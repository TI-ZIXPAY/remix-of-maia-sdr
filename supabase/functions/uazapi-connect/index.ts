import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, phone, instance_id } = await req.json();

    if (!action || !["connect", "status", "disconnect", "configure-webhook"].includes(action)) {
      return new Response(
        JSON.stringify({ error: "Invalid action. Use 'connect', 'status', 'disconnect', or 'configure-webhook'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Resolve credentials ---
    let uazapi_endpoint: string | null = null;
    let uazapi_sessionkey: string | null = null;
    let uazapi_session: string | null = null;

    if (instance_id) {
      // Multi-instance: fetch from uazapi_instances table
      const { data: instance, error: instanceError } = await supabase
        .from("uazapi_instances")
        .select("endpoint, session, sessionkey")
        .eq("id", instance_id)
        .maybeSingle();

      if (instanceError || !instance) {
        return new Response(
          JSON.stringify({ error: "Instância não encontrada" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      uazapi_endpoint = instance.endpoint;
      uazapi_session = instance.session;
      uazapi_sessionkey = instance.sessionkey;
    } else {
      // Legacy fallback: use nina_settings
      const { data: settings, error: settingsError } = await supabase
        .from("nina_settings")
        .select("uazapi_endpoint, uazapi_session, uazapi_sessionkey")
        .limit(1)
        .maybeSingle();

      if (settingsError || !settings) {
        return new Response(
          JSON.stringify({ error: "Configurações não encontradas" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      uazapi_endpoint = settings.uazapi_endpoint;
      uazapi_session = settings.uazapi_session;
      uazapi_sessionkey = settings.uazapi_sessionkey;
    }

    if (!uazapi_endpoint || !uazapi_sessionkey) {
      return new Response(
        JSON.stringify({ error: "Credenciais da Uazapi não configuradas" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean endpoint - v2 API does NOT include session in path
    const endpoint = uazapi_endpoint.replace(/\/+$/, "");

    const uazapiHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      token: uazapi_sessionkey,
    };

    if (action === "connect") {
      console.log(`[uazapi-connect] Checking status before connect...`);
      const statusResponse = await fetch(`${endpoint}/instance/status`, {
        method: "GET",
        headers: uazapiHeaders,
      });
      const statusData = await statusResponse.json();
      const currentStatus = statusData?.instance?.status || statusData?.status || "unknown";
      console.log(`[uazapi-connect] Current status: ${currentStatus}`);

      if (currentStatus === "connected" || currentStatus === "open") {
        return new Response(
          JSON.stringify({
            success: true,
            status: "connected",
            qrcode: null,
            paircode: null,
            raw: statusData,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (currentStatus === "connecting") {
        const qrcode = statusData?.instance?.qrcode || statusData?.qrcode || null;
        const paircode = statusData?.instance?.paircode || statusData?.paircode || null;
        return new Response(
          JSON.stringify({
            success: true,
            status: "connecting",
            qrcode: qrcode || null,
            paircode: paircode || null,
            message: "Already connecting. Use status action to poll for QR updates.",
            raw: statusData,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const connectBody: Record<string, string> = {};
      if (phone) {
        connectBody.phone = phone;
      }
      console.log(`[uazapi-connect] Calling POST ${endpoint}/instance/connect`);

      let data: any = {};
      try {
        const response = await fetch(`${endpoint}/instance/connect`, {
          method: "POST",
          headers: uazapiHeaders,
          body: JSON.stringify(connectBody),
        });
        try { data = await response.json(); } catch { data = {}; }
        console.log("[uazapi-connect] Connect response:", response.status, JSON.stringify(data).substring(0, 300));
      } catch (e) {
        console.log("[uazapi-connect] Connect fetch error:", e);
      }

      const qrcode = data?.instance?.qrcode || data?.qrcode || null;
      const paircode = data?.instance?.paircode || data?.paircode || null;

      return new Response(
        JSON.stringify({
          success: true,
          status: "connecting",
          qrcode: qrcode || null,
          paircode: paircode || null,
          message: "Connection initiated. Poll status for QR updates.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "status") {
      console.log(`[uazapi-connect] Calling GET ${endpoint}/instance/status`);

      const response = await fetch(`${endpoint}/instance/status`, {
        method: "GET",
        headers: uazapiHeaders,
      });

      const data = await response.json();
      console.log("[uazapi-connect] Status response:", JSON.stringify(data).substring(0, 300));

      const instanceStatus = data.instance?.status || data.state || "unknown";
      const isConnected = instanceStatus === "connected" || instanceStatus === "open" || data.status?.connected === true;

      return new Response(
        JSON.stringify({
          success: true,
          status: isConnected ? "connected" : instanceStatus,
          qrcode: data.instance?.qrcode || data.qr || data.base64 || data.data?.qrcode || null,
          paircode: data.instance?.paircode || null,
          raw: data,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "disconnect") {
      console.log(`[uazapi-connect] Calling POST ${endpoint}/instance/disconnect`);

      const response = await fetch(`${endpoint}/instance/disconnect`, {
        method: "POST",
        headers: uazapiHeaders,
        body: JSON.stringify({}),
      });

      const data = await response.json();
      console.log("[uazapi-connect] Disconnect response:", JSON.stringify(data).substring(0, 200));

      return new Response(
        JSON.stringify({
          success: response.ok,
          status: "disconnected",
          raw: data,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "configure-webhook") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const webhookUrl = `${supabaseUrl}/functions/v1/uazapi-webhook`;

      console.log(`[uazapi-connect] Configuring webhook: ${webhookUrl}`);

      const response = await fetch(`${endpoint}/webhook`, {
        method: "POST",
        headers: uazapiHeaders,
        body: JSON.stringify({
          enabled: true,
          url: webhookUrl,
          events: ["messages", "connection"],
          excludeMessages: ["wasSentByApi", "isGroupYes"],
        }),
      });

      const data = await response.json();
      console.log("[uazapi-connect] Webhook config response:", JSON.stringify(data).substring(0, 300));

      return new Response(
        JSON.stringify({
          success: response.ok,
          webhookUrl,
          raw: data,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("[uazapi-connect] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
