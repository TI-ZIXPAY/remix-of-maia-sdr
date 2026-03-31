import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UazapiConfig {
  endpoint: string;
  session: string;
  sessionkey: string;
}

/**
 * Uazapi Sender - Sends messages via Uazapi API
 * 
 * Endpoints used:
 * - POST /sendText - Send text message
 * - POST /sendAudio - Send audio file
 * - POST /sendImage - Send image
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get base settings (for provider check and delay config)
    const { data: settings, error: settingsError } = await supabase
      .from('nina_settings')
      .select('uazapi_endpoint, uazapi_session, uazapi_sessionkey, whatsapp_provider, response_delay_min, response_delay_max')
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings) {
      console.error('[Uazapi-Sender] Failed to get settings:', settingsError);
      return new Response(JSON.stringify({ error: 'Settings not found' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (settings.whatsapp_provider !== 'uazapi') {
      console.error('[Uazapi-Sender] WhatsApp provider is not uazapi');
      return new Response(JSON.stringify({ error: 'Uazapi not configured as provider' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build default config from nina_settings (fallback)
    const defaultEndpoint = settings.uazapi_endpoint?.replace(/\/$/, '') || '';
    const defaultConfig: UazapiConfig | null = (defaultEndpoint && settings.uazapi_sessionkey) ? {
      endpoint: settings.uazapi_session ? `${defaultEndpoint}/${settings.uazapi_session}` : defaultEndpoint,
      session: settings.uazapi_session || '',
      sessionkey: settings.uazapi_sessionkey
    } : null;

    // Helper to resolve config for a specific contact
    async function resolveConfigForContact(contactId: string): Promise<UazapiConfig | null> {
      const { data: contact } = await supabase
        .from('contacts')
        .select('uazapi_instance_id')
        .eq('id', contactId)
        .maybeSingle();

      if (contact?.uazapi_instance_id) {
        const { data: inst } = await supabase
          .from('uazapi_instances')
          .select('endpoint, session, sessionkey')
          .eq('id', contact.uazapi_instance_id)
          .eq('is_active', true)
          .maybeSingle();

        if (inst) {
          const ep = inst.endpoint.replace(/\/$/, '');
          return {
            endpoint: inst.session ? `${ep}/${inst.session}` : ep,
            session: inst.session || '',
            sessionkey: inst.sessionkey
          };
        }
      }

      // Try first active instance as secondary fallback
      if (!defaultConfig) {
        const { data: firstInst } = await supabase
          .from('uazapi_instances')
          .select('endpoint, session, sessionkey')
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (firstInst) {
          const ep = firstInst.endpoint.replace(/\/$/, '');
          return {
            endpoint: firstInst.session ? `${ep}/${firstInst.session}` : ep,
            session: firstInst.session || '',
            sessionkey: firstInst.sessionkey
          };
        }
      }

      return defaultConfig;
    }

    // Process send queue
    const { data: queueItems, error: queueError } = await supabase
      .rpc('claim_send_queue_batch', { p_limit: 10 });

    if (queueError) {
      console.error('[Uazapi-Sender] Error claiming queue batch:', queueError);
      return new Response(JSON.stringify({ error: 'Failed to claim queue' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!queueItems || queueItems.length === 0) {
      console.log('[Uazapi-Sender] No messages in queue');
      return new Response(JSON.stringify({ status: 'empty', processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('[Uazapi-Sender] Processing', queueItems.length, 'messages');

    let successCount = 0;
    let failCount = 0;

    const delayMin = settings.response_delay_min ?? 1000;
    const delayMax = settings.response_delay_max ?? 3000;

    for (const item of queueItems) {
      try {
        // Resolve config for this specific contact's instance
        const config = await resolveConfigForContact(item.contact_id);
        if (!config) {
          throw new Error('Uazapi credentials not configured for this contact');
        }

        // Get contact phone number
        const { data: contact } = await supabase
          .from('contacts')
          .select('phone_number')
          .eq('id', item.contact_id)
          .single();

        if (!contact) {
          throw new Error('Contact not found');
        }

        const phoneNumber = contact.phone_number.replace(/\D/g, '');
        const messageType = item.message_type || 'text';
        const metadata = item.metadata as Record<string, unknown> | null;
        let result: { success: boolean; messageId?: string; error?: string };
        const delay = calculateDelay(messageType, (item.content || '').length, delayMin, delayMax);

        if (messageType === 'menu') {
          // Handle interactive menu messages
          result = await sendMenu(config, phoneNumber, item, delay);
        } else if (messageType === 'text' || (!item.media_url && item.content)) {
          result = await sendText(config, phoneNumber, item.content || '', delay);
        } else if (item.media_url) {
          const mediaType = mapMessageTypeToUazapi(messageType, metadata);
          result = await sendMedia(config, phoneNumber, {
            type: mediaType,
            file: item.media_url,
            text: item.content || undefined,
            docName: (metadata?.docName as string) || undefined,
          }, delay);
        } else {
          result = await sendText(config, phoneNumber, item.content || '', delay);
        }

        if (result.success) {
          // Update queue item as completed
          await supabase
            .from('send_queue')
            .update({
              status: 'completed',
              sent_at: new Date().toISOString()
            })
            .eq('id', item.id);

          // Update message with WhatsApp ID
          if (item.message_id && result.messageId) {
            await supabase
              .from('messages')
              .update({
                whatsapp_message_id: result.messageId,
                status: 'sent'
              })
              .eq('id', item.message_id);
          }

          successCount++;
          console.log('[Uazapi-Sender] Sent message to:', phoneNumber);
        } else {
          throw new Error(result.error || 'Send failed');
        }
      } catch (error) {
        console.error('[Uazapi-Sender] Error sending message:', error);
        
        const retryCount = (item.retry_count || 0) + 1;
        const maxRetries = 3;

        if (retryCount >= maxRetries) {
          await supabase
            .from('send_queue')
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error',
              retry_count: retryCount
            })
            .eq('id', item.id);
        } else {
          await supabase
            .from('send_queue')
            .update({
              status: 'pending',
              error_message: error instanceof Error ? error.message : 'Unknown error',
              retry_count: retryCount,
              scheduled_at: new Date(Date.now() + 60000 * retryCount).toISOString() // Exponential backoff
            })
            .eq('id', item.id);
        }

        failCount++;
      }
    }

    return new Response(JSON.stringify({
      status: 'processed',
      success: successCount,
      failed: failCount,
      total: queueItems.length
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Uazapi-Sender] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function calculateDelay(
  messageType: string,
  contentLength: number,
  delayMin: number,
  delayMax: number
): number {
  if (messageType === 'audio' || messageType === 'ptt') {
    return delayMax;
  }
  if (messageType === 'text') {
    return Math.min(delayMax, Math.max(delayMin, contentLength * 50));
  }
  // image, video, document, etc.
  return delayMin;
}

async function sendText(
  config: UazapiConfig,
  phoneNumber: string,
  text: string,
  delay?: number
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const body: Record<string, unknown> = {
      session: config.session,
      number: phoneNumber,
      text: text
    };
    if (delay && delay > 0) body.delay = delay;

    console.log(`[Uazapi-Sender] sendText to=${phoneNumber} delay=${delay || 0}ms`);

    const response = await fetch(`${config.endpoint}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': config.sessionkey
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    console.log('[Uazapi-Sender] sendText response:', JSON.stringify(data));

    if (data.result === 200 || response.ok) {
      return {
        success: true,
        messageId: data.messageId || data.id
      };
    }

    return {
      success: false,
      error: data.message || data.error || 'Unknown error'
    };
  } catch (error) {
    console.error('[Uazapi-Sender] sendText error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error'
    };
  }
}

async function sendAudio(
  config: UazapiConfig,
  phoneNumber: string,
  audioUrl: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return sendMedia(config, phoneNumber, { type: 'audio', file: audioUrl });
}

type UazapiMediaType = 'image' | 'video' | 'document' | 'audio' | 'myaudio' | 'ptt' | 'ptv' | 'sticker';

interface MediaPayload {
  type: UazapiMediaType;
  file: string;
  text?: string;
  docName?: string;
}

function mapMessageTypeToUazapi(
  messageType: string,
  metadata?: Record<string, unknown> | null
): UazapiMediaType {
  const uazapiType = (metadata?.uazapi_type as string) || null;
  if (uazapiType && ['image', 'video', 'document', 'audio', 'myaudio', 'ptt', 'ptv', 'sticker'].includes(uazapiType)) {
    return uazapiType as UazapiMediaType;
  }

  switch (messageType) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'document': return 'document';
    case 'audio': return 'audio';
    default: return 'document';
  }
}

async function sendMedia(
  config: UazapiConfig,
  phoneNumber: string,
  payload: MediaPayload,
  delay?: number
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const body: Record<string, unknown> = {
      number: phoneNumber,
      type: payload.type,
      file: payload.file,
    };

    if (payload.text) body.text = payload.text;
    if (payload.docName) body.docName = payload.docName;
    if (delay && delay > 0) body.delay = delay;

    console.log(`[Uazapi-Sender] sendMedia type=${payload.type} to=${phoneNumber} delay=${delay || 0}ms`);

    const response = await fetch(`${config.endpoint}/send/media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': config.sessionkey,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log('[Uazapi-Sender] sendMedia response:', JSON.stringify(data).substring(0, 300));

    if (data.result === 200 || response.ok) {
      return {
        success: true,
        messageId: data.messageId || data.id || data.data?.to?.id,
      };
    }

    return {
      success: false,
      error: data.message || data.error || 'Unknown error',
    };
  } catch (error) {
    console.error('[Uazapi-Sender] sendMedia error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

async function sendMenu(
  config: UazapiConfig,
  phoneNumber: string,
  queueItem: { content?: string | null; metadata?: unknown },
  delay?: number
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const metadata = queueItem.metadata as Record<string, unknown> | null;
    if (!metadata?.menu_type || !metadata?.menu_choices) {
      return { success: false, error: 'Menu metadata missing menu_type or menu_choices' };
    }

    const body: Record<string, unknown> = {
      number: phoneNumber,
      type: metadata.menu_type,
      text: metadata.menu_text || queueItem.content || '',
      choices: metadata.menu_choices,
    };

    if (metadata.menu_footer) body.footerText = metadata.menu_footer;
    if (metadata.menu_list_button) body.listButton = metadata.menu_list_button;
    if (metadata.menu_selectable_count) body.selectableCount = metadata.menu_selectable_count;
    if (metadata.menu_image_button) body.imageButton = metadata.menu_image_button;
    if (delay && delay > 0) body.delay = delay;

    console.log(`[Uazapi-Sender] sendMenu type=${metadata.menu_type} to=${phoneNumber} delay=${delay || 0}ms`);

    const response = await fetch(`${config.endpoint}/send/menu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': config.sessionkey,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log('[Uazapi-Sender] sendMenu response:', JSON.stringify(data).substring(0, 300));

    if (data.result === 200 || response.ok) {
      return {
        success: true,
        messageId: data.messageId || data.id || data.key?.id,
      };
    }

    return {
      success: false,
      error: data.message || data.error || 'Unknown error',
    };
  } catch (error) {
    console.error('[Uazapi-Sender] sendMenu error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}
