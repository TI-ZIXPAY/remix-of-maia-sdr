import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { messageId } = await req.json();

    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Find message in database
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, whatsapp_message_id, conversation_id, content, media_url, type, metadata, from_type, sent_at')
      .eq('id', messageId)
      .maybeSingle();

    if (msgError || !message) {
      console.error('[Delete-Message] Message not found:', msgError);
      return new Response(JSON.stringify({ error: 'Message not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let whatsappDeleted = false;
    let whatsappError: string | null = null;

    // Resolve Uazapi credentials: contact instance → nina_settings fallback
    if (message.whatsapp_message_id) {
      const { data: settings } = await supabase
        .from('nina_settings')
        .select('uazapi_endpoint, uazapi_session, uazapi_sessionkey, whatsapp_provider')
        .limit(1)
        .maybeSingle();

      let uazapiEndpoint = settings?.uazapi_endpoint || '';
      let uazapiSessionkey = settings?.uazapi_sessionkey || '';

      if (settings?.whatsapp_provider === 'uazapi') {
        // Try to resolve from contact's instance
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
      }

      if (settings?.whatsapp_provider === 'uazapi' && uazapiEndpoint && uazapiSessionkey) {
        const endpoint = uazapiEndpoint.replace(/\/$/, '');
        const rawId = message.whatsapp_message_id;
        const isFromMe = message.from_type === 'nina' || message.from_type === 'human';
        
        console.log('[Delete-Message] Raw WhatsApp ID:', rawId);
        console.log('[Delete-Message] From type:', message.from_type, '→ fromMe:', isFromMe);
        
        const deleteBody: Record<string, unknown> = {
          id: rawId,
          fromMe: isFromMe,
        };

        try {
          const response = await fetch(`${endpoint}/message/delete`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'sessionkey': uazapiSessionkey,
              'token': uazapiSessionkey
            },
            body: JSON.stringify(deleteBody)
          });

          const data = await response.json();
          console.log('[Delete-Message] Response:', response.status, JSON.stringify(data).substring(0, 300));
          
          if (response.ok) {
            whatsappDeleted = true;
          } else {
            whatsappError = JSON.stringify(data);
          }
        } catch (fetchErr) {
          console.error('[Delete-Message] Fetch error:', fetchErr);
          whatsappError = fetchErr instanceof Error ? fetchErr.message : 'Fetch failed';
        }
      }
    }

    // Soft-delete: update metadata to mark as deleted, preserve original content
    const existingMetadata = (message.metadata || {}) as Record<string, unknown>;
    const { error: updateError } = await supabase
      .from('messages')
      .update({
        metadata: {
          ...existingMetadata,
          deleted: true,
          deleted_at: new Date().toISOString(),
          original_content: message.content,
          original_media_url: message.media_url,
          original_type: message.type
        }
      })
      .eq('id', messageId);

    if (updateError) {
      console.error('[Delete-Message] DB update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to mark message as deleted' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      whatsappDeleted,
      whatsappError,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Delete-Message] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
