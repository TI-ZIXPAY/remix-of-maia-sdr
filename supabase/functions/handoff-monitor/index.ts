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

/** Normalize a field value for select fields to match the exact registered label */
function normalizeFieldValue(rawValue: string | null, fieldDef: any): string | null {
  if (!rawValue) return rawValue;
  if (fieldDef.field_type !== 'select') return rawValue;
  const options: string[] = fieldDef.options || [];
  if (options.length === 0) return rawValue;
  const exactMatch = options.find((opt: string) => opt === rawValue);
  if (exactMatch) return exactMatch;
  const lowerRaw = rawValue.toLowerCase().trim();
  const ciMatch = options.find((opt: string) => opt.toLowerCase().trim() === lowerRaw);
  if (ciMatch) return ciMatch;
  const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const strippedRaw = stripAccents(rawValue);
  const accentMatch = options.find((opt: string) => stripAccents(opt) === strippedRaw);
  if (accentMatch) return accentMatch;
  const toSlug = (s: string) => stripAccents(s).replace(/[\s\-_]+/g, '');
  const slugMatch = options.find((opt: string) => toSlug(opt) === toSlug(rawValue));
  if (slugMatch) return slugMatch;
  const partialMatch = options.find((opt: string) => {
    const optLower = stripAccents(opt);
    return optLower.includes(strippedRaw) || strippedRaw.includes(optLower);
  });
  if (partialMatch) return partialMatch;
  return rawValue;
}

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function generateHandoffSummary(
  lovableApiKey: string,
  messages: any[],
  contact: any,
  deal: any,
  customFields: Record<string, string>
): Promise<string> {
  try {
    const conversationText = messages
      .map((m: any) => `[${m.from_type}]: ${m.content || '(mídia)'}`)
      .join('\n');

    const response = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          {
            role: 'system',
            content: `Você é um analista de vendas. Gere um resumo conciso (máximo 500 caracteres) da conversa entre o assistente virtual e o cliente. Inclua:
1. O que o cliente buscava
2. Principais informações coletadas
3. Status atual do negócio
4. Motivo da transferência para humano (inatividade)
Seja direto e objetivo. Escreva em português.`
          },
          {
            role: 'user',
            content: `CONVERSA:\n${conversationText}\n\nCONTATO: ${contact?.name || 'Sem nome'} (${contact?.phone_number})\nSCORE: ${contact?.lead_score || 0}\nCLASSIFICAÇÃO: ${contact?.lead_classification || 'new'}\nCAMPOS: ${JSON.stringify(customFields)}\nDEAL VALOR: ${deal?.value || 0}`
          }
        ]
      })
    });

    if (!response.ok) {
      console.error('[handoff-monitor] AI summary failed:', response.status);
      return 'Resumo indisponível';
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Resumo indisponível';
  } catch (err) {
    console.error('[handoff-monitor] Error generating summary:', err);
    return 'Resumo indisponível';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('[handoff-monitor] Starting inactivity check...');

    // Load handoff settings
    const { data: handoffSettings } = await supabase
      .from('nina_settings')
      .select('handoff_timeout_minutes, handoff_webhook_endpoint_id, handoff_team_id')
      .limit(1)
      .maybeSingle();

    const timeoutMinutes = (handoffSettings as any)?.handoff_timeout_minutes || 15;
    const handoffWebhookEndpointId = (handoffSettings as any)?.handoff_webhook_endpoint_id || null;

    console.log(`[handoff-monitor] Timeout: ${timeoutMinutes}min, specific webhook: ${handoffWebhookEndpointId || 'all'}`);

    // Find conversations where Nina sent the last message > N min ago,
    // status is 'nina', and no scheduled appointment exists
    const { data: staleConversations, error: queryError } = await supabase
      .rpc('find_stale_nina_conversations');

    // If RPC doesn't exist, use raw query approach via direct SQL
    let conversations: any[] = [];

    if (queryError || !staleConversations) {
      console.log('[handoff-monitor] Using direct query approach...');
      
      // Get all active nina conversations
      const { data: ninaConvos } = await supabase
        .from('conversations')
        .select('id, contact_id, user_id')
        .eq('status', 'nina')
        .eq('is_active', true);

      if (!ninaConvos || ninaConvos.length === 0) {
        console.log('[handoff-monitor] No active nina conversations found');
        return new Response(JSON.stringify({ transferred: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();

      for (const convo of ninaConvos) {
        // Get the latest message in this conversation
        const { data: lastMsg } = await supabase
          .from('messages')
          .select('from_type, sent_at')
          .eq('conversation_id', convo.id)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastMsg) continue;

        // Only handoff if last message was from nina and older than 15 min
        if (lastMsg.from_type !== 'nina') continue;
        if (lastMsg.sent_at > cutoff) continue;

        // Check if contact has a scheduled appointment (skip if yes)
        const { data: activeAppt } = await supabase
          .from('appointments')
          .select('id')
          .eq('contact_id', convo.contact_id)
          .eq('status', 'scheduled')
          .limit(1)
          .maybeSingle();

        if (activeAppt) continue;

        conversations.push(convo);
      }
    } else {
      conversations = staleConversations;
    }

    if (conversations.length === 0) {
      console.log('[handoff-monitor] No stale conversations found');
      return new Response(JSON.stringify({ transferred: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[handoff-monitor] Found ${conversations.length} stale conversations`);

    // Get the "Transferido p/ Humano" pipeline stage
    const { data: handoffStage } = await supabase
      .from('pipeline_stages')
      .select('id, webhook_endpoint_id')
      .eq('title', 'Transferido p/ Humano')
      .eq('is_active', true)
      .maybeSingle();

    // Pre-fetch roulette member once for all conversations (each gets own call for fairness)
    let transferred = 0;

    for (const convo of conversations) {
      try {
        // 1. Update conversation status to 'human'
        await supabase
          .from('conversations')
          .update({ status: 'human', updated_at: new Date().toISOString() })
          .eq('id', convo.id);

        // 2. Move deal to handoff stage
        if (handoffStage) {
          await supabase
            .from('deals')
            .update({ stage_id: handoffStage.id, updated_at: new Date().toISOString() })
            .eq('contact_id', convo.contact_id);

          // Dispatch stage-specific webhook if configured
          if (handoffStage.webhook_endpoint_id) {
            const stagePayload = {
              event: 'deal.stage_changed',
              stage: 'Transferido p/ Humano',
              stage_id: handoffStage.id,
              trigger: 'inactivity_timeout',
              contact_id: convo.contact_id,
              moved_at: new Date().toISOString(),
            };
            await supabase.from('webhook_outbox').insert({
              endpoint_id: handoffStage.webhook_endpoint_id,
              event_type: 'deal.stage_changed',
              payload: stagePayload,
              idempotency_key: `stage-handoff-monitor-${convo.id}-${Date.now()}`,
              status: 'pending',
            });
            triggerDispatch();
          }
        }

        // 2.5 Roulette: pick next human owner
        const { data: rouletteResult } = await supabase.rpc('pick_next_roulette_member');
        let assignedOwner: any = null;

        if (rouletteResult && rouletteResult.length > 0) {
          assignedOwner = rouletteResult[0];

          await supabase.from('deals')
            .update({ owner_id: assignedOwner.member_id, updated_at: new Date().toISOString() })
            .eq('contact_id', convo.contact_id);

          await supabase.from('conversations')
            .update({ assigned_user_id: assignedOwner.user_id })
            .eq('id', convo.id);

          const { data: dealForAssignment } = await supabase.from('deals')
            .select('id').eq('contact_id', convo.contact_id).maybeSingle();

          await supabase.from('roulette_assignments').insert({
            team_member_id: assignedOwner.member_id,
            deal_id: dealForAssignment?.id || null,
            contact_id: convo.contact_id,
          });

          console.log(`[handoff-monitor] Roulette assigned to: ${assignedOwner.member_name}`);
        }

        // 3. Build webhook payload
        const { data: contact } = await supabase
          .from('contacts')
          .select('*')
          .eq('id', convo.contact_id)
          .maybeSingle();

        const { data: deal } = await supabase
          .from('deals')
          .select('id, value, stage_id')
          .eq('contact_id', convo.contact_id)
          .maybeSingle();

        const { data: lastMessage } = await supabase
          .from('messages')
          .select('content, sent_at')
          .eq('conversation_id', convo.id)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const { count: totalMessages } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', convo.id);

        // Fetch last 100 messages for AI summary
        const { data: recentMessages } = await supabase
          .from('messages')
          .select('from_type, content, sent_at')
          .eq('conversation_id', convo.id)
          .order('sent_at', { ascending: true })
          .limit(100);

        // Load custom field values with normalization
        let customFields: Record<string, string> = {};
        if (contact) {
          const { data: cfValues } = await supabase
            .from('contact_custom_field_values')
            .select('value, contact_custom_fields!inner(field_key, field_type, options)')
            .eq('contact_id', contact.id);
          if (cfValues) {
            for (const row of cfValues) {
              const fieldInfo = (row as any).contact_custom_fields;
              const key = fieldInfo?.field_key;
              if (key && row.value) {
                customFields[key] = normalizeFieldValue(row.value, fieldInfo) || row.value;
              }
            }
          }
        }

        // Generate AI summary
        const handoffSummary = await generateHandoffSummary(
          lovableApiKey,
          recentMessages || [],
          contact,
          deal,
          customFields
        );

        console.log(`[handoff-monitor] Summary generated for ${convo.id}: ${handoffSummary.substring(0, 100)}...`);

        // Save summary to conversation
        await supabase
          .from('conversations')
          .update({ handoff_summary: handoffSummary })
          .eq('id', convo.id);

        const payload = {
          event: 'lead.handoff',
          reason: 'inactivity_timeout',
          handoff_summary: handoffSummary,
          assigned_to: assignedOwner ? {
            name: assignedOwner.member_name,
            email: assignedOwner.member_email,
            user_id: assignedOwner.user_id,
            external_id: assignedOwner.external_id || null,
          } : null,
          contact: {
            id: contact?.id,
            name: contact?.name,
            phone_number: contact?.phone_number,
            email: contact?.email,
            lead_score: contact?.lead_score,
            lead_classification: contact?.lead_classification,
            tags: contact?.tags || [],
            custom_fields: customFields,
          },
          conversation: {
            id: convo.id,
            last_message: lastMessage?.content || '',
            total_messages: totalMessages || 0,
            started_at: lastMessage?.sent_at || '',
            handoff_summary: handoffSummary,
          },
          deal: {
            id: deal?.id || null,
            owner_id: assignedOwner?.user_id || null,
            stage: 'Transferido p/ Humano',
            value: deal?.value || 0,
          },
          handoff_at: new Date().toISOString(),
        };

        // 4. Insert into webhook_outbox — use configured endpoint or all enabled
        if (handoffWebhookEndpointId) {
          // Send only to the configured handoff webhook
          await supabase.from('webhook_outbox').insert({
            endpoint_id: handoffWebhookEndpointId,
            event_type: 'lead.handoff',
            payload,
            idempotency_key: `handoff-inactivity-${convo.id}-${Date.now()}`,
            status: 'pending',
          });
          triggerDispatch();
        } else {
          // Fallback: send to all enabled endpoints
          const { data: endpoints } = await supabase
            .from('webhook_endpoints')
            .select('id')
            .eq('enabled', true);

          if (endpoints && endpoints.length > 0) {
            const outboxRows = endpoints.map((ep: any) => ({
              endpoint_id: ep.id,
              event_type: 'lead.handoff',
              payload,
              idempotency_key: `handoff-inactivity-${convo.id}-${Date.now()}-${ep.id}`,
              status: 'pending',
            }));

            await supabase.from('webhook_outbox').insert(outboxRows);
            triggerDispatch();
          }
        }

        // 5. Internal handoff — no message sent to client

        transferred++;
        console.log(`[handoff-monitor] Transferred conversation ${convo.id}`);
      } catch (err) {
        console.error(`[handoff-monitor] Error processing conversation ${convo.id}:`, err);
      }
    }

    console.log(`[handoff-monitor] Completed: ${transferred} transfers`);

    return new Response(JSON.stringify({ transferred, checked: conversations.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[handoff-monitor] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
