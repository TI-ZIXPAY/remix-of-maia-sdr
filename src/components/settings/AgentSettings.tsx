import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Bot, Loader2, Calendar, Wand2, Building2, RotateCcw, Info, Send, Plus, X, UserCheck } from 'lucide-react';
import ScoringVariablesSettings from './ScoringVariablesSettings';
import { Button } from '../Button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import PromptGeneratorSheet from './PromptGeneratorSheet';
import { DEFAULT_NINA_PROMPT } from '@/prompts/default-nina-prompt';
import { useAuth } from '@/hooks/useAuth';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DaySchedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

const DAYS_OF_WEEK = [
  { value: 0, label: 'Dom', fullLabel: 'Domingo' },
  { value: 1, label: 'Seg', fullLabel: 'Segunda' },
  { value: 2, label: 'Ter', fullLabel: 'Terça' },
  { value: 3, label: 'Qua', fullLabel: 'Quarta' },
  { value: 4, label: 'Qui', fullLabel: 'Quinta' },
  { value: 5, label: 'Sex', fullLabel: 'Sexta' },
  { value: 6, label: 'Sáb', fullLabel: 'Sábado' },
];

const DEFAULT_SCHEDULE: DaySchedule[] = DAYS_OF_WEEK.map(d => ({
  day_of_week: d.value,
  start_time: '09:00',
  end_time: d.value === 6 ? '13:00' : '18:00',
  is_active: d.value >= 1 && d.value <= 5,
}));

interface AgentSettingsData {
  id?: string;
  system_prompt_override: string | null;
  is_active: boolean;
  auto_response_enabled: boolean;
  ai_model_mode: 'flash' | 'flash3' | 'pro' | 'pro3' | 'adaptive';
  message_breaking_enabled: boolean;
  company_name: string | null;
  sdr_name: string | null;
  city: string | null;
  broker_name: string | null;
  broker_phone: string | null;
  ai_scheduling_enabled: boolean;
  auto_greeting_enabled: boolean;
  auto_greeting_message: string | null;
  auto_greeting_messages: string[];
  auto_greeting_delay_minutes: number;
  handoff_timeout_minutes: number;
  handoff_webhook_endpoint_id: string | null;
  handoff_team_id: string | null;
  business_hours_24h: boolean;
}

// Using shared prompt from @/prompts/default-nina-prompt

export interface AgentSettingsRef {
  save: () => Promise<void>;
  cancel: () => void;
  isSaving: boolean;
}

const AgentSettings = forwardRef<AgentSettingsRef, {}>((props, ref) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [settings, setSettings] = useState<AgentSettingsData>({
    system_prompt_override: null,
    is_active: true,
    auto_response_enabled: true,
    ai_model_mode: 'flash',
    message_breaking_enabled: true,
    company_name: null,
    sdr_name: null,
    city: null,
    broker_name: null,
    broker_phone: null,
    ai_scheduling_enabled: true,
    auto_greeting_enabled: false,
    auto_greeting_message: 'Olá! 👋 Vi que você demonstrou interesse em imóveis. Como posso te ajudar?',
    auto_greeting_messages: [],
    auto_greeting_delay_minutes: 10,
    handoff_timeout_minutes: 15,
    handoff_webhook_endpoint_id: null,
    handoff_team_id: null,
    business_hours_24h: false,
  });
  const [schedule, setSchedule] = useState<DaySchedule[]>(DEFAULT_SCHEDULE);
  const [webhookEndpoints, setWebhookEndpoints] = useState<{id: string, name: string}[]>([]);
  const [teams, setTeams] = useState<{id: string, name: string}[]>([]);
  const [customFields, setCustomFields] = useState<{field_key: string, field_label: string}[]>([]);

  useImperativeHandle(ref, () => ({
    save: handleSave,
    cancel: loadSettings,
    isSaving: saving
  }));

  useEffect(() => {
    if (user?.id) {
      loadSettings();
    }
  }, [user?.id]);

  const loadSettings = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    
    try {
      // Fetch global nina_settings (no user_id filter - single tenant)
      const { data, error } = await supabase
        .from('nina_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      // Se não existe registro, admin precisa configurar via onboarding
      if (!data) {
        console.log('[AgentSettings] No global settings found');
        setLoading(false);
        return;
      }

      // Load settings from global data
      setSettings({
        id: data.id,
        system_prompt_override: data.system_prompt_override,
        is_active: data.is_active,
        auto_response_enabled: data.auto_response_enabled,
        ai_model_mode: (['flash', 'flash3', 'pro', 'pro3', 'adaptive'].includes(data.ai_model_mode || '')) 
          ? (data.ai_model_mode as 'flash' | 'flash3' | 'pro' | 'pro3' | 'adaptive')
          : 'flash',
        message_breaking_enabled: data.message_breaking_enabled,
        company_name: data.company_name,
        sdr_name: data.sdr_name,
        city: (data as any).city ?? null,
        broker_name: (data as any).broker_name ?? null,
        broker_phone: (data as any).broker_phone ?? null,
        ai_scheduling_enabled: data.ai_scheduling_enabled ?? true,
        auto_greeting_enabled: (data as any).auto_greeting_enabled ?? false,
        auto_greeting_message: (data as any).auto_greeting_message ?? 'Olá! 👋 Vi que você demonstrou interesse em imóveis. Como posso te ajudar?',
        auto_greeting_messages: Array.isArray((data as any).auto_greeting_messages) ? (data as any).auto_greeting_messages : [],
        auto_greeting_delay_minutes: (data as any).auto_greeting_delay_minutes ?? 10,
        handoff_timeout_minutes: (data as any).handoff_timeout_minutes ?? 15,
        handoff_webhook_endpoint_id: (data as any).handoff_webhook_endpoint_id ?? null,
        handoff_team_id: (data as any).handoff_team_id ?? null,
        business_hours_24h: (data as any).business_hours_24h ?? false,
      });

      // Load per-day schedule
      const { data: scheduleData, error: scheduleError } = await supabase
        .from('business_hours_schedule')
        .select('*')
        .order('day_of_week', { ascending: true });

      if (!scheduleError && scheduleData && scheduleData.length > 0) {
        setSchedule(scheduleData.map(s => ({
          day_of_week: s.day_of_week,
          start_time: String(s.start_time).substring(0, 5),
          end_time: String(s.end_time).substring(0, 5),
          is_active: s.is_active ?? true,
        })));
      }

      // Load webhook endpoints, teams and custom fields for handoff config
      const [{ data: epData }, { data: tmData }, { data: cfData }] = await Promise.all([
        supabase.from('webhook_endpoints').select('id, name').eq('enabled', true).order('name'),
        supabase.from('teams').select('id, name').eq('is_active', true).order('name'),
        supabase.from('contact_custom_fields').select('field_key, field_label').eq('is_active', true).order('position'),
      ]);
      setWebhookEndpoints(epData || []);
      setTeams(tmData || []);
      setCustomFields(cfData || []);
    } catch (error) {
      console.error('[AgentSettings] Error loading settings:', error);
      toast.error('Erro ao carregar configurações do agente');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update global settings
      const activeDays = schedule.filter(s => s.is_active).map(s => s.day_of_week).sort();
      const firstActive = schedule.find(s => s.is_active);
      
      const { error } = await supabase
        .from('nina_settings')
        .update({
          system_prompt_override: settings.system_prompt_override,
          is_active: settings.is_active,
          auto_response_enabled: settings.auto_response_enabled,
          ai_model_mode: settings.ai_model_mode,
          message_breaking_enabled: settings.message_breaking_enabled,
          business_hours_start: firstActive?.start_time || '09:00',
          business_hours_end: firstActive?.end_time || '18:00',
          business_days: activeDays,
          company_name: settings.company_name,
          sdr_name: settings.sdr_name,
          city: settings.city,
          broker_name: settings.broker_name,
          broker_phone: settings.broker_phone,
          ai_scheduling_enabled: settings.ai_scheduling_enabled,
          auto_greeting_enabled: settings.auto_greeting_enabled,
          auto_greeting_message: settings.auto_greeting_messages.length > 0 ? settings.auto_greeting_messages[0] : settings.auto_greeting_message,
          auto_greeting_messages: settings.auto_greeting_messages,
          auto_greeting_delay_minutes: settings.auto_greeting_delay_minutes,
          handoff_timeout_minutes: settings.handoff_timeout_minutes,
          handoff_webhook_endpoint_id: settings.handoff_webhook_endpoint_id || null,
          handoff_team_id: settings.handoff_team_id || null,
          business_hours_24h: settings.business_hours_24h,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', settings.id!);

      if (error) throw error;

      // Upsert per-day schedule
      for (const day of schedule) {
        await supabase
          .from('business_hours_schedule')
          .upsert({
            day_of_week: day.day_of_week,
            start_time: day.start_time,
            end_time: day.end_time,
            is_active: day.is_active,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'day_of_week' });
      }

      toast.success('Configurações do agente salvas com sucesso!');
    } catch (error) {
      console.error('Error saving agent settings:', error);
      toast.error('Erro ao salvar configurações do agente');
    } finally {
      setSaving(false);
    }
  };

  const updateDaySchedule = (dayOfWeek: number, field: keyof DaySchedule, value: any) => {
    setSchedule(prev => prev.map(d => 
      d.day_of_week === dayOfWeek ? { ...d, [field]: value } : d
    ));
  };

  const handlePromptGenerated = (prompt: string) => {
    setSettings((prev: AgentSettingsData) => ({ ...prev, system_prompt_override: prompt }));
  };

  const handleRestoreDefault = () => {
    setSettings((prev: AgentSettingsData) => ({ ...prev, system_prompt_override: DEFAULT_NINA_PROMPT }));
    toast.success('Prompt restaurado para o padrão');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <>
      <PromptGeneratorSheet
        open={isGeneratorOpen}
        onOpenChange={setIsGeneratorOpen}
        onPromptGenerated={handlePromptGenerated}
      />
      
      <TooltipProvider>
      <div className="space-y-6">
        {/* System Prompt - PRIMEIRA SEÇÃO */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Bot className="w-5 h-5 text-cyan-400" />
              <h3 className="font-semibold text-white">Prompt do Sistema</h3>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRestoreDefault}
                className="text-slate-400 hover:text-white hover:bg-slate-700"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Restaurar Padrão
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsGeneratorOpen(true)}
                className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
              >
                <Wand2 className="w-4 h-4 mr-2" />
                Gerar com IA
              </Button>
            </div>
          </div>
          
          {/* Nota explicativa sobre o prompt */}
          <div className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
            <p className="flex items-start gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Template de exemplo:</strong> Este é um modelo inicial para você começar. 
                Personalize completamente com as informações da sua empresa, produtos, serviços e tom de comunicação.
              </span>
            </p>
          </div>
          
          <textarea
            value={settings.system_prompt_override || ''}
            onChange={(e) => setSettings({ ...settings, system_prompt_override: e.target.value || null })}
            placeholder="Cole ou escreva o prompt do agente aqui..."
            rows={12}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-y font-mono custom-scrollbar"
          />
          <details className="mt-3">
            <summary className="text-xs text-cyan-400 cursor-pointer hover:text-cyan-300 flex items-center gap-2">
              <span>📋</span> Variáveis dinâmicas disponíveis
            </summary>
            <div className="mt-2 p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono space-y-1">
              <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Sistema</div>
              <div><span className="text-cyan-400">{"{{ data_hora }}"}</span> → Data e hora atual</div>
              <div><span className="text-cyan-400">{"{{ data }}"}</span> → Apenas data</div>
              <div><span className="text-cyan-400">{"{{ hora }}"}</span> → Apenas hora</div>
              <div><span className="text-cyan-400">{"{{ dia_semana }}"}</span> → Dia da semana por extenso</div>
              <div><span className="text-cyan-400">{"{{ cliente_nome }}"}</span> → Nome do cliente na conversa</div>
              <div><span className="text-cyan-400">{"{{ cliente_telefone }}"}</span> → Telefone do cliente</div>
              <div><span className="text-cyan-400">{"{{ lead_classification }}"}</span> → Classificação do lead</div>
              <div className="text-slate-500 uppercase tracking-wider text-[10px] mt-3 mb-1 border-t border-slate-800 pt-2">Empresa / Corretor</div>
              <div><span className="text-blue-400">{"{{ nome_empresa }}"}</span> → Nome da empresa/imobiliária</div>
              <div><span className="text-blue-400">{"{{ nome_agente }}"}</span> → Nome do agente</div>
              <div><span className="text-blue-400">{"{{ cidade_atendimento }}"}</span> → Cidade de atuação</div>
              <div><span className="text-blue-400">{"{{ corretor_nome }}"}</span> → Nome do corretor responsável</div>
              <div><span className="text-blue-400">{"{{ corretor_telefone }}"}</span> → Telefone do corretor</div>
              {customFields.length > 0 && (
                <>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px] mt-3 mb-1 border-t border-slate-800 pt-2">Campos Personalizados</div>
                  {customFields.map(cf => (
                    <div key={cf.field_key}>
                      <span className="text-emerald-400">{`{{ ${cf.field_key} }}`}</span> → {cf.field_label}
                    </div>
                  ))}
                </>
              )}
            </div>
          </details>
        </div>

        {/* 2-Column Grid: Company Info + Business Hours */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Company Info */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Building2 className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold text-white">Informações da Empresa</h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Nome da Empresa <span className="text-amber-400 text-[10px]">(recomendado)</span>
                </label>
                <input
                  type="text"
                  value={settings.company_name || ''}
                  onChange={(e) => setSettings({ ...settings, company_name: e.target.value || null })}
                  placeholder="Nome da sua imobiliária"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Nome do Agente <span className="text-amber-400 text-[10px]">(recomendado)</span>
                </label>
                <input
                  type="text"
                  value={settings.sdr_name || ''}
                  onChange={(e) => setSettings({ ...settings, sdr_name: e.target.value || null })}
                  placeholder="Nome do agente (ex: Ana, Sofia)"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Cidade de Atuação
                </label>
                <input
                  type="text"
                  value={settings.city || ''}
                  onChange={(e) => setSettings({ ...settings, city: e.target.value || null })}
                  placeholder="Ex: São Paulo, Curitiba"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Nome do Corretor Responsável
                </label>
                <input
                  type="text"
                  value={settings.broker_name || ''}
                  onChange={(e) => setSettings({ ...settings, broker_name: e.target.value || null })}
                  placeholder="Corretor que assume após qualificação"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Telefone do Corretor
                </label>
                <input
                  type="text"
                  value={settings.broker_phone || ''}
                  onChange={(e) => setSettings({ ...settings, broker_phone: e.target.value || null })}
                  placeholder="Ex: (11) 99999-9999"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>
          </div>

          {/* Business Hours - Per Day */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-white">Horário de Atendimento</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">24h</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.business_hours_24h}
                    onChange={(e) => setSettings({ ...settings, business_hours_24h: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
                </label>
              </div>
            </div>
            {settings.business_hours_24h && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                <p className="text-xs text-indigo-300">✨ Modo 24h ativo — a IA responde a qualquer hora, todos os dias.</p>
              </div>
            )}
            <div className={`space-y-2 ${settings.business_hours_24h ? 'opacity-40 pointer-events-none' : ''}`}>
              {schedule.map(day => {
                const dayInfo = DAYS_OF_WEEK.find(d => d.value === day.day_of_week);
                return (
                  <div
                    key={day.day_of_week}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                      day.is_active
                        ? 'bg-slate-950/50 border border-slate-800'
                        : 'bg-slate-950/20 border border-slate-800/50 opacity-50'
                    }`}
                  >
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={day.is_active}
                        onChange={(e) => updateDaySchedule(day.day_of_week, 'is_active', e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[1px] after:start-[2px] after:bg-white after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-indigo-500"></div>
                    </label>
                    <span className="text-sm font-medium text-slate-300 w-10">{dayInfo?.label}</span>
                    {day.is_active ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="time"
                          value={day.start_time}
                          onChange={(e) => updateDaySchedule(day.day_of_week, 'start_time', e.target.value)}
                          className="h-7 w-24 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                        />
                        <span className="text-slate-500 text-xs">até</span>
                        <input
                          type="time"
                          value={day.end_time}
                          onChange={(e) => updateDaySchedule(day.day_of_week, 'end_time', e.target.value)}
                          className="h-7 w-24 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-600 italic">Fechado</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Saudação Automática */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Send className="w-5 h-5 text-emerald-400" />
              <h3 className="font-semibold text-white">Saudação Automática</h3>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.auto_greeting_enabled}
                onChange={(e) => setSettings({ ...settings, auto_greeting_enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            Quando ativado, leads que entrarem no pipeline e não tiverem nenhuma conversa aberta receberão automaticamente uma mensagem de saudação via WhatsApp após o tempo configurado. Use <code className="text-emerald-400">{"{{nome}}"}</code> para incluir o nome do lead.
          </p>
          
          <div className={`mb-4 ${!settings.auto_greeting_enabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className="text-xs text-slate-500 mb-1.5 block">Tempo de espera antes do envio</label>
            <div className="flex items-center gap-3">
              <select
                value={settings.auto_greeting_delay_minutes}
                onChange={(e) => setSettings({ ...settings, auto_greeting_delay_minutes: Number(e.target.value) })}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              >
                <option value={5}>5 minutos</option>
                <option value={10}>10 minutos</option>
                <option value={15}>15 minutos</option>
                <option value={20}>20 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={60}>1 hora</option>
                <option value={120}>2 horas</option>
              </select>
              <span className="text-xs text-slate-500">após o lead entrar no pipeline</span>
            </div>
          </div>
          
          <div className={`space-y-3 ${!settings.auto_greeting_enabled ? 'opacity-50 pointer-events-none' : ''}`}>
            {(settings.auto_greeting_messages.length > 0 ? settings.auto_greeting_messages : [settings.auto_greeting_message || '']).map((msg, index) => (
              <div key={index} className="flex gap-2 items-start">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 mb-1 block">Variação {index + 1}</label>
                  <textarea
                    value={msg}
                    onChange={(e) => {
                      const msgs = settings.auto_greeting_messages.length > 0 
                        ? [...settings.auto_greeting_messages] 
                        : [settings.auto_greeting_message || ''];
                      msgs[index] = e.target.value;
                      setSettings({ ...settings, auto_greeting_messages: msgs });
                    }}
                    placeholder="Olá {{nome}}! 👋 Vi que você demonstrou interesse..."
                    rows={2}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-y"
                  />
                </div>
                {(settings.auto_greeting_messages.length > 1 || (settings.auto_greeting_messages.length === 0 && false)) && (
                  <button
                    type="button"
                    onClick={() => {
                      const msgs = [...settings.auto_greeting_messages];
                      msgs.splice(index, 1);
                      setSettings({ ...settings, auto_greeting_messages: msgs });
                    }}
                    className="mt-6 p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            
            <button
              type="button"
              onClick={() => {
                const msgs = settings.auto_greeting_messages.length > 0 
                  ? [...settings.auto_greeting_messages] 
                  : [settings.auto_greeting_message || ''];
                msgs.push('');
                setSettings({ ...settings, auto_greeting_messages: msgs });
              }}
              className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-2 rounded-lg border border-dashed border-slate-700 hover:border-emerald-500/50 w-full justify-center"
            >
              <Plus className="w-3.5 h-3.5" />
              Adicionar variação
            </button>
            
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Info className="w-3 h-3" />
              Use múltiplas variações para evitar bloqueio do número. A cada envio, uma variação será escolhida aleatoriamente.
            </p>
          </div>
        </div>

        {/* Handoff para Humano */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <UserCheck className="w-5 h-5 text-amber-400" />
            <h3 className="font-semibold text-white">Transferência para Humano</h3>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Configure o tempo de inatividade para transferência automática, o webhook disparado e o time que receberá o lead.
          </p>

          <div className="space-y-4">
            {/* Timeout */}
            <div>
              <label className="text-xs text-slate-500 mb-1.5 block">Tempo de inatividade para transferir</label>
              <div className="flex items-center gap-3">
                <select
                  value={settings.handoff_timeout_minutes}
                  onChange={(e) => setSettings({ ...settings, handoff_timeout_minutes: Number(e.target.value) })}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                >
                  <option value={5}>5 minutos</option>
                  <option value={10}>10 minutos</option>
                  <option value={15}>15 minutos</option>
                  <option value={20}>20 minutos</option>
                  <option value={30}>30 minutos</option>
                  <option value={60}>1 hora</option>
                </select>
                <span className="text-xs text-slate-500">sem resposta do lead</span>
              </div>
            </div>

            {/* Webhook */}
            <div>
              <label className="text-xs text-slate-500 mb-1.5 block">Webhook de Handoff</label>
              <select
                value={settings.handoff_webhook_endpoint_id || ''}
                onChange={(e) => setSettings({ ...settings, handoff_webhook_endpoint_id: e.target.value || null })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                <option value="">Todos os endpoints habilitados</option>
                {webhookEndpoints.map(ep => (
                  <option key={ep.id} value={ep.id}>{ep.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Se vazio, o evento <code className="text-amber-400">lead.handoff</code> será enviado para todos os endpoints ativos. Se selecionado, será enviado apenas para este.
              </p>
            </div>

            {/* Team */}
            <div>
              <label className="text-xs text-slate-500 mb-1.5 block">Time de destino</label>
              <select
                value={settings.handoff_team_id || ''}
                onChange={(e) => setSettings({ ...settings, handoff_team_id: e.target.value || null })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                <option value="">Roleta geral (todos os membros ativos)</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Se selecionado, o lead será atribuído apenas a membros deste time.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Bot className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold text-white">Comportamento</h3>
          </div>
          
          {/* AI Model Selection */}
          <div className="mb-4">
            <label className="text-xs font-medium text-slate-400 mb-3 block">Modelo de IA</label>
            <div className="grid grid-cols-5 gap-2">
              <button
                type="button"
                onClick={() => setSettings({ ...settings, ai_model_mode: 'flash' })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                  settings.ai_model_mode === 'flash'
                    ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">⚡</span>
                <span className="text-xs font-medium">Flash 2.5</span>
                <span className="text-[10px] text-center opacity-70">Rápido</span>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, ai_model_mode: 'flash3' })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                  settings.ai_model_mode === 'flash3'
                    ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">⚡</span>
                <span className="text-xs font-medium">Flash 3</span>
                <span className="text-[10px] text-center opacity-70">Novo</span>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, ai_model_mode: 'pro' })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                  settings.ai_model_mode === 'pro'
                    ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">🧠</span>
                <span className="text-xs font-medium">Pro 2.5</span>
                <span className="text-[10px] text-center opacity-70">Inteligente</span>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, ai_model_mode: 'pro3' })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                  settings.ai_model_mode === 'pro3'
                    ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">🚀</span>
                <span className="text-xs font-medium">Pro 3</span>
                <span className="text-[10px] text-center opacity-70">Avançado</span>
              </button>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, ai_model_mode: 'adaptive' })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                  settings.ai_model_mode === 'adaptive'
                    ? 'bg-violet-500/20 border-violet-500 text-violet-300'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span className="text-lg">🎯</span>
                <span className="text-xs font-medium">Adaptativo</span>
                <span className="text-[10px] text-center opacity-70">Contexto</span>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {settings.ai_model_mode === 'flash' && 'Gemini 2.5 Flash: respostas rápidas e econômicas'}
              {settings.ai_model_mode === 'flash3' && 'Gemini 3 Flash: modelo mais recente da linha Flash, melhor aderência a instruções'}
              {settings.ai_model_mode === 'pro' && 'Gemini 2.5 Pro: respostas elaboradas e inteligentes'}
              {settings.ai_model_mode === 'pro3' && 'Gemini 3 Pro: modelo mais recente e avançado'}
              {settings.ai_model_mode === 'adaptive' && 'Alterna automaticamente baseado no contexto da conversa'}
            </p>
          </div>

          {/* Toggles em grid 2x2 com tooltips */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-slate-300 cursor-help flex items-center gap-1.5">
                    Agente Ativo
                    <Info className="w-3 h-3 text-slate-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">Liga ou desliga o agente de IA completamente. Quando desativado, nenhuma resposta automática será enviada.</p>
                </TooltipContent>
              </Tooltip>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.is_active}
                  onChange={(e) => setSettings({ ...settings, is_active: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-slate-300 cursor-help flex items-center gap-1.5">
                    Resposta Automática
                    <Info className="w-3 h-3 text-slate-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">Quando ativo, o agente responde automaticamente sem necessidade de aprovação humana.</p>
                </TooltipContent>
              </Tooltip>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.auto_response_enabled}
                  onChange={(e) => setSettings({ ...settings, auto_response_enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-slate-300 cursor-help flex items-center gap-1.5">
                    Quebrar Mensagens
                    <Info className="w-3 h-3 text-slate-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">Divide respostas longas em várias mensagens menores, simulando uma conversa mais natural.</p>
                </TooltipContent>
              </Tooltip>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.message_breaking_enabled}
                  onChange={(e) => setSettings({ ...settings, message_breaking_enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>

            <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950/50 border border-slate-800">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-slate-300 cursor-help flex items-center gap-1.5">
                    Agendamento via IA
                    <Info className="w-3 h-3 text-slate-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-[200px]">Permite que o agente crie, altere e cancele agendamentos automaticamente durante a conversa.</p>
                </TooltipContent>
              </Tooltip>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.ai_scheduling_enabled}
                  onChange={(e) => setSettings({ ...settings, ai_scheduling_enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Scoring Variables */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <ScoringVariablesSettings />
        </div>

      </div>
      </TooltipProvider>
    </>
  );
});

AgentSettings.displayName = 'AgentSettings';

export default AgentSettings;
