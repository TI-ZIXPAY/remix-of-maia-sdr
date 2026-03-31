import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  BarChart3, Loader2, TrendingUp, TrendingDown, Users, CalendarDays,
  PhoneForwarded, Clock, Target, Flame, Snowflake, ThermometerSun,
  CalendarIcon, Filter, Activity, DollarSign, MessageSquare, ArrowUpRight
} from 'lucide-react';
import {
  BarChart, Bar, Area, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { api } from '../services/api';
import { StatMetric } from '../types';
import { OnboardingBanner } from './OnboardingBanner';
import { SystemHealthCard } from './SystemHealthCard';
import { useOutletContext } from 'react-router-dom';

interface OutletContext {
  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;
}

// ─── Types ───────────────────────────────────────────────────
type PeriodPreset = 'today' | '7days' | '30days' | 'custom';

interface Filters {
  period: PeriodPreset;
  startDate: Date;
  endDate: Date;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
}

interface ClassificationCount {
  classification: string;
  count: number;
}

interface FunnelStage {
  title: string;
  count: number;
  color: string;
  position: number;
}

interface HandoffEntry {
  contactName: string;
  phone: string;
  reason: string;
  date: string;
}

interface AppointmentDay {
  date: string;
  label: string;
  count: number;
}

// ─── Helpers ─────────────────────────────────────────────────
const periodPresets: { key: PeriodPreset; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: '7days', label: '7 Dias' },
  { key: '30days', label: '30 Dias' },
  { key: 'custom', label: 'Custom' },
];

const periodDays: Record<string, number> = {
  today: 1,
  '7days': 7,
  '30days': 30,
};

const classificationLabels: Record<string, string> = {
  new: 'Novo',
  mql: 'MQL',
  sql: 'SQL',
  dq: 'Desqualificado',
  won: 'Ganho',
  lost: 'Perdido',
};

const classificationColors: Record<string, string> = {
  new: 'hsl(220, 15%, 50%)',
  mql: 'hsl(45, 90%, 55%)',
  sql: 'hsl(14, 85%, 52%)',
  dq: 'hsl(0, 60%, 50%)',
  won: 'hsl(145, 65%, 45%)',
  lost: 'hsl(0, 40%, 40%)',
};

const getScoreColor = (score: number) => {
  if (score <= 30) return { color: 'hsl(200, 80%, 55%)', label: 'Frio', Icon: Snowflake };
  if (score <= 60) return { color: 'hsl(45, 90%, 55%)', label: 'Morno', Icon: ThermometerSun };
  return { color: 'hsl(0, 75%, 55%)', label: 'Quente', Icon: Flame };
};

const getDatesForPreset = (preset: PeriodPreset): { start: Date; end: Date } => {
  const end = endOfDay(new Date());
  switch (preset) {
    case 'today': return { start: startOfDay(new Date()), end };
    case '7days': return { start: startOfDay(subDays(new Date(), 6)), end };
    case '30days': return { start: startOfDay(subDays(new Date(), 29)), end };
    default: return { start: startOfDay(subDays(new Date(), 6)), end };
  }
};

const getMetricIcon = (label: string) => {
  if (label.includes('Conversões')) return <DollarSign className="h-5 w-5 text-emerald-400" />;
  if (label.includes('Atendimentos')) return <MessageSquare className="h-5 w-5 text-primary" />;
  if (label.includes('Leads')) return <Users className="h-5 w-5 text-violet-400" />;
  return <Activity className="h-5 w-5 text-primary" />;
};

const getMetricGradient = (label: string) => {
  if (label.includes('Conversões')) return 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20';
  if (label.includes('Atendimentos')) return 'from-primary/20 to-primary/5 border-primary/20';
  if (label.includes('Leads')) return 'from-violet-500/20 to-violet-500/5 border-violet-500/20';
  return 'from-primary/20 to-primary/5 border-primary/20';
};

// ─── Component ───────────────────────────────────────────────
const Reports: React.FC = () => {
  const { setShowOnboarding } = useOutletContext<OutletContext>();
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(() => {
    const { start, end } = getDatesForPreset('7days');
    return { period: '7days', startDate: start, endDate: end, utmSource: '', utmMedium: '', utmCampaign: '' };
  });

  // Dashboard data
  const [metrics, setMetrics] = useState<StatMetric[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);

  // UTM options
  const [utmSources, setUtmSources] = useState<string[]>([]);
  const [utmMediums, setUtmMediums] = useState<string[]>([]);
  const [utmCampaigns, setUtmCampaigns] = useState<string[]>([]);

  // Reports data
  const [avgScore, setAvgScore] = useState(0);
  const [prevAvgScore, setPrevAvgScore] = useState(0);
  const [classifications, setClassifications] = useState<ClassificationCount[]>([]);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [followupCount, setFollowupCount] = useState(0);
  const [appointmentsToday, setAppointmentsToday] = useState(0);
  const [handoffCount, setHandoffCount] = useState(0);
  const [totalLeads, setTotalLeads] = useState(0);
  const [leadsWithAppointment, setLeadsWithAppointment] = useState(0);
  const [appointmentsByDay, setAppointmentsByDay] = useState<AppointmentDay[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffEntry[]>([]);

  // Fetch UTM options once
  useEffect(() => {
    const fetchUTMs = async () => {
      const { data } = await supabase
        .from('contacts')
        .select('utm_source, utm_medium, utm_campaign')
        .limit(1000);
      if (data) {
        const sources = new Set<string>();
        const mediums = new Set<string>();
        const campaigns = new Set<string>();
        data.forEach((c: any) => {
          if (c.utm_source) sources.add(c.utm_source);
          if (c.utm_medium) mediums.add(c.utm_medium);
          if (c.utm_campaign) campaigns.add(c.utm_campaign);
        });
        setUtmSources(Array.from(sources).sort());
        setUtmMediums(Array.from(mediums).sort());
        setUtmCampaigns(Array.from(campaigns).sort());
      }
    };
    fetchUTMs();
  }, []);

  const setPeriodPreset = useCallback((preset: PeriodPreset) => {
    if (preset === 'custom') {
      setFilters(f => ({ ...f, period: 'custom' }));
      return;
    }
    const { start, end } = getDatesForPreset(preset);
    setFilters(f => ({ ...f, period: preset, startDate: start, endDate: end }));
  }, []);

  // Main data fetch (dashboard + reports)
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const startStr = filters.startDate.toISOString();
      const endStr = filters.endDate.toISOString();
      const days = periodDays[filters.period] || 7;

      // Previous period for trend
      const periodMs = filters.endDate.getTime() - filters.startDate.getTime();
      const prevStart = new Date(filters.startDate.getTime() - periodMs);
      const prevStartStr = prevStart.toISOString();

      const applyUtm = (query: any) => {
        if (filters.utmSource) query = query.eq('utm_source', filters.utmSource);
        if (filters.utmMedium) query = query.eq('utm_medium', filters.utmMedium);
        if (filters.utmCampaign) query = query.eq('utm_campaign', filters.utmCampaign);
        return query;
      };

      try {
        // Fetch dashboard metrics + chart data in parallel with reports data
        const [metricsData, chartDataResponse] = await Promise.all([
          api.fetchDashboardMetrics(days),
          api.fetchChartData(days)
        ]);
        setMetrics(metricsData);
        setChartData(chartDataResponse);

        // ── 1. Lead score + classifications ────
        let contactsQuery = supabase
          .from('contacts')
          .select('lead_score, lead_classification')
          .gte('created_at', startStr)
          .lte('created_at', endStr);
        contactsQuery = applyUtm(contactsQuery);
        const { data: contactsData } = await contactsQuery;

        let prevContactsQuery = supabase
          .from('contacts')
          .select('lead_score')
          .gte('created_at', prevStartStr)
          .lt('created_at', startStr);
        prevContactsQuery = applyUtm(prevContactsQuery);
        const { data: prevContactsData } = await prevContactsQuery;

        const scores = (contactsData || []).map((c: any) => c.lead_score || 0);
        const avg = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;
        setAvgScore(avg);
        setTotalLeads(contactsData?.length || 0);

        const prevScores = (prevContactsData || []).map((c: any) => c.lead_score || 0);
        const prevAvg = prevScores.length > 0 ? Math.round(prevScores.reduce((a: number, b: number) => a + b, 0) / prevScores.length) : 0;
        setPrevAvgScore(prevAvg);

        const classMap = new Map<string, number>();
        (contactsData || []).forEach((c: any) => {
          const cl = c.lead_classification || 'new';
          classMap.set(cl, (classMap.get(cl) || 0) + 1);
        });
        setClassifications(
          Array.from(classMap.entries()).map(([classification, count]) => ({ classification, count }))
            .sort((a, b) => b.count - a.count)
        );

        // ── 2. Funnel ────
        const [stagesRes, dealsRes] = await Promise.all([
          supabase.from('pipeline_stages').select('id, title, color, position').eq('is_active', true).order('position'),
          supabase.from('deals').select('stage_id').gte('created_at', startStr).lte('created_at', endStr),
        ]);
        const dealCounts = new Map<string, number>();
        (dealsRes.data || []).forEach((d: any) => {
          dealCounts.set(d.stage_id, (dealCounts.get(d.stage_id) || 0) + 1);
        });
        setFunnel(
          (stagesRes.data || []).map((s: any) => ({
            title: s.title,
            count: dealCounts.get(s.id) || 0,
            color: s.color,
            position: s.position,
          }))
        );

        // ── 3. Metrics cards ────
        const [followupRes, appointmentsTodayRes, handoffStageRes, appointmentsWithContactRes] = await Promise.all([
          supabase.from('followup_executions').select('id', { count: 'exact', head: true })
            .eq('status', 'scheduled').gte('scheduled_for', startStr),
          supabase.from('appointments').select('id', { count: 'exact', head: true })
            .eq('date', format(new Date(), 'yyyy-MM-dd')),
          supabase.from('pipeline_stages').select('id').ilike('title', '%Transferido%').limit(1).single(),
          supabase.from('appointments').select('contact_id').gte('created_at', startStr).lte('created_at', endStr),
        ]);

        setFollowupCount(followupRes.count || 0);
        setAppointmentsToday(appointmentsTodayRes.count || 0);

        const uniqueContactsWithAppt = new Set((appointmentsWithContactRes.data || []).map((a: any) => a.contact_id));
        setLeadsWithAppointment(uniqueContactsWithAppt.size);

        const handoffStageId = handoffStageRes.data?.id;
        if (handoffStageId) {
          const { count } = await supabase.from('deals').select('id', { count: 'exact', head: true })
            .eq('stage_id', handoffStageId).gte('updated_at', startStr).lte('updated_at', endStr);
          setHandoffCount(count || 0);
        } else {
          setHandoffCount(0);
        }

        // ── 4. Appointments by day ────
        const { data: apptData } = await supabase
          .from('appointments')
          .select('date')
          .gte('date', format(filters.startDate, 'yyyy-MM-dd'))
          .lte('date', format(filters.endDate, 'yyyy-MM-dd'));

        const apptMap = new Map<string, number>();
        (apptData || []).forEach((a: any) => {
          apptMap.set(a.date, (apptMap.get(a.date) || 0) + 1);
        });
        const days2: AppointmentDay[] = [];
        const cur = new Date(filters.startDate);
        while (cur <= filters.endDate) {
          const dateStr = format(cur, 'yyyy-MM-dd');
          days2.push({
            date: dateStr,
            label: format(cur, 'dd/MM', { locale: ptBR }),
            count: apptMap.get(dateStr) || 0,
          });
          cur.setDate(cur.getDate() + 1);
        }
        setAppointmentsByDay(days2);

        // ── 5. Handoffs table ────
        if (handoffStageId) {
          const { data: handoffDeals } = await supabase
            .from('deals')
            .select('contact_id, updated_at, notes')
            .eq('stage_id', handoffStageId)
            .gte('updated_at', startStr)
            .order('updated_at', { ascending: false })
            .limit(20);

          if (handoffDeals && handoffDeals.length > 0) {
            const contactIds = handoffDeals.map((d: any) => d.contact_id).filter(Boolean);
            const { data: contactsInfo } = await supabase
              .from('contacts')
              .select('id, name, phone_number, call_name')
              .in('id', contactIds);

            const contactMap = new Map((contactsInfo || []).map((c: any) => [c.id, c]));
            setHandoffs(
              handoffDeals.map((d: any) => {
                const contact = contactMap.get(d.contact_id);
                return {
                  contactName: contact?.name || contact?.call_name || 'Sem nome',
                  phone: contact?.phone_number || '-',
                  reason: d.notes?.includes('inactivity') ? 'Inatividade' : 'Solicitação do cliente',
                  date: format(new Date(d.updated_at), "dd/MM/yy HH:mm"),
                };
              })
            );
          } else {
            setHandoffs([]);
          }
        }
      } catch (err) {
        console.error('[Reports] Error loading data:', err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [filters.startDate, filters.endDate, filters.utmSource, filters.utmMedium, filters.utmCampaign, filters.period]);

  const schedulingRate = totalLeads > 0 ? Math.round((leadsWithAppointment / totalLeads) * 100) : 0;
  const scoreTrend = avgScore - prevAvgScore;
  const scoreInfo = getScoreColor(avgScore);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
            <Loader2 className="h-10 w-10 animate-spin text-primary relative z-10" />
          </div>
          <p className="text-sm text-muted-foreground font-medium animate-pulse">Carregando insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 md:space-y-8 overflow-y-auto h-full bg-background text-foreground custom-scrollbar">
      {/* Onboarding Banner */}
      <OnboardingBanner onOpenWizard={() => setShowOnboarding(true)} />

      {/* System Health Card */}
      <SystemHealthCard />

      {/* ─── Header + Filters ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h2>
          <p className="text-muted-foreground mt-1">
            Visão geral da performance da sua IA {filters.period === 'today' ? 'hoje' : `nos últimos ${filters.period === '7days' ? '7 dias' : '30 dias'}`}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Period presets */}
          <div className="flex items-center gap-1 bg-card p-1 rounded-lg border border-border">
            {periodPresets.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriodPreset(p.key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  filters.period === p.key
                    ? 'bg-secondary text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date pickers */}
          {filters.period === 'custom' && (
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-card border border-border text-foreground hover:bg-secondary transition-colors">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {format(filters.startDate, 'dd/MM/yyyy')}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={filters.startDate}
                    onSelect={d => d && setFilters(f => ({ ...f, startDate: startOfDay(d) }))}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground text-xs">até</span>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-card border border-border text-foreground hover:bg-secondary transition-colors">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {format(filters.endDate, 'dd/MM/yyyy')}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={filters.endDate}
                    onSelect={d => d && setFilters(f => ({ ...f, endDate: endOfDay(d) }))}
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* UTM Filters */}
          {(utmSources.length > 0 || utmMediums.length > 0 || utmCampaigns.length > 0) && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              <Filter className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              {utmSources.length > 0 && (
                <select
                  value={filters.utmSource}
                  onChange={e => setFilters(f => ({ ...f, utmSource: e.target.value }))}
                  className="bg-card border border-border rounded-md px-2 py-1.5 text-xs text-foreground flex-shrink-0"
                >
                  <option value="">Todos Sources</option>
                  {utmSources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              {utmMediums.length > 0 && (
                <select
                  value={filters.utmMedium}
                  onChange={e => setFilters(f => ({ ...f, utmMedium: e.target.value }))}
                  className="bg-card border border-border rounded-md px-2 py-1.5 text-xs text-foreground flex-shrink-0"
                >
                  <option value="">Todos Mediums</option>
                  {utmMediums.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              {utmCampaigns.length > 0 && (
                <select
                  value={filters.utmCampaign}
                  onChange={e => setFilters(f => ({ ...f, utmCampaign: e.target.value }))}
                  className="bg-card border border-border rounded-md px-2 py-1.5 text-xs text-foreground flex-shrink-0"
                >
                  <option value="">Todas Campaigns</option>
                  {utmCampaigns.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Dashboard Metric Cards ─── */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((stat, index) => (
          <div
            key={index}
            className={cn(
              'relative overflow-hidden rounded-2xl border bg-card/50 backdrop-blur-sm p-6 shadow-xl transition-all duration-300 hover:translate-y-[-2px] hover:bg-card group',
              getMetricGradient(stat.label)
            )}
          >
            <div className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="text-sm font-medium text-muted-foreground">{stat.label}</div>
              <div className="p-2 rounded-lg bg-secondary/50 border border-border group-hover:border-muted transition-colors">
                {getMetricIcon(stat.label)}
              </div>
            </div>
            <div className="flex items-end justify-between">
              <div className="text-3xl font-bold text-foreground tracking-tight">{stat.value}</div>
              <div className={cn(
                'flex items-center text-xs font-medium px-2 py-1 rounded-full',
                stat.trendUp
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
              )}>
                {stat.trendUp ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                {stat.trend}
              </div>
            </div>
            <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-white/5 blur-2xl rounded-full group-hover:bg-white/10 transition-all" />
          </div>
        ))}
      </div>

      {/* ─── Dashboard Charts ─── */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-7">
        {/* Volume de Atendimentos */}
        <div className="col-span-1 md:col-span-4 rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-4 md:p-6 shadow-lg">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Volume de Atendimentos</h3>
              <p className="text-sm text-muted-foreground">
                Interações da IA {filters.period === 'today' ? 'hoje' : `nos últimos ${periodDays[filters.period] || 7} dias`}
              </p>
            </div>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorChats" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(24 95% 53%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(24 95% 53%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(255 25% 16%)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tickMargin={10} fontSize={12} stroke="hsl(255 15% 65%)" />
                <YAxis axisLine={false} tickLine={false} fontSize={12} stroke="hsl(255 15% 65%)" />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(255 35% 12%)', borderRadius: '12px', border: '1px solid hsl(255 25% 16%)', color: '#f8fafc', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' }}
                  itemStyle={{ color: 'hsl(24 95% 53%)' }}
                />
                <Area
                  type="monotone"
                  dataKey="chats"
                  stroke="hsl(24 95% 53%)"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorChats)"
                  activeDot={{ r: 6, strokeWidth: 0, fill: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Conversões */}
        <div className="col-span-1 md:col-span-3 rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-4 md:p-6 shadow-lg flex flex-col">
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-foreground">Conversões</h3>
            <p className="text-sm text-muted-foreground">Reuniões, vendas e ações concluídas</p>
          </div>
          <div className="flex-1 flex flex-col justify-center space-y-5">
            {chartData.slice(0, 5).map((day, i) => (
              <div key={i} className="group">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground/80">{day.name}</span>
                  <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">{day.sales} conv.</span>
                </div>
                <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary to-orange-400 rounded-full shadow-[0_0_10px_hsl(24_95%_53%/0.3)] transition-all duration-1000 ease-out group-hover:shadow-[0_0_15px_hsl(24_95%_53%/0.6)]"
                    style={{ width: `${Math.min((day.sales / Math.max(...chartData.map((d: any) => d.sales), 1)) * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-4 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total no período</span>
              <span className="text-emerald-400 font-bold">
                {chartData.reduce((sum, d) => sum + d.sales, 0)} conversões
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Termômetro de Leads ─── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-6 shadow-lg flex flex-col items-center justify-center">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Lead Score Médio</h3>
          <div className="relative w-40 h-40">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="hsl(var(--secondary))" strokeWidth="10" />
              <circle
                cx="60" cy="60" r="52"
                fill="none"
                stroke={scoreInfo.color}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${(avgScore / 100) * 327} 327`}
                className="transition-all duration-1000"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <scoreInfo.Icon className="w-5 h-5 mb-1" style={{ color: scoreInfo.color }} />
              <span className="text-3xl font-bold text-foreground">{avgScore}</span>
              <span className="text-xs font-medium" style={{ color: scoreInfo.color }}>{scoreInfo.label}</span>
            </div>
          </div>
          <div className={cn(
            'flex items-center gap-1 mt-3 text-xs font-medium px-2 py-1 rounded-full',
            scoreTrend >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
          )}>
            {scoreTrend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {scoreTrend >= 0 ? '+' : ''}{scoreTrend} vs período anterior
          </div>
        </div>

        <div className="lg:col-span-2 rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-6 shadow-lg">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Distribuição por Classificação</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {(['new', 'mql', 'sql', 'dq', 'won', 'lost'] as const).map(cl => {
              const item = classifications.find(c => c.classification === cl);
              const count = item?.count || 0;
              const pct = totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0;
              return (
                <div key={cl} className="flex flex-col gap-2 p-3 rounded-xl bg-secondary/30 border border-border/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">{classificationLabels[cl]}</span>
                    <span className="text-xs font-bold" style={{ color: classificationColors[cl] }}>{pct}%</span>
                  </div>
                  <span className="text-2xl font-bold text-foreground">{count}</span>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, backgroundColor: classificationColors[cl] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── Métricas Rápidas ─── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Follow-ups Agendados', value: followupCount, icon: Clock, gradient: 'from-blue-500/20 to-blue-500/5 border-blue-500/20', iconColor: 'text-blue-400' },
          { label: 'Reuniões Hoje', value: appointmentsToday, icon: CalendarDays, gradient: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/20', iconColor: 'text-emerald-400' },
          { label: 'Transferidos p/ Humano', value: handoffCount, icon: PhoneForwarded, gradient: 'from-amber-500/20 to-amber-500/5 border-amber-500/20', iconColor: 'text-amber-400' },
          { label: 'Taxa de Agendamento', value: `${schedulingRate}%`, icon: Target, gradient: 'from-violet-500/20 to-violet-500/5 border-violet-500/20', iconColor: 'text-violet-400' },
        ].map((card, i) => (
          <div
            key={i}
            className={cn(
              'relative overflow-hidden rounded-2xl border bg-card/50 backdrop-blur-sm p-6 shadow-xl transition-all duration-300 hover:translate-y-[-2px] hover:bg-card group',
              card.gradient
            )}
          >
            <div className="flex items-center justify-between pb-3">
              <span className="text-sm font-medium text-muted-foreground">{card.label}</span>
              <div className="p-2 rounded-lg bg-secondary/50 border border-border">
                <card.icon className={cn('h-5 w-5', card.iconColor)} />
              </div>
            </div>
            <span className="text-3xl font-bold text-foreground">{card.value}</span>
            <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-white/5 blur-2xl rounded-full group-hover:bg-white/10 transition-all" />
          </div>
        ))}
      </div>

      {/* ─── Funil de Conversão ─── */}
      <div className="rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-foreground mb-1">Funil de Conversão</h3>
        <p className="text-sm text-muted-foreground mb-6">Deals por estágio do pipeline no período.</p>
        <div className="space-y-3">
          {funnel.map((stage, i) => {
            const maxCount = Math.max(...funnel.map(s => s.count), 1);
            const prevCount = i > 0 ? funnel[i - 1].count : 0;
            const convRate = i > 0 && prevCount > 0 ? Math.round((stage.count / prevCount) * 100) : null;
            return (
              <div key={stage.title} className="group">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{stage.title}</span>
                    {convRate !== null && (
                      <span className="text-[10px] font-medium text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded-full">
                        {convRate}% conv.
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-bold text-foreground">{stage.count}</span>
                </div>
                <div className="h-3 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 group-hover:opacity-90"
                    style={{
                      width: `${Math.max((stage.count / maxCount) * 100, 2)}%`,
                      backgroundColor: 'hsl(var(--primary))',
                      opacity: 1 - (i * 0.12),
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Reuniões por Dia + Handoffs ─── */}
      <div className="grid gap-6 lg:grid-cols-7">
        <div className="lg:col-span-4 rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-6 shadow-lg">
          <h3 className="text-lg font-semibold text-foreground mb-1">Reuniões por Dia</h3>
          <p className="text-sm text-muted-foreground mb-4">Agendamentos no período selecionado.</p>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={appointmentsByDay} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(220, 25%, 14%)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={11} stroke="hsl(215, 15%, 60%)" />
                <YAxis axisLine={false} tickLine={false} fontSize={11} stroke="hsl(215, 15%, 60%)" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(220, 35%, 10%)',
                    borderRadius: '12px',
                    border: '1px solid hsl(220, 25%, 14%)',
                    color: '#f8fafc',
                  }}
                />
                <Bar dataKey="count" name="Reuniões" radius={[6, 6, 0, 0]} maxBarSize={40}>
                  {appointmentsByDay.map((_, i) => (
                    <Cell key={i} fill="hsl(var(--primary))" fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-3 rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-6 shadow-lg">
          <h3 className="text-lg font-semibold text-foreground mb-1">Últimos Handoffs</h3>
          <p className="text-sm text-muted-foreground mb-4">Leads transferidos para atendimento humano.</p>
          {handoffs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <PhoneForwarded className="w-8 h-8 mb-2 opacity-40" />
              <span className="text-sm">Nenhum handoff no período</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-[260px] overflow-y-auto custom-scrollbar">
              {handoffs.map((h, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 border border-border/50 hover:bg-secondary/50 transition-colors">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{h.contactName}</span>
                    <span className="text-xs text-muted-foreground">{h.phone}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className={cn(
                      'text-[10px] font-medium px-2 py-0.5 rounded-full',
                      h.reason === 'Inatividade'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                    )}>
                      {h.reason}
                    </span>
                    <span className="text-xs text-muted-foreground mt-0.5">{h.date}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Reports;
