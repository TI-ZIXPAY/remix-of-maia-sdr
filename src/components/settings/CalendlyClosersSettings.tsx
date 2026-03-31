import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '../Button';
import { Users, Plus, Trash2, ChevronUp, ChevronDown, Loader2, Search, UserPlus, Webhook, CheckCircle2, XCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useCompanySettings } from '@/hooks/useCompanySettings';

interface Closer {
  id: string;
  name: string;
  calendly_user_uri: string | null;
  calendly_event_type_uri: string;
  priority: number;
  is_active: boolean;
}

interface CalendlyMember {
  uri: string;
  name: string;
  email: string;
  role: string;
}

interface CalendlyEventType {
  uri: string;
  name: string;
  slug: string;
  active: boolean;
  scheduling_url: string;
}

const CalendlyClosersSettings: React.FC = () => {
  const { isAdmin } = useCompanySettings();
  const [closers, setClosers] = useState<Closer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddFlow, setShowAddFlow] = useState(false);
  const [members, setMembers] = useState<CalendlyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState<CalendlyMember | null>(null);
  const [eventTypes, setEventTypes] = useState<CalendlyEventType[]>([]);
  const [eventTypesLoading, setEventTypesLoading] = useState(false);
  const [selectedEventType, setSelectedEventType] = useState<CalendlyEventType | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchClosers = async () => {
    const { data, error } = await supabase
      .from('calendly_closers')
      .select('*')
      .order('priority', { ascending: true });
    if (!error && data) setClosers(data);
    setLoading(false);
  };

  useEffect(() => { fetchClosers(); }, []);

  const fetchMembers = async () => {
    setMembersLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(
        `https://${projectId}.supabase.co/functions/v1/calendly-integration?action=list-members`,
        {
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      const result = await resp.json();
      if (result.members) {
        setMembers(result.members);
      } else {
        toast.error(result.error || 'Erro ao buscar membros do Calendly');
      }
    } catch (err) {
      toast.error('Erro ao conectar com o Calendly');
    } finally {
      setMembersLoading(false);
    }
  };

  const fetchEventTypes = async (userUri: string) => {
    setEventTypesLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(
        `https://${projectId}.supabase.co/functions/v1/calendly-integration?action=list-types&user=${encodeURIComponent(userUri)}`,
        {
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
        }
      );
      const result = await resp.json();
      const types = (result.collection || []).map((et: any) => ({
        uri: et.uri,
        name: et.name,
        slug: et.slug,
        active: et.active,
        scheduling_url: et.scheduling_url,
      }));
      setEventTypes(types);
    } catch (err) {
      toast.error('Erro ao buscar tipos de evento');
    } finally {
      setEventTypesLoading(false);
    }
  };

  const handleSelectMember = (member: CalendlyMember) => {
    setSelectedMember(member);
    setSelectedEventType(null);
    fetchEventTypes(member.uri);
  };

  const handleAddCloser = async () => {
    if (!selectedMember || !selectedEventType) return;
    setSaving(true);
    try {
      const newPriority = closers.length > 0 ? Math.max(...closers.map(c => c.priority)) + 1 : 1;
      const { error } = await supabase.from('calendly_closers').insert({
        name: selectedMember.name,
        calendly_user_uri: selectedMember.uri,
        calendly_event_type_uri: selectedEventType.uri,
        priority: newPriority,
        is_active: true,
      });
      if (error) throw error;
      toast.success(`${selectedMember.name} adicionado como closer!`);
      setShowAddFlow(false);
      setSelectedMember(null);
      setSelectedEventType(null);
      setMembers([]);
      setEventTypes([]);
      fetchClosers();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao adicionar closer');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    await supabase.from('calendly_closers').update({ is_active: !currentActive }).eq('id', id);
    fetchClosers();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remover ${name} dos closers?`)) return;
    await supabase.from('calendly_closers').delete().eq('id', id);
    toast.success('Closer removido');
    fetchClosers();
  };

  const handleMovePriority = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= closers.length) return;
    
    const current = closers[index];
    const target = closers[targetIndex];
    
    await Promise.all([
      supabase.from('calendly_closers').update({ priority: target.priority }).eq('id', current.id),
      supabase.from('calendly_closers').update({ priority: current.priority }).eq('id', target.id),
    ]);
    fetchClosers();
  };

  const startAddFlow = () => {
    setShowAddFlow(true);
    setSelectedMember(null);
    setSelectedEventType(null);
    setEventTypes([]);
    fetchMembers();
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 className="w-4 h-4 animate-spin" /> Carregando closers...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-cyan-400" />
            Closers do Calendly
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            Configure quais closers a IA consulta ao verificar disponibilidade de agenda.
          </p>
        </div>
        {isAdmin && (
          <Button variant="primary" size="sm" onClick={startAddFlow} className="gap-2">
            <Plus className="w-4 h-4" /> Adicionar Closer
          </Button>
        )}
      </div>

      {/* Add Closer Flow */}
      {showAddFlow && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-4">
          <h4 className="text-sm font-medium text-white flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-cyan-400" />
            Selecionar membro do Calendly
          </h4>

          {membersLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Buscando membros da organização...
            </div>
          ) : members.length > 0 && !selectedMember ? (
            <div className="space-y-2">
              {members
                .filter(m => !closers.some(c => c.calendly_user_uri === m.uri))
                .map(m => (
                  <button
                    key={m.uri}
                    onClick={() => handleSelectMember(m)}
                    className="w-full text-left p-3 bg-slate-900/50 hover:bg-slate-700/50 rounded-lg border border-slate-700 transition-colors"
                  >
                    <div className="font-medium text-white">{m.name}</div>
                    <div className="text-xs text-slate-400">{m.email} • {m.role}</div>
                  </button>
                ))}
              {members.filter(m => !closers.some(c => c.calendly_user_uri === m.uri)).length === 0 && (
                <p className="text-sm text-slate-400">Todos os membros já estão cadastrados como closers.</p>
              )}
            </div>
          ) : null}

          {selectedMember && (
            <div className="space-y-3">
              <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
                <div className="font-medium text-cyan-300">{selectedMember.name}</div>
                <div className="text-xs text-slate-400">{selectedMember.email}</div>
              </div>

              <h4 className="text-sm font-medium text-white">Selecionar tipo de evento</h4>
              {eventTypesLoading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Buscando tipos de evento...
                </div>
              ) : eventTypes.length > 0 ? (
                <div className="space-y-2">
                  {eventTypes.map(et => (
                    <button
                      key={et.uri}
                      onClick={() => setSelectedEventType(et)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedEventType?.uri === et.uri
                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                          : 'bg-slate-900/50 hover:bg-slate-700/50 border-slate-700 text-white'
                      }`}
                    >
                      <div className="font-medium">{et.name}</div>
                      <div className="text-xs text-slate-400 truncate">{et.scheduling_url}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Nenhum tipo de evento encontrado para este membro.</p>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowAddFlow(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!selectedMember || !selectedEventType || saving}
              onClick={handleAddCloser}
              className="gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Adicionar
            </Button>
          </div>
        </div>
      )}

      {/* Webhook Setup */}
      {isAdmin && <CalendlyWebhookSetup />}

      {/* Closers List */}
      {closers.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Nenhum closer cadastrado.</p>
          <p className="text-xs mt-1">O sistema usará o event_type_uri padrão do nina_settings como fallback.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {closers.map((closer, index) => (
            <div
              key={closer.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                closer.is_active
                  ? 'bg-slate-800/50 border-slate-700'
                  : 'bg-slate-900/30 border-slate-800 opacity-60'
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleMovePriority(index, -1)}
                  disabled={index === 0 || !isAdmin}
                  className="text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleMovePriority(index, 1)}
                  disabled={index === closers.length - 1 || !isAdmin}
                  className="text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm font-bold">
                {closer.priority}
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-medium text-white">{closer.name}</div>
                <div className="text-xs text-slate-500 truncate font-mono">
                  {closer.calendly_event_type_uri.split('/').pop()}
                </div>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={closer.is_active}
                    onCheckedChange={() => handleToggleActive(closer.id, closer.is_active)}
                  />
                  <button
                    onClick={() => handleDelete(closer.id, closer.name)}
                    className="text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const CalendlyWebhookSetup: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'active' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSetup = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(
        `https://${projectId}.supabase.co/functions/v1/calendly-webhook?action=setup`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({}),
        }
      );
      const result = await resp.json();
      if (result.success) {
        setStatus('active');
        toast.success(result.message || 'Webhook do Calendly ativado com sucesso!');
      } else {
        throw new Error(result.error || 'Erro desconhecido');
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Erro ao ativar webhook');
      toast.error(err.message || 'Erro ao ativar webhook do Calendly');
    }
  };

  return (
    <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Webhook className="w-5 h-5 text-cyan-400" />
          <div>
            <h4 className="text-sm font-medium text-white">Webhook de Eventos</h4>
            <p className="text-xs text-slate-400">
              Receba automaticamente cancelamentos, no-shows e reagendamentos do Calendly.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === 'active' && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" /> Ativo
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1 text-xs text-red-400" title={errorMsg}>
              <XCircle className="w-3.5 h-3.5" /> Erro
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSetup}
            disabled={status === 'loading'}
            className="gap-2"
          >
            {status === 'loading' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Webhook className="w-4 h-4" />
            )}
            {status === 'active' ? 'Reconectar' : 'Ativar Webhook'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CalendlyClosersSettings;
