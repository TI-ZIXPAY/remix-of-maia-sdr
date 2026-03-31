import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions"

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { messageId } = await req.json()
    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Fetch the message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, whatsapp_message_id, content, type, media_url, metadata, transcription_text, transcription_status')
      .eq('id', messageId)
      .single()

    if (msgError || !message) {
      return new Response(JSON.stringify({ error: 'Message not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. If already transcribed, return it
    if (message.transcription_text && message.transcription_status === 'done') {
      return new Response(JSON.stringify({ transcription: message.transcription_text }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. If already processing, return status
    if (message.transcription_status === 'processing') {
      return new Response(JSON.stringify({ status: 'processing' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Mark as processing
    await supabase
      .from('messages')
      .update({ transcription_status: 'processing' })
      .eq('id', messageId)

    // 5. Get config for Uazapi - try contact's instance first, fallback to nina_settings
    const { data: settings } = await supabase
      .from('nina_settings')
      .select('uazapi_endpoint, uazapi_sessionkey, whatsapp_provider')
      .limit(1)
      .single()

    let uazapiEndpoint = settings?.uazapi_endpoint || ''
    let uazapiSessionkey = settings?.uazapi_sessionkey || ''

    // Resolve instance from message's contact
    const { data: msgConv } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('id', messageId)
      .maybeSingle()

    if (msgConv?.conversation_id) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('contact_id')
        .eq('id', msgConv.conversation_id)
        .maybeSingle()

      if (conv?.contact_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('uazapi_instance_id')
          .eq('id', conv.contact_id)
          .maybeSingle()

        if (contact?.uazapi_instance_id) {
          const { data: inst } = await supabase
            .from('uazapi_instances')
            .select('endpoint, sessionkey')
            .eq('id', contact.uazapi_instance_id)
            .maybeSingle()

          if (inst) {
            uazapiEndpoint = inst.endpoint
            uazapiSessionkey = inst.sessionkey
          }
        }
      }
    }

    let audioUrl: string | null = null
    const uazapiMessageId = message.whatsapp_message_id || (message.metadata as any)?.uazapi_message_id

    // 6. Get audio URL from Uazapi
    if (settings?.whatsapp_provider === 'uazapi' && uazapiEndpoint && uazapiSessionkey && uazapiMessageId) {
      try {
        const endpoint = uazapiEndpoint.replace(/\/$/, '')
        console.log('[Transcribe] Downloading audio from Uazapi, messageId:', uazapiMessageId)
        
        const resp = await fetch(`${endpoint}/message/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'token': uazapiSessionkey,
          },
          body: JSON.stringify({
            id: uazapiMessageId,
            generate_mp3: true,
            return_link: true,
          }),
        })

        if (resp.ok) {
          const data = await resp.json()
          console.log('[Transcribe] Uazapi download response keys:', Object.keys(data))
          
          // Try to get a URL from the response
          audioUrl = data?.fileURL || data?.url || data?.link || data?.mp3Url || null
          
          // If we got base64 data instead, convert to a data URL
          if (!audioUrl && data?.base64Data) {
            console.log('[Transcribe] Got base64 data, will send as inline data')
            audioUrl = `data:audio/mp3;base64,${data.base64Data}`
          }
        } else {
          console.error('[Transcribe] Uazapi download failed:', resp.status, await resp.text())
        }
      } catch (e) {
        console.error('[Transcribe] Uazapi download error:', e)
      }
    }

    // Also try media_url from message if available
    if (!audioUrl && message.media_url) {
      audioUrl = message.media_url
    }

    if (!audioUrl) {
      const errorMsg = 'Não foi possível obter a URL do áudio'
      console.error('[Transcribe]', errorMsg)
      await supabase
        .from('messages')
        .update({ transcription_status: 'error', transcription_error: errorMsg })
        .eq('id', messageId)

      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log('[Transcribe] Got audio URL, sending to Gemini for transcription...')

    // 7. Send audio URL to Gemini for transcription
    let transcription: string | null = null

    // If it's a data URL (base64), use inline_data format
    if (audioUrl.startsWith('data:')) {
      const base64Match = audioUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (base64Match) {
        transcription = await transcribeWithGeminiBase64(base64Match[2], base64Match[1], lovableApiKey)
      }
    } else {
      // Use URL-based approach: download and send as base64
      try {
        const audioResp = await fetch(audioUrl)
        if (audioResp.ok) {
          const audioBuffer = await audioResp.arrayBuffer()
          const uint8 = new Uint8Array(audioBuffer)
          let binary = ''
          // Process in chunks to avoid stack overflow
          const chunkSize = 8192
          for (let i = 0; i < uint8.length; i += chunkSize) {
            const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length))
            binary += String.fromCharCode(...chunk)
          }
          const base64Audio = btoa(binary)
          
          // Detect mime type from URL or default
          const mimeType = audioUrl.includes('.mp3') ? 'audio/mp3' : 
                           audioUrl.includes('.ogg') ? 'audio/ogg' :
                           audioUrl.includes('.wav') ? 'audio/wav' :
                           'audio/mpeg'
          
          transcription = await transcribeWithGeminiBase64(base64Audio, mimeType, lovableApiKey)
        } else {
          console.error('[Transcribe] Failed to download audio:', audioResp.status)
        }
      } catch (e) {
        console.error('[Transcribe] Error downloading audio for Gemini:', e)
      }
    }

    // 8. Save result
    if (transcription) {
      await supabase
        .from('messages')
        .update({
          transcription_text: transcription,
          transcription_status: 'done',
          transcription_error: null,
        })
        .eq('id', messageId)

      return new Response(JSON.stringify({ transcription }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } else {
      const errorMsg = 'Não foi possível transcrever o áudio'
      await supabase
        .from('messages')
        .update({
          transcription_status: 'error',
          transcription_error: errorMsg,
        })
        .eq('id', messageId)

      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  } catch (e) {
    console.error('[Transcribe] Error:', e)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function transcribeWithGeminiBase64(
  base64Audio: string, 
  mimeType: string, 
  apiKey: string
): Promise<string | null> {
  try {
    console.log('[Transcribe] Sending to Gemini, mime:', mimeType, 'size:', base64Audio.length)

    const response = await fetch(LOVABLE_AI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
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
                  format: mimeType.includes('mp3') ? 'mp3' : 
                          mimeType.includes('wav') ? 'wav' : 
                          mimeType.includes('ogg') ? 'ogg' : 'mp3',
                },
              },
              {
                type: 'text',
                text: 'Transcreva este áudio em português brasileiro. Retorne APENAS o texto transcrito, sem explicações, sem aspas, sem prefixos. Se não conseguir entender, retorne "[áudio inaudível]".',
              },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[Transcribe] Gemini error:', response.status, errText)
      return null
    }

    const result = await response.json()
    const text = result.choices?.[0]?.message?.content?.trim() || null
    console.log('[Transcribe] Gemini result:', text ? `"${text.substring(0, 100)}..."` : 'no text')
    return text
  } catch (error) {
    console.error('[Transcribe] Gemini error:', error)
    return null
  }
}
