import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GROUPING_DELAY_MS = 10000;

/** Normalize Brazilian phone: always add 9th digit (55+DDD+9+8digits = 13 digits) */
function normalizeBrazilianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("55")) {
    return "55" + digits.slice(2, 4) + "9" + digits.slice(4);
  }
  return digits;
}

/** Get both variants of a BR phone (with and without 9) */
function getBrazilianPhoneVariants(phone: string): string[] {
  const canonical = normalizeBrazilianPhone(phone);
  const variants = [canonical];
  if (canonical.length === 13 && canonical.startsWith("55")) {
    variants.push("55" + canonical.slice(2, 4) + canonical.slice(5));
  }
  return variants;
}

// ─── Mimetype → Extension map (confiável) ───
const MIME_EXT_MAP: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

function cleanMimetype(mime: string): string {
  return (mime || '').split(';')[0].trim().toLowerCase();
}

function getExtension(cleanMime: string): string {
  return MIME_EXT_MAP[cleanMime] || cleanMime.split('/')[1] || 'bin';
}

function detectMediaType(rawType: string): 'audio' | 'image' | 'video' | 'document' | 'text' {
  const t = rawType.toLowerCase();
  if (t === 'audio' || t === 'ptt') return 'audio';
  if (t === 'image' || t === 'sticker' || t === 'stickermessage') return 'image';
  if (t === 'video') return 'video';
  if (t === 'document') return 'document';
  return 'text';
}

// ─── Unified media processor ───
interface ProcessMediaResult {
  mediaUrl: string | null;
  resolvedMimetype: string | null;
  extension: string | null;
  transcription?: string | null;
  error?: string;
}

async function processIncomingMedia(
  supabase: SupabaseClient<any>,
  uazapiMessageId: string,
  messageDbId: string,
  mediaType: 'audio' | 'image' | 'video' | 'document'
): Promise<ProcessMediaResult> {
  try {
    // 1. Get Uazapi config - try instance from message metadata first, fallback to nina_settings
    let endpoint = '';
    let sessionkey = '';

    // Try to find instance from the message's contact
    const { data: msgData } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('id', messageDbId)
      .maybeSingle();

    if (msgData?.conversation_id) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('contact_id')
        .eq('id', msgData.conversation_id)
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
            endpoint = inst.endpoint.replace(/\/$/, '');
            sessionkey = inst.sessionkey;
          }
        }
      }
    }

    // Fallback to nina_settings
    if (!endpoint || !sessionkey) {
      const { data: settings } = await supabase
        .from('nina_settings')
        .select('uazapi_endpoint, uazapi_sessionkey')
        .limit(1)
        .maybeSingle();

      if (!settings?.uazapi_endpoint || !settings?.uazapi_sessionkey) {
        return { mediaUrl: null, resolvedMimetype: null, extension: null, error: 'Uazapi not configured' };
      }

      endpoint = settings.uazapi_endpoint.replace(/\/$/, '');
      sessionkey = settings.uazapi_sessionkey;
    }
    const isAudio = mediaType === 'audio';

    console.log(`[processMedia] Downloading ${mediaType} via /message/download for: ${uazapiMessageId}`);

    // 2. Call /message/download
    const downloadResponse = await fetch(`${endpoint}/message/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': sessionkey
      },
      body: JSON.stringify({
        id: uazapiMessageId,
        generate_mp3: isAudio,   // Convert audio to MP3 server-side
        return_link: true,
        return_base64: false
      })
    });

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text();
      console.error(`[processMedia] Download API error: ${downloadResponse.status}`, errorText);
      return { mediaUrl: null, resolvedMimetype: null, extension: null, error: `Download API ${downloadResponse.status}` };
    }

    const downloadData = await downloadResponse.json();
    console.log('[processMedia] Download response:', JSON.stringify(downloadData).substring(0, 300));

    // 3. Resolve REAL mimetype from download response (not webhook!)
    const resolvedMimetype = cleanMimetype(downloadData.mimetype || '');
    const extension = resolvedMimetype ? getExtension(resolvedMimetype) : (isAudio ? 'mp3' : 'bin');

    // 4. Get the file URL
    const fileURL = downloadData.fileURL || downloadData.url || downloadData.link;

    if (!fileURL && !downloadData.base64Data) {
      console.error('[processMedia] No fileURL or base64Data in response');
      return { mediaUrl: null, resolvedMimetype, extension, error: 'No file data returned' };
    }

    // 5. Download the REAL binary
    let mediaBuffer: ArrayBuffer | null = null;

    if (fileURL) {
      console.log('[processMedia] Fetching binary from:', fileURL);
      try {
        const fileResp = await fetch(fileURL);
        if (fileResp.ok) {
          mediaBuffer = await fileResp.arrayBuffer();
          console.log(`[processMedia] Downloaded ${mediaBuffer.byteLength} bytes`);
        } else {
          console.error('[processMedia] Fetch failed:', fileResp.status);
        }
      } catch (fetchErr) {
        console.error('[processMedia] Error fetching file:', fetchErr);
      }
    }

    if (!mediaBuffer && downloadData.base64Data) {
      console.log('[processMedia] Using base64Data fallback');
      const binaryString = atob(downloadData.base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      mediaBuffer = bytes.buffer;
    }

    if (!mediaBuffer || mediaBuffer.byteLength < 100) {
      console.error('[processMedia] Buffer empty or too small');
      // Fallback: return the Uazapi temp URL directly (it expires in 2 days)
      return { 
        mediaUrl: fileURL || null, 
        resolvedMimetype, 
        extension, 
        transcription: downloadData.transcription || null,
        error: mediaBuffer ? 'File too small' : 'No buffer obtained'
      };
    }

    // 6. Determine proper content type for upload
    const uploadContentType = resolvedMimetype || 
      (isAudio ? 'audio/mpeg' : `${mediaType}/${extension}`);

    // 7. Upload to Supabase Storage
    const storagePath = `uazapi/${messageDbId}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('audio-messages')
      .upload(storagePath, new Uint8Array(mediaBuffer), {
        contentType: uploadContentType,
        upsert: true
      });

    if (uploadError) {
      console.error('[processMedia] Storage upload error:', uploadError);
      // Fallback to Uazapi temp URL
      return { 
        mediaUrl: fileURL || null, 
        resolvedMimetype, 
        extension, 
        transcription: downloadData.transcription || null,
        error: `Upload failed: ${uploadError.message}`
      };
    }

    // 8. Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('audio-messages')
      .getPublicUrl(storagePath);

    const publicUrl = publicUrlData?.publicUrl;
    console.log(`[processMedia] ✅ ${mediaType} uploaded: ${publicUrl}`);

    return { 
      mediaUrl: publicUrl || fileURL || null, 
      resolvedMimetype, 
      extension,
      transcription: downloadData.transcription || null
    };

  } catch (error) {
    console.error('[processMedia] Error:', error);
    return { 
      mediaUrl: null, 
      resolvedMimetype: null, 
      extension: null, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// ─── Main handler ───
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey) as SupabaseClient<any>;

  try {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    const body = await req.json();
    console.log('[Uazapi-Webhook] Received payload:', JSON.stringify(body, null, 2));

    const webhookType = body.EventType || body.wook;
    const message = body.message || {};

    const isFromMe = message.fromMe === true || 
                     String(message.id || body.id || '').startsWith('true_') ||
                     body.status === 'SENT';
    
    // Detect if sent by API (to avoid duplicating messages our system already saved)
    const wasSentByApi = !!(message.wasSentByApi || body.wasSentByApi || 
                           (message.metadata as any)?.wasSentByApi);

    console.log('[Uazapi-Webhook] Type:', webhookType, 'fromMe:', isFromMe, 'wasSentByApi:', wasSentByApi);

    // Check if this is an edited message
    const isEdited = !!(message.edited || message.editedMessage || body.editedMessage);

    switch (webhookType) {
      case 'messages':
      case 'RECEIVE_MESSAGE':
        if (message.isGroup || body.isGroupMsg) {
          return new Response(JSON.stringify({ status: 'ignored', reason: 'group' }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        // Handle edited messages
        if (isEdited) {
          return await handleEditedMessage(supabase, body);
        }
        if (isFromMe) {
          return await handleOutgoingMessage(supabase, body, wasSentByApi, supabaseUrl, supabaseServiceKey);
        }
        return await handleIncomingMessage(supabase, body, supabaseUrl, supabaseServiceKey);
      
      case 'messages_update':
      case 'MESSAGE_STATUS':
        return await handleMessageStatus(supabase, body);
      
      case 'connection':
      case 'STATUS_CONNECT':
      case 'QRCODE':
      case 'chats':
      case 'presence':
        return new Response(JSON.stringify({ status: 'acknowledged' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      
      default:
        return new Response(JSON.stringify({ status: 'ignored', reason: 'unknown type' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('[Uazapi-Webhook] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// ─── Incoming message handler ───
async function handleIncomingMessage(
  supabase: SupabaseClient<any>,
  body: Record<string, unknown>,
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<Response> {
  const processAfter = new Date(Date.now() + GROUPING_DELAY_MS).toISOString();
  const message = (body.message || {}) as Record<string, unknown>;
  const chat = (body.chat || {}) as Record<string, unknown>;
  
  // ── Extract phone number ──
  let phoneNumber = '';
  if (message.chatid) {
    phoneNumber = String(message.chatid).split('@')[0].replace(/\D/g, '');
  } else if (chat.wa_chatid) {
    phoneNumber = String(chat.wa_chatid).split('@')[0].replace(/\D/g, '');
  } else {
    phoneNumber = String(body.phone || body.sender || '').replace(/\D/g, '');
  }
  
  const contactName = (chat.name || message.senderName || body.name) as string || null;
  const messageId = (message.id || message.messageid || body.id) as string || `uazapi_${Date.now()}`;
  
  // ── Detect message type ──
  let rawType = String(message.type || body.type || 'text');
  if (rawType === 'Conversation' || rawType === 'ExtendedTextMessage') rawType = 'text';
  
  // Also detect from parsed JSON content (Uazapi sometimes puts media info in content)
  const rawContent = (message.text || message.content || body.content) as unknown;
  const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent ?? '');
  
  let parsedContent: Record<string, unknown> | null = null;
  if (typeof content === 'string' && content.trimStart().startsWith('{')) {
    try { parsedContent = JSON.parse(content.trim()); } catch { /* ignore */ }
  }

  const rawMimeFromWebhook = String(
    (message as any).mediaType || (message as any).media_type ||
    (body as any).mediaType || (body as any).mimetype ||
    (parsedContent?.mimetype ?? '')
  ).toLowerCase();

  // Detect media type from raw type or mime
  let mediaType = detectMediaType(rawType);
  
  if (mediaType === 'text' && rawType.toLowerCase() === 'media') {
    if (rawMimeFromWebhook.includes('audio')) mediaType = 'audio';
    else if (rawMimeFromWebhook.includes('image')) mediaType = 'image';
    else if (rawMimeFromWebhook.includes('video')) mediaType = 'video';
    else if (rawMimeFromWebhook.includes('application') || rawMimeFromWebhook.includes('pdf')) mediaType = 'document';
  }

  if (mediaType === 'text' && parsedContent) {
    const parsedMime = String(parsedContent.mimetype || parsedContent.mimeType || '').toLowerCase();
    if (parsedMime.includes('audio') || parsedMime.includes('ogg') || parsedMime.includes('opus')) mediaType = 'audio';
    else if (parsedMime.includes('image') || parsedMime.includes('webp')) mediaType = 'image';
    else if (parsedMime.includes('video')) mediaType = 'video';
  }

  const session = (body.owner || body.session) as string || 'default';
  const isMedia = mediaType !== 'text';

  // ── Resolve uazapi_instance_id with multiple fallbacks ──
  let uazapiInstanceId: string | null = null;
  {
    // 1. Try by session = owner phone
    const { data: inst1 } = await supabase
      .from('uazapi_instances')
      .select('id')
      .eq('session', session)
      .eq('is_active', true)
      .maybeSingle();
    if (inst1) {
      uazapiInstanceId = inst1.id;
      console.log('[Uazapi-Webhook] Instance found by session:', session);
    }

    // 2. Fallback: try by name = instanceName from payload
    if (!uazapiInstanceId && body.instanceName) {
      const { data: inst2 } = await supabase
        .from('uazapi_instances')
        .select('id')
        .eq('name', String(body.instanceName))
        .eq('is_active', true)
        .maybeSingle();
      if (inst2) {
        uazapiInstanceId = inst2.id;
        console.log('[Uazapi-Webhook] Instance found by instanceName:', body.instanceName);
      }
    }

    // 3. Fallback: try by phone_number = owner phone
    if (!uazapiInstanceId) {
      const { data: inst3 } = await supabase
        .from('uazapi_instances')
        .select('id')
        .eq('phone_number', session)
        .eq('is_active', true)
        .maybeSingle();
      if (inst3) {
        uazapiInstanceId = inst3.id;
        console.log('[Uazapi-Webhook] Instance found by phone_number:', session);
      }
    }

    // 4. Last fallback: first active instance
    if (!uazapiInstanceId) {
      const { data: inst4 } = await supabase
        .from('uazapi_instances')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (inst4) {
        uazapiInstanceId = inst4.id;
        console.log('[Uazapi-Webhook] Using first active instance as fallback');
      }
    }
  }

  if (!phoneNumber) {
    return new Response(JSON.stringify({ error: 'No phone number' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`[Uazapi-Webhook] From: ${phoneNumber}, type: ${mediaType}, content: ${String(content || '').substring(0, 50)}`);

  // ── 1. Get or create contact (with Brazilian 9th digit fallback) ──
  const phoneVariants = getBrazilianPhoneVariants(phoneNumber);
  const canonicalPhone = normalizeBrazilianPhone(phoneNumber);
  
  let { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .in('phone_number', phoneVariants)
    .maybeSingle();

  if (!contact) {
    const { data: newContact, error: contactError } = await supabase
      .from('contacts')
      .insert({
        phone_number: canonicalPhone,
        whatsapp_id: phoneNumber,
        name: contactName,
        call_name: contactName?.split(' ')[0] || null,
        user_id: null,
        uazapi_instance_id: uazapiInstanceId
      })
      .select()
      .single();

    if (contactError) {
      console.error('[Uazapi-Webhook] Error creating contact:', contactError);
      return new Response(JSON.stringify({ error: 'Failed to create contact' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    contact = newContact;
  } else {
    const updates: Record<string, unknown> = { last_activity: new Date().toISOString() };
    if (contactName && !contact.name) {
      updates.name = contactName;
      updates.call_name = contactName.split(' ')[0];
    }
    // Associate contact with instance if not already
    if (uazapiInstanceId && !contact.uazapi_instance_id) {
      updates.uazapi_instance_id = uazapiInstanceId;
    }
    await supabase.from('contacts').update(updates).eq('id', contact.id);
  }

  if (!contact) {
    return new Response(JSON.stringify({ error: 'Failed to get/create contact' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── 2. Get or create conversation ──
  let { data: conversation } = await supabase
    .from('conversations')
    .select('*')
    .eq('contact_id', contact.id)
    .eq('is_active', true)
    .maybeSingle();

  if (!conversation) {
    const { data: newConv, error: convError } = await supabase
      .from('conversations')
      .insert({ contact_id: contact.id, status: 'nina', is_active: true, user_id: null })
      .select()
      .single();

    if (convError) {
      console.error('[Uazapi-Webhook] Error creating conversation:', convError);
      return new Response(JSON.stringify({ error: 'Failed to create conversation' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    conversation = newConv;
  }

  if (!conversation) {
    return new Response(JSON.stringify({ error: 'Failed to get/create conversation' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── 3. Build message content ──
  const contentMap: Record<string, string> = {
    audio: '[áudio recebido]',
    image: content || '[imagem recebida]',
    video: content || '[vídeo recebido]',
    document: content || '[documento recebido]',
  };
  const messageContent = isMedia ? contentMap[mediaType] || `[${mediaType}]` : content;

  // ── 4. Create message ──
  const messageMetadata: Record<string, unknown> = {
    provider: 'uazapi',
    original_type: rawType,
    session,
    uazapi_message_id: messageId,
  };
  if (isMedia) {
    messageMetadata.needs_download = true;
    messageMetadata.webhook_mimetype = rawMimeFromWebhook || null;
  }

  const { data: dbMessage, error: msgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      whatsapp_message_id: messageId,
      content: messageContent,
      type: mediaType === 'text' ? 'text' : mediaType,
      from_type: 'user',
      status: 'sent',
      media_type: isMedia ? mediaType : null,
      sent_at: new Date().toISOString(),
      metadata: messageMetadata
    })
    .select()
    .single();

  if (msgError) {
    if (msgError.code === '23505') {
      return new Response(JSON.stringify({ status: 'duplicate' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    console.error('[Uazapi-Webhook] Error creating message:', msgError);
    return new Response(JSON.stringify({ error: 'Failed to create message' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log('[Uazapi-Webhook] Created message:', dbMessage?.id, 'type:', mediaType);

  // ── 5. Process media via unified processIncomingMedia ──
  if (isMedia && dbMessage && mediaType !== 'text') {
    const result = await processIncomingMedia(
      supabase,
      messageId,
      dbMessage.id,
      mediaType as 'audio' | 'image' | 'video' | 'document'
    );

    const updatedMetadata: Record<string, unknown> = {
      ...messageMetadata,
      needs_download: !result.mediaUrl,
      resolved_mimetype: result.resolvedMimetype,
      extension: result.extension,
    };

    if (result.mediaUrl) {
      updatedMetadata.download_completed = true;
      if (mediaType === 'audio') updatedMetadata.audio_format = result.extension || 'mp3';

      await supabase
        .from('messages')
        .update({
          media_url: result.mediaUrl,
          content: (mediaType === 'audio' && result.transcription) 
            ? result.transcription 
            : dbMessage.content,
          metadata: updatedMetadata
        })
        .eq('id', dbMessage.id);

      console.log(`[Uazapi-Webhook] ✅ ${mediaType} updated with URL: ${result.mediaUrl}`);
    } else {
      updatedMetadata.download_error = result.error;
      updatedMetadata.download_failed_at = new Date().toISOString();

      await supabase
        .from('messages')
        .update({ metadata: updatedMetadata })
        .eq('id', dbMessage.id);

      console.error(`[Uazapi-Webhook] ❌ ${mediaType} download failed: ${result.error}`);
    }
  }

  // ── 6. Update conversation ──
  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversation.id);

  // ── 7. Reset grouping timer for pending messages from same contact, THEN insert ──
  await supabase
    .from('message_grouping_queue')
    .update({ process_after: processAfter })
    .eq('processed', false)
    .eq('phone_number_id', session)
    .filter('contacts_data->>phone', 'eq', phoneNumber);

  const { error: queueError } = await supabase
    .from('message_grouping_queue')
    .insert({
      whatsapp_message_id: messageId,
      phone_number_id: session,
      message_id: dbMessage?.id,
      message_data: body,
      contacts_data: { name: contactName, phone: phoneNumber },
      process_after: processAfter
    });

  if (queueError && queueError.code !== '23505') {
    console.error('[Uazapi-Webhook] Queue insert error:', queueError);
  }

  // ── 8. Trigger message-grouper ──
  EdgeRuntime.waitUntil(
    fetch(`${supabaseUrl}/functions/v1/message-grouper`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({ triggered_by: 'uazapi-webhook' })
    }).catch(err => console.error('[Uazapi-Webhook] Error triggering grouper:', err))
  );

  return new Response(JSON.stringify({ status: 'processed', message_id: dbMessage?.id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ─── Status update handler ───
async function handleMessageStatus(
  supabase: SupabaseClient<any>,
  body: Record<string, unknown>
): Promise<Response> {
  const status = body.status as string;
  const messageId = body.id as string;

  if (messageId && status) {
    const statusMap: Record<string, string> = {
      'RECEIVED': 'delivered', 'READ': 'read', 'SENT': 'sent', 'FAILED': 'failed'
    };
    const newStatus = statusMap[status.toUpperCase()];
    if (newStatus) {
      const updateData: Record<string, unknown> = { status: newStatus };
      if (newStatus === 'delivered') updateData.delivered_at = new Date().toISOString();
      if (newStatus === 'read') updateData.read_at = new Date().toISOString();
      await supabase.from('messages').update(updateData).eq('whatsapp_message_id', messageId);
    }
  }

  return new Response(JSON.stringify({ status: 'processed' }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ─── Edited message handler ───
async function handleEditedMessage(
  supabase: SupabaseClient<any>,
  body: Record<string, unknown>
): Promise<Response> {
  const message = (body.message || {}) as Record<string, unknown>;
  
  // Get the original message ID (the one being edited)
  const editedInfo = (message.edited || message.editedMessage || body.editedMessage) as Record<string, unknown> | string;
  const originalMessageId = typeof editedInfo === 'object' 
    ? String(editedInfo.id || editedInfo.messageId || message.id || body.id || '')
    : String(message.id || body.id || '');
  
  // Get new text content
  const newText = String(
    (typeof editedInfo === 'object' ? editedInfo.text : null) || 
    message.text || message.content || body.text || ''
  );

  if (!originalMessageId || !newText) {
    console.log('[Uazapi-Webhook] Edited message missing ID or text, ignoring');
    return new Response(JSON.stringify({ status: 'ignored', reason: 'no id or text' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log(`[Uazapi-Webhook] 📝 Message edited: ${originalMessageId} → "${newText.substring(0, 50)}"`);

  // Find and update the message in DB
  const { data: updated, error: updateError } = await supabase
    .from('messages')
    .update({ 
      content: newText,
      metadata: {
        edited: true,
        edited_at: new Date().toISOString()
      }
    })
    .eq('whatsapp_message_id', originalMessageId)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[Uazapi-Webhook] Error updating edited message:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to update message' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if (!updated) {
    // Try without owner prefix
    const shortId = originalMessageId.includes(':') 
      ? originalMessageId.split(':').pop()! 
      : originalMessageId;
    
    const { data: updated2 } = await supabase
      .from('messages')
      .update({ 
        content: newText,
        metadata: {
          edited: true,
          edited_at: new Date().toISOString()
        }
      })
      .like('whatsapp_message_id', `%${shortId}`)
      .select('id')
      .maybeSingle();

    if (updated2) {
      console.log('[Uazapi-Webhook] ✅ Edited message updated (short ID match):', updated2.id);
    } else {
      console.log('[Uazapi-Webhook] Message not found for edit:', originalMessageId);
    }
  } else {
    console.log('[Uazapi-Webhook] ✅ Edited message updated:', updated.id);
  }

  return new Response(JSON.stringify({ status: 'edited', message_id: updated?.id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}


// Handles both API-sent messages (just update status) and
// phone/WhatsApp Web messages (create as 'human' outgoing)
async function handleOutgoingMessage(
  supabase: SupabaseClient<any>,
  body: Record<string, unknown>,
  wasSentByApi: boolean,
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<Response> {
  const message = (body.message || {}) as Record<string, unknown>;
  const chat = (body.chat || {}) as Record<string, unknown>;
  const messageId = (message.id || body.id) as string;

  // 1. Check if message already exists (deduplication)
  const { data: existing } = await supabase
    .from('messages')
    .select('id, status')
    .eq('whatsapp_message_id', messageId)
    .maybeSingle();

  if (existing) {
    // Already in DB → just update status
    await supabase
      .from('messages')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', existing.id);
    
    console.log('[Uazapi-Webhook] Echo: updated existing message:', existing.id);
    return new Response(JSON.stringify({ status: 'echo_updated', message_id: existing.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 2. If sent by API but not in DB yet, ignore (race condition)
  if (wasSentByApi) {
    console.log('[Uazapi-Webhook] API-sent message not in DB yet, ignoring echo:', messageId);
    return new Response(JSON.stringify({ status: 'api_echo_ignored' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 3. Message sent from phone/WhatsApp Web → save as 'human' outgoing
  console.log('[Uazapi-Webhook] Saving outgoing message from phone/WhatsApp Web:', messageId);

  // Extract phone number (destination)
  let phoneNumber = '';
  if (message.chatid) {
    phoneNumber = String(message.chatid).split('@')[0].replace(/\D/g, '');
  } else if (chat.wa_chatid) {
    phoneNumber = String(chat.wa_chatid).split('@')[0].replace(/\D/g, '');
  } else {
    phoneNumber = String(body.phone || body.sender || '').replace(/\D/g, '');
  }

  if (!phoneNumber) {
    console.log('[Uazapi-Webhook] No phone number in outgoing message, ignoring');
    return new Response(JSON.stringify({ status: 'ignored', reason: 'no phone' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Find the contact
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  if (!contact) {
    console.log('[Uazapi-Webhook] No contact found for outgoing message to:', phoneNumber);
    return new Response(JSON.stringify({ status: 'ignored', reason: 'no contact' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Find active conversation
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, status')
    .eq('contact_id', contact.id)
    .eq('is_active', true)
    .maybeSingle();

  if (!conversation) {
    console.log('[Uazapi-Webhook] No active conversation for outgoing message to:', phoneNumber);
    return new Response(JSON.stringify({ status: 'ignored', reason: 'no conversation' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Extract content and type
  // For outgoing messages: message.text has caption for text msgs, 
  // message.content is an object with {URL, mimetype, caption, ...} for media
  const contentObj = message.content as Record<string, unknown> | null;
  const isContentObject = contentObj && typeof contentObj === 'object' && !Array.isArray(contentObj);
  
  // Extract caption: prefer message.text, then content.caption from the media object
  const captionFromText = typeof message.text === 'string' ? message.text : '';
  const captionFromContent = isContentObject ? String(contentObj.caption || '') : '';
  const extractedCaption = captionFromText || captionFromContent;
  
  // For non-media detection, use the caption as content string
  const content = extractedCaption || (typeof message.text === 'string' ? message.text : 
    (typeof contentObj === 'string' ? contentObj : ''));
  
  // Uazapi uses messageType (e.g. "ImageMessage") and mediaType (e.g. "image")
  let rawType = String(message.messageType || message.type || message.mediaType || body.type || 'text');
  if (rawType === 'Conversation' || rawType === 'ExtendedTextMessage') rawType = 'text';
  
  // Map Uazapi messageType names
  const messageTypeMap: Record<string, string> = {
    'ImageMessage': 'image', 'AudioMessage': 'audio', 'VideoMessage': 'video',
    'DocumentMessage': 'document', 'StickerMessage': 'sticker',
  };
  if (messageTypeMap[rawType]) rawType = messageTypeMap[rawType];
  
  let mediaType = detectMediaType(rawType);

  // Also check message.mediaType field directly (Uazapi puts "image", "audio", etc.)
  if (mediaType === 'text' && message.mediaType) {
    const mt = String(message.mediaType).toLowerCase();
    if (mt === 'image' || mt === 'audio' || mt === 'video' || mt === 'document' || mt === 'sticker') {
      mediaType = detectMediaType(mt);
    }
  }

  // Fallback: check message.content object for mimetype
  if (mediaType === 'text' && isContentObject) {
    const mime = String(contentObj.mimetype || contentObj.mimeType || '').toLowerCase();
    if (mime.includes('audio') || mime.includes('ogg') || mime.includes('opus')) mediaType = 'audio';
    else if (mime.includes('image') || mime.includes('webp')) mediaType = 'image';
    else if (mime.includes('video')) mediaType = 'video';
    else if (mime.includes('application') || mime.includes('pdf')) mediaType = 'document';
  }

  // Last fallback: parse content string as JSON for mimetype
  if (mediaType === 'text' && content) {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const mime = String(parsed.mimetype || parsed.mimeType || '').toLowerCase();
        if (mime.includes('audio') || mime.includes('ogg') || mime.includes('opus')) mediaType = 'audio';
        else if (mime.includes('image') || mime.includes('webp')) mediaType = 'image';
        else if (mime.includes('video')) mediaType = 'video';
        else if (mime.includes('application') || mime.includes('pdf')) mediaType = 'document';
      } catch { /* ignore */ }
    }
  }

  const isMedia = mediaType !== 'text';

  // Use extracted caption for content, otherwise placeholder
  const isSticker = rawType === 'sticker' || rawType === 'StickerMessage' || 
    String((contentObj as any)?.mimetype || '').includes('webp');
  
  const contentMap: Record<string, string> = {
    audio: '[áudio enviado]',
    image: isSticker ? '[figurinha enviada]' : (extractedCaption || '[imagem enviada]'),
    video: extractedCaption || '[vídeo enviado]',
    document: extractedCaption || '[documento enviado]',
  };
  const messageContent = isMedia ? contentMap[mediaType] || `[${mediaType}]` : content;

  // Create message as 'human' (sent by human agent via phone)
  const { data: dbMessage, error: msgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      whatsapp_message_id: messageId,
      content: messageContent || '',
      type: mediaType === 'text' ? 'text' : mediaType,
      from_type: 'human',  // ← Key: marks as sent by human (not nina, not user)
      status: 'sent',
      media_type: isMedia ? mediaType : null,
      sent_at: new Date().toISOString(),
      metadata: {
        provider: 'uazapi',
        source: 'whatsapp_direct',  // Sent from phone/WhatsApp Web
        original_type: rawType,
        uazapi_message_id: messageId
      }
    })
    .select()
    .single();

  if (msgError) {
    if (msgError.code === '23505') {
      console.log('[Uazapi-Webhook] Duplicate outgoing message:', messageId);
      return new Response(JSON.stringify({ status: 'duplicate' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    console.error('[Uazapi-Webhook] Error saving outgoing message:', msgError);
    return new Response(JSON.stringify({ error: 'Failed to save outgoing message' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  console.log('[Uazapi-Webhook] ✅ Saved outgoing human message:', dbMessage?.id, 'type:', mediaType);

  // Download media if applicable
  if (isMedia && dbMessage && mediaType !== 'text') {
    const result = await processIncomingMedia(
      supabase,
      messageId,
      dbMessage.id,
      mediaType as 'audio' | 'image' | 'video' | 'document'
    );

    if (result.mediaUrl) {
      await supabase
        .from('messages')
        .update({
          media_url: result.mediaUrl,
          metadata: {
            ...(dbMessage.metadata as any || {}),
            needs_download: false,
            download_completed: true,
            resolved_mimetype: result.resolvedMimetype
          }
        })
        .eq('id', dbMessage.id);
    }
  }

  // Update conversation last_message_at
  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversation.id);

  return new Response(JSON.stringify({ 
    status: 'outgoing_saved', 
    message_id: dbMessage?.id,
    from_type: 'human'
  }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
