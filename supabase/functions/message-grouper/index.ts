import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('[MessageGrouper] Starting message grouping...');

    // Fetch messages ready to process (timer expired and not processed)
    const { data: readyMessages, error: fetchError } = await supabase
      .from('message_grouping_queue')
      .select('*')
      .eq('processed', false)
      .lte('process_after', new Date().toISOString())
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('[MessageGrouper] Error fetching messages:', fetchError);
      throw fetchError;
    }

    if (!readyMessages || readyMessages.length === 0) {
      console.log('[MessageGrouper] No messages ready to process');
      
      // Check if there are pending messages with future process_after and schedule re-invocation
      await scheduleNextProcessing(supabase, supabaseUrl, supabaseServiceKey);
      
      return new Response(JSON.stringify({ processed: 0, groups: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[MessageGrouper] Found ${readyMessages.length} messages ready to process`);

    // IMMEDIATELY mark all ready messages as processed to prevent duplicates
    const readyIds = readyMessages.map(m => m.id);
    await supabase
      .from('message_grouping_queue')
      .update({ processed: true })
      .in('id', readyIds);

    console.log(`[MessageGrouper] Marked ${readyIds.length} messages as processed`);

    // Group messages by phone number
    const grouped: Record<string, typeof readyMessages> = {};
    for (const msg of readyMessages) {
      // Support both WhatsApp Cloud API (from) and Uazapi (message.chatid/chat.wa_chatid) formats
      const messageData = msg.message_data || {};
      const message = messageData.message || messageData;
      const chat = messageData.chat || {};
      
      // Try different phone number fields based on provider
      let phone = messageData.from; // WhatsApp Cloud API
      
      if (!phone && message.chatid) {
        // Uazapi format: extract from chatid "554488064777@s.whatsapp.net"
        phone = String(message.chatid).split('@')[0];
      }
      if (!phone && chat.wa_chatid) {
        phone = String(chat.wa_chatid).split('@')[0];
      }
      if (!phone && msg.contacts_data?.phone) {
        phone = String(msg.contacts_data.phone).replace(/\D/g, '');
      }
      
      if (!phone) {
        console.log('[MessageGrouper] No phone found for message:', msg.id);
        continue;
      }
      
      // Normalize phone number (canonical Brazilian format with 9th digit)
      phone = normalizeBrazilianPhone(String(phone));
      
      if (!grouped[phone]) grouped[phone] = [];
      grouped[phone].push(msg);
    }

    const groupCount = Object.keys(grouped).length;
    console.log(`[MessageGrouper] Grouped into ${groupCount} phone numbers`);

    let processedCount = 0;

    // Process each group
    for (const [phoneNumber, messages] of Object.entries(grouped)) {
      try {
        console.log(`[MessageGrouper] Processing group for ${phoneNumber} with ${messages.length} messages`);

        // Get the phone_number_id from the first message
        const phoneNumberId = messages[0].phone_number_id;

        // Get owner settings for this phone_number_id
        const { data: ownerSettings } = await supabase
          .from('nina_settings')
          .select('user_id, whatsapp_access_token')
          .eq('whatsapp_phone_number_id', phoneNumberId)
          .maybeSingle();

        // Get all message_ids from the queue entries
        const messageIds = messages.map(m => m.message_id).filter(Boolean);
        
        if (messageIds.length === 0) {
          console.log(`[MessageGrouper] No message_ids found for group ${phoneNumber}, skipping`);
          continue;
        }

        // Fetch the actual messages from the database
        const { data: dbMessages, error: dbMsgError } = await supabase
          .from('messages')
          .select('*')
          .in('id', messageIds)
          .order('sent_at', { ascending: true });

        if (dbMsgError || !dbMessages || dbMessages.length === 0) {
          console.error('[MessageGrouper] Error fetching messages from DB:', dbMsgError);
          continue;
        }

        // Get the last message's conversation for context
        const lastDbMessage = dbMessages[dbMessages.length - 1];
        const conversationId = lastDbMessage.conversation_id;

        // Get conversation details
        const { data: conversation } = await supabase
          .from('conversations')
          .select('*, contacts(*)')
          .eq('id', conversationId)
          .single();

        if (!conversation) {
          console.error('[MessageGrouper] Conversation not found:', conversationId);
          continue;
        }

        // Combine content and handle audio transcription
        const combinedContent = await combineAndTranscribeMessages(
          supabase,
          messages,
          dbMessages,
          ownerSettings,
          lovableApiKey
        );

        console.log(`[MessageGrouper] Combined content for ${phoneNumber}:`, combinedContent.substring(0, 200));

        // Update the last message with combined content if multiple messages
        if (dbMessages.length > 1) {
          await supabase
            .from('messages')
            .update({
              content: combinedContent,
              metadata: {
                ...lastDbMessage.metadata,
                grouped_messages: messageIds,
                message_count: messageIds.length
              }
            })
            .eq('id', lastDbMessage.id);
          
          console.log(`[MessageGrouper] Updated last message with combined content`);
        } else if (dbMessages[0].type === 'audio' && combinedContent !== dbMessages[0].content) {
          // Update single audio message with transcription
          await supabase
            .from('messages')
            .update({ content: combinedContent })
            .eq('id', dbMessages[0].id);
          
          console.log(`[MessageGrouper] Updated audio message with transcription`);
        }

        // If conversation is handled by Nina, queue for AI processing
        if (conversation.status === 'nina') {
          // Check if already in queue to avoid duplicates
          const { data: existingQueue } = await supabase
            .from('nina_processing_queue')
            .select('id')
            .eq('message_id', lastDbMessage.id)
            .maybeSingle();

          if (!existingQueue) {
            const { error: ninaQueueError } = await supabase
              .from('nina_processing_queue')
              .insert({
                message_id: lastDbMessage.id,
                conversation_id: conversationId,
                contact_id: conversation.contact_id,
                priority: 1,
                context_data: {
                  phone_number_id: phoneNumberId,
                  contact_name: conversation.contacts?.name || conversation.contacts?.call_name,
                  message_type: lastDbMessage.type,
                  grouped_count: messageIds.length,
                  combined_content: combinedContent
                }
              });

            if (ninaQueueError) {
              console.error('[MessageGrouper] Error queuing for Nina:', ninaQueueError);
            } else {
              console.log('[MessageGrouper] Message queued for Nina processing');
              
              // Trigger nina-orchestrator
              fetch(`${supabaseUrl}/functions/v1/nina-orchestrator`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${supabaseServiceKey}`
                },
                body: JSON.stringify({ triggered_by: 'message-grouper' })
              }).catch(err => console.error('[MessageGrouper] Error triggering nina-orchestrator:', err));
            }
          } else {
            console.log('[MessageGrouper] Message already in Nina queue, skipping');
          }
        }

        processedCount += messages.length;
        console.log(`[MessageGrouper] Group ${phoneNumber} processed successfully`);

      } catch (groupError) {
        console.error(`[MessageGrouper] Error processing group ${phoneNumber}:`, groupError);
      }
    }

    console.log(`[MessageGrouper] Completed. Processed ${processedCount} messages in ${groupCount} groups`);

    // Check if there are more pending messages and schedule re-invocation
    await scheduleNextProcessing(supabase, supabaseUrl, supabaseServiceKey);

    return new Response(JSON.stringify({ 
      processed: processedCount, 
      groups: groupCount 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[MessageGrouper] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Combine content from multiple messages and transcribe audio
async function combineAndTranscribeMessages(
  supabase: any,
  queueMessages: any[],
  dbMessages: any[],
  settings: any,
  lovableApiKey: string
): Promise<string> {
  const contentParts: string[] = [];

  // Get Uazapi settings (nina_settings as fallback)
  const { data: uazapiSettings } = await supabase
    .from('nina_settings')
    .select('uazapi_endpoint, uazapi_session, uazapi_sessionkey, whatsapp_provider')
    .limit(1)
    .maybeSingle();

  // Helper to resolve Uazapi credentials for a specific contact
  async function resolveUazapiCreds(contactId: string | null): Promise<{ endpoint: string; session: string; sessionkey: string } | null> {
    if (contactId) {
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
          .maybeSingle();

        if (inst) return { endpoint: inst.endpoint, session: inst.session || '', sessionkey: inst.sessionkey };
      }
    }
    if (uazapiSettings?.uazapi_endpoint && uazapiSettings?.uazapi_sessionkey) {
      return { endpoint: uazapiSettings.uazapi_endpoint, session: uazapiSettings.uazapi_session || '', sessionkey: uazapiSettings.uazapi_sessionkey };
    }
    return null;
  }

  for (let i = 0; i < queueMessages.length; i++) {
    const queueMsg = queueMessages[i];
    const dbMsg = dbMessages.find(m => m.id === queueMsg.message_id);
    const messageData = queueMsg.message_data;
    
    if (!dbMsg) continue;

    let content = dbMsg.content || '';
    const metadata = dbMsg.metadata || {};
    const provider = metadata.provider || 'cloud';

    // Handle audio transcription
    const msgType = messageData.type || messageData.message?.type || messageData.message?.mediaType;
    
    // Also check if content is JSON with audio mimetype (Uazapi often sends this way)
    let isAudioFromContent = false;
    if (dbMsg.content) {
      const trimmed = dbMsg.content.trim();
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          const mime = String(parsed.mimetype || parsed.mimeType || '').toLowerCase();
          if (mime.includes('audio') || mime.includes('ogg') || mime.includes('opus')) {
            isAudioFromContent = true;
            console.log('[MessageGrouper] Detected audio from content JSON:', mime);
          }
        } catch {
          // Not JSON, ignore
        }
      }
    }
    
    if (msgType === 'audio' || msgType === 'ptt' || msgType === 'media' || dbMsg.type === 'audio' || isAudioFromContent) {
      let audioBuffer: ArrayBuffer | null = null;
      let mediaUrl: string | null = dbMsg.media_url || null;

      // Check provider and use appropriate download method
      const shouldDownloadFromUazapi = provider === 'uazapi' && (metadata.needs_download || isAudioFromContent);
      
      if (shouldDownloadFromUazapi) {
        // Download from Uazapi - resolve per-contact instance
        const contactId = dbMsg.metadata?.contact_id || null;
        const creds = await resolveUazapiCreds(contactId);
        if (creds) {
          const uazapiMsgId = metadata.uazapi_message_id || dbMsg.whatsapp_message_id;
          console.log('[MessageGrouper] Downloading audio from Uazapi:', uazapiMsgId);
          const uazapiResult = await downloadUazapiMedia(
            creds.endpoint,
            creds.session,
            creds.sessionkey,
            uazapiMsgId
          );
          
          audioBuffer = uazapiResult.buffer;
          mediaUrl = uazapiResult.url;

          if (audioBuffer) {
            const uploadedUrl = await uploadAudioToStorage(
              supabase, audioBuffer, dbMsg.conversation_id, dbMsg.id
            );
            if (uploadedUrl) {
              mediaUrl = uploadedUrl;
              console.log('[MessageGrouper] Audio uploaded to storage:', uploadedUrl);
            }
          }
          
          if (mediaUrl) {
            await supabase
              .from('messages')
              .update({ 
                type: 'audio',
                media_url: mediaUrl,
                metadata: { ...metadata, needs_download: false, uazapi_message_id: uazapiMsgId }
              })
              .eq('id', dbMsg.id);
          }
        }
      } else if (mediaUrl && dbMsg.type === 'audio') {
        // Audio already has a media_url (e.g. processed by uazapi-webhook)
        // Download from existing media_url for transcription
        console.log('[MessageGrouper] Downloading audio from existing media_url for transcription:', mediaUrl);
        try {
          const mediaResponse = await fetch(mediaUrl);
          if (mediaResponse.ok) {
            audioBuffer = await mediaResponse.arrayBuffer();
            console.log('[MessageGrouper] Downloaded audio from media_url, size:', audioBuffer.byteLength);
          } else {
            console.error('[MessageGrouper] Failed to download from media_url:', mediaResponse.status);
          }
        } catch (downloadErr) {
          console.error('[MessageGrouper] Error downloading from media_url:', downloadErr);
        }
      } else {
        // Download from WhatsApp Cloud API
        const audioMediaId = messageData.audio?.id;
        if (audioMediaId && settings?.whatsapp_access_token) {
          console.log('[MessageGrouper] Downloading audio from WhatsApp Cloud:', audioMediaId);
          audioBuffer = await downloadWhatsAppMedia(settings, audioMediaId);
        }
      }

      // Transcribe audio if downloaded
      if (audioBuffer && lovableApiKey) {
        const transcription = await transcribeAudio(audioBuffer, lovableApiKey);
        if (transcription) {
          content = transcription;
          await supabase
            .from('messages')
            .update({ content: transcription, transcription_text: transcription, transcription_status: 'completed' })
            .eq('id', dbMsg.id);
          console.log('[MessageGrouper] Audio transcribed successfully');
        } else {
          content = '[áudio]';
          await supabase
            .from('messages')
            .update({ content: '[áudio]', transcription_status: 'failed' })
            .eq('id', dbMsg.id);
          console.log('[MessageGrouper] Transcription failed, using placeholder');
        }
      } else if (dbMsg.type === 'audio' && (!content || content === '[áudio - processando transcrição...]')) {
        content = '[áudio]';
        await supabase
          .from('messages')
          .update({ content: '[áudio]' })
          .eq('id', dbMsg.id);
      }
    }

    // Skip empty content, placeholders, and raw JSON objects (often media payload) that start with "{" (ignoring leading whitespace)
    if (content && 
        content !== '[áudio - processando transcrição...]' && 
        content !== '[áudio]' &&
        !content.trimStart().startsWith('{')) {
      contentParts.push(content);
    } else if (content === '[áudio]') {
      // For audio without transcription, add a note
      contentParts.push('[mensagem de áudio]');
    }
  }

  return contentParts.join('\n');
}

// Download media from Uazapi using their API
// See: POST /downloadMedia with id, return_link=true, generate_mp3=true
async function downloadUazapiMedia(
  endpoint: string,
  session: string,
  sessionkey: string,
  messageId: string
): Promise<{ buffer: ArrayBuffer | null; url: string | null }> {
  try {
    console.log('[MessageGrouper] Calling Uazapi downloadMedia for:', messageId);
    
    // Clean endpoint URL and include session in path
    const baseUrl = endpoint.replace(/\/$/, '');
    const apiUrl = session ? `${baseUrl}/${session}` : baseUrl;
    
    // First, try to get a public URL (return_link=true) and MP3 format
    const response = await fetch(`${apiUrl}/downloadMedia`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': sessionkey
      },
      body: JSON.stringify({
        id: messageId,
        return_link: true,
        generate_mp3: true,
        return_base64: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[MessageGrouper] Uazapi download failed:', response.status, errorText);
      return { buffer: null, url: null };
    }

    const result = await response.json();
    console.log('[MessageGrouper] Uazapi downloadMedia response:', JSON.stringify(result));

    // Response format: { fileURL: "...", mimetype: "...", base64Data?: "...", transcription?: "..." }
    if (result.fileURL) {
      console.log('[MessageGrouper] Got Uazapi media URL:', result.fileURL);
      
      // Download the actual file to get the buffer for transcription
      try {
        const mediaResponse = await fetch(result.fileURL);
        if (mediaResponse.ok) {
          const buffer = await mediaResponse.arrayBuffer();
          console.log('[MessageGrouper] Downloaded Uazapi media, size:', buffer.byteLength);
          return { buffer, url: result.fileURL };
        }
      } catch (downloadErr) {
        console.error('[MessageGrouper] Error downloading from Uazapi URL:', downloadErr);
      }
      
      // If we couldn't download but have URL, return just the URL
      return { buffer: null, url: result.fileURL };
    }

    // Fallback: if base64 was returned
    if (result.base64Data) {
      const binaryString = atob(result.base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return { buffer: bytes.buffer, url: null };
    }

    console.error('[MessageGrouper] Uazapi response has no fileURL or base64Data');
    return { buffer: null, url: null };
  } catch (error) {
    console.error('[MessageGrouper] Error downloading from Uazapi:', error);
    return { buffer: null, url: null };
  }
}

// Upload audio to Supabase storage
async function uploadAudioToStorage(
  supabase: any,
  audioBuffer: ArrayBuffer,
  conversationId: string,
  messageId: string
): Promise<string | null> {
  try {
    const fileName = `${conversationId}/${messageId}.ogg`;
    
    const { data, error } = await supabase.storage
      .from('audio-messages')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/ogg',
        upsert: true
      });

    if (error) {
      console.error('[MessageGrouper] Storage upload error:', error);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('audio-messages')
      .getPublicUrl(fileName);

    return urlData?.publicUrl || null;
  } catch (error) {
    console.error('[MessageGrouper] Error uploading to storage:', error);
    return null;
  }
}

// Download media from WhatsApp API
async function downloadWhatsAppMedia(settings: any, mediaId: string): Promise<ArrayBuffer | null> {
  if (!settings?.whatsapp_access_token) {
    console.error('[MessageGrouper] No WhatsApp access token configured');
    return null;
  }

  try {
    const mediaInfoResponse = await fetch(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        headers: {
          'Authorization': `Bearer ${settings.whatsapp_access_token}`
        }
      }
    );

    if (!mediaInfoResponse.ok) {
      console.error('[MessageGrouper] Failed to get media info:', await mediaInfoResponse.text());
      return null;
    }

    const mediaInfo = await mediaInfoResponse.json();
    const mediaUrl = mediaInfo.url;

    if (!mediaUrl) {
      console.error('[MessageGrouper] No media URL in response');
      return null;
    }

    const mediaResponse = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${settings.whatsapp_access_token}`
      }
    });

    if (!mediaResponse.ok) {
      console.error('[MessageGrouper] Failed to download media:', await mediaResponse.text());
      return null;
    }

    return await mediaResponse.arrayBuffer();
  } catch (error) {
    console.error('[MessageGrouper] Error downloading media:', error);
    return null;
  }
}

// Transcribe audio using Lovable AI Gateway (Gemini multimodal)
async function transcribeAudio(audioBuffer: ArrayBuffer, lovableApiKey: string): Promise<string | null> {
  try {
    console.log('[MessageGrouper] Transcribing audio with Gemini, size:', audioBuffer.byteLength, 'bytes');

    // Convert audio buffer to base64
    const uint8Array = new Uint8Array(audioBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64Audio = btoa(binary);

    // Determine mime type (most WhatsApp audio is ogg/opus, Uazapi may convert to mp3)
    const mimeType = 'audio/ogg';

    const response = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: base64Audio,
                  format: 'ogg'
                }
              },
              {
                type: 'text',
                text: 'Transcreva exatamente o que a pessoa disse neste áudio em português. Retorne SOMENTE a transcrição, sem explicações, aspas ou prefixos.'
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[MessageGrouper] Gemini transcription error:', response.status, errorText);
      return null;
    }

    const result = await response.json();
    const transcription = result.choices?.[0]?.message?.content?.trim();
    
    console.log('[MessageGrouper] Transcription result:', transcription?.substring(0, 200));
    return transcription || null;
  } catch (error) {
    console.error('[MessageGrouper] Error transcribing audio:', error);
    return null;
  }
}

// Schedule next processing if there are pending messages with future process_after
async function scheduleNextProcessing(
  supabase: any,
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<void> {
  try {
    // Check for pending messages with future process_after
    const { data: pendingMessages, error } = await supabase
      .from('message_grouping_queue')
      .select('id, process_after')
      .eq('processed', false)
      .gt('process_after', new Date().toISOString())
      .order('process_after', { ascending: true })
      .limit(1);

    if (error) {
      console.error('[MessageGrouper] Error checking pending messages:', error);
      return;
    }

    if (!pendingMessages || pendingMessages.length === 0) {
      console.log('[MessageGrouper] No pending messages to schedule');
      return;
    }

    const nextProcessAt = new Date(pendingMessages[0].process_after);
    const now = Date.now();
    const delayMs = Math.max(nextProcessAt.getTime() - now + 500, 1000); // +500ms buffer, min 1s
    
    // Cap delay at 30 seconds to prevent edge function timeout issues
    const cappedDelayMs = Math.min(delayMs, 30000);

    console.log(`[MessageGrouper] Scheduling self-invocation in ${cappedDelayMs}ms for pending message ${pendingMessages[0].id}`);

    // Use EdgeRuntime.waitUntil for background task
    (globalThis as any).EdgeRuntime?.waitUntil?.(
      new Promise<void>((resolve) => {
        setTimeout(async () => {
          try {
            console.log('[MessageGrouper] Self-invoking after scheduled delay');
            await fetch(`${supabaseUrl}/functions/v1/message-grouper`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify({ triggered_by: 'self-reschedule' })
            });
            console.log('[MessageGrouper] Self-invocation completed');
          } catch (err) {
            console.error('[MessageGrouper] Self-reschedule error:', err);
          }
          resolve();
        }, cappedDelayMs);
      })
    );
  } catch (error) {
    console.error('[MessageGrouper] Error scheduling next processing:', error);
  }
}
