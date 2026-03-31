import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function triggerDispatch() {
  try {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/dispatch-webhooks`;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    }); // fire-and-forget
  } catch {}
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate auth: require authenticated user or service role
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      // Accept service_role key or valid user JWT
      if (token !== supabaseServiceKey) {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    } else {
      return new Response(JSON.stringify({ error: 'Authorization header required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { event_type, payload, endpoint_id, idempotency_key } = await req.json();

    if (!event_type || !payload) {
      return new Response(JSON.stringify({ error: 'event_type and payload are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate idempotency key if not provided
    const idemKey = idempotency_key || `${event_type}-${crypto.randomUUID()}`;

    // If endpoint_id is specified, enqueue for that endpoint only
    // Otherwise, enqueue for ALL enabled endpoints
    let endpointIds: string[] = [];

    if (endpoint_id) {
      endpointIds = [endpoint_id];
    } else {
      const { data: endpoints } = await supabase
        .from('webhook_endpoints')
        .select('id')
        .eq('enabled', true);
      endpointIds = (endpoints || []).map((e: any) => e.id);
    }

    if (endpointIds.length === 0) {
      return new Response(JSON.stringify({ enqueued: 0, message: 'No enabled endpoints found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert one outbox entry per endpoint
    const rows = endpointIds.map((epId: string) => ({
      endpoint_id: epId,
      event_type,
      payload,
      idempotency_key: endpointIds.length > 1 ? `${idemKey}-${epId}` : idemKey,
      status: 'pending',
    }));

    const { data, error } = await supabase
      .from('webhook_outbox')
      .insert(rows)
      .select('id');

    if (error) {
      // Handle duplicate idempotency_key gracefully
      if (error.code === '23505') {
        return new Response(JSON.stringify({ enqueued: 0, message: 'Duplicate event (idempotency_key already exists)' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw error;
    }

    console.log(`[enqueue-event] Enqueued ${event_type} for ${endpointIds.length} endpoint(s)`);

    // Fire-and-forget: trigger dispatch immediately
    triggerDispatch();

    return new Response(JSON.stringify({
      enqueued: data?.length || 0,
      event_type,
      ids: data?.map((d: any) => d.id),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[enqueue-event] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
