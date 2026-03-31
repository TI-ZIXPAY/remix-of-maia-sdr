import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const CALENDLY_BASE = "https://api.calendly.com";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const calendlyToken = Deno.env.get('CALENDLY_API_TOKEN');
  if (!calendlyToken) {
    return new Response(JSON.stringify({ error: 'CALENDLY_API_TOKEN not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  const headers = {
    'Authorization': `Bearer ${calendlyToken}`,
    'Content-Type': 'application/json',
  };

  const jsonResponse = (data: any, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const calendlyFetch = async (endpoint: string, options?: RequestInit) => {
    const res = await fetch(`${CALENDLY_BASE}${endpoint}`, { headers, ...options });
    if (!res.ok) {
      const text = await res.text();
      throw { status: res.status, message: `Calendly API error: ${res.status}`, details: text };
    }
    return res.json();
  };

  try {
    switch (action) {
      case 'get-user': {
        const data = await calendlyFetch('/users/me');
        return jsonResponse(data);
      }

      case 'get-event': {
        const eventUri = url.searchParams.get('event_uri');
        if (!eventUri) return jsonResponse({ error: 'Missing "event_uri" param' }, 400);
        // Extract UUID from full URI
        const eventUuid = eventUri.split('/scheduled_events/')[1]?.split('/')[0];
        if (!eventUuid) return jsonResponse({ error: 'Invalid event_uri format' }, 400);
        const data = await calendlyFetch(`/scheduled_events/${eventUuid}`);
        return jsonResponse(data);
      }

      case 'list-types': {
        const userUri = url.searchParams.get('user');
        if (!userUri) return jsonResponse({ error: 'Missing "user" param (user URI)' }, 400);
        const data = await calendlyFetch(`/event_types?user=${encodeURIComponent(userUri)}&active=true`);
        return jsonResponse(data);
      }

      case 'available-times': {
        const eventType = url.searchParams.get('event_type');
        const startTime = url.searchParams.get('start_time');
        const endTime = url.searchParams.get('end_time');
        if (!eventType || !startTime || !endTime) {
          return jsonResponse({ error: 'Missing params: event_type, start_time, end_time' }, 400);
        }
        const data = await calendlyFetch(
          `/event_type_available_times?event_type=${encodeURIComponent(eventType)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`
        );
        return jsonResponse(data);
      }

      case 'available-times-multi': {
        const body = await req.json().catch(() => ({}));
        const closers = body.closers || [];
        const startTime = body.start_time;
        const endTime = body.end_time;

        if (!closers.length || !startTime || !endTime) {
          return jsonResponse({ error: 'Missing params: closers[], start_time, end_time' }, 400);
        }

        const results = await Promise.allSettled(
          closers.map(async (closer: any) => {
            const data = await calendlyFetch(
              `/event_type_available_times?event_type=${encodeURIComponent(closer.event_type_uri)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`
            );
            return {
              closer_id: closer.closer_id,
              closer_name: closer.closer_name,
              priority: closer.priority,
              event_type_uri: closer.event_type_uri,
              slots: (data.collection || [])
                .filter((item: any) => item.status === 'available' && item.start_time)
                .map((item: any) => ({ start_time: item.start_time, status: item.status })),
            };
          })
        );

        const closerResults = results
          .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
          .map(r => r.value);

        return jsonResponse({ closers: closerResults });
      }

      case 'create-webhook': {
        const userData = await calendlyFetch('/users/me');
        const organizationUri = userData.resource?.current_organization;
        const userUri = userData.resource?.uri;

        if (!organizationUri) {
          return jsonResponse({ error: 'Could not determine organization URI' }, 400);
        }

        const body = await req.json().catch(() => ({}));
        const callbackUrl = body.callback_url;
        const events = body.events || ['invitee.created', 'invitee.canceled', 'invitee_no_show.created'];

        if (!callbackUrl) {
          return jsonResponse({ error: 'Missing callback_url in request body' }, 400);
        }

        const listData = await calendlyFetch(
          `/webhook_subscriptions?organization=${encodeURIComponent(organizationUri)}&scope=organization`
        ).catch(() => ({ collection: [] }));
        
        const existing = (listData.collection || []).find((w: any) => w.callback_url === callbackUrl);
        if (existing) {
          return jsonResponse({ success: true, message: 'Webhook already exists', webhook: existing });
        }

        const createRes = await fetch(`${CALENDLY_BASE}/webhook_subscriptions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            url: callbackUrl,
            events,
            organization: organizationUri,
            user: userUri,
            scope: 'organization',
          }),
        });

        if (!createRes.ok) {
          const text = await createRes.text();
          return jsonResponse({ error: `Failed to create webhook: ${createRes.status}`, details: text }, createRes.status);
        }

        const webhookData = await createRes.json();
        return jsonResponse({ success: true, webhook: webhookData.resource });
      }

      case 'create-invitee': {
        const body = await req.json().catch(() => ({}));
        const { event_type, start_time, invitee_name, invitee_email, invitee_timezone, text_reminder_number, location, questions_and_answers, tracking } = body;

        if (!event_type || !start_time || !invitee_email) {
          return jsonResponse({ error: 'Missing required params: event_type, start_time, invitee_email' }, 400);
        }

        const nameParts = (invitee_name || 'Lead').split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

        const inviteeBody: any = {
          event_type,
          start_time,
          invitee: {
            name: invitee_name || 'Lead',
            first_name: firstName,
            last_name: lastName,
            email: invitee_email,
            timezone: invitee_timezone || 'America/Sao_Paulo',
          },
        };

        // Add text reminder number for SMS reminders
        if (text_reminder_number) {
          inviteeBody.invitee.text_reminder_number = text_reminder_number;
        }

        if (location) inviteeBody.location = location;
        if (questions_and_answers && Array.isArray(questions_and_answers)) {
          inviteeBody.questions_and_answers = questions_and_answers;
        }
        // Add UTM tracking data
        if (tracking && typeof tracking === 'object') {
          inviteeBody.tracking = tracking;
        }

        console.log('[Calendly] Creating invitee:', JSON.stringify(inviteeBody));

        const createRes = await fetch(`${CALENDLY_BASE}/invitees`, {
          method: 'POST',
          headers,
          body: JSON.stringify(inviteeBody),
        });

        if (!createRes.ok) {
          const text = await createRes.text();
          console.error('[Calendly] Create invitee error:', createRes.status, text);
          return jsonResponse({ error: `Calendly create invitee error: ${createRes.status}`, details: text }, createRes.status);
        }

        const inviteeData = await createRes.json();
        return jsonResponse({ success: true, ...inviteeData });
      }

      case 'cancel-event': {
        const body = await req.json().catch(() => ({}));
        const eventUri = body.event_uri;
        const reason = body.reason || 'Cancelado pelo lead';

        if (!eventUri) {
          return jsonResponse({ error: 'Missing event_uri in request body' }, 400);
        }

        // Extract event UUID from URI
        const eventUuid = eventUri.split('/').pop();
        const cancelRes = await fetch(`${CALENDLY_BASE}/scheduled_events/${eventUuid}/cancellation`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ reason }),
        });

        if (!cancelRes.ok) {
          const text = await cancelRes.text();
          console.error('[Calendly] Cancel event error:', cancelRes.status, text);
          // 404 or 403 might mean already cancelled
          if (cancelRes.status === 404 || cancelRes.status === 403) {
            return jsonResponse({ success: true, message: 'Event already cancelled or not found' });
          }
          return jsonResponse({ error: `Calendly cancel error: ${cancelRes.status}`, details: text }, cancelRes.status);
        }

        const cancelData = await cancelRes.json();
        return jsonResponse({ success: true, ...cancelData });
      }

      case 'list-members': {
        const userData = await calendlyFetch('/users/me');
        const organizationUri = userData.resource?.current_organization;
        if (!organizationUri) {
          return jsonResponse({ error: 'Could not determine organization URI' }, 400);
        }
        const data = await calendlyFetch(
          `/organization_memberships?organization=${encodeURIComponent(organizationUri)}`
        );
        const members = (data.collection || []).map((m: any) => ({
          uri: m.user?.uri,
          name: m.user?.name,
          email: m.user?.email,
          role: m.role,
          membership_uri: m.uri,
        }));
        return jsonResponse({ members });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: any) {
    console.error('[Calendly] Error:', error);
    const status = error.status || 500;
    return jsonResponse({ error: error.message || String(error), details: error.details }, status);
  }
});
