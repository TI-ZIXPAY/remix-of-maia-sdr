import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WHATSAPP_API_URL = "https://graph.facebook.com/v18.0";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('[Sender] Starting send process...');

    const MAX_EXECUTION_TIME = 25000; // 25 seconds
    const startTime = Date.now();
    let totalSent = 0;
    let iterations = 0;

    // Small initial delay to allow recently scheduled messages to become ready
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    console.log('[Sender] Starting polling loop');

    // Cache de settings por user_id para evitar múltiplas queries
    const settingsCache: Record<string, any> = {};

    while (Date.now() - startTime < MAX_EXECUTION_TIME) {
      iterations++;
      console.log(`[Sender] Iteration ${iterations}, elapsed: ${Date.now() - startTime}ms`);

      // Claim batch of messages to send
      const { data: queueItems, error: claimError } = await supabase
        .rpc('claim_send_queue_batch', { p_limit: 10 });

      if (claimError) {
        console.error('[Sender] Error claiming batch:', claimError);
        throw claimError;
      }

      if (!queueItems || queueItems.length === 0) {
        console.log('[Sender] No messages ready to send, checking for scheduled messages...');
        
        // Check for messages scheduled in the next 5 seconds
        const { data: upcoming, error: upcomingError } = await supabase
          .from('send_queue')
          .select('id, scheduled_at')
          .eq('status', 'pending')
          .gte('scheduled_at', new Date().toISOString())
          .lte('scheduled_at', new Date(Date.now() + 5000).toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(1);

        if (upcomingError) {
          console.error('[Sender] Error checking upcoming messages:', upcomingError);
        }

        if (upcoming && upcoming.length > 0) {
          const scheduledAt = new Date(upcoming[0].scheduled_at).getTime();
          const now = Date.now();
          const waitTime = Math.min(
            Math.max(scheduledAt - now + 100, 0),
            5000
          );
          
          if (waitTime > 0 && (Date.now() - startTime + waitTime) < MAX_EXECUTION_TIME) {
            console.log(`[Sender] Waiting ${waitTime}ms for scheduled message at ${upcoming[0].scheduled_at}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        
        // No more messages to process
        console.log('[Sender] No more messages to process, exiting loop');
        break;
      }

      console.log(`[Sender] Processing batch of ${queueItems.length} messages`);

      for (const item of queueItems) {
        try {
          // Get contact phone for presence indicator
          const { data: contactForPresence } = await supabase
            .from('contacts')
            .select('phone_number, whatsapp_id, uazapi_instance_id')
            .eq('id', item.contact_id)
            .maybeSingle();

          // Buscar user_id da conversation para multi-tenancy
          const { data: conversation, error: convError } = await supabase
            .from('conversations')
            .select('user_id')
            .eq('id', item.conversation_id)
            .single();

          if (convError || !conversation) {
            console.error(`[Sender] Error fetching conversation ${item.conversation_id}:`, convError);
            throw new Error('Conversation not found');
          }

          const userId = conversation.user_id;
          
          // --- Try to resolve Uazapi credentials from contact's instance first ---
          let instanceCredentials: { endpoint: string; sessionkey: string } | null = null;
          if (contactForPresence?.uazapi_instance_id) {
            const { data: inst } = await supabase
              .from('uazapi_instances')
              .select('endpoint, sessionkey')
              .eq('id', contactForPresence.uazapi_instance_id)
              .eq('is_active', true)
              .maybeSingle();
            if (inst) {
              instanceCredentials = { endpoint: inst.endpoint, sessionkey: inst.sessionkey };
            }
          }

          // Buscar settings do cache ou do banco com fallback triplo
          const cacheKey = userId || 'global';
          let settings = settingsCache[cacheKey];
          if (!settings) {
            let settingsData = null;

            // 1. Tentar por user_id da conversa
            if (userId) {
              const { data } = await supabase
                .from('nina_settings')
                .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_provider, uazapi_endpoint, uazapi_session, uazapi_sessionkey')
                .eq('user_id', userId)
                .maybeSingle();
              settingsData = data;
            }

            // 2. Fallback: buscar global (user_id IS NULL)
            if (!settingsData) {
              console.log('[Sender] No user-specific settings, trying global...');
              const { data } = await supabase
                .from('nina_settings')
                .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_provider, uazapi_endpoint, uazapi_session, uazapi_sessionkey')
                .is('user_id', null)
                .maybeSingle();
              settingsData = data;
            }

            // 3. Último fallback: qualquer settings com WhatsApp ou Uazapi configurado
            if (!settingsData) {
              console.log('[Sender] No global settings, fetching any with WhatsApp/Uazapi...');
              const { data } = await supabase
                .from('nina_settings')
                .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_provider, uazapi_endpoint, uazapi_session, uazapi_sessionkey')
                .limit(1)
                .maybeSingle();
              settingsData = data;
            }

            if (!settingsData) {
              console.error('[Sender] No settings found with any fallback');
              throw new Error('Settings not found');
            }

            // Override with instance-specific credentials if available
            if (instanceCredentials) {
              settingsData.uazapi_endpoint = instanceCredentials.endpoint;
              settingsData.uazapi_sessionkey = instanceCredentials.sessionkey;
            }

            // Check if either Cloud API or Uazapi is configured
            const hasCloudApi = settingsData.whatsapp_access_token && settingsData.whatsapp_phone_number_id;
            const hasUazapi = settingsData.uazapi_endpoint && settingsData.uazapi_sessionkey;
            
            if (!hasCloudApi && !hasUazapi) {
              // Fallback: buscar primeira instância ativa em uazapi_instances
              console.log('[Sender] No credentials in nina_settings, checking uazapi_instances...');
              const { data: fallbackInstance } = await supabase
                .from('uazapi_instances')
                .select('endpoint, sessionkey')
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();

              if (fallbackInstance) {
                console.log('[Sender] Found active Uazapi instance as fallback');
                settingsData.uazapi_endpoint = fallbackInstance.endpoint;
                settingsData.uazapi_sessionkey = fallbackInstance.sessionkey;
                settingsData.whatsapp_provider = 'uazapi';
              } else {
                console.error('[Sender] Neither WhatsApp Cloud API nor Uazapi configured');
                throw new Error('WhatsApp not configured');
              }
            }

            settings = settingsData;
            // Don't cache if we used instance-specific credentials (per-contact)
            if (!instanceCredentials) {
              settingsCache[cacheKey] = settings;
            }
          } else if (instanceCredentials) {
            // Override cached settings with instance-specific credentials
            settings = { ...settings, uazapi_endpoint: instanceCredentials.endpoint, uazapi_sessionkey: instanceCredentials.sessionkey };
          }

          // --- Presence indicator (typing/recording) ---
          const useUazapi = settings.whatsapp_provider === 'uazapi' || 
            (settings.uazapi_endpoint && settings.uazapi_sessionkey && !settings.whatsapp_access_token);
          
          // For Uazapi: skip manual presence + sleep — the native `delay` field handles it
          // For Cloud API: keep existing presence + sleep behavior
          if (!useUazapi) {
            const presencePhone = contactForPresence?.whatsapp_id || contactForPresence?.phone_number || '';
            const isAudio = item.message_type === 'audio';

            try {
              if (presencePhone) {
                await sendPresenceCloudApi(settings, presencePhone);
              }
            } catch (presenceErr) {
              console.warn('[Sender] Presence indicator failed (non-blocking):', presenceErr);
            }

            const typingDelay = isAudio
              ? 3000 + Math.random() * 2000
              : Math.min(Math.max((item.content?.length || 0) * 30, 1500), 6000);
            
            if ((Date.now() - startTime + typingDelay) < MAX_EXECUTION_TIME) {
              console.log(`[Sender] Simulating typing for ${Math.round(typingDelay)}ms (Cloud API)`);
              await new Promise(resolve => setTimeout(resolve, typingDelay));
            }
          } else {
            console.log('[Sender] Uazapi provider: skipping manual presence (using native delay)');
          }
          // --- End presence ---

          await sendMessage(supabase, settings, item);
          
          // Mark as completed
          await supabase
            .from('send_queue')
            .update({ 
              status: 'completed', 
              sent_at: new Date().toISOString() 
            })
            .eq('id', item.id);
          
          totalSent++;
          console.log(`[Sender] Successfully sent message ${item.id} (${totalSent} total)`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[Sender] Error sending item ${item.id}:`, error);
          
          // Mark as failed with retry
          const newRetryCount = (item.retry_count || 0) + 1;
          const shouldRetry = newRetryCount < 3;
          
          await supabase
            .from('send_queue')
            .update({ 
              status: shouldRetry ? 'pending' : 'failed',
              retry_count: newRetryCount,
              error_message: errorMessage,
              scheduled_at: shouldRetry 
                ? new Date(Date.now() + newRetryCount * 60000).toISOString() 
                : null
            })
            .eq('id', item.id);
        }
      }
    }

    const executionTime = Date.now() - startTime;
    console.log(`[Sender] Completed: sent ${totalSent} messages in ${iterations} iterations (${executionTime}ms)`);

    return new Response(JSON.stringify({ 
      sent: totalSent, 
      iterations,
      executionTime 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[Sender] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function sendMessage(supabase: any, settings: any, queueItem: any) {
  console.log(`[Sender] Sending message: ${queueItem.id}`);

  // Get contact phone number
  const { data: contact } = await supabase
    .from('contacts')
    .select('phone_number, whatsapp_id')
    .eq('id', queueItem.contact_id)
    .maybeSingle();

  if (!contact) {
    throw new Error('Contact not found');
  }

  const phoneNumber = contact.whatsapp_id || contact.phone_number;
  
  // Determine which provider to use
  const useUazapi = settings.whatsapp_provider === 'uazapi' || 
                   (settings.uazapi_endpoint && settings.uazapi_sessionkey && !settings.whatsapp_access_token);
  
  console.log('[Sender] Using provider:', useUazapi ? 'uazapi' : 'cloud');

  let whatsappMessageId: string | undefined;

  if (useUazapi) {
    // Send via Uazapi
    whatsappMessageId = await sendViaUazapi(settings, phoneNumber, queueItem);
  } else {
    // Send via WhatsApp Cloud API
    whatsappMessageId = await sendViaCloudApi(settings, phoneNumber, queueItem);
  }

  console.log('[Sender] Message sent, WA ID:', whatsappMessageId);

  // Update or create message record in database
  if (queueItem.message_id) {
    // UPDATE existing message (for human messages)
    console.log('[Sender] Updating existing message:', queueItem.message_id);
    const { error: msgError } = await supabase
      .from('messages')
      .update({
        whatsapp_message_id: whatsappMessageId,
        status: 'sent',
        sent_at: new Date().toISOString()
      })
      .eq('id', queueItem.message_id);

    if (msgError) {
      console.error('[Sender] Error updating message record:', msgError);
      throw new Error(`Failed to update message record: ${msgError.message}`);
    }
  } else {
    // INSERT new message (for Nina messages)
    console.log('[Sender] Creating new message record');
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: queueItem.conversation_id,
        whatsapp_message_id: whatsappMessageId,
        content: queueItem.content,
        type: queueItem.message_type === 'menu' ? 'text' : queueItem.message_type,
        from_type: queueItem.from_type,
        status: 'sent',
        media_url: queueItem.media_url || null,
        sent_at: new Date().toISOString(),
        metadata: queueItem.metadata || {}
      });

    if (msgError) {
      console.error('[Sender] Error creating message record:', msgError);
      throw new Error(`Failed to create message record: ${msgError.message}`);
    }
  }

  // Update conversation last_message_at
  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', queueItem.conversation_id);
}

async function sendViaUazapi(settings: any, phoneNumber: string, queueItem: any): Promise<string> {
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  const baseUrl = settings.uazapi_endpoint.replace(/\/$/, '');

  const hasMedia = !!queueItem.media_url;
  const messageType = queueItem.message_type || 'text';

  // Handle interactive menu messages
  if (messageType === 'menu') {
    return await sendUazapiMenu(baseUrl, settings.uazapi_sessionkey, cleanPhone, queueItem);
  }

  // Calculate native delay for Uazapi presence indicator
  const isAudio = messageType === 'audio';
  const textDelay = Math.min(5000, Math.max(1500, (queueItem.content?.length || 0) * 50));
  const delay = isAudio ? 3000 : hasMedia ? 1500 : textDelay;

  if (hasMedia) {
    try {
      const mediaResult = await sendUazapiMedia(baseUrl, settings.uazapi_sessionkey, cleanPhone, queueItem, messageType, delay);
      return mediaResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      if (errorMsg.includes('405') || errorMsg.includes('Method Not Allowed')) {
        console.log('[Sender] Media endpoint not available (405), falling back to text');
        if (queueItem.content) {
          return await sendUazapiText(baseUrl, settings.uazapi_sessionkey, cleanPhone, queueItem.content, textDelay);
        }
      }
      throw error;
    }
  }

  return await sendUazapiText(baseUrl, settings.uazapi_sessionkey, cleanPhone, queueItem.content || '', delay);
}

async function sendUazapiMenu(baseUrl: string, token: string, phone: string, queueItem: any): Promise<string> {
  const metadata = queueItem.metadata as Record<string, unknown> | null;
  if (!metadata?.menu_type || !metadata?.menu_choices) {
    throw new Error('Menu metadata missing menu_type or menu_choices');
  }

  const body: Record<string, unknown> = {
    number: phone,
    type: metadata.menu_type,
    text: metadata.menu_text || queueItem.content || '',
    choices: metadata.menu_choices,
  };

  if (metadata.menu_footer) body.footerText = metadata.menu_footer;
  if (metadata.menu_list_button) body.listButton = metadata.menu_list_button;
  if (metadata.menu_selectable_count) body.selectableCount = metadata.menu_selectable_count;
  if (metadata.menu_image_button) body.imageButton = metadata.menu_image_button;

  // Add delay for presence indicator
  const delay = Math.min(3000, Math.max(1500, (body.text as string).length * 50));
  if (delay > 0) body.delay = delay;

  const url = `${baseUrl}/send/menu`;
  console.log(`[Sender] Sending interactive menu via Uazapi: type=${metadata.menu_type} to=${phone}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': token },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  console.log('[Sender] Uazapi menu response:', JSON.stringify(data).substring(0, 300));

  if (!response.ok && data.result !== 200) {
    throw new Error(data.message || data.error || `Uazapi menu error ${response.status}`);
  }

  return data.messageId || data.id || data.key?.id || `uazapi_menu_${Date.now()}`;
}

async function sendUazapiText(baseUrl: string, token: string, phone: string, text: string, delay?: number): Promise<string> {
  const url = `${baseUrl}/send/text`;
  console.log(`[Sender] Sending text via Uazapi to: ${phone} delay=${delay || 0}ms`);

  const body: Record<string, unknown> = { number: phone, text };
  if (delay && delay > 0) body.delay = delay;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': token },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  console.log('[Sender] Uazapi text response:', JSON.stringify(data).substring(0, 300));

  if (!response.ok && data.result !== 200) {
    throw new Error(data.message || data.error || 'Uazapi text error');
  }

  return data.messageId || data.id || data.key?.id || `uazapi_${Date.now()}`;
}

async function sendUazapiMedia(baseUrl: string, token: string, phone: string, queueItem: any, messageType: string, delay?: number): Promise<string> {
  let uazapiType: string;
  switch (messageType) {
    case 'audio': uazapiType = 'ptt'; break;
    case 'image': uazapiType = 'image'; break;
    case 'video': uazapiType = 'video'; break;
    case 'document': uazapiType = 'document'; break;
    default: uazapiType = 'document';
  }

  // Body conforme documentação Uazapi V2: { number, type, file, text?, docName?, delay? }
  const bodyPayload: Record<string, unknown> = {
    number: phone,
    type: uazapiType,
    file: queueItem.media_url,
  };

  // Caption/legenda (não enviar para áudio/ptt)
  if (uazapiType !== 'ptt' && queueItem.content) {
    bodyPayload.text = queueItem.content;
  }

  if (uazapiType === 'document') {
    const metadata = queueItem.metadata as Record<string, unknown> | null;
    bodyPayload.docName = (metadata?.docName as string) || queueItem.content || 'document';
  }

  // Native delay for Uazapi presence indicator
  if (delay && delay > 0) bodyPayload.delay = delay;

  const uazapiUrl = `${baseUrl}/send/media`;
  console.log('[Sender] Sending media via Uazapi:', { phone, type: uazapiType, file: queueItem.media_url, url: uazapiUrl });

  const response = await fetch(uazapiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': token },
    body: JSON.stringify(bodyPayload)
  });

  const responseData = await response.json();
  console.log('[Sender] Uazapi media response:', JSON.stringify(responseData).substring(0, 500));

  if (!response.ok && responseData.result !== 200) {
    const errMsg = responseData.message || responseData.error || `Uazapi ${response.status}`;
    throw new Error(`${response.status}: ${errMsg}`);
  }

  return responseData.messageId || responseData.id || responseData.key?.id || responseData.data?.to?.id || `uazapi_${Date.now()}`;
}

async function sendViaCloudApi(settings: any, phoneNumber: string, queueItem: any): Promise<string> {
  // Build WhatsApp API payload
  let payload: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneNumber
  };

  switch (queueItem.message_type) {
    case 'text':
      payload.type = 'text';
      payload.text = { body: queueItem.content };
      break;
    
    case 'image':
      payload.type = 'image';
      payload.image = { 
        link: queueItem.media_url,
        caption: queueItem.content || undefined
      };
      break;
    
    case 'audio':
      payload.type = 'audio';
      payload.audio = { link: queueItem.media_url };
      break;
    
    case 'document':
      payload.type = 'document';
      payload.document = { 
        link: queueItem.media_url,
        filename: queueItem.content || 'document'
      };
      break;
    
    default:
      payload.type = 'text';
      payload.text = { body: queueItem.content };
  }

  console.log('[Sender] WhatsApp API payload:', JSON.stringify(payload, null, 2));

  // Send via WhatsApp Cloud API
  const response = await fetch(
    `${WHATSAPP_API_URL}/${settings.whatsapp_phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.whatsapp_access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  const responseData = await response.json();

  if (!response.ok) {
    console.error('[Sender] WhatsApp API error:', responseData);
    throw new Error(responseData.error?.message || 'WhatsApp API error');
  }

  return responseData.messages?.[0]?.id || `cloud_${Date.now()}`;
}

// --- Presence indicator helpers ---

async function sendPresenceUazapi(baseUrl: string, token: string, phone: string, state: 'composing' | 'recording'): Promise<void> {
  const url = `${baseUrl}/chat/presence`;
  console.log(`[Sender] Sending presence via Uazapi: ${state} to ${phone}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'token': token },
    body: JSON.stringify({ Phone: phone, State: state })
  });

  if (!response.ok) {
    const data = await response.text();
    throw new Error(`Presence failed ${response.status}: ${data.substring(0, 200)}`);
  }
}

async function sendPresenceCloudApi(settings: any, phone: string): Promise<void> {
  const url = `${WHATSAPP_API_URL}/${settings.whatsapp_phone_number_id}/messages`;
  console.log(`[Sender] Sending typing indicator via Cloud API to ${phone}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.whatsapp_access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      typing_indicator: { type: 'text' }
    })
  });

  if (!response.ok) {
    const data = await response.text();
    throw new Error(`Typing indicator failed ${response.status}: ${data.substring(0, 200)}`);
  }
}
