import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, calendly-webhook-signature',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // ─── Setup action: create webhook subscription ───
    if (action === 'setup') {
      return await handleSetup(req, supabase, supabaseUrl);
    }

    const body = await req.json();
    const event = body.event;
    const payload = body.payload;

    console.log(`[Calendly Webhook] Event received: ${event}`);

    if (!payload) {
      return new Response(JSON.stringify({ error: 'No payload' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (event === 'invitee.created') {
      return await handleInviteeCreated(payload, supabase);
    }

    if (event === 'invitee.canceled') {
      return await handleInviteeCanceled(payload, supabase);
    }

    if (event === 'invitee_no_show.created') {
      return await handleNoShowCreated(payload, supabase);
    }

    if (event === 'invitee_no_show.deleted') {
      return await handleNoShowDeleted(payload, supabase);
    }

    // Unknown event
    console.log(`[Calendly Webhook] Unhandled event: ${event}`);
    return jsonResponse({ success: true, action: 'ignored', event });

  } catch (error) {
    console.error('[Calendly Webhook] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ─── Find appointment by calendly event URI ───
async function findAppointmentByCalendlyUri(supabase: any, calendlyEventUri: string) {
  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, metadata, contact_id')
    .limit(100);

  return (appointments || []).find((a: any) => {
    const meta = a.metadata as any;
    return meta?.calendly_event_uri === calendlyEventUri;
  });
}

// ─── Update contact follow_up_status ───
async function updateContactFollowUpStatus(supabase: any, contactId: string | null, status: string) {
  if (!contactId) return;
  const { error } = await supabase
    .from('contacts')
    .update({ follow_up_status: status, updated_at: new Date().toISOString() })
    .eq('id', contactId);
  if (error) {
    console.error(`[Calendly Webhook] Error updating follow_up_status to ${status} for contact ${contactId}:`, error);
  } else {
    console.log(`[Calendly Webhook] Contact ${contactId} follow_up_status → ${status}`);
  }
}

// ─── Cancel pending followup executions for an appointment ───
async function cancelFollowupExecutions(supabase: any, appointmentId: string, reason: string) {
  const { error } = await supabase
    .from('followup_executions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('appointment_id', appointmentId)
    .eq('status', 'scheduled');

  if (error) {
    console.error(`[Calendly Webhook] Error cancelling followup executions for ${appointmentId}:`, error);
  } else {
    console.log(`[Calendly Webhook] Cancelled pending followup executions for appointment ${appointmentId} (${reason})`);
  }
}

// ─── Recalculate followup executions for rescheduled appointment ───
async function recalculateFollowups(supabase: any, appointmentId: string, newStartTime: string, contactId: string | null) {
  // Cancel existing pending executions
  await cancelFollowupExecutions(supabase, appointmentId, 'reschedule');

  // Find active sequences
  const { data: sequences } = await supabase
    .from('followup_sequences')
    .select('id, name')
    .eq('is_active', true)
    .eq('trigger_event', 'appointment_scheduled');

  if (!sequences || sequences.length === 0) return;

  // Find conversation for this contact
  let conversationId: string | null = null;
  if (contactId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    conversationId = conv?.id || null;
  }

  if (!conversationId || !contactId) {
    console.log('[Calendly Webhook] No conversation/contact found, skipping followup recalculation');
    return;
  }

  const appointmentDate = new Date(newStartTime);

  for (const seq of sequences) {
    const { data: steps } = await supabase
      .from('followup_steps')
      .select('*')
      .eq('sequence_id', seq.id)
      .eq('is_active', true)
      .order('step_order', { ascending: true });

    if (!steps || steps.length === 0) continue;

    const executions = steps.map((step: any) => {
      const scheduledFor = new Date(appointmentDate.getTime() + step.delay_minutes * 60 * 1000);
      return {
        step_id: step.id,
        appointment_id: appointmentId,
        contact_id: contactId,
        conversation_id: conversationId,
        scheduled_for: scheduledFor.toISOString(),
        status: 'scheduled',
      };
    });

    const { error } = await supabase.from('followup_executions').insert(executions);
    if (error) {
      console.error(`[Calendly Webhook] Error creating followup executions for sequence ${seq.name}:`, error);
    } else {
      console.log(`[Calendly Webhook] Created ${executions.length} followup executions for sequence ${seq.name}`);
    }
  }
}

// ─── Setup handler ───
async function handleSetup(req: Request, supabase: any, supabaseUrl: string) {
  const calendlyToken = Deno.env.get('CALENDLY_API_TOKEN');
  if (!calendlyToken) {
    return jsonResponse({ error: 'CALENDLY_API_TOKEN not configured' }, 500);
  }

  const apiHeaders = {
    'Authorization': `Bearer ${calendlyToken}`,
    'Content-Type': 'application/json',
  };

  const userRes = await fetch('https://api.calendly.com/users/me', { headers: apiHeaders });
  if (!userRes.ok) {
    const text = await userRes.text();
    return jsonResponse({ error: `Calendly API error: ${userRes.status}`, details: text }, userRes.status);
  }
  const userData = await userRes.json();
  const organizationUri = userData.resource?.current_organization;
  const userUri = userData.resource?.uri;

  const body = await req.json().catch(() => ({}));
  const callbackUrl = body.callback_url || `${supabaseUrl}/functions/v1/calendly-webhook`;
  const events = ['invitee.created', 'invitee.canceled', 'invitee_no_show.created', 'invitee_no_show.deleted'];

  // Check for existing webhook
  const listRes = await fetch(`https://api.calendly.com/webhook_subscriptions?organization=${encodeURIComponent(organizationUri)}&scope=organization`, { headers: apiHeaders });
  if (listRes.ok) {
    const listData = await listRes.json();
    const existing = (listData.collection || []).find((w: any) => w.callback_url === callbackUrl);
    if (existing) {
      return jsonResponse({ success: true, message: 'Webhook já está ativo', webhook: existing });
    }
  }

  // Create webhook
  const createRes = await fetch('https://api.calendly.com/webhook_subscriptions', {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({ url: callbackUrl, events, organization: organizationUri, user: userUri, scope: 'organization' }),
  });

  if (!createRes.ok) {
    const text = await createRes.text();
    return jsonResponse({ error: `Failed to create webhook: ${createRes.status}`, details: text }, createRes.status);
  }

  const webhookData = await createRes.json();
  return jsonResponse({ success: true, message: 'Webhook do Calendly ativado!', webhook: webhookData.resource });
}

// ─── invitee.created ───
async function handleInviteeCreated(payload: any, supabase: any) {
  const scheduledEvent = payload.scheduled_event;
  const invitee = payload;

  const eventName = scheduledEvent?.name || 'Reunião Calendly';
  const startTime = scheduledEvent?.start_time;
  const endTime = scheduledEvent?.end_time;
  const meetingUrl = scheduledEvent?.location?.join_url || payload.tracking?.utm_content || '';
  const inviteeName = invitee.name || invitee.first_name || 'Convidado';
  const inviteeEmail = invitee.email || '';
  const inviteePhone = invitee.text_reminder_number || '';
  const calendlyEventUri = scheduledEvent?.uri || '';
  const inviteeUri = invitee.uri || '';
  const cancelUrl = invitee.cancel_url || '';
  const rescheduleUrl = invitee.reschedule_url || '';

  const startDate = new Date(startTime);
  const dateStr = startDate.toISOString().split('T')[0];
  const timeStr = startDate.toTimeString().substring(0, 5);

  let duration = 30;
  if (endTime && startTime) {
    duration = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
  }

  // Find contact
  let contactId: string | null = null;
  if (inviteeEmail) {
    const { data: contactByEmail } = await supabase
      .from('contacts').select('id').eq('email', inviteeEmail).limit(1).maybeSingle();
    if (contactByEmail) contactId = contactByEmail.id;
  }
  if (!contactId && inviteePhone) {
    const cleanPhone = inviteePhone.replace(/\D/g, '');
    const { data: contactByPhone } = await supabase
      .from('contacts').select('id').ilike('phone_number', `%${cleanPhone.slice(-9)}`).limit(1).maybeSingle();
    if (contactByPhone) contactId = contactByPhone.id;
  }

  // Check for existing (reschedule scenario)
  const { data: existing } = await supabase
    .from('appointments').select('id').contains('metadata', { calendly_event_uri: calendlyEventUri }).limit(1).maybeSingle();

  if (existing) {
    await supabase.from('appointments').update({
      status: 'scheduled',
      date: dateStr,
      time: timeStr,
      duration,
      meeting_url: meetingUrl || undefined,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);

    // Reschedule: recalculate followup executions
    await recalculateFollowups(supabase, existing.id, startTime, contactId);
    console.log(`[Calendly Webhook] Updated & recalculated followups for appointment ${existing.id}`);
  } else {
    const attendees = [inviteeName];
    if (inviteeEmail) attendees.push(inviteeEmail);

    const metadata = {
      source: 'calendly',
      calendly_event_uri: calendlyEventUri,
      calendly_invitee_uri: inviteeUri,
      calendly_cancel_url: cancelUrl,
      calendly_reschedule_url: rescheduleUrl,
      invitee_name: inviteeName,
      invitee_email: inviteeEmail,
      invitee_phone: inviteePhone,
      invitee_status: 'accepted',
    };

    const { error: insertErr } = await supabase.from('appointments').insert({
      title: `${eventName} - ${inviteeName}`,
      date: dateStr,
      time: timeStr,
      duration,
      type: 'meeting',
      description: `Agendamento via Calendly\n${inviteeName} (${inviteeEmail})`,
      status: 'scheduled',
      meeting_url: meetingUrl,
      attendees,
      contact_id: contactId,
      metadata,
    });

    if (insertErr) {
      console.error('[Calendly Webhook] Insert error:', insertErr);
      throw insertErr;
    }
    console.log(`[Calendly Webhook] Created appointment for ${inviteeName} on ${dateStr} at ${timeStr}`);
  }

  // Update contact follow_up_status → agendado
  await updateContactFollowUpStatus(supabase, contactId, 'agendado');

  return jsonResponse({ success: true, action: 'created' });
}

// ─── invitee.canceled ───
async function handleInviteeCanceled(payload: any, supabase: any) {
  const scheduledEvent = payload.scheduled_event;
  const calendlyEventUri = scheduledEvent?.uri || '';
  const cancelerName = payload.name || 'Convidado';
  const cancelReason = payload.cancellation?.reason || '';

  if (!calendlyEventUri) return jsonResponse({ success: true, action: 'canceled' });

  const match = await findAppointmentByCalendlyUri(supabase, calendlyEventUri);

  if (match) {
    const updatedMeta = {
      ...(match.metadata as any),
      invitee_status: 'canceled',
      cancel_reason: cancelReason,
      canceled_by: cancelerName,
      canceled_at: new Date().toISOString(),
    };

    await supabase.from('appointments').update({
      status: 'canceled',
      metadata: updatedMeta,
      updated_at: new Date().toISOString(),
    }).eq('id', match.id);

    // Cancel pending followup executions
    await cancelFollowupExecutions(supabase, match.id, 'canceled');
    // Update contact follow_up_status → cancelado
    await updateContactFollowUpStatus(supabase, match.contact_id, 'cancelado');
    console.log(`[Calendly Webhook] Canceled appointment ${match.id}`);
  }

  return jsonResponse({ success: true, action: 'canceled' });
}

// ─── invitee_no_show.created ───
async function handleNoShowCreated(payload: any, supabase: any) {
  const inviteeUri = payload.invitee || '';
  if (!inviteeUri) return jsonResponse({ success: true, action: 'no_show' });

  const { data: appointments } = await supabase
    .from('appointments').select('id, metadata').limit(100);

  const match = (appointments || []).find((a: any) => {
    const meta = a.metadata as any;
    return meta?.calendly_invitee_uri === inviteeUri;
  });

  if (match) {
    const updatedMeta = {
      ...(match.metadata as any),
      invitee_status: 'no_show',
    };

    await supabase.from('appointments').update({
      status: 'no_show',
      metadata: updatedMeta,
      updated_at: new Date().toISOString(),
    }).eq('id', match.id);

    // Cancel pending followup executions
    await cancelFollowupExecutions(supabase, match.id, 'no_show');
    // Update contact follow_up_status → no_show
    await updateContactFollowUpStatus(supabase, match.contact_id, 'no_show');
    console.log(`[Calendly Webhook] No-show for appointment ${match.id}`);
  }

  return jsonResponse({ success: true, action: 'no_show' });
}

// ─── invitee_no_show.deleted (revert no-show) ───
async function handleNoShowDeleted(payload: any, supabase: any) {
  const inviteeUri = payload.invitee || '';
  if (!inviteeUri) return jsonResponse({ success: true, action: 'no_show_reverted' });

  const { data: appointments } = await supabase
    .from('appointments').select('id, metadata, contact_id, date, time').limit(100);

  const match = (appointments || []).find((a: any) => {
    const meta = a.metadata as any;
    return meta?.calendly_invitee_uri === inviteeUri;
  });

  if (match) {
    const updatedMeta = {
      ...(match.metadata as any),
      invitee_status: 'accepted',
    };

    await supabase.from('appointments').update({
      status: 'scheduled',
      metadata: updatedMeta,
      updated_at: new Date().toISOString(),
    }).eq('id', match.id);

    // Recalculate followups since appointment is active again
    const startTime = `${match.date}T${match.time}`;
    await recalculateFollowups(supabase, match.id, startTime, match.contact_id);
    // Update contact follow_up_status → agendado
    await updateContactFollowUpStatus(supabase, match.contact_id, 'agendado');
    console.log(`[Calendly Webhook] Reverted no-show for appointment ${match.id}`);
  }

  return jsonResponse({ success: true, action: 'no_show_reverted' });
}
