import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BACKOFF_MINUTES = [1, 5, 15, 60, 120, 360, 720, 1440, 1440, 1440];
const MAX_ATTEMPTS = 10;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT = 10;
const RESPONSE_SNIPPET_MAX = 500;

async function hmacSign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function withJitter(minutes: number): number {
  const jitter = minutes * 0.25 * (Math.random() * 2 - 1);
  return Math.max(1, minutes + jitter);
}

async function processWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const executing = new Set<Promise<void>>();
  for (const item of items) {
    const p = fn(item).then(() => { executing.delete(p); });
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
}

/** Normalize a field value for select fields to match the exact registered label */
function normalizeFieldValue(rawValue: string | null, fieldDef: any): string | null {
  if (!rawValue) return rawValue;
  if (fieldDef.field_type !== 'select') return rawValue;
  const options: string[] = fieldDef.options || [];
  if (options.length === 0) return rawValue;
  const exactMatch = options.find((opt: string) => opt === rawValue);
  if (exactMatch) return exactMatch;
  const lowerRaw = rawValue.toLowerCase().trim();
  const ciMatch = options.find((opt: string) => opt.toLowerCase().trim() === lowerRaw);
  if (ciMatch) return ciMatch;
  const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const strippedRaw = stripAccents(rawValue);
  const accentMatch = options.find((opt: string) => stripAccents(opt) === strippedRaw);
  if (accentMatch) return accentMatch;
  const toSlug = (s: string) => stripAccents(s).replace(/[\s\-_]+/g, '');
  const slugMatch = options.find((opt: string) => toSlug(opt) === toSlug(rawValue));
  if (slugMatch) return slugMatch;
  const partialMatch = options.find((opt: string) => {
    const optLower = stripAccents(opt);
    return optLower.includes(strippedRaw) || strippedRaw.includes(optLower);
  });
  if (partialMatch) return partialMatch;
  return rawValue;
}

/** Resolve payload template variables using contact data and custom field values */
async function resolvePayloadTemplate(
  supabase: any,
  template: Record<string, string>,
  eventPayload: any,
): Promise<Record<string, any>> {
  const contactId = eventPayload?.contact_id;
  let contact: any = null;
  let customValues: Record<string, string | null> = {};

  // Check if we need contact or custom data
  const templateStr = JSON.stringify(template);
  const needsContact = templateStr.includes('{{contact.');
  const needsCustom = templateStr.includes('{{custom.');

  if ((needsContact || needsCustom) && contactId) {
    const promises: Promise<any>[] = [];

    if (needsContact) {
      promises.push(
        supabase.from('contacts').select('*').eq('id', contactId).single().then(({ data }: any) => {
          contact = data;
        })
      );
    }

    if (needsCustom) {
      promises.push(
        supabase.from('contact_custom_field_values')
          .select('value, field:contact_custom_fields(field_key, field_type, options)')
          .eq('contact_id', contactId)
          .then(({ data }: any) => {
            if (data) {
              for (const row of data) {
                const fieldInfo = row.field;
                const key = fieldInfo?.field_key;
                if (key) {
                  // Normalize select field values to exact labels
                  customValues[key] = fieldInfo ? normalizeFieldValue(row.value, fieldInfo) : row.value;
                }
              }
            }
          })
      );
    }

    await Promise.all(promises);
  }

  // Resolve each template value
  const resolved: Record<string, any> = {};
  for (const [jsonKey, varExpr] of Object.entries(template)) {
    const match = varExpr.match(/^\{\{(.+?)\}\}$/);
    if (!match) {
      resolved[jsonKey] = varExpr; // literal value
      continue;
    }

    const varPath = match[1];
    if (varPath.startsWith('contact.') && contact) {
      const field = varPath.replace('contact.', '');
      resolved[jsonKey] = contact[field] ?? null;
    } else if (varPath.startsWith('custom.')) {
      const fieldKey = varPath.replace('custom.', '');
      resolved[jsonKey] = customValues[fieldKey] ?? null;
    } else if (varPath.startsWith('event.')) {
      const field = varPath.replace('event.', '');
      if (field === 'type') resolved[jsonKey] = eventPayload?.event_type ?? null;
      else if (field === 'timestamp') resolved[jsonKey] = new Date().toISOString();
      else resolved[jsonKey] = null;
    } else {
      resolved[jsonKey] = null;
    }
  }

  return resolved;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronBearer = Deno.env.get('DISPATCH_CRON_BEARER');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    // Accept: cron bearer, anon key, service role key, or valid user JWT
    let isAuthorized = false;
    if (token) {
      if ((cronBearer && token === cronBearer) || (anonKey && token === anonKey) || (serviceKey && token === serviceKey)) {
        isAuthorized = true;
      } else {
        // Try validating as user JWT
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const tempClient = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: authErr } = await tempClient.auth.getUser(token);
        if (user && !authErr) isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      console.error('[dispatch-webhooks] Unauthorized: invalid or missing Bearer token');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: batch, error: claimError } = await supabase.rpc('claim_webhook_outbox_batch', { p_limit: 50 });

    if (claimError) {
      console.error('[dispatch-webhooks] Claim error:', claimError);
      return new Response(JSON.stringify({ error: claimError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!batch || batch.length === 0) {
      return new Response(JSON.stringify({ dispatched: 0, message: 'No pending events' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[dispatch-webhooks] Processing ${batch.length} events`);

    const endpointIds = [...new Set(batch.map((e: any) => e.endpoint_id))];
    const { data: endpoints } = await supabase
      .from('webhook_endpoints')
      .select('*')
      .in('id', endpointIds);

    const endpointMap = new Map((endpoints || []).map((ep: any) => [ep.id, ep]));

    let sent = 0, failed = 0, deadLetter = 0, rateLimited = 0;

    await processWithConcurrency(batch, MAX_CONCURRENT, async (event: any) => {
      const startTime = Date.now();
      const endpoint = endpointMap.get(event.endpoint_id);

      if (!endpoint) {
        await supabase.from('webhook_outbox').update({ status: 'dead_letter', last_error: 'Endpoint not found' }).eq('id', event.id);
        deadLetter++;
        console.error(JSON.stringify({ level: 'error', action: 'dispatch', delivery_id: event.id, endpoint_id: event.endpoint_id, status: 'dead_letter', reason: 'endpoint_not_found', elapsed_ms: Date.now() - startTime }));
        return;
      }

      try {
        // Resolve payload: use template if available, otherwise raw event payload
        let finalPayload: any;
        if (endpoint.payload_template && typeof endpoint.payload_template === 'object' && Object.keys(endpoint.payload_template).length > 0) {
          finalPayload = await resolvePayloadTemplate(supabase, endpoint.payload_template, { ...event.payload, event_type: event.event_type });
        } else {
          finalPayload = event.payload;
        }

        const bodyStr = JSON.stringify(finalPayload);
        const timestamp = Math.floor(Date.now() / 1000).toString();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Event-Type': event.event_type,
          'X-Delivery-Id': event.id,
          'Idempotency-Key': event.idempotency_key,
          'X-Timestamp': timestamp,
          ...(endpoint.headers || {}),
        };

        const signingSecret = endpoint.signing_secret || Deno.env.get('WEBHOOK_SIGNING_SECRET');
        if (signingSecret) {
          const signaturePayload = `${timestamp}.${bodyStr}`;
          const signature = await hmacSign(signingSecret, signaturePayload);
          headers['X-Signature'] = signature;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(endpoint.url, { method: 'POST', headers, body: bodyStr, signal: controller.signal });
        } catch (fetchErr: any) {
          clearTimeout(timeout);
          const isTimeout = fetchErr.name === 'AbortError';
          throw new Error(isTimeout ? `Timeout after ${REQUEST_TIMEOUT_MS}ms` : `Network error: ${fetchErr.message}`);
        }
        clearTimeout(timeout);

        const elapsedMs = Date.now() - startTime;
        const responseSnippet = await response.text().catch(() => '').then(t => t.substring(0, RESPONSE_SNIPPET_MAX));

        if (response.ok) {
          await supabase.from('webhook_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_status_code: response.status, last_error: null }).eq('id', event.id);
          sent++;
          console.log(JSON.stringify({ level: 'info', action: 'dispatch', delivery_id: event.id, endpoint_id: event.endpoint_id, endpoint_name: endpoint.name, event_type: event.event_type, status: 'sent', http_status: response.status, attempt: (event.attempts || 0) + 1, elapsed_ms: elapsedMs }));
        } else if (response.status === 429) {
          rateLimited++;
          const retryAfterHeader = response.headers.get('Retry-After');
          let retryMinutes: number;
          if (retryAfterHeader) {
            const retrySeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(retrySeconds)) {
              retryMinutes = Math.max(1, retrySeconds / 60);
            } else {
              const retryDate = new Date(retryAfterHeader);
              retryMinutes = !isNaN(retryDate.getTime()) ? Math.max(1, (retryDate.getTime() - Date.now()) / 60_000) : withJitter(BACKOFF_MINUTES[Math.min(event.attempts || 0, BACKOFF_MINUTES.length - 1)]);
            }
          } else {
            retryMinutes = withJitter(BACKOFF_MINUTES[Math.min(event.attempts || 0, BACKOFF_MINUTES.length - 1)]);
          }

          const attempts = (event.attempts || 0) + 1;
          const nextRetry = new Date(Date.now() + retryMinutes * 60_000).toISOString();

          if (attempts >= MAX_ATTEMPTS) {
            await supabase.from('webhook_outbox').update({ status: 'dead_letter', attempts, last_error: `429 Rate Limited: ${responseSnippet}`, last_status_code: 429 }).eq('id', event.id);
            deadLetter++;
          } else {
            await supabase.from('webhook_outbox').update({ status: 'pending', attempts, next_retry_at: nextRetry, last_error: `429 Rate Limited`, last_status_code: 429 }).eq('id', event.id);
            failed++;
          }
          console.warn(JSON.stringify({ level: 'warn', action: 'dispatch', delivery_id: event.id, endpoint_id: event.endpoint_id, endpoint_name: endpoint.name, event_type: event.event_type, status: 'rate_limited', http_status: 429, attempt: attempts, retry_after_min: retryMinutes.toFixed(1), next_retry: nextRetry, elapsed_ms: elapsedMs }));
        } else {
          throw Object.assign(new Error(`HTTP ${response.status}: ${responseSnippet}`), { httpStatus: response.status });
        }
      } catch (err: any) {
        const elapsedMs = Date.now() - startTime;
        const attempts = (event.attempts || 0) + 1;
        const errorMsg = err.message || 'Unknown error';
        const httpStatus = err.httpStatus || null;

        if (attempts >= MAX_ATTEMPTS) {
          await supabase.from('webhook_outbox').update({ status: 'dead_letter', attempts, last_error: errorMsg, last_status_code: httpStatus }).eq('id', event.id);
          deadLetter++;
          console.error(JSON.stringify({ level: 'error', action: 'dispatch', delivery_id: event.id, endpoint_id: event.endpoint_id, endpoint_name: endpoint?.name, event_type: event.event_type, status: 'dead_letter', http_status: httpStatus, attempt: attempts, error: errorMsg, elapsed_ms: elapsedMs }));
        } else {
          const backoffMinutes = withJitter(BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)]);
          const nextRetry = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
          await supabase.from('webhook_outbox').update({ status: 'pending', attempts, next_retry_at: nextRetry, last_error: errorMsg, last_status_code: httpStatus }).eq('id', event.id);
          failed++;
          console.warn(JSON.stringify({ level: 'warn', action: 'dispatch', delivery_id: event.id, endpoint_id: event.endpoint_id, endpoint_name: endpoint?.name, event_type: event.event_type, status: 'retry', http_status: httpStatus, attempt: attempts, max_attempts: MAX_ATTEMPTS, next_retry: nextRetry, backoff_min: backoffMinutes.toFixed(1), error: errorMsg, elapsed_ms: elapsedMs }));
        }
      }
    });

    const result = { dispatched: batch.length, sent, failed, rateLimited, deadLetter };
    console.log(`[dispatch-webhooks] Result:`, JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[dispatch-webhooks] Fatal error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
