import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'https://www.googleapis.com/auth/calendar';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // Step 1: Generate OAuth URL
  if (action === 'get-auth-url') {
    try {
      const body = await req.json();
      const { client_id } = body;

      if (!client_id) {
        return new Response(JSON.stringify({ error: 'client_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const redirectUri = `${supabaseUrl}/functions/v1/google-calendar-auth?action=callback`;

      const params = new URLSearchParams({
        client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state: 'gcal-auth',
      });

      const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

      return new Response(JSON.stringify({ success: true, authUrl, redirectUri }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('[GCalAuth] Error generating auth URL:', error);
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Step 2: Handle OAuth callback
  if (action === 'callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      return new Response(renderHTML(false, `Autorização negada: ${error}`), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (!code) {
      return new Response(renderHTML(false, 'Código de autorização não recebido'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    try {
      // Get client credentials from nina_settings
      const { data: settings, error: settingsError } = await supabase
        .from('nina_settings')
        .select('id, google_calendar_client_id, google_calendar_client_secret')
        .limit(1)
        .maybeSingle();

      if (settingsError || !settings?.google_calendar_client_id || !settings?.google_calendar_client_secret) {
        return new Response(renderHTML(false, 'Credenciais do Google Calendar não encontradas. Salve o Client ID e Client Secret primeiro.'), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      const redirectUri = `${supabaseUrl}/functions/v1/google-calendar-auth?action=callback`;

      // Exchange code for tokens
      const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: settings.google_calendar_client_id,
          client_secret: settings.google_calendar_client_secret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || !tokenData.refresh_token) {
        console.error('[GCalAuth] Token exchange error:', tokenData);
        return new Response(renderHTML(false, `Erro ao obter tokens: ${tokenData.error_description || tokenData.error || 'refresh_token não retornado. Tente revogar o acesso em myaccount.google.com e autorizar novamente.'}`), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // Save refresh token to nina_settings
      const { error: updateError } = await supabase
        .from('nina_settings')
        .update({
          google_calendar_refresh_token: tokenData.refresh_token,
          google_calendar_enabled: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id);

      if (updateError) {
        console.error('[GCalAuth] Error saving refresh token:', updateError);
        return new Response(renderHTML(false, 'Erro ao salvar o token. Tente novamente.'), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      console.log('[GCalAuth] Refresh token saved successfully');
      return new Response(renderHTML(true, 'Google Calendar autorizado com sucesso! Você pode fechar esta janela.'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (err) {
      console.error('[GCalAuth] Callback error:', err);
      return new Response(renderHTML(false, `Erro inesperado: ${err instanceof Error ? err.message : 'Unknown'}`), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'action is required (get-auth-url or callback)' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

function renderHTML(success: boolean, message: string): string {
  const color = success ? '#10b981' : '#ef4444';
  const icon = success ? '✅' : '❌';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Google Calendar - ${success ? 'Sucesso' : 'Erro'}</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
  .card { background: #1e293b; border-radius: 16px; padding: 40px; text-align: center; max-width: 420px; border: 1px solid ${color}33; }
  .icon { font-size: 48px; margin-bottom: 16px; }
  .msg { font-size: 16px; line-height: 1.6; }
  .hint { font-size: 13px; color: #94a3b8; margin-top: 16px; }
</style></head><body>
<div class="card">
  <div class="icon">${icon}</div>
  <div class="msg">${message}</div>
  ${success ? '<div class="hint">Volte para as configurações e atualize a página.</div>' : ''}
</div>
<script>${success ? 'setTimeout(() => window.close(), 3000);' : ''}</script>
</body></html>`;
}
