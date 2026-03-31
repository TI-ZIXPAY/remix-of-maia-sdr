import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Normalize Brazilian phone: always add 9th digit (55+DDD+9+8digits = 13 digits) */
function normalizeBrazilianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("55")) {
    return "55" + digits.slice(2, 4) + "9" + digits.slice(4);
  }
  return digits;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Check if auto greeting is enabled
    const { data: settings } = await supabase
      .from('nina_settings')
      .select('auto_greeting_enabled, auto_greeting_message, auto_greeting_messages, sdr_name')
      .limit(1)
      .maybeSingle();

    const greetingMessages: string[] = Array.isArray(settings?.auto_greeting_messages) ? settings.auto_greeting_messages.filter((m: string) => m && m.trim()) : [];
    const hasMessages = greetingMessages.length > 0 || !!settings?.auto_greeting_message;

    if (!settings?.auto_greeting_enabled || !hasMessages) {
      console.log('[AutoGreeting] Disabled or no message configured');
      return new Response(JSON.stringify({ skipped: true, reason: 'disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Find deals created between delay minutes ago, with contact, where contact has NO conversation
    const { data: eligibleDeals, error: dealsError } = await supabase
      .rpc('get_deals_needing_greeting');

    if (dealsError) {
      console.error('[AutoGreeting] Error fetching eligible deals:', dealsError);
      throw new Error('Failed to fetch eligible deals');
    }

    if (!eligibleDeals || eligibleDeals.length === 0) {
      console.log('[AutoGreeting] No eligible deals found');
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[AutoGreeting] Found ${eligibleDeals.length} eligible deals`);

    let processed = 0;

    for (const deal of eligibleDeals) {
      try {
        // 3. Get contact info
        const { data: contact } = await supabase
          .from('contacts')
          .select('name, call_name, phone_number')
          .eq('id', deal.contact_id)
          .single();

        if (!contact) {
          console.log(`[AutoGreeting] Contact ${deal.contact_id} not found, skipping`);
          continue;
        }

        // 4. Normalize phone (with Brazilian 9th digit) and check if ANY conversation exists
        const normalizedPhone = normalizeBrazilianPhone(contact.phone_number || '');
        if (!normalizedPhone) {
          console.log(`[AutoGreeting] Contact ${deal.contact_id} has no valid phone, skipping`);
          continue;
        }

        // Query all contacts with same normalized phone that have conversations
        const { data: existingConvByPhone } = await supabase
          .from('conversations')
          .select('id, contacts!inner(phone_number)')
          .limit(1);

        // Two-step check: get all contact IDs with same normalized phone, then check conversations
        const { data: allContactsWithPhone } = await supabase
          .from('contacts')
          .select('id, phone_number');

        const matchingContactIds = (allContactsWithPhone || [])
          .filter(c => normalizeBrazilianPhone(c.phone_number || '') === normalizedPhone)
          .map(c => c.id);

        if (matchingContactIds.length > 0) {
          const { data: existingConv } = await supabase
            .from('conversations')
            .select('id')
            .in('contact_id', matchingContactIds)
            .limit(1)
            .maybeSingle();

          if (existingConv) {
            console.log(`[AutoGreeting] already_has_conversation_same_phone: ${normalizedPhone}, conv: ${existingConv.id}, skipping`);
            continue;
          }
        }

        // 5. Process template variables - random selection from array
        let greetingTemplate: string;
        if (greetingMessages.length > 0) {
          greetingTemplate = greetingMessages[Math.floor(Math.random() * greetingMessages.length)];
        } else {
          greetingTemplate = settings.auto_greeting_message;
        }
        let greetingMessage = greetingTemplate;
        const contactName = contact.call_name || contact.name || '';
        greetingMessage = greetingMessage.replace(/\{\{\s*nome\s*\}\}/gi, contactName);
        greetingMessage = greetingMessage.replace(/\{\{\s*telefone\s*\}\}/gi, contact.phone_number || '');

        // 6. Create conversation (handle unique index conflict gracefully)
        const { data: conversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            contact_id: deal.contact_id,
            status: 'nina',
            is_active: true,
            user_id: deal.user_id || null,
          })
          .select('id')
          .single();

        if (convError) {
          // Unique index violation = another process already created it → safe skip
          if (convError.code === '23505') {
            console.log(`[AutoGreeting] Unique constraint hit for contact ${deal.contact_id}, skipping (race condition prevented)`);
            continue;
          }
          console.error(`[AutoGreeting] Error creating conversation for deal ${deal.id}:`, convError);
          continue;
        }

        if (!conversation) continue;

        // 7. Create message
        const { data: message, error: msgError } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            content: greetingMessage,
            from_type: 'nina',
            type: 'text',
            status: 'processing',
          })
          .select('id')
          .single();

        if (msgError || !message) {
          console.error(`[AutoGreeting] Error creating message:`, msgError);
          continue;
        }

        // 8. Enqueue in send_queue
        await supabase
          .from('send_queue')
          .insert({
            conversation_id: conversation.id,
            contact_id: deal.contact_id,
            message_id: message.id,
            content: greetingMessage,
            message_type: 'text',
            from_type: 'nina',
            status: 'pending',
            priority: 5,
          });

        console.log(`[AutoGreeting] Queued greeting for contact ${contactName || contact.phone_number}, conv: ${conversation.id}`);
        processed++;
      } catch (e) {
        console.error(`[AutoGreeting] Error processing deal ${deal.id}:`, e);
      }
    }

    // 9. Trigger whatsapp-sender if any messages were queued
    if (processed > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/whatsapp-sender`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ trigger: 'auto-greeting' }),
        });
      } catch (e) {
        console.warn('[AutoGreeting] whatsapp-sender trigger failed (messages still queued):', e);
      }
    }

    return new Response(JSON.stringify({ processed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[AutoGreeting] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
