import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function triggerDispatch() {
  try {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/dispatch-webhooks`;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
  } catch {}
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('[FollowUp] Starting scheduler...');

    // =========================================
    // PART A: Schedule follow-ups for new appointments
    // =========================================
    
    // Find appointments with status 'scheduled' that don't have follow-up executions yet
    const { data: appointments, error: apptError } = await supabase
      .from('appointments')
      .select(`
        id, date, time, title, description, contact_id, duration, status,
        contacts!appointments_contact_id_fkey (id, name, call_name, phone_number)
      `)
      .eq('status', 'scheduled');

    if (apptError) {
      console.error('[FollowUp] Error fetching appointments:', apptError);
      throw apptError;
    }

    let scheduled = 0;
    
    if (appointments && appointments.length > 0) {
      // Get appointments that already have executions
      const appointmentIds = appointments.map(a => a.id);
      const { data: existingExecutions } = await supabase
        .from('followup_executions')
        .select('appointment_id')
        .in('appointment_id', appointmentIds);

      const alreadyScheduled = new Set((existingExecutions || []).map(e => e.appointment_id));

      // Get active sequences
      const { data: sequences } = await supabase
        .from('followup_sequences')
        .select('id, trigger_event')
        .eq('is_active', true);

      if (sequences && sequences.length > 0) {
        for (const appointment of appointments) {
          if (alreadyScheduled.has(appointment.id)) continue;

          // Find matching sequence
          const matchingSequence = sequences.find(s => s.trigger_event === 'appointment_scheduled');
          if (!matchingSequence) continue;

          // Get steps for this sequence
          const { data: steps } = await supabase
            .from('followup_steps')
            .select('*')
            .eq('sequence_id', matchingSequence.id)
            .eq('is_active', true)
            .order('step_order', { ascending: true });

          if (!steps || steps.length === 0) continue;

          // Find conversation for this contact
          const { data: conversation } = await supabase
            .from('conversations')
            .select('id')
            .eq('contact_id', appointment.contact_id)
            .order('last_message_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!conversation) {
            console.log(`[FollowUp] No conversation found for contact ${appointment.contact_id}`);
            continue;
          }

          // Calculate appointment datetime
          const appointmentDatetime = new Date(`${appointment.date}T${appointment.time}`);
          
          // Create executions for each step
          const executions = steps.map(step => {
            const scheduledFor = new Date(appointmentDatetime.getTime() + step.delay_minutes * 60 * 1000);
            return {
              step_id: step.id,
              appointment_id: appointment.id,
              contact_id: appointment.contact_id,
              conversation_id: conversation.id,
              status: 'scheduled',
              scheduled_for: scheduledFor.toISOString(),
            };
          }).filter(e => new Date(e.scheduled_for) > new Date()); // Only future executions

          if (executions.length > 0) {
            const { error: insertError } = await supabase
              .from('followup_executions')
              .insert(executions);

            if (insertError) {
              console.error(`[FollowUp] Error inserting executions for appointment ${appointment.id}:`, insertError);
            } else {
              scheduled += executions.length;
              console.log(`[FollowUp] Scheduled ${executions.length} follow-ups for appointment ${appointment.id}`);
            }
          }
        }
      }
    }

    // =========================================
    // PART B: Dispatch due follow-up messages
    // =========================================
    
    const { data: dueExecutions, error: dueError } = await supabase
      .from('followup_executions')
      .select(`
        id, step_id, appointment_id, contact_id, conversation_id, scheduled_for,
        followup_steps!followup_executions_step_id_fkey (message_template, step_order, webhook_endpoint_id, is_question, webhook_on_negative_id)
      `)
      .eq('status', 'scheduled')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(50);

    if (dueError) {
      console.error('[FollowUp] Error fetching due executions:', dueError);
      throw dueError;
    }

    let sent = 0;

    if (dueExecutions && dueExecutions.length > 0) {
      for (const execution of dueExecutions) {
        try {
          // Fetch appointment + contact data
          const { data: appointment } = await supabase
            .from('appointments')
            .select('id, date, time, title, status, meeting_url')
            .eq('id', execution.appointment_id)
            .single();

          if (!appointment || appointment.status === 'cancelled') {
            // Cancel this execution
            await supabase
              .from('followup_executions')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() })
              .eq('id', execution.id);
            continue;
          }

          const { data: contact } = await supabase
            .from('contacts')
            .select('name, call_name, phone_number')
            .eq('id', execution.contact_id)
            .single();

          if (!contact) continue;

          // Get nina_settings for calendly URL
          const { data: settings } = await supabase
            .from('nina_settings')
            .select('calendly_scheduling_url')
            .limit(1)
            .maybeSingle();

          // Process template
          const step = execution.followup_steps as any;
          let message = step?.message_template || '';
          
          const nome = contact.call_name || contact.name || 'cliente';
          const data = formatDate(appointment.date);
          const horario = appointment.time?.substring(0, 5) || '';
          const titulo = appointment.title || 'reunião';
          const linkCalendly = settings?.calendly_scheduling_url || '';

          message = message
            .replace(/\{\{nome\}\}/gi, nome)
            .replace(/\{\{data\}\}/gi, data)
            .replace(/\{\{horario\}\}/gi, horario)
            .replace(/\{\{titulo\}\}/gi, titulo)
            .replace(/\{\{link_calendly\}\}/gi, linkCalendly);

          // Insert into send_queue - use buttons for question steps
          const isQuestion = !!step?.is_question;
          const sendPayload: any = {
            contact_id: execution.contact_id,
            conversation_id: execution.conversation_id,
            content: message,
            message_type: isQuestion ? 'menu' : 'text',
            from_type: 'nina',
            status: 'pending',
            priority: 2,
            metadata: {
              source: 'followup',
              step_order: step?.step_order,
              appointment_id: execution.appointment_id,
              ...(isQuestion ? {
                menu_type: 'button',
                menu_text: message,
                menu_choices: ['Sim, confirmo ✅|confirm', 'Não poderei ❌|decline'],
                menu_footer: 'Responda clicando em um botão',
                followup_execution_id: execution.id,
                webhook_positive_id: step?.webhook_endpoint_id || null,
                webhook_negative_id: step?.webhook_on_negative_id || null,
              } : {})
            }
          };

          const { error: sendError } = await supabase
            .from('send_queue')
            .insert(sendPayload);

          if (sendError) {
            console.error(`[FollowUp] Error sending message for execution ${execution.id}:`, sendError);
            continue;
          }

          // Mark as sent (with reply_status if it's a question)
          const updateData: any = { status: 'sent', sent_at: new Date().toISOString() };
          if (step?.is_question) {
            updateData.reply_status = 'awaiting_reply';
          }
          await supabase
            .from('followup_executions')
            .update(updateData)
            .eq('id', execution.id);

          sent++;
          console.log(`[FollowUp] Sent follow-up message for execution ${execution.id}`);

          // Dispatch webhook for this step if configured
          // If is_question, do NOT dispatch webhook now - wait for reply
          const stepWebhookId = step?.webhook_endpoint_id;
          if (stepWebhookId && !step?.is_question) {
            await enqueueFollowUpWebhook(supabase, stepWebhookId, 'followup_step_sent', {
              step_order: step?.step_order,
              appointment_id: execution.appointment_id,
              contact_id: execution.contact_id,
              contact_name: contact.call_name || contact.name,
              contact_phone: contact.phone_number,
              appointment_date: appointment.date,
              appointment_time: appointment.time,
              appointment_title: appointment.title,
            });
          }

          // Check if all steps for this appointment are now sent → dispatch completed webhook
          const { data: remainingScheduled } = await supabase
            .from('followup_executions')
            .select('id')
            .eq('appointment_id', execution.appointment_id)
            .eq('status', 'scheduled')
            .limit(1);

          if (!remainingScheduled || remainingScheduled.length === 0) {
            // All steps sent - check for completed webhook
            const { data: seqForCompleted } = await supabase
              .from('followup_sequences')
              .select('webhook_on_completed_id')
              .eq('is_active', true)
              .limit(1)
              .maybeSingle();

            if (seqForCompleted?.webhook_on_completed_id) {
              await enqueueFollowUpWebhook(supabase, seqForCompleted.webhook_on_completed_id, 'followup_completed', {
                appointment_id: execution.appointment_id,
                contact_id: execution.contact_id,
                contact_name: contact.call_name || contact.name,
                contact_phone: contact.phone_number,
                appointment_date: appointment.date,
                appointment_time: appointment.time,
                appointment_title: appointment.title,
              });
            }
          }
        } catch (err) {
          console.error(`[FollowUp] Error processing execution ${execution.id}:`, err);
        }
      }
    }

    // =========================================
    // PART C: Cancel executions for cancelled appointments
    // =========================================
    
    const { data: cancelledAppts } = await supabase
      .from('appointments')
      .select('id, contact_id, date, time, title')
      .eq('status', 'cancelled');

    let cancelled = 0;
    if (cancelledAppts && cancelledAppts.length > 0) {
      const cancelledIds = cancelledAppts.map(a => a.id);
      const { data: cancelledExecs, error: cancelError } = await supabase
        .from('followup_executions')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .in('appointment_id', cancelledIds)
        .eq('status', 'scheduled')
        .select('id, appointment_id, contact_id');

      if (!cancelError && cancelledExecs) {
        cancelled = cancelledExecs.length;

        // Dispatch cancelled webhook if configured
        if (cancelled > 0) {
          const { data: seqForCancelled } = await supabase
            .from('followup_sequences')
            .select('webhook_on_cancelled_id')
            .eq('is_active', true)
            .limit(1)
            .maybeSingle();

          if (seqForCancelled?.webhook_on_cancelled_id) {
            // Get unique appointment IDs that were just cancelled
            const cancelledApptIds = [...new Set(cancelledExecs.map(e => e.appointment_id))];
            for (const apptId of cancelledApptIds) {
              const appt = cancelledAppts.find(a => a.id === apptId);
              const exec = cancelledExecs.find(e => e.appointment_id === apptId);
              if (appt && exec) {
                const { data: cancelContact } = await supabase
                  .from('contacts')
                  .select('name, call_name, phone_number')
                  .eq('id', exec.contact_id)
                  .single();

                await enqueueFollowUpWebhook(supabase, seqForCancelled.webhook_on_cancelled_id, 'followup_cancelled', {
                  appointment_id: apptId,
                  contact_id: exec.contact_id,
                  contact_name: cancelContact?.call_name || cancelContact?.name,
                  contact_phone: cancelContact?.phone_number,
                  appointment_date: appt.date,
                  appointment_time: appt.time,
                  appointment_title: appt.title,
                });
              }
            }
          }
        }
      }
    }

    const result = { scheduled, sent, cancelled };
    console.log('[FollowUp] Done:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[FollowUp] Scheduler error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function formatDate(dateStr: string): string {
  try {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

async function enqueueFollowUpWebhook(supabase: any, endpointId: string, eventType: string, payload: Record<string, any>) {
  try {
    const idempotencyKey = `followup_${eventType}_${payload.appointment_id}_${Date.now()}`;
    await supabase
      .from('webhook_outbox')
      .insert({
        endpoint_id: endpointId,
        event_type: eventType,
        idempotency_key: idempotencyKey,
        payload,
        status: 'pending',
        next_retry_at: new Date().toISOString(),
      });
    console.log(`[FollowUp] Enqueued webhook ${eventType} for endpoint ${endpointId}`);
    triggerDispatch();
  } catch (err) {
    console.error(`[FollowUp] Error enqueuing webhook:`, err);
  }
}
