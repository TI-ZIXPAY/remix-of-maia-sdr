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
    const { conversationId } = await req.json();

    if (!conversationId) {
      return new Response(JSON.stringify({ error: 'conversationId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get unread messages from this conversation (from user, not yet read)
    const { data: unreadMessages, error: fetchError } = await supabase
      .from('messages')
      .select('id, whatsapp_message_id')
      .eq('conversation_id', conversationId)
      .eq('from_type', 'user')
      .in('status', ['sent', 'delivered']);

    if (fetchError) {
      console.error('[Mark-Read] Error fetching unread messages:', fetchError);
      return new Response(JSON.stringify({ error: 'Failed to fetch messages' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!unreadMessages || unreadMessages.length === 0) {
      return new Response(JSON.stringify({ success: true, marked: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update messages in database
    const { error: updateError } = await supabase
      .from('messages')
      .update({
        status: 'read',
        read_at: new Date().toISOString()
      })
      .eq('conversation_id', conversationId)
      .eq('from_type', 'user')
      .in('status', ['sent', 'delivered']);

    if (updateError) {
      console.error('[Mark-Read] DB update error:', updateError);
    }

    // Get Uazapi config - resolve from contact's instance first
    const { data: settings } = await supabase
      .from('nina_settings')
      .select('uazapi_endpoint, uazapi_sessionkey, whatsapp_provider')
      .limit(1)
      .maybeSingle();

    // Resolve credentials: contact instance → nina_settings fallback
    let uazapiEndpoint = settings?.uazapi_endpoint || '';
    let uazapiSessionkey = settings?.uazapi_sessionkey || '';

    if (settings?.whatsapp_provider === 'uazapi') {
      // Try to get instance from conversation's contact
      const { data: conv } = await supabase
        .from('conversations')
        .select('contact_id')
        .eq('id', conversationId)
        .maybeSingle();

      if (conv?.contact_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('uazapi_instance_id')
          .eq('id', conv.contact_id)
          .maybeSingle();

        if (contact?.uazapi_instance_id) {
          const { data: inst } = await supabase
            .from('uazapi_instances')
            .select('endpoint, sessionkey')
            .eq('id', contact.uazapi_instance_id)
            .maybeSingle();

          if (inst) {
            uazapiEndpoint = inst.endpoint;
            uazapiSessionkey = inst.sessionkey;
          }
        }
      }
    }

    // Call Uazapi markread if configured
    if (settings?.whatsapp_provider === 'uazapi' && uazapiEndpoint && uazapiSessionkey) {
      const whatsappIds = unreadMessages
        .map(m => m.whatsapp_message_id)
        .filter((id): id is string => !!id);

      if (whatsappIds.length > 0) {
        const endpoint = uazapiEndpoint.replace(/\/$/, '');
        
        console.log('[Mark-Read] Marking', whatsappIds.length, 'messages as read on WhatsApp');

        try {
          const response = await fetch(`${endpoint}/message/markread`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'sessionkey': uazapiSessionkey,
              'token': uazapiSessionkey
            },
            body: JSON.stringify({
              id: whatsappIds
            })
          });

          const data = await response.json();
          console.log('[Mark-Read] Uazapi response:', JSON.stringify(data));
        } catch (uazapiError) {
          console.error('[Mark-Read] Uazapi call failed:', uazapiError);
          // Don't fail the whole request if UAZAPI fails
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      marked: unreadMessages.length 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Mark-Read] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
