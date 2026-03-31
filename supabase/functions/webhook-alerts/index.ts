import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AlertPayload {
  alert_type: string;
  severity: 'warning' | 'critical';
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: accept cron bearer or service role
    const cronBearer = Deno.env.get('DISPATCH_CRON_BEARER');
    if (cronBearer) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader || authHeader !== `Bearer ${cronBearer}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const alertWebhookUrl = Deno.env.get('WEBHOOK_ALERT_URL'); // Slack/Teams/custom

    const alerts: AlertPayload[] = [];
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60_000).toISOString();

    // 1. Check failures in last 10 minutes
    const { count: recentFailures } = await supabase
      .from('webhook_outbox')
      .select('*', { count: 'exact', head: true })
      .in('status', ['failed', 'dead_letter'])
      .gte('updated_at', tenMinAgo);

    if ((recentFailures || 0) >= 5) {
      alerts.push({
        alert_type: 'high_failure_rate',
        severity: (recentFailures || 0) >= 10 ? 'critical' : 'warning',
        message: `🚨 ${recentFailures} falhas nos últimos 10 minutos`,
        details: { failures: recentFailures, window: '10min' },
        timestamp: now.toISOString(),
      });
    }

    // 2. Check oldest pending event
    const { data: oldestPending } = await supabase
      .from('webhook_outbox')
      .select('id, created_at, event_type, endpoint_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (oldestPending && new Date(oldestPending.created_at) < new Date(thirtyMinAgo)) {
      const ageMin = Math.floor((now.getTime() - new Date(oldestPending.created_at).getTime()) / 60_000);
      alerts.push({
        alert_type: 'stale_pending',
        severity: ageMin > 120 ? 'critical' : 'warning',
        message: `⏰ Evento pendente há ${ageMin} minutos (${oldestPending.event_type})`,
        details: { event_id: oldestPending.id, age_minutes: ageMin, event_type: oldestPending.event_type },
        timestamp: now.toISOString(),
      });
    }

    // 3. Check endpoints with 5+ consecutive failures
    const { data: endpoints } = await supabase
      .from('webhook_endpoints')
      .select('id, name')
      .eq('enabled', true);

    for (const ep of (endpoints || [])) {
      const { data: recentEvents } = await supabase
        .from('webhook_outbox')
        .select('status')
        .eq('endpoint_id', ep.id)
        .order('created_at', { ascending: false })
        .limit(10);

      let consecutive = 0;
      for (const ev of (recentEvents || [])) {
        if (ev.status === 'failed' || ev.status === 'dead_letter') consecutive++;
        else if (ev.status === 'sent') break;
      }

      if (consecutive >= 5) {
        alerts.push({
          alert_type: 'endpoint_degraded',
          severity: consecutive >= 8 ? 'critical' : 'warning',
          message: `🔴 Endpoint "${ep.name}" com ${consecutive} falhas consecutivas`,
          details: { endpoint_id: ep.id, endpoint_name: ep.name, consecutive_failures: consecutive },
          timestamp: now.toISOString(),
        });
      }
    }

    // 4. Dead letter count
    const { count: deadLetterCount } = await supabase
      .from('webhook_outbox')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'dead_letter');

    if ((deadLetterCount || 0) > 0) {
      alerts.push({
        alert_type: 'dead_letters_exist',
        severity: (deadLetterCount || 0) >= 10 ? 'critical' : 'warning',
        message: `💀 ${deadLetterCount} evento(s) em dead letter aguardando revisão`,
        details: { count: deadLetterCount },
        timestamp: now.toISOString(),
      });
    }

    // Send alerts to webhook (Slack, etc.)
    if (alerts.length > 0 && alertWebhookUrl) {
      try {
        const slackBlocks = alerts.map(a => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*[${a.severity.toUpperCase()}]* ${a.message}\n_${a.alert_type} — ${new Date(a.timestamp).toLocaleString('pt-BR')}_`,
          },
        }));

        await fetch(alertWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `⚠️ ${alerts.length} alerta(s) do Webhook Dispatcher`,
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: `⚠️ Webhook Alerts (${alerts.length})` } },
              ...slackBlocks,
            ],
          }),
        });
        console.log(`[webhook-alerts] Sent ${alerts.length} alert(s) to webhook`);
      } catch (err: any) {
        console.error(`[webhook-alerts] Failed to send alerts:`, err.message);
      }
    }

    console.log(JSON.stringify({
      level: 'info', action: 'webhook-alerts-check',
      alerts_found: alerts.length, alerts: alerts.map(a => a.alert_type),
    }));

    return new Response(JSON.stringify({
      checked: true,
      alerts_found: alerts.length,
      alerts,
      alert_webhook_configured: !!alertWebhookUrl,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[webhook-alerts] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
