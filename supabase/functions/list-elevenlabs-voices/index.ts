import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels?: Record<string, string>;
  description?: string;
  preview_url?: string;
}

interface VoiceResponse {
  id: string;
  name: string;
  category: 'custom' | 'cloned' | 'premade' | 'professional';
  description: string;
  preview_url?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { apiKey } = await req.json();

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API Key é obrigatória' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[list-elevenlabs-voices] Fetching voices from ElevenLabs API...');

    // Fetch all voices from ElevenLabs API
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[list-elevenlabs-voices] ElevenLabs API error:', response.status, errorText);
      
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'API Key inválida' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: `Erro na API ElevenLabs: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const voices: ElevenLabsVoice[] = data.voices || [];

    console.log(`[list-elevenlabs-voices] Found ${voices.length} voices`);

    // Transform and categorize voices
    const transformedVoices: VoiceResponse[] = voices.map((voice) => {
      // Determine category
      let category: VoiceResponse['category'] = 'premade';
      if (voice.category === 'cloned') {
        category = 'cloned';
      } else if (voice.category === 'professional') {
        category = 'professional';
      } else if (voice.category === 'generated' || voice.category === 'high_quality') {
        category = 'custom';
      }

      // Build description from labels
      let description = '';
      if (voice.labels) {
        const parts: string[] = [];
        if (voice.labels.gender) parts.push(voice.labels.gender === 'female' ? 'Feminina' : 'Masculina');
        if (voice.labels.accent) parts.push(voice.labels.accent);
        if (voice.labels.age) parts.push(voice.labels.age);
        if (voice.labels.use_case) parts.push(voice.labels.use_case);
        description = parts.join(', ');
      }
      if (voice.description) {
        description = voice.description;
      }

      return {
        id: voice.voice_id,
        name: voice.name,
        category,
        description: description || 'Voz personalizada',
        preview_url: voice.preview_url,
      };
    });

    // Sort: custom/cloned first, then by name
    transformedVoices.sort((a, b) => {
      const categoryOrder = { cloned: 0, custom: 1, professional: 2, premade: 3 };
      const orderDiff = categoryOrder[a.category] - categoryOrder[b.category];
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });

    // Count by category
    const customCount = transformedVoices.filter(v => v.category === 'cloned' || v.category === 'custom').length;
    const premadeCount = transformedVoices.filter(v => v.category === 'premade' || v.category === 'professional').length;

    console.log(`[list-elevenlabs-voices] Returning ${customCount} custom + ${premadeCount} premade voices`);

    return new Response(
      JSON.stringify({
        success: true,
        voices: transformedVoices,
        counts: {
          custom: customCount,
          premade: premadeCount,
          total: transformedVoices.length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[list-elevenlabs-voices] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
