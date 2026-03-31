import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  description?: string;
  primary: boolean;
  backgroundColor: string;
  accessRole: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status: string;
  htmlLink: string;
  attendees?: { email: string; responseStatus: string; displayName?: string }[];
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
  calendarId: string;
  calendarName?: string;
  backgroundColor?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  description?: string;
  source: 'local' | 'google';
  type?: string;
  color?: string;
  htmlLink?: string;
  attendees?: { email: string; responseStatus: string; displayName?: string }[];
  meetLink?: string;
  calendarName?: string;
  calendarId?: string;
  status?: string;
}

function parseGoogleEvent(ev: GoogleCalendarEvent): CalendarEvent {
  const startDt = ev.start.dateTime ? new Date(ev.start.dateTime) : new Date(ev.start.date + 'T00:00:00');
  const endDt = ev.end.dateTime ? new Date(ev.end.dateTime) : new Date(ev.end.date + 'T23:59:59');
  
  const date = `${startDt.getFullYear()}-${String(startDt.getMonth() + 1).padStart(2, '0')}-${String(startDt.getDate()).padStart(2, '0')}`;
  const startTime = `${String(startDt.getHours()).padStart(2, '0')}:${String(startDt.getMinutes()).padStart(2, '0')}`;
  const endTime = `${String(endDt.getHours()).padStart(2, '0')}:${String(endDt.getMinutes()).padStart(2, '0')}`;
  const duration = Math.round((endDt.getTime() - startDt.getTime()) / 60000);

  const meetLink = ev.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri;

  return {
    id: `gcal-${ev.calendarId}-${ev.id}`,
    title: ev.summary || '(Sem título)',
    date,
    startTime,
    endTime,
    duration: duration > 0 ? duration : 60,
    description: ev.description,
    source: 'google',
    color: ev.backgroundColor || '#4285f4',
    htmlLink: ev.htmlLink,
    attendees: ev.attendees,
    meetLink,
    calendarName: ev.calendarName,
    calendarId: ev.calendarId,
    status: ev.status,
  };
}

export function useGoogleCalendar() {
  const [gcalEnabled, setGcalEnabled] = useState(false);
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[]>([]);
  const [enabledCalendarIds, setEnabledCalendarIds] = useState<string[]>([]);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [calendarsLoading, setCalendarsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const cacheRef = useRef<Record<string, CalendarEvent[]>>({});

  // Check if Google Calendar is enabled
  const [configuredCalendarId, setConfiguredCalendarId] = useState<string | null>(null);

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase
        .from('nina_settings')
        .select('google_calendar_enabled, google_calendar_id')
        .limit(1)
        .maybeSingle();
      setGcalEnabled(!!data?.google_calendar_enabled);
      setConfiguredCalendarId((data as any)?.google_calendar_id || null);
    };
    check();
  }, []);

  // Load calendars list
  const loadCalendars = useCallback(async () => {
    if (!gcalEnabled) return;
    setCalendarsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fetchRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar?action=list-calendars`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({}),
        }
      );
      const result = await fetchRes.json();
      if (result.calendars) {
        setCalendars(result.calendars);
        // Pre-select only the configured calendar from integration settings
        if (enabledCalendarIds.length === 0) {
          if (configuredCalendarId) {
            const match = result.calendars.find((c: GoogleCalendarInfo) => c.id === configuredCalendarId);
            setEnabledCalendarIds(match ? [match.id] : [result.calendars[0]?.id].filter(Boolean));
          } else {
            // Fallback: select primary or first calendar
            const primary = result.calendars.find((c: GoogleCalendarInfo) => c.primary);
            setEnabledCalendarIds(primary ? [primary.id] : [result.calendars[0]?.id].filter(Boolean));
          }
        }
      }
    } catch (err) {
      console.error('[useGoogleCalendar] Error loading calendars:', err);
    } finally {
      setCalendarsLoading(false);
    }
  }, [gcalEnabled, configuredCalendarId]);

  useEffect(() => {
    loadCalendars();
  }, [loadCalendars]);

  // Fetch events for a date range
  const fetchEvents = useCallback(async (timeMin: string, timeMax: string) => {
    if (!gcalEnabled || enabledCalendarIds.length === 0) {
      setGoogleEvents([]);
      return;
    }

    const cacheKey = `${timeMin}|${timeMax}|${enabledCalendarIds.sort().join(',')}`;
    if (cacheRef.current[cacheKey]) {
      setGoogleEvents(cacheRef.current[cacheKey]);
      return;
    }

    setGcalLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fetchRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar?action=list-events-multi`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            calendarIds: enabledCalendarIds,
            timeMin,
            timeMax,
            maxResults: 200,
          }),
        }
      );
      const result = await fetchRes.json();
      if (result.events) {
        const parsed = result.events.map(parseGoogleEvent);
        cacheRef.current[cacheKey] = parsed;
        setGoogleEvents(parsed);
      }
    } catch (err) {
      console.error('[useGoogleCalendar] Error fetching events:', err);
    } finally {
      setGcalLoading(false);
    }
  }, [gcalEnabled, enabledCalendarIds]);

  // Debounced fetch
  const fetchEventsDebounced = useCallback((timeMin: string, timeMax: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchEvents(timeMin, timeMax), 300);
  }, [fetchEvents]);

  const toggleCalendar = useCallback((calId: string) => {
    setEnabledCalendarIds(prev =>
      prev.includes(calId) ? prev.filter(id => id !== calId) : [...prev, calId]
    );
    // Clear cache when toggling
    cacheRef.current = {};
  }, []);

  const refreshCalendars = useCallback(() => {
    cacheRef.current = {};
    loadCalendars();
  }, [loadCalendars]);

  return {
    gcalEnabled,
    calendars,
    enabledCalendarIds,
    toggleCalendar,
    googleEvents,
    gcalLoading,
    calendarsLoading,
    fetchEventsDebounced,
    refreshCalendars,
  };
}
