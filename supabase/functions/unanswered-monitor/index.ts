import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('[UnansweredMonitor] Starting check...');

    // 1. Find conversations with status='nina' where the last message is from the user
    //    and was sent more than 5 minutes ago
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: ninaConversations, error: convError } = await supabase
      .from('conversations')
      .select('id, contact_id, user_id')
      .eq('status', 'nina')
      .eq('is_active', true);

    if (convError) {
      console.error('[UnansweredMonitor] Error fetching conversations:', convError);
      throw convError;
    }

    if (!ninaConversations || ninaConversations.length === 0) {
      console.log('[UnansweredMonitor] No active nina conversations found');
      return new Response(JSON.stringify({ checked: 0, recovered: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[UnansweredMonitor] Checking ${ninaConversations.length} active nina conversations`);

    let recovered = 0;
    let checked = 0;
    const MAX_RECOVERIES = 10;

    for (const conv of ninaConversations) {
      if (recovered >= MAX_RECOVERIES) break;

      // Get the last message in this conversation
      const { data: lastMsg, error: msgError } = await supabase
        .from('messages')
        .select('id, from_type, sent_at')
        .eq('conversation_id', conv.id)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (msgError || !lastMsg) continue;

      checked++;

      // Skip if last message is not from user
      if (lastMsg.from_type !== 'user') continue;

      // Skip if last message is less than 5 minutes old
      if (new Date(lastMsg.sent_at) > new Date(fiveMinAgo)) continue;

      console.log(`[UnansweredMonitor] Conversation ${conv.id}: last user msg at ${lastMsg.sent_at} (>5min ago)`);

      // Check if there's a pending/processing item in send_queue for this conversation
      const { count: sendQueueCount } = await supabase
        .from('send_queue')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .in('status', ['pending', 'processing']);

      if ((sendQueueCount || 0) > 0) {
        console.log(`[UnansweredMonitor] Conv ${conv.id}: ${sendQueueCount} items in send_queue, skipping`);
        continue;
      }

      // Check if there's a pending/processing item in nina_processing_queue
      const { count: ninaQueueCount } = await supabase
        .from('nina_processing_queue')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .in('status', ['pending', 'processing']);

      if ((ninaQueueCount || 0) > 0) {
        console.log(`[UnansweredMonitor] Conv ${conv.id}: ${ninaQueueCount} items in nina_processing_queue, skipping`);
        continue;
      }

      // This conversation is orphaned! Re-insert into nina_processing_queue
      console.warn(`[UnansweredMonitor] 🚨 ORPHANED conversation detected: ${conv.id}, last user msg: ${lastMsg.id}`);

      const { error: insertError } = await supabase
        .from('nina_processing_queue')
        .insert({
          message_id: lastMsg.id,
          conversation_id: conv.id,
          contact_id: conv.contact_id,
          status: 'pending',
          priority: 2, // Higher priority for recovery
          context_data: { 
            source: 'unanswered-monitor',
            original_sent_at: lastMsg.sent_at,
            recovered_at: new Date().toISOString()
          }
        });

      if (insertError) {
        console.error(`[UnansweredMonitor] Error re-inserting conv ${conv.id}:`, insertError);
        continue;
      }

      recovered++;
      console.log(`[UnansweredMonitor] ✅ Re-queued conversation ${conv.id} for processing`);

      // Trigger the orchestrator
      try {
        await fetch(`${supabaseUrl}/functions/v1/trigger-nina-orchestrator`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ triggered_by: 'unanswered-monitor', conversation_id: conv.id })
        });
      } catch (triggerErr) {
        console.warn(`[UnansweredMonitor] Failed to trigger orchestrator (non-blocking):`, triggerErr);
      }
    }

    const result = { checked, recovered, total_nina_conversations: ninaConversations.length };
    console.log('[UnansweredMonitor] Done:', JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[UnansweredMonitor] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
