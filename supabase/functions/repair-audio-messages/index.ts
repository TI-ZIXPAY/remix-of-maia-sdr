 import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
 import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 
 const corsHeaders = {
   'Access-Control-Allow-Origin': '*',
   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
 };
 
 const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
 
 serve(async (req) => {
   if (req.method === 'OPTIONS') {
     return new Response(null, { headers: corsHeaders });
   }
 
   const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
   const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
   const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
   const supabase = createClient(supabaseUrl, supabaseServiceKey);
 
   try {
     console.log('[RepairAudio] Starting audio message repair...');
 
     // Get legacy Uazapi settings as fallback
     const { data: settings } = await supabase
       .from('nina_settings')
       .select('uazapi_endpoint, uazapi_session, uazapi_sessionkey')
       .limit(1)
       .maybeSingle();

     // Also try first active instance as primary source
     const { data: firstInstance } = await supabase
       .from('uazapi_instances')
       .select('endpoint, session, sessionkey')
       .eq('is_active', true)
       .order('created_at', { ascending: true })
       .limit(1)
       .maybeSingle();

     const defaultEndpoint = firstInstance?.endpoint || settings?.uazapi_endpoint || '';
     const defaultSessionkey = firstInstance?.sessionkey || settings?.uazapi_sessionkey || '';

     if (!defaultEndpoint || !defaultSessionkey) {
       return new Response(JSON.stringify({ 
         error: 'Uazapi not configured' 
       }), {
         status: 400,
         headers: { ...corsHeaders, 'Content-Type': 'application/json' }
       });
     }
 
      const { data: brokenMessages, error: fetchError } = await supabase
        .from('messages')
        .select('id, content, metadata, whatsapp_message_id, conversation_id, type')
        .is('media_url', null)
        .or('type.eq.text,type.eq.audio,type.eq.image,type.eq.video')
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) {
        console.error('[RepairMedia] Error fetching messages:', fetchError);
        throw fetchError;
      }

      const mediaMessages = (brokenMessages || []).filter(msg => {
        if (msg.type === 'audio' || msg.type === 'image' || msg.type === 'video') return true;
        if (!msg.content) return false;
        const trimmed = msg.content.trim();
        if (!trimmed.startsWith('{')) return false;
        try {
          const parsed = JSON.parse(trimmed);
          const mime = String(parsed.mimetype || parsed.mimeType || '').toLowerCase();
          return mime.includes('audio') || mime.includes('ogg') || mime.includes('opus') ||
                 mime.includes('image') || mime.includes('webp') || mime.includes('video');
        } catch {
          return false;
        }
      });
 
     console.log(`[RepairMedia] Found ${mediaMessages.length} media messages to repair`);
 
     let repaired = 0;
     let failed = 0;

     // Helper to resolve credentials for a message's contact
     async function resolveCredsForMessage(conversationId: string): Promise<{ endpoint: string; sessionkey: string }> {
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

           if (inst) return { endpoint: inst.endpoint, sessionkey: inst.sessionkey };
         }
       }
       return { endpoint: defaultEndpoint, sessionkey: defaultSessionkey };
     }
 
      for (const msg of mediaMessages) {
        try {
          console.log(`[RepairMedia] Repairing message: ${msg.id}, type: ${msg.type}`);

          // Resolve credentials for this specific message's contact
          const creds = await resolveCredsForMessage(msg.conversation_id);
          
          const uazapiMessageId = msg.whatsapp_message_id || 
            (msg.metadata as any)?.uazapi_message_id ||
            (() => {
              try {
                const parsed = JSON.parse((msg.content || '').trim());
                return parsed.id;
              } catch { return null; }
            })();
          
          if (!uazapiMessageId) {
            console.log(`[RepairMedia] No message ID for: ${msg.id}, skipping`);
            failed++;
            continue;
          }

          let detectedType = msg.type;
          if (msg.type === 'text' && msg.content) {
            try {
              const parsed = JSON.parse(msg.content.trim());
              const mime = String(parsed.mimetype || parsed.mimeType || '').toLowerCase();
              if (mime.includes('audio') || mime.includes('ogg') || mime.includes('opus')) {
                detectedType = 'audio';
              } else if (mime.includes('image') || mime.includes('webp')) {
                detectedType = 'image';
              } else if (mime.includes('video')) {
                detectedType = 'video';
              }
            } catch {}
          }

          console.log(`[RepairMedia] Downloading from Uazapi: ${uazapiMessageId}`);
          const isAudio = detectedType === 'audio';
          const downloadResult = await downloadUazapiMedia(
            creds.endpoint,
            creds.sessionkey,
            uazapiMessageId,
            isAudio
          );

          let mediaUrl = downloadResult.url;
          const mediaBuffer = downloadResult.buffer;

          if (mediaBuffer) {
            const ext = isAudio ? 'mp3' : (detectedType === 'image' ? 'jpg' : 'mp4');
            const contentType = isAudio ? 'audio/mpeg' : (detectedType === 'image' ? 'image/jpeg' : 'video/mp4');
            const uploadedUrl = await uploadMediaToStorage(
              supabase,
              mediaBuffer,
              msg.conversation_id,
              msg.id,
              ext,
              contentType
            );
            if (uploadedUrl) {
              mediaUrl = uploadedUrl;
              console.log(`[RepairMedia] Uploaded to storage: ${uploadedUrl}`);
            }
          }

          let content = detectedType === 'audio' ? '[áudio]' : 
                       detectedType === 'image' ? '[imagem recebida]' : 
                       `[${detectedType}]`;
          
          if (detectedType === 'image' && msg.type === 'image' && msg.content && !msg.content.trim().startsWith('{')) {
            content = msg.content;
          }
          
          if (isAudio && mediaBuffer && lovableApiKey) {
            const transcribed = await transcribeAudio(mediaBuffer, lovableApiKey);
            if (transcribed) {
              content = transcribed;
              console.log(`[RepairMedia] Transcribed: ${content.substring(0, 50)}...`);
            }
          }

          const { error: updateError } = await supabase
            .from('messages')
            .update({
              type: detectedType,
              media_url: mediaUrl,
              content: content,
              metadata: {
                ...(msg.metadata || {}),
                provider: 'uazapi',
                needs_download: false,
                uazapi_message_id: uazapiMessageId,
                repaired_at: new Date().toISOString()
              }
            })
            .eq('id', msg.id);

          if (updateError) {
            console.error(`[RepairMedia] Update error for ${msg.id}:`, updateError);
            failed++;
          } else {
            repaired++;
            console.log(`[RepairMedia] Repaired: ${msg.id} as ${detectedType}`);
          }

        } catch (err) {
          console.error(`[RepairMedia] Error repairing ${msg.id}:`, err);
          failed++;
        }
      }
 
      console.log(`[RepairMedia] Completed. Repaired: ${repaired}, Failed: ${failed}`);

      return new Response(JSON.stringify({ 
        total: mediaMessages.length,
       repaired,
       failed
     }), {
       headers: { ...corsHeaders, 'Content-Type': 'application/json' }
     });
 
   } catch (error) {
     console.error('[RepairAudio] Error:', error);
     const errorMessage = error instanceof Error ? error.message : 'Unknown error';
     return new Response(JSON.stringify({ error: errorMessage }), {
       status: 500,
       headers: { ...corsHeaders, 'Content-Type': 'application/json' }
     });
   }
 });
 
async function downloadUazapiMedia(
  endpoint: string,
  sessionkey: string,
  messageId: string,
  isAudio: boolean
): Promise<{ buffer: ArrayBuffer | null; url: string | null }> {
  try {
    const baseUrl = endpoint.replace(/\/$/, '');
    console.log('[RepairMedia] Calling Uazapi /message/download for:', messageId);

    const response = await fetch(`${baseUrl}/message/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': sessionkey
      },
      body: JSON.stringify({
        id: messageId,
        return_link: true,
        generate_mp3: isAudio,
        return_base64: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[RepairMedia] Uazapi download failed:', response.status, errorText);
      return { buffer: null, url: null };
    }

    const result = await response.json();
    console.log('[RepairMedia] Uazapi response:', JSON.stringify(result).substring(0, 200));

    if (result.fileURL) {
      console.log('[RepairMedia] Got media URL:', result.fileURL);
      try {
        const mediaResponse = await fetch(result.fileURL);
        if (mediaResponse.ok) {
          const buffer = await mediaResponse.arrayBuffer();
          console.log('[RepairMedia] Downloaded buffer, size:', buffer.byteLength);
          return { buffer, url: result.fileURL };
        }
      } catch (downloadErr) {
        console.error('[RepairMedia] Error downloading from URL:', downloadErr);
      }
      return { buffer: null, url: result.fileURL };
    }

    if (result.base64Data) {
      const binaryString = atob(result.base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return { buffer: bytes.buffer, url: null };
    }

    console.error('[RepairMedia] No fileURL or base64Data in response');
    return { buffer: null, url: null };
  } catch (error) {
    console.error('[RepairMedia] Error downloading from Uazapi:', error);
    return { buffer: null, url: null };
  }
}

async function uploadMediaToStorage(
  supabase: any,
  buffer: ArrayBuffer,
  conversationId: string,
  messageId: string,
  ext: string,
  contentType: string
): Promise<string | null> {
  try {
    const fileName = `uazapi/${messageId}.${ext}`;
    
    const { error } = await supabase.storage
      .from('audio-messages')
      .upload(fileName, new Uint8Array(buffer), {
        contentType,
        upsert: true
      });

    if (error) {
      console.error('[RepairMedia] Storage upload error:', error);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('audio-messages')
      .getPublicUrl(fileName);

    return urlData?.publicUrl || null;
  } catch (error) {
    console.error('[RepairMedia] Error uploading to storage:', error);
    return null;
  }
}

async function transcribeAudio(audioBuffer: ArrayBuffer, apiKey: string): Promise<string | null> {
  try {
    const uint8 = new Uint8Array(audioBuffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64Audio = btoa(binary);

    const response = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'input_audio', input_audio: { data: base64Audio, format: 'mp3' } },
              { type: 'text', text: 'Transcreva este áudio em português brasileiro. Retorne APENAS o texto transcrito, sem explicações, sem aspas, sem prefixos.' },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.error('[RepairMedia] Transcription error:', response.status, await response.text());
      return null;
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('[RepairMedia] Error transcribing:', error);
    return null;
  }
}
