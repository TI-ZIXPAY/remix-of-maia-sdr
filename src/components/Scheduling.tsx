import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, Clock, AlignLeft, X, Loader2, LayoutGrid, List, Columns, Video, User, UserCircle, Bot, Pencil, ExternalLink, RefreshCw, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { Appointment, Contact } from '../types';
import { api } from '../services/api';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useGoogleCalendar, CalendarEvent } from '@/hooks/useGoogleCalendar';
import { Checkbox } from '@/components/ui/checkbox';

type ViewMode = 'month' | 'week' | 'day';

const Scheduling: React.FC = () => {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>(() => window.innerWidth < 768 ? 'day' : 'week');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [selectedGoogleEvent, setSelectedGoogleEvent] = useState<CalendarEvent | null>(null);
  
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);

  // Sidebar
  const [showCalendarSidebar, setShowCalendarSidebar] = useState(false);
  const weekDayViewRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Auto-scroll to 8h on week/day view mount
  const scrollTo8h = useCallback((node: HTMLDivElement | null) => {
    if (node && !hasScrolledRef.current) {
      const hourHeight = viewMode === 'day' ? 80 : 64;
      const scrollTarget = (8 - 6) * hourHeight - 20;
      requestAnimationFrame(() => { node.scrollTop = scrollTarget; });
      hasScrolledRef.current = true;
    }
  }, [viewMode]);

  // Google Calendar hook
  const {
    gcalEnabled,
    calendars,
    enabledCalendarIds,
    toggleCalendar,
    googleEvents,
    gcalLoading,
    calendarsLoading,
    fetchEventsDebounced,
    refreshCalendars,
  } = useGoogleCalendar();

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    time: '09:00',
    type: 'demo',
    description: '',
    duration: 60
  });

  // Edit Form State
  const [editFormData, setEditFormData] = useState({
    title: '',
    date: '',
    time: '09:00',
    type: 'demo',
    description: '',
    duration: 60,
    attendees: ''
  });
  const [editContactId, setEditContactId] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [appointmentsData, contactsData] = await Promise.all([
          api.fetchAppointments(),
          api.fetchContacts()
        ]);
        setAppointments(appointmentsData);
        setContacts(contactsData);
      } catch (error) {
        console.error("Erro ao carregar dados", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    const channel = supabase
      .channel('appointments-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
        loadData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Calculate visible date range and fetch Google events
  useEffect(() => {
    if (!gcalEnabled) return;

    let timeMin: Date, timeMax: Date;
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    if (viewMode === 'month') {
      timeMin = new Date(year, month, 1);
      timeMax = new Date(year, month + 1, 0, 23, 59, 59);
      // Include extra days for grid
      timeMin.setDate(timeMin.getDate() - timeMin.getDay());
      timeMax.setDate(timeMax.getDate() + (6 - timeMax.getDay()));
    } else if (viewMode === 'week') {
      const start = getStartOfWeek(currentDate);
      timeMin = new Date(start);
      timeMax = new Date(start);
      timeMax.setDate(timeMax.getDate() + 6);
      timeMax.setHours(23, 59, 59);
    } else {
      timeMin = new Date(currentDate);
      timeMin.setHours(0, 0, 0, 0);
      timeMax = new Date(currentDate);
      timeMax.setHours(23, 59, 59);
    }

    fetchEventsDebounced(timeMin.toISOString(), timeMax.toISOString());
  }, [currentDate, viewMode, gcalEnabled, fetchEventsDebounced]);

  // Navigation Logic
  const navigateDate = (direction: number) => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') newDate.setMonth(newDate.getMonth() + direction);
    else if (viewMode === 'week') newDate.setDate(newDate.getDate() + (direction * 7));
    else newDate.setDate(newDate.getDate() + direction);
    setCurrentDate(newDate);
  };

  const goToToday = () => setCurrentDate(new Date());

  // Date Formatters
  const getMonthLabel = () => currentDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  const getDayLabel = () => currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const getWeekLabel = () => {
    const start = getStartOfWeek(currentDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.getDate()} ${start.toLocaleString('pt-BR', { month: 'short' })} - ${end.getDate()} ${end.toLocaleString('pt-BR', { month: 'short' })}`;
  };

  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  };

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
  const formatDateStr = (date: Date) => date.toISOString().split('T')[0];

  const handleDateClick = (day: number) => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(dateStr);
    setShowCreateModal(true);
  };

  const handleSlotClick = (dateStr: string, time?: string) => {
    setSelectedDate(dateStr);
    if (time) setFormData(prev => ({ ...prev, time }));
    setShowCreateModal(true);
  };

  const handleAppointmentClick = (app: Appointment, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAppointment(app);
  };

  const handleGoogleEventClick = (ev: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedGoogleEvent(ev);
  };

  const calculateEndTime = (startTime: string, durationMinutes: number): string => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + durationMinutes;
    const endHours = Math.floor(totalMinutes / 60) % 24;
    const endMinutes = totalMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate) return;
    setIsSaving(true);
    try {
      const attendeesInput = (document.querySelector('[name="attendees"]') as HTMLInputElement)?.value || '';
      const attendeesArray = attendeesInput.split(',').map(a => a.trim()).filter(Boolean);
      await api.createAppointment({
        title: formData.title,
        description: formData.description,
        date: selectedDate,
        time: formData.time,
        duration: formData.duration,
        type: formData.type as 'demo' | 'meeting' | 'support' | 'followup',
        attendees: attendeesArray,
        contact_id: selectedContactId || undefined
      });
      toast.success('Agendamento criado com sucesso!');
      setShowCreateModal(false);
      setFormData({ title: '', time: '09:00', type: 'demo', description: '', duration: 60 });
      setSelectedDate(null);
      setSelectedContactId(null);
    } catch (error) {
      console.error('Error creating appointment:', error);
      toast.error('Erro ao criar agendamento');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAppointment = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este agendamento?')) return;
    try {
      await api.deleteAppointment(id);
      toast.success('Agendamento excluído com sucesso!');
      setSelectedAppointment(null);
    } catch (error) {
      console.error('Error deleting appointment:', error);
      toast.error('Erro ao excluir agendamento');
    }
  };

  const handleEditClick = (appointment: Appointment) => {
    setEditFormData({
      title: appointment.title,
      date: appointment.date,
      time: appointment.time,
      type: appointment.type,
      description: appointment.description || '',
      duration: appointment.duration,
      attendees: appointment.attendees?.join(', ') || ''
    });
    setEditContactId(appointment.contact_id || null);
    setShowEditModal(true);
    setSelectedAppointment(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppointment) return;
    setIsSaving(true);
    try {
      const attendeesArray = editFormData.attendees.split(',').map(a => a.trim()).filter(Boolean);
      await api.updateAppointment(selectedAppointment.id, {
        title: editFormData.title,
        date: editFormData.date,
        time: editFormData.time,
        type: editFormData.type as 'demo' | 'meeting' | 'support' | 'followup',
        description: editFormData.description,
        duration: editFormData.duration,
        attendees: attendeesArray,
        contact_id: editContactId || undefined
      });
      toast.success('Agendamento atualizado com sucesso!');
      setShowEditModal(false);
      setSelectedAppointment(null);
    } catch (error) {
      console.error('Error updating appointment:', error);
      toast.error('Erro ao atualizar agendamento');
    } finally {
      setIsSaving(false);
    }
  };

  const getEventTypeColor = (type: string) => {
    switch (type) {
      case 'demo': return 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20 hover:bg-cyan-500/20';
      case 'meeting': return 'bg-violet-500/10 text-violet-300 border-violet-500/20 hover:bg-violet-500/20';
      case 'support': return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20';
      case 'followup': return 'bg-orange-500/10 text-orange-300 border-orange-500/20 hover:bg-orange-500/20';
      default: return 'bg-slate-700 text-slate-300 border-slate-600';
    }
  };

  // --- Event type colors for absolute positioned events (border-left style) ---
  const getEventBorderColor = (type: string) => {
    switch (type) {
      case 'demo': return '#06b6d4';
      case 'meeting': return '#8b5cf6';
      case 'support': return '#10b981';
      case 'followup': return '#f97316';
      default: return '#64748b';
    }
  };
  const getEventBgColor = (type: string) => {
    switch (type) {
      case 'demo': return 'rgba(6,182,212,0.15)';
      case 'meeting': return 'rgba(139,92,246,0.15)';
      case 'support': return 'rgba(16,185,129,0.15)';
      case 'followup': return 'rgba(249,115,22,0.15)';
      default: return 'rgba(100,116,139,0.15)';
    }
  };
  const getEventTextColor = (type: string) => {
    switch (type) {
      case 'demo': return '#67e8f9';
      case 'meeting': return '#c4b5fd';
      case 'support': return '#6ee7b7';
      case 'followup': return '#fdba74';
      default: return '#cbd5e1';
    }
  };

  // --- Smart overlap algorithm (Google Calendar style) ---
  interface PositionedEvent {
    event: CalendarEvent | Appointment;
    source: 'local' | 'google';
    startMinutes: number;
    endMinutes: number;
    left: number;
    width: number;
  }

  const eventsOverlap = (a: { startMinutes: number; endMinutes: number }, b: { startMinutes: number; endMinutes: number }) =>
    a.startMinutes < b.endMinutes && a.endMinutes > b.startMinutes;

  const calculateEventPositions = (items: { startMinutes: number; endMinutes: number; [key: string]: any }[]): { item: any; left: number; width: number }[] => {
    if (items.length === 0) return [];
    const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes);

    // Group overlapping events
    const groups: typeof sorted[] = [];
    let currentGroup = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const groupEnd = Math.max(...currentGroup.map(e => e.endMinutes));
      if (sorted[i].startMinutes < groupEnd) {
        currentGroup.push(sorted[i]);
      } else {
        groups.push(currentGroup);
        currentGroup = [sorted[i]];
      }
    }
    groups.push(currentGroup);

    const results: { item: any; left: number; width: number }[] = [];
    for (const group of groups) {
      // Assign columns
      const columns: typeof group[] = [];
      for (const ev of group) {
        let placed = false;
        for (let col = 0; col < columns.length; col++) {
          if (columns[col].every(existing => !eventsOverlap(ev, existing))) {
            columns[col].push(ev);
            placed = true;
            break;
          }
        }
        if (!placed) columns.push([ev]);
      }
      const totalCols = columns.length;
      columns.forEach((col, colIdx) => {
        col.forEach(ev => {
          // Try to expand width if no conflict in next columns
          let expandTo = colIdx + 1;
          for (let i = colIdx + 1; i < totalCols; i++) {
            if (columns[i].every(e => !eventsOverlap(ev, e))) expandTo = i + 1;
            else break;
          }
          results.push({
            item: ev,
            left: (colIdx / totalCols) * 100,
            width: ((expandTo - colIdx) / totalCols) * 100,
          });
        });
      });
    }
    return results;
  };

  // Filter google events by enabled calendars (client-side)
  const filteredGoogleEvents = useMemo(() => {
    if (enabledCalendarIds.length === 0) return [];
    return googleEvents.filter(e => e.calendarId && enabledCalendarIds.includes(e.calendarId));
  }, [googleEvents, enabledCalendarIds]);

  // Deduplicate google events by Google event ID (same event on multiple calendars)
  const deduplicatedGoogleEvents = useMemo(() => {
    const seen = new Map<string, CalendarEvent>();
    for (const ev of filteredGoogleEvents) {
      // Extract the original Google event ID (strip calendarId prefix)
      const rawId = ev.id.replace(/^gcal-[^-]+-/, 'gcal-');
      const baseId = rawId.split('_')[0]; // handle recurring event IDs
      const key = `${ev.date}-${ev.startTime}-${baseId}`;
      if (!seen.has(key)) {
        seen.set(key, ev);
      }
    }
    return Array.from(seen.values());
  }, [filteredGoogleEvents]);

  // Build unified event list for a day (for week/day views)
  const getPositionedEventsForDate = (dateStr: string) => {
    const localApps = appointments.filter(a => a.date === dateStr);
    const gEvents = deduplicatedGoogleEvents.filter(e => e.date === dateStr);

    const unified = [
      ...localApps.map(a => {
        const [h, m] = a.time.split(':').map(Number);
        const startMin = h * 60 + m;
        return { ...a, _source: 'local' as const, startMinutes: startMin, endMinutes: startMin + a.duration };
      }),
      ...gEvents.map(e => {
        const [h, m] = e.startTime.split(':').map(Number);
        const startMin = h * 60 + m;
        return { ...e, _source: 'google' as const, startMinutes: startMin, endMinutes: startMin + e.duration };
      }),
    ];

    return calculateEventPositions(unified);
  };

  // Helper to get events for a specific date
  const getEventsForDate = (dateStr: string) => {
    const localApps = appointments.filter(a => a.date === dateStr);
    const gEvents = deduplicatedGoogleEvents.filter(e => e.date === dateStr);
    return { localApps, gEvents };
  };

  // Google event card style
  const GoogleEventBadge = ({ small = false }: { small?: boolean }) => (
    <span className={`inline-flex items-center gap-0.5 ${small ? 'text-[8px]' : 'text-[10px]'} font-bold text-orange-300`}>
      <svg viewBox="0 0 24 24" className={`${small ? 'w-2 h-2' : 'w-3 h-3'}`} fill="currentColor">
        <path d="M19.5 22h-15A2.5 2.5 0 0 1 2 19.5v-15A2.5 2.5 0 0 1 4.5 2h15A2.5 2.5 0 0 1 22 4.5v15a2.5 2.5 0 0 1-2.5 2.5zM9.5 7.5v9h1.5v-3.5h2a2.5 2.5 0 0 0 0-5h-3.5z"/>
      </svg>
      G
    </span>
  );

  const renderGoogleEventMonth = (ev: CalendarEvent) => {
    const isConfirmed = ev.status === 'confirmed';
    return (
      <div
        key={ev.id}
        className={`text-[10px] px-2 py-1 rounded border truncate font-medium cursor-pointer ${isConfirmed ? '' : 'border-dashed'}`}
        style={{
          backgroundColor: isConfirmed ? (ev.color || '#fb923c') : 'transparent',
          borderColor: ev.color || '#fb923c',
          color: isConfirmed ? '#fff' : (ev.color || '#fb923c'),
        }}
        onClick={(e) => handleGoogleEventClick(ev, e)}
      >
        <GoogleEventBadge small /> {ev.startTime} - {ev.title}
      </div>
    );
  };

  const renderGoogleEventWeekDay = (ev: CalendarEvent, isDay = false) => (
    <div
      key={ev.id}
      className={`mb-1 ${isDay ? 'p-3 rounded-lg' : 'p-2 rounded'} border border-dashed cursor-pointer hover:brightness-110 relative z-10 shadow-sm`}
      style={{
        backgroundColor: ev.color ? `${ev.color}12` : 'rgba(251,146,60,0.08)',
        borderColor: ev.color ? `${ev.color}50` : 'rgba(251,146,60,0.3)',
        color: ev.color || '#fb923c',
        minHeight: isDay ? `${Math.max(60, (ev.duration / 60) * 100)}px` : `${Math.max(40, (ev.duration / 60) * 80)}px`,
      }}
      onClick={(e) => handleGoogleEventClick(ev, e)}
    >
      <div className={`font-bold truncate flex items-center gap-1 ${isDay ? 'text-sm' : 'text-xs'}`}>
        <GoogleEventBadge small />
        {ev.title}
      </div>
      <div className="text-[10px] opacity-80">{ev.startTime} - {ev.endTime}</div>
      {isDay && ev.calendarName && <div className="text-[10px] opacity-60 mt-1">{ev.calendarName}</div>}
    </div>
  );

  // --- RENDERERS ---

  const renderMonthView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const days = daysInMonth(year, month);
    const firstDay = firstDayOfMonth(year, month);

    return (
      <div className="grid grid-cols-7 flex-1 auto-rows-fr">
        {Array.from({ length: firstDay }).map((_, index) => (
          <div key={`empty-${index}`} className="border-b border-r border-slate-800/50 bg-slate-950/30 min-h-[100px]" />
        ))}
        {Array.from({ length: days }).map((_, index) => {
          const day = index + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const { localApps, gEvents } = getEventsForDate(dateStr);
          const isToday = formatDateStr(new Date()) === dateStr;
          const MAX_VISIBLE = 3;
          const allEvents = [...localApps.map(a => ({ ...a, _type: 'local' as const })), ...gEvents.map(g => ({ ...g, _type: 'google' as const }))];
          const visibleEvents = allEvents.slice(0, MAX_VISIBLE);
          const hiddenCount = allEvents.length - MAX_VISIBLE;

          return (
            <div
              key={day}
              onClick={() => handleDateClick(day)}
              className={`border-b border-r border-slate-800/50 p-2 min-h-[120px] cursor-pointer transition-colors hover:bg-slate-800/30 group relative ${isToday ? 'bg-cyan-950/10' : ''}`}
            >
              <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full mb-2 ${isToday ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/40' : 'text-slate-400 group-hover:text-white'}`}>
                {day}
              </span>
              <div className="space-y-1">
                {visibleEvents.map(ev => {
                  if (ev._type === 'local') {
                    const app = ev as any as Appointment;
                    return (
                      <div
                        key={app.id}
                        className={`text-[10px] px-2 py-1 rounded border truncate font-medium cursor-pointer relative ${getEventTypeColor(app.type)}`}
                        onClick={(e) => handleAppointmentClick(app, e)}
                      >
                        {app.metadata?.source === 'nina_ai' && (
                          <Bot className="w-2.5 h-2.5 inline-block mr-0.5 text-cyan-400" />
                        )}
                        {app.time} - {app.title}
                      </div>
                    );
                  } else {
                    return renderGoogleEventMonth(ev as any as CalendarEvent);
                  }
                })}
                {hiddenCount > 0 && (
                  <div className="text-[10px] text-slate-400 font-medium px-2 py-0.5 hover:text-white transition-colors">
                    +{hiddenCount} mais
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {Array.from({ length: 42 - (days + firstDay) }).map((_, index) => (
          <div key={`remaining-${index}`} className="border-b border-r border-slate-800/50 bg-slate-950/30" />
        ))}
      </div>
    );
  };

  const renderWeekView = () => {
    const startOfWeek = getStartOfWeek(currentDate);
    const weekDays = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      return d;
    });
    const START_HOUR = 6;
    const END_HOUR = 20;
    const HOUR_HEIGHT = 64; // px per hour
    const hours = Array.from({ length: END_HOUR - START_HOUR }).map((_, i) => i + START_HOUR);
    const totalHeight = hours.length * HOUR_HEIGHT;

    return (
      <div ref={scrollTo8h} className="flex flex-col flex-1 overflow-y-auto custom-scrollbar bg-slate-900/30">
        {/* Header */}
        <div className="grid border-b border-slate-800 sticky top-0 bg-slate-900 z-20" style={{ gridTemplateColumns: '72px repeat(7, 1fr)' }}>
          <div className="p-3 text-[10px] font-medium text-slate-500 border-r border-slate-800 flex items-end justify-center pb-2">GMT-3</div>
          {weekDays.map((day, i) => {
            const isToday = formatDateStr(new Date()) === formatDateStr(day);
            return (
              <div key={i} className={`py-3 text-center border-r border-slate-800/50 ${isToday ? 'bg-cyan-950/20' : ''}`}>
                <div className={`text-[10px] uppercase font-semibold tracking-wider ${isToday ? 'text-cyan-400' : 'text-slate-500'}`}>
                  {day.toLocaleDateString('pt-BR', { weekday: 'short' })}
                </div>
                <div className={`text-xl font-bold mt-0.5 ${isToday ? 'text-cyan-500' : 'text-slate-300'}`}>
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div className="flex-1 relative">
          {/* Current time indicator */}
          {(() => {
            const now = new Date();
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            const topPx = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
            if (nowMinutes < START_HOUR * 60 || nowMinutes > END_HOUR * 60) return null;
            return (
              <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top: `${topPx}px` }}>
                <div className="flex items-center" style={{ marginLeft: '68px' }}>
                  <div className="w-3 h-3 rounded-full bg-red-500 -ml-1.5 shadow-lg shadow-red-500/50" />
                  <div className="flex-1 h-[2px] bg-red-500 shadow-sm shadow-red-500/50" />
                </div>
              </div>
            );
          })()}
          <div className="grid" style={{ gridTemplateColumns: '72px repeat(7, 1fr)', minHeight: `${totalHeight}px` }}>
            {/* Time labels column */}
            <div className="border-r border-slate-800/50 relative">
              {hours.map((h, i) => (
                <div key={h} className="absolute right-0 pr-2 text-[11px] text-slate-500 text-right w-full" style={{ top: `${i * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}>
                  <span className="-translate-y-1/2 block pt-0">{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {weekDays.map((day, dayIdx) => {
              const dateStr = formatDateStr(day);
              const isToday = formatDateStr(new Date()) === dateStr;
              const positioned = getPositionedEventsForDate(dateStr);

              return (
                <div key={dayIdx} className={`relative border-r border-slate-800/30 ${isToday ? 'bg-cyan-950/5' : 'bg-slate-900/20'}`} style={{ minHeight: `${totalHeight}px` }}>
                  {/* Hour lines */}
                  {hours.map((h, i) => (
                    <div
                      key={h}
                      className="absolute w-full border-b border-slate-800/30 cursor-pointer hover:bg-slate-800/10 transition-colors"
                      style={{ top: `${i * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                      onClick={() => handleSlotClick(dateStr, `${String(h).padStart(2, '0')}:00`)}
                    />
                  ))}

                  {/* Events container */}
                  <div className="absolute inset-0 pointer-events-none px-0.5">
                    {positioned.map(({ item, left, width }, idx) => {
                      const topPx = ((item.startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
                      const heightPx = Math.max(20, ((item.endMinutes - item.startMinutes) / 60) * HOUR_HEIGHT);
                      const isGoogle = item._source === 'google';
                      const isConfirmed = isGoogle && item.status === 'confirmed';

                      const borderColor = isGoogle ? (item.color || '#fb923c') : getEventBorderColor(item.type);
                      const bgColor = isGoogle
                        ? (isConfirmed ? (item.color || '#fb923c') : 'transparent')
                        : getEventBgColor(item.type);
                      const textColor = isGoogle
                        ? (isConfirmed ? '#fff' : (item.color || '#fb923c'))
                        : getEventTextColor(item.type);

                      return (
                        <div
                          key={`${item.id}-${idx}`}
                          className={`absolute rounded-sm px-1.5 py-1 cursor-pointer pointer-events-auto transition-all hover:scale-[1.02] hover:shadow-lg hover:z-50 overflow-hidden ${isGoogle && !isConfirmed ? 'border border-dashed' : 'border-l-[3px]'}`}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            left: `${left}%`,
                            width: `${width}%`,
                            ...(isGoogle && !isConfirmed ? { borderColor: borderColor } : { borderLeftColor: borderColor }),
                            backgroundColor: bgColor,
                            color: textColor,
                            zIndex: 10 + (item.startMinutes % 60),
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isGoogle) handleGoogleEventClick(item as CalendarEvent, e);
                            else handleAppointmentClick(item as Appointment, e);
                          }}
                        >
                          <div className="font-semibold text-[11px] truncate leading-tight flex items-center gap-0.5">
                            {isGoogle && <GoogleEventBadge small />}
                            {!isGoogle && item.metadata?.source === 'nina_ai' && <Bot className="w-2.5 h-2.5 flex-shrink-0" />}
                            {!isGoogle && (item.metadata as any)?.source === 'calendly' && <CalendarIcon className="w-2.5 h-2.5 flex-shrink-0 text-orange-400" />}
                            {item.title || item.summary}
                          </div>
                          {heightPx > 28 && (
                            <div className="text-[10px] opacity-80 whitespace-nowrap mt-0.5">
                              {isGoogle ? `${item.startTime} - ${item.endTime}` : `${item.time} - ${calculateEndTime(item.time, item.duration)}`}
                            </div>
                          )}
                          {!isGoogle && heightPx > 44 && (item.metadata as any)?.closer_name && (
                            <div className="text-[9px] opacity-70 truncate mt-0.5 flex items-center gap-0.5">
                              <Users className="w-2 h-2 flex-shrink-0" />
                              {(item.metadata as any).closer_name}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const START_HOUR = 6;
    const END_HOUR = 20;
    const HOUR_HEIGHT = 80; // px per hour (larger for day view)
    const hours = Array.from({ length: END_HOUR - START_HOUR }).map((_, i) => i + START_HOUR);
    const totalHeight = hours.length * HOUR_HEIGHT;
    const dateStr = formatDateStr(currentDate);
    const positioned = getPositionedEventsForDate(dateStr);

    return (
      <div ref={scrollTo8h} className="flex flex-col flex-1 overflow-y-auto custom-scrollbar bg-slate-900/30">
        <div className="p-4 border-b border-slate-800 bg-slate-900 sticky top-0 z-20">
          <h3 className="text-xl font-bold text-white capitalize">{currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
        </div>


        <div className="flex-1 relative" style={{ minHeight: `${totalHeight}px` }}>
          {/* Current time indicator */}
          {(() => {
            const now = new Date();
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            const topPx = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
            if (nowMinutes < START_HOUR * 60 || nowMinutes > END_HOUR * 60) return null;
            const isToday = formatDateStr(new Date()) === dateStr;
            if (!isToday) return null;
            return (
              <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top: `${topPx}px` }}>
                <div className="flex items-center" style={{ marginLeft: '76px' }}>
                  <div className="w-3 h-3 rounded-full bg-red-500 -ml-1.5 shadow-lg shadow-red-500/50" />
                  <div className="flex-1 h-[2px] bg-red-500 shadow-sm shadow-red-500/50" />
                </div>
              </div>
            );
          })()}
          <div className="grid" style={{ gridTemplateColumns: '80px 1fr', minHeight: `${totalHeight}px` }}>
            {/* Time labels */}
            <div className="border-r border-slate-800/50 relative">
              {hours.map((h, i) => (
                <div key={h} className="absolute right-0 pr-3 text-xs text-slate-500 text-right w-full" style={{ top: `${i * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}>
                  <span className="-translate-y-1/2 block">{String(h).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>

            {/* Day column */}
            <div className="relative" style={{ minHeight: `${totalHeight}px` }}>
              {/* Hour lines */}
              {hours.map((h, i) => (
                <div
                  key={h}
                  className="absolute w-full border-b border-slate-800/30 cursor-pointer hover:bg-slate-800/10 transition-colors"
                  style={{ top: `${i * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
                  onClick={() => handleSlotClick(dateStr, `${String(h).padStart(2, '0')}:00`)}
                />
              ))}

              {/* Events */}
              <div className="absolute inset-0 pointer-events-none px-1">
                {positioned.map(({ item, left, width }, idx) => {
                  const topPx = ((item.startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
                  const heightPx = Math.max(28, ((item.endMinutes - item.startMinutes) / 60) * HOUR_HEIGHT);
                   const isGoogle = item._source === 'google';
                   const isConfirmed = isGoogle && item.status === 'confirmed';

                   const borderColor = isGoogle ? (item.color || '#fb923c') : getEventBorderColor(item.type);
                   const bgColor = isGoogle
                     ? (isConfirmed ? (item.color || '#fb923c') : 'transparent')
                     : getEventBgColor(item.type);
                   const textColor = isGoogle
                     ? (isConfirmed ? '#fff' : (item.color || '#fb923c'))
                     : getEventTextColor(item.type);

                  return (
                    <div
                      key={`${item.id}-${idx}`}
                      className={`absolute rounded px-2.5 py-1.5 cursor-pointer pointer-events-auto transition-all hover:scale-[1.02] hover:shadow-lg hover:z-50 overflow-hidden ${isGoogle && !isConfirmed ? 'border border-dashed' : 'border-l-4'}`}
                      style={{
                        top: `${topPx}px`,
                        height: `${heightPx}px`,
                        left: `${left}%`,
                        width: `${width}%`,
                        ...(isGoogle && !isConfirmed ? { borderColor: borderColor } : { borderLeftColor: borderColor }),
                        backgroundColor: bgColor,
                        color: textColor,
                        zIndex: 10 + (item.startMinutes % 60),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isGoogle) handleGoogleEventClick(item as CalendarEvent, e);
                        else handleAppointmentClick(item as Appointment, e);
                      }}
                    >
                      <div className="font-semibold text-sm truncate leading-tight flex items-center gap-1">
                        {isGoogle && <GoogleEventBadge small />}
                        {!isGoogle && item.metadata?.source === 'nina_ai' && <Bot className="w-3 h-3 flex-shrink-0" />}
                        {item.title || item.summary}
                      </div>
                      {heightPx > 36 && (
                        <div className="text-xs opacity-80 whitespace-nowrap mt-0.5">
                          {isGoogle ? `${item.startTime} - ${item.endTime}` : `${item.time} - ${calculateEndTime(item.time, item.duration)}`}
                        </div>
                      )}
                      {heightPx > 56 && !isGoogle && (
                        <div className="text-[10px] opacity-60 uppercase tracking-wider font-bold mt-0.5">{item.type} • {item.duration}min</div>
                      )}
                      {heightPx > 56 && isGoogle && item.calendarName && (
                        <div className="text-[10px] opacity-60 mt-0.5">{item.calendarName}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 h-full flex flex-col bg-slate-950 text-slate-50">
      {/* Header */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-3xl font-bold text-white flex items-center gap-2">
            <CalendarIcon className="w-8 h-8 text-cyan-500" />
            Agendamentos
          </h2>
          <p className="text-slate-400 text-sm mt-1">Gerencie demos, reuniões e suporte técnico.</p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 w-full xl:w-auto">
          {/* Calendar Sidebar Toggle */}
          {gcalEnabled && (
            <button
              onClick={() => setShowCalendarSidebar(!showCalendarSidebar)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 border transition-all ${showCalendarSidebar ? 'bg-orange-500/10 text-orange-300 border-orange-500/30' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'}`}
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              Calendários
              {gcalLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            </button>
          )}

          {/* View Switcher */}
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button onClick={() => setViewMode('month')} className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all ${viewMode === 'month' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
              <LayoutGrid className="w-3.5 h-3.5" /> Mês
            </button>
            <button onClick={() => setViewMode('week')} className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all ${viewMode === 'week' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
              <Columns className="w-3.5 h-3.5" /> Semana
            </button>
            <button onClick={() => setViewMode('day')} className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all ${viewMode === 'day' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
              <List className="w-3.5 h-3.5" /> Dia
            </button>
          </div>

          {/* Date Nav */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button onClick={() => navigateDate(-1)} className="p-2 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex flex-col items-center justify-center w-48 px-2 cursor-pointer" onClick={goToToday} title="Ir para hoje">
              <span className="text-sm font-bold text-slate-200 capitalize">
                {viewMode === 'month' ? getMonthLabel() : viewMode === 'week' ? getWeekLabel() : getDayLabel()}
              </span>
              {viewMode === 'week' && <span className="text-[10px] text-slate-500">{currentDate.getFullYear()}</span>}
            </div>
            <button onClick={() => navigateDate(1)} className="p-2 hover:bg-slate-800 rounded-md text-slate-400 hover:text-white transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <Button onClick={() => { setSelectedDate(new Date().toISOString().split('T')[0]); setShowCreateModal(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Agendar
          </Button>
        </div>
      </div>

      {/* Main Area with optional sidebar */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Calendar Sidebar */}
        {gcalEnabled && showCalendarSidebar && (
          <div className="w-64 bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 overflow-y-auto custom-scrollbar flex-shrink-0">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Calendários Google</h3>
              <button onClick={refreshCalendars} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors" title="Atualizar">
                <RefreshCw className={`w-3.5 h-3.5 ${calendarsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {calendarsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : calendars.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhum calendário encontrado.</p>
            ) : (
              <div className="space-y-1">
                {calendars.map(cal => (
                  <label key={cal.id} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800/50 cursor-pointer transition-colors">
                    <Checkbox
                      checked={enabledCalendarIds.includes(cal.id)}
                      onCheckedChange={() => toggleCalendar(cal.id)}
                      className="border-slate-600"
                    />
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cal.backgroundColor }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-200 truncate">{cal.summary}</div>
                      {cal.primary && <span className="text-[10px] text-cyan-400 font-medium">Principal</span>}
                    </div>
                  </label>
                ))}
              </div>
            )}

            {gcalLoading && (
              <div className="flex items-center gap-2 text-xs text-slate-500 pt-2 border-t border-slate-800">
                <Loader2 className="w-3 h-3 animate-spin" />
                Carregando eventos...
              </div>
            )}
          </div>
        )}

        {/* Main Calendar Area */}
        <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col relative">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
            </div>
          ) : (
            <>
              {viewMode === 'month' && (
                <>
                  <div className="grid grid-cols-7 border-b border-slate-800 bg-slate-900">
                    {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                      <div key={day} className="py-3 text-center text-sm font-semibold text-slate-500 uppercase tracking-wider">
                        {day}
                      </div>
                    ))}
                  </div>
                  {renderMonthView()}
                </>
              )}
              {viewMode === 'week' && renderWeekView()}
              {viewMode === 'day' && renderDayView()}
            </>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Novo Agendamento</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Data Selecionada</label>
                <div className="flex items-center gap-2 text-white font-medium bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <CalendarIcon className="w-4 h-4 text-cyan-500" />
                  {selectedDate?.split('-').reverse().join('/')}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Horário</label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input type="time" className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none" value={formData.time} onChange={e => setFormData({ ...formData, time: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Duração</label>
                  <select className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none appearance-none" value={formData.duration} onChange={e => setFormData({ ...formData, duration: parseInt(e.target.value) })}>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">1 hora</option>
                    <option value="90">1h 30min</option>
                    <option value="120">2 horas</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Tipo</label>
                <select className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none appearance-none" value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })}>
                  <option value="demo">Demo</option>
                  <option value="meeting">Reunião</option>
                  <option value="support">Suporte</option>
                  <option value="followup">Follow-up</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Título do Evento</label>
                <input required type="text" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600" placeholder="Ex: Apresentação para Cliente X" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Descrição</label>
                <div className="relative">
                  <AlignLeft className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                  <textarea className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600 resize-none h-24" placeholder="Detalhes adicionais..." value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Contato Vinculado</label>
                <div className="relative">
                  <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <select value={selectedContactId || ''} onChange={(e) => setSelectedContactId(e.target.value || null)} className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none appearance-none">
                    <option value="">Selecionar contato (opcional)</option>
                    {contacts.map(contact => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name || contact.phone} - {contact.phone}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Participantes Adicionais</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input type="text" name="attendees" className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600" placeholder="Ex: João Silva, Maria Santos" />
                </div>
                <p className="text-xs text-slate-500">Separe os nomes por vírgula</p>
              </div>

              <div className="pt-4 flex gap-3">
                <Button type="button" variant="ghost" onClick={() => setShowCreateModal(false)} className="flex-1 border border-slate-700 hover:bg-slate-800">Cancelar</Button>
                <Button type="submit" disabled={isSaving} className="flex-1">
                  {isSaving ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Appointment Details Modal (local) */}
      {selectedAppointment && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
            <div className={`p-6 border-b border-slate-800 relative overflow-hidden ${getEventTypeColor(selectedAppointment.type).replace('text-', 'bg-').replace('/10', '/5')}`}>
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <CalendarIcon className="w-32 h-32" />
              </div>
              <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${getEventTypeColor(selectedAppointment.type)}`}>
                      {selectedAppointment.type}
                    </span>
                    {selectedAppointment.metadata?.source === 'nina_ai' && (
                      <span className="px-2 py-1 rounded text-[10px] font-bold uppercase border bg-cyan-500/10 text-cyan-300 border-cyan-500/30 flex items-center gap-1">
                        <Bot className="w-3 h-3" /> Criado por IA
                      </span>
                    )}
                    {(selectedAppointment.metadata as any)?.source === 'calendly' && (
                      <span className="px-2 py-1 rounded text-[10px] font-bold uppercase border bg-orange-500/10 text-orange-300 border-orange-500/30 flex items-center gap-1">
                        <CalendarIcon className="w-3 h-3" /> Calendly
                      </span>
                    )}
                  </div>
                  <button onClick={() => setSelectedAppointment(null)} className="p-1 rounded-full bg-black/20 text-white hover:bg-black/40 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">{selectedAppointment.title}</h3>
                <div className="flex items-center gap-4 text-sm text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-cyan-500" />
                    {selectedAppointment.time} - {calculateEndTime(selectedAppointment.time, selectedAppointment.duration)} ({selectedAppointment.duration}min)
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CalendarIcon className="w-4 h-4 text-cyan-500" />
                    {selectedAppointment.date.split('-').reverse().join('/')}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6 flex-1">
              {selectedAppointment.description && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Descrição</h4>
                  <p className="text-sm text-slate-300 leading-relaxed bg-slate-950 p-3 rounded-lg border border-slate-800">{selectedAppointment.description}</p>
                </div>
              )}

              {selectedAppointment.contact_id && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Contato Vinculado</h4>
                  <div className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-lg border border-slate-700">
                    <UserCircle className="w-5 h-5 text-cyan-500" />
                    <div className="flex-1">
                      <span className="text-sm text-white font-medium">{selectedAppointment.contact?.name || 'Contato'}</span>
                      <span className="text-xs text-slate-400 ml-2">{selectedAppointment.contact?.phone_number}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Participantes</h4>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedAppointment.attendees && selectedAppointment.attendees.length > 0 ? (
                    selectedAppointment.attendees.map((attendee, i) => (
                      <div key={i} className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
                        <div className="w-5 h-5 rounded-full bg-cyan-600 flex items-center justify-center text-[10px] text-white font-bold">
                          {attendee.charAt(0)}
                        </div>
                        <span className="text-xs text-slate-200">{attendee}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-sm text-slate-500">Nenhum participante adicional.</span>
                  )}
                </div>
              </div>

              {/* Closer info */}
              {(selectedAppointment.metadata as any)?.closer_name && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Closer Atribuído</h4>
                  <div className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-lg border border-slate-700">
                    <Users className="w-4 h-4 text-cyan-500" />
                    <span className="text-sm text-white font-medium">{(selectedAppointment.metadata as any).closer_name}</span>
                  </div>
                </div>
              )}

              {/* Calendly-specific info */}
              {((selectedAppointment.metadata as any)?.source === 'calendly' || (selectedAppointment.metadata as any)?.calendly_event_uri) && (
                <div className="space-y-3">
                  {/* Invitee status */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Status do Convite</h4>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const status = (selectedAppointment.metadata as any)?.invitee_status;
                        if (status === 'accepted') return <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">✓ Confirmado</span>;
                        if (status === 'canceled') return <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">✗ Cancelado</span>;
                        if (status === 'no_show') return <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">⚠ No-show</span>;
                        return <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-slate-500/10 text-slate-400 border border-slate-500/20">Pendente</span>;
                      })()}
                    </div>
                  </div>

                  {/* Meeting URL */}
                  {selectedAppointment.meeting_url && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Link da Reunião</h4>
                      <a
                        href={selectedAppointment.meeting_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-lg border border-slate-700 hover:border-cyan-500/50 transition-colors group"
                      >
                        <Video className="w-4 h-4 text-cyan-500" />
                        <span className="text-sm text-cyan-300 group-hover:text-cyan-200 truncate flex-1">{selectedAppointment.meeting_url}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400" />
                      </a>
                    </div>
                  )}

                  {/* Cancel reason */}
                  {(selectedAppointment.metadata as any)?.cancel_reason && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Motivo do Cancelamento</h4>
                      <p className="text-sm text-red-300 bg-red-950/30 p-3 rounded-lg border border-red-900/30">
                        {(selectedAppointment.metadata as any).cancel_reason}
                      </p>
                    </div>
                  )}

                  {/* Reschedule link */}
                  {(selectedAppointment.metadata as any)?.calendly_reschedule_url && (selectedAppointment.metadata as any)?.invitee_status !== 'canceled' && (
                    <a
                      href={(selectedAppointment.metadata as any).calendly_reschedule_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 bg-slate-800 px-3 py-2 rounded-lg border border-slate-700 hover:border-amber-500/50 transition-colors text-sm text-amber-300"
                    >
                      <RefreshCw className="w-4 h-4" /> Reagendar no Calendly
                    </a>
                  )}
                </div>
              )}

              {/* Non-Calendly meeting URL */}
              {!(selectedAppointment.metadata as any)?.calendly_event_uri && (selectedAppointment.metadata as any)?.source !== 'calendly' && selectedAppointment.meeting_url && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Link da Reunião</h4>
                  <a
                    href={selectedAppointment.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-lg border border-slate-700 hover:border-cyan-500/50 transition-colors group"
                  >
                    <Video className="w-4 h-4 text-cyan-500" />
                    <span className="text-sm text-cyan-300 group-hover:text-cyan-200 truncate flex-1">{selectedAppointment.meeting_url}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400" />
                  </a>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => handleDeleteAppointment(selectedAppointment.id)} className="flex-1 border-destructive text-destructive hover:bg-destructive/10">
                    Excluir
                  </Button>
                  <Button type="button" variant="outline" onClick={() => handleEditClick(selectedAppointment)} className="flex-1">
                    <Pencil className="w-4 h-4 mr-1" /> Editar
                  </Button>
                </div>
                {selectedAppointment.meeting_url ? (
                  <a href={selectedAppointment.meeting_url} target="_blank" rel="noopener noreferrer" className="w-full">
                    <Button className="w-full shadow-lg shadow-cyan-500/20 py-3" size="lg">
                      <Video className="w-5 h-5 mr-2" /> Entrar na Reunião
                    </Button>
                  </a>
                ) : (
                  <Button className="w-full shadow-lg shadow-cyan-500/20 py-3" size="lg" onClick={() => navigate(`/meeting/${selectedAppointment.id}`)}>
                    <Video className="w-5 h-5 mr-2" /> Entrar na Sala de Reunião
                  </Button>
                )}
                <p className="text-center text-xs text-slate-500">A sala estará disponível 5 minutos antes do horário.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Google Calendar Event Details Modal */}
      {selectedGoogleEvent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-slate-800 relative overflow-hidden" style={{ backgroundColor: selectedGoogleEvent.color ? `${selectedGoogleEvent.color}10` : 'rgba(251,146,60,0.05)' }}>
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <CalendarIcon className="w-32 h-32" />
              </div>
              <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded text-[10px] font-bold uppercase border border-dashed flex items-center gap-1" style={{ borderColor: selectedGoogleEvent.color || '#fb923c', color: selectedGoogleEvent.color || '#fb923c' }}>
                      <CalendarIcon className="w-3 h-3" /> Google Calendar
                    </span>
                    {selectedGoogleEvent.calendarName && (
                      <span className="px-2 py-1 rounded text-[10px] font-bold uppercase border border-slate-700 text-slate-400">
                        {selectedGoogleEvent.calendarName}
                      </span>
                    )}
                  </div>
                  <button onClick={() => setSelectedGoogleEvent(null)} className="p-1 rounded-full bg-black/20 text-white hover:bg-black/40 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">{selectedGoogleEvent.title}</h3>
                <div className="flex items-center gap-4 text-sm text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" style={{ color: selectedGoogleEvent.color || '#fb923c' }} />
                    {selectedGoogleEvent.startTime} - {selectedGoogleEvent.endTime} ({selectedGoogleEvent.duration}min)
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CalendarIcon className="w-4 h-4" style={{ color: selectedGoogleEvent.color || '#fb923c' }} />
                    {selectedGoogleEvent.date.split('-').reverse().join('/')}
                  </div>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 flex-1 max-h-[50vh] overflow-y-auto custom-scrollbar">
              {selectedGoogleEvent.description && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Descrição</h4>
                  <div className="text-sm text-slate-300 leading-relaxed bg-slate-950 p-3 rounded-lg border border-slate-800 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: selectedGoogleEvent.description }} />
                </div>
              )}

              {selectedGoogleEvent.attendees && selectedGoogleEvent.attendees.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> Participantes ({selectedGoogleEvent.attendees.length})
                  </h4>
                  <div className="space-y-1">
                    {selectedGoogleEvent.attendees.map((att, i) => (
                      <div key={i} className="flex items-center gap-2 bg-slate-800/50 px-3 py-2 rounded-lg">
                        <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-white font-bold">
                          {(att.displayName || att.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-slate-200 truncate block">{att.displayName || att.email}</span>
                          {att.displayName && <span className="text-[10px] text-slate-500 truncate block">{att.email}</span>}
                        </div>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${att.responseStatus === 'accepted' ? 'text-emerald-400 bg-emerald-500/10' : att.responseStatus === 'declined' ? 'text-red-400 bg-red-500/10' : 'text-slate-400 bg-slate-700'}`}>
                          {att.responseStatus === 'accepted' ? 'Confirmado' : att.responseStatus === 'declined' ? 'Recusado' : att.responseStatus === 'tentative' ? 'Talvez' : 'Pendente'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {selectedGoogleEvent.meetLink && (
                  <a
                    href={selectedGoogleEvent.meetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 rounded-lg transition-colors"
                  >
                    <Video className="w-5 h-5" /> Entrar com Google Meet
                  </a>
                )}
                {selectedGoogleEvent.htmlLink && (
                  <a
                    href={selectedGoogleEvent.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-medium py-2.5 rounded-lg border border-slate-700 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" /> Abrir no Google Calendar
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Appointment Modal */}
      {showEditModal && selectedAppointment && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-gradient-to-r from-cyan-950/30 to-slate-900">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/10 rounded-lg">
                  <Pencil className="w-5 h-5 text-cyan-400" />
                </div>
                <h2 className="text-lg font-bold text-white">Editar Agendamento</h2>
              </div>
              <button onClick={() => { setShowEditModal(false); setSelectedAppointment(null); }} className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Data</label>
                  <div className="relative">
                    <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input type="date" required className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none" value={editFormData.date} onChange={e => setEditFormData({ ...editFormData, date: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Horário</label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input type="time" className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none" value={editFormData.time} onChange={e => setEditFormData({ ...editFormData, time: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Duração</label>
                  <select className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none appearance-none" value={editFormData.duration} onChange={e => setEditFormData({ ...editFormData, duration: parseInt(e.target.value) })}>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">1 hora</option>
                    <option value="90">1h 30min</option>
                    <option value="120">2 horas</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Tipo</label>
                  <select className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none appearance-none" value={editFormData.type} onChange={e => setEditFormData({ ...editFormData, type: e.target.value })}>
                    <option value="demo">Demo</option>
                    <option value="meeting">Reunião</option>
                    <option value="support">Suporte</option>
                    <option value="followup">Follow-up</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Título do Evento</label>
                <input required type="text" className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600" placeholder="Ex: Apresentação para Cliente X" value={editFormData.title} onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })} />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Descrição</label>
                <div className="relative">
                  <AlignLeft className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                  <textarea className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-3 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600 resize-none h-24" placeholder="Detalhes adicionais..." value={editFormData.description} onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Contato Vinculado</label>
                <div className="relative">
                  <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <select value={editContactId || ''} onChange={(e) => setEditContactId(e.target.value || null)} className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none appearance-none">
                    <option value="">Selecionar contato (opcional)</option>
                    {contacts.map(contact => (
                      <option key={contact.id} value={contact.id}>{contact.name || contact.phone} - {contact.phone}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-slate-500 tracking-wider">Participantes Adicionais</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input type="text" className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white focus:ring-1 focus:ring-cyan-500 outline-none placeholder:text-slate-600" placeholder="Ex: João Silva, Maria Santos" value={editFormData.attendees} onChange={(e) => setEditFormData({ ...editFormData, attendees: e.target.value })} />
                </div>
                <p className="text-xs text-slate-500">Separe os nomes por vírgula</p>
              </div>

              <div className="pt-4 flex gap-3">
                <Button type="button" variant="ghost" onClick={() => { setShowEditModal(false); setSelectedAppointment(null); }} className="flex-1 border border-slate-700 hover:bg-slate-800">Cancelar</Button>
                <Button type="submit" disabled={isSaving} className="flex-1">
                  {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scheduling;
