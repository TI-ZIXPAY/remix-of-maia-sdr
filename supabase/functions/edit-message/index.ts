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
    const { messageId, newText } = await req.json();

    if (!messageId || !newText?.trim()) {
      return new Response(JSON.stringify({ error: 'messageId and newText are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Find message in database
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, whatsapp_message_id, conversation_id, content, from_type')
      .eq('id', messageId)
      .single();

    if (msgError || !message) {
      console.error('[Edit-Message] Message not found:', msgError);
      return new Response(JSON.stringify({ error: 'Message not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!message.whatsapp_message_id) {
      return new Response(JSON.stringify({ error: 'Message has no WhatsApp ID, cannot edit' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get provider check from nina_settings
    const { data: settings, error: settingsError } = await supabase
      .from('nina_settings')
      .select('uazapi_endpoint, uazapi_session, uazapi_sessionkey, whatsapp_provider')
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings) {
      return new Response(JSON.stringify({ error: 'Settings not found' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (settings.whatsapp_provider !== 'uazapi') {
      return new Response(JSON.stringify({ error: 'Edit only supported with Uazapi provider' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Resolve credentials: contact instance → nina_settings fallback
    let uazapiEndpoint = settings.uazapi_endpoint || '';
    let uazapiSessionkey = settings.uazapi_sessionkey || '';

    const { data: conv } = await supabase
      .from('conversations')
      .select('contact_id')
      .eq('id', message.conversation_id)
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

    const endpoint = uazapiEndpoint?.replace(/\/$/, '');
    if (!endpoint || !uazapiSessionkey) {
      return new Response(JSON.stringify({ error: 'Uazapi not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Call Uazapi editMessage endpoint
    console.log('[Edit-Message] Editing message:', message.whatsapp_message_id, 'to:', newText.trim());
    
    const response = await fetch(`${endpoint}/message/edit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'sessionkey': uazapiSessionkey,
        'token': uazapiSessionkey
      },
      body: JSON.stringify({
        id: message.whatsapp_message_id,
        text: newText.trim()
      })
    });

    const data = await response.json();
    console.log('[Edit-Message] Uazapi response:', JSON.stringify(data));

    if (!response.ok && data.result !== 200) {
      return new Response(JSON.stringify({ error: data.message || 'Failed to edit message on WhatsApp' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update message in database
    const { error: updateError } = await supabase
      .from('messages')
      .update({
        content: newText.trim(),
        metadata: {
          edited: true,
          edited_at: new Date().toISOString(),
          original_content: message.content
        }
      })
      .eq('id', messageId);

    if (updateError) {
      console.error('[Edit-Message] DB update error:', updateError);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Edit-Message] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
