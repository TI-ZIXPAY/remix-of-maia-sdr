import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

interface GoogleCalendarSettings {
  google_calendar_client_id: string;
  google_calendar_client_secret: string;
  google_calendar_refresh_token: string;
  google_calendar_id: string;
  google_calendar_enabled: boolean;
}

async function getAccessToken(settings: GoogleCalendarSettings): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.google_calendar_client_id,
      client_secret: settings.google_calendar_client_secret,
      refresh_token: settings.google_calendar_refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[GoogleCalendar] Token error:', response.status, errorText);
    throw new Error(`Failed to get access token: ${response.status}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function getCalendarSettings(supabase: any): Promise<GoogleCalendarSettings | null> {
  const { data, error } = await supabase
    .from('nina_settings')
    .select('google_calendar_client_id, google_calendar_client_secret, google_calendar_refresh_token, google_calendar_id, google_calendar_enabled')
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error('[GoogleCalendar] Error fetching settings:', error);
    return null;
  }

  if (!data.google_calendar_enabled || !data.google_calendar_client_id || !data.google_calendar_client_secret || !data.google_calendar_refresh_token) {
    return null;
  }

  return {
    google_calendar_client_id: data.google_calendar_client_id,
    google_calendar_client_secret: data.google_calendar_client_secret,
    google_calendar_refresh_token: data.google_calendar_refresh_token,
    google_calendar_id: data.google_calendar_id || 'primary',
    google_calendar_enabled: data.google_calendar_enabled,
  };
}

async function handleFreeBusy(accessToken: string, calendarId: string, body: any) {
  const { date, timezone } = body;
  if (!date) throw new Error('date is required for free-busy');

  const timeMin = `${date}T00:00:00`;
  const timeMax = `${date}T23:59:59`;

  const response = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: new Date(`${timeMin}${timezone ? '' : 'Z'}`).toISOString(),
      timeMax: new Date(`${timeMax}${timezone ? '' : 'Z'}`).toISOString(),
      timeZone: timezone || 'America/Sao_Paulo',
      items: [{ id: calendarId }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FreeBusy error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const busy = data.calendars?.[calendarId]?.busy || [];

  return { busy, date, calendarId };
}

async function handleListEvents(accessToken: string, calendarId: string, body: any) {
  const { timeMin, timeMax, maxResults, timezone } = body;

  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeZone: timezone || 'America/Sao_Paulo',
  });

  if (timeMin) params.set('timeMin', new Date(timeMin).toISOString());
  if (timeMax) params.set('timeMax', new Date(timeMax).toISOString());
  if (maxResults) params.set('maxResults', String(maxResults));

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ListEvents error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const events = (data.items || []).map((e: any) => ({
    id: e.id,
    summary: e.summary,
    description: e.description,
    start: e.start,
    end: e.end,
    status: e.status,
    htmlLink: e.htmlLink,
    attendees: e.attendees?.map((a: any) => ({ email: a.email, responseStatus: a.responseStatus, displayName: a.displayName })),
    conferenceData: e.conferenceData ? {
      entryPoints: e.conferenceData.entryPoints?.map((ep: any) => ({ entryPointType: ep.entryPointType, uri: ep.uri })),
    } : null,
    calendarId,
  }));

  return { events, calendarId };
}

async function handleListEventsMulti(accessToken: string, body: any) {
  const { calendarIds, timeMin, timeMax, maxResults, timezone } = body;
  if (!calendarIds || !Array.isArray(calendarIds) || calendarIds.length === 0) {
    throw new Error('calendarIds array is required for list-events-multi');
  }

  // Fetch calendar list for names/colors
  const calListRes = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const calListData = calListRes.ok ? await calListRes.json() : { items: [] };
  const calMap: Record<string, { summary: string; backgroundColor: string }> = {};
  for (const c of (calListData.items || [])) {
    calMap[c.id] = { summary: c.summary, backgroundColor: c.backgroundColor };
  }

  // Fetch events from all calendars in parallel
  const results = await Promise.allSettled(
    calendarIds.map((cId: string) =>
      handleListEvents(accessToken, cId, { timeMin, timeMax, maxResults, timezone })
    )
  );

  const allEvents: any[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const ev of r.value.events) {
        const calInfo = calMap[ev.calendarId] || {};
        allEvents.push({
          ...ev,
          calendarName: calInfo.summary || ev.calendarId,
          backgroundColor: calInfo.backgroundColor || '#4285f4',
        });
      }
    }
  }

  return { events: allEvents };
}

async function handleListCalendars(accessToken: string) {
  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/users/me/calendarList`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ListCalendars error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const calendars = (data.items || []).map((c: any) => ({
    id: c.id,
    summary: c.summary,
    description: c.description,
    primary: c.primary || false,
    accessRole: c.accessRole,
    backgroundColor: c.backgroundColor,
  }));

  return { calendars };
}

async function handleCreateEvent(accessToken: string, calendarId: string, body: any) {
  const { title, date, time, duration, description, timezone, attendees } = body;
  if (!title || !date || !time) throw new Error('title, date, and time are required');

  const tz = timezone || 'America/Sao_Paulo';
  const durationMinutes = duration || 60;
  const startDateTime = `${date}T${time}:00`;
  const startDate = new Date(`${startDateTime}`);
  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

  const endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;
  const endDateTime = `${date}T${endTime}`;

  const event: any = {
    summary: title,
    description: description || '',
    start: { dateTime: startDateTime, timeZone: tz },
    end: { dateTime: endDateTime, timeZone: tz },
  };

  if (attendees && attendees.length > 0) {
    event.attendees = attendees.map((email: string) => ({ email }));
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CreateEvent error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return {
    eventId: data.id,
    htmlLink: data.htmlLink,
    summary: data.summary,
    start: data.start,
    end: data.end,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    if (!action) {
      return new Response(JSON.stringify({ error: 'action query param is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const calSettings = await getCalendarSettings(supabase);
    if (!calSettings) {
      return new Response(JSON.stringify({ error: 'Google Calendar not configured or disabled' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getAccessToken(calSettings);
    const body = req.method === 'POST' ? await req.json() : {};

    let result;
    switch (action) {
      case 'free-busy':
        result = await handleFreeBusy(accessToken, calSettings.google_calendar_id, body);
        break;
      case 'list-events':
        result = await handleListEvents(accessToken, calSettings.google_calendar_id, body);
        break;
      case 'create-event':
        result = await handleCreateEvent(accessToken, calSettings.google_calendar_id, body);
        break;
      case 'list-calendars':
        result = await handleListCalendars(accessToken);
        break;
      case 'list-events-multi':
        result = await handleListEventsMulti(accessToken, body);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[GoogleCalendar] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
