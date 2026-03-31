import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { Button } from '@/components/Button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Clock, MessageSquare, Save, Loader2, Info, Webhook, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';

interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

interface FollowUpStep {
  id?: string;
  step_order: number;
  delay_minutes: number;
  message_template: string;
  is_active: boolean;
  webhook_endpoint_id?: string | null;
  is_question?: boolean;
  webhook_on_negative_id?: string | null;
}

interface FollowUpSequence {
  id?: string;
  name: string;
  trigger_event: string;
  is_active: boolean;
  steps: FollowUpStep[];
  webhook_on_completed_id?: string | null;
  webhook_on_cancelled_id?: string | null;
}

const DELAY_OPTIONS = [
  { label: '15 minutos antes', value: -15 },
  { label: '30 minutos antes', value: -30 },
  { label: '1 hora antes', value: -60 },
  { label: '2 horas antes', value: -120 },
  { label: '6 horas antes', value: -360 },
  { label: '12 horas antes', value: -720 },
  { label: '24 horas antes', value: -1440 },
  { label: '48 horas antes', value: -2880 },
];

const VARIABLES_HELP = [
  { var: '{{nome}}', desc: 'Nome do contato' },
  { var: '{{data}}', desc: 'Data da reunião (DD/MM/AAAA)' },
  { var: '{{horario}}', desc: 'Horário da reunião (HH:MM)' },
  { var: '{{titulo}}', desc: 'Título do agendamento' },
  { var: '{{link_calendly}}', desc: 'Link do Calendly (se configurado)' },
];

const FollowUpSettings: React.FC = () => {
  const { isAdmin } = useCompanySettings();
  const [sequence, setSequence] = useState<FollowUpSequence | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookEndpoints, setWebhookEndpoints] = useState<WebhookEndpoint[]>([]);

  useEffect(() => {
    fetchSequence();
    fetchWebhookEndpoints();
  }, []);

  const fetchWebhookEndpoints = async () => {
    const { data } = await supabase
      .from('webhook_endpoints')
      .select('id, name, url, enabled')
      .eq('enabled', true)
      .order('name');
    setWebhookEndpoints((data as WebhookEndpoint[]) || []);
  };

  const fetchSequence = async () => {
    setLoading(true);
    try {
      const { data: sequences } = await supabase
        .from('followup_sequences')
        .select('*')
        .eq('trigger_event', 'appointment_scheduled')
        .limit(1)
        .maybeSingle();

      if (sequences) {
        const { data: steps } = await supabase
          .from('followup_steps')
          .select('*')
          .eq('sequence_id', sequences.id)
          .order('step_order', { ascending: true });

        setSequence({
          ...sequences,
          webhook_on_completed_id: sequences.webhook_on_completed_id || null,
          webhook_on_cancelled_id: sequences.webhook_on_cancelled_id || null,
          steps: (steps || []).map(s => ({
            id: s.id,
            step_order: s.step_order,
            delay_minutes: s.delay_minutes,
            message_template: s.message_template,
            is_active: s.is_active,
            webhook_endpoint_id: s.webhook_endpoint_id || null,
            is_question: (s as any).is_question || false,
            webhook_on_negative_id: (s as any).webhook_on_negative_id || null,
          })),
        });
      } else {
        // Create default
        setSequence({
          name: 'Confirmação de Visita',
          trigger_event: 'appointment_scheduled',
          is_active: true,
          steps: [
            {
              step_order: 1,
              delay_minutes: -1440,
              message_template: 'Oi {{nome}}! 😊 Lembrando que amanhã temos a visita ao imóvel {{titulo}} agendada para as {{horario}}. Posso confirmar sua presença?',
              is_active: true,
            },
            {
              step_order: 2,
              delay_minutes: -60,
              message_template: '{{nome}}, daqui a pouco temos a visita ao imóvel {{titulo}} às {{horario}}. Te espero! 🙂',
              is_active: true,
            },
            {
              step_order: 3,
              delay_minutes: -15,
              message_template: 'Estamos quase! Sua visita começa em 15 minutos. Até já! 🏠',
              is_active: true,
            },
          ],
        });
      }
    } catch (error) {
      console.error('[FollowUp] Error fetching:', error);
      toast.error('Erro ao carregar configurações de follow-up');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!sequence || !isAdmin) return;
    setSaving(true);

    try {
      let sequenceId = sequence.id;

      if (!sequenceId) {
        // Create new sequence
        const { data: newSeq, error: seqError } = await supabase
          .from('followup_sequences')
          .insert({
            name: sequence.name,
            trigger_event: sequence.trigger_event,
            is_active: sequence.is_active,
            webhook_on_completed_id: sequence.webhook_on_completed_id || null,
            webhook_on_cancelled_id: sequence.webhook_on_cancelled_id || null,
          })
          .select('id')
          .single();

        if (seqError) throw seqError;
        sequenceId = newSeq.id;
      } else {
        // Update existing
        const { error: updateError } = await supabase
          .from('followup_sequences')
          .update({
            name: sequence.name,
            is_active: sequence.is_active,
            webhook_on_completed_id: sequence.webhook_on_completed_id || null,
            webhook_on_cancelled_id: sequence.webhook_on_cancelled_id || null,
          })
          .eq('id', sequenceId);

        if (updateError) throw updateError;

        // Delete old steps and recreate
        await supabase
          .from('followup_steps')
          .delete()
          .eq('sequence_id', sequenceId);
      }

      // Insert steps
      if (sequence.steps.length > 0) {
        const stepsToInsert = sequence.steps.map((step, idx) => ({
          sequence_id: sequenceId!,
          step_order: idx + 1,
          delay_minutes: step.delay_minutes,
          message_template: step.message_template,
          is_active: step.is_active,
          webhook_endpoint_id: step.webhook_endpoint_id || null,
          is_question: step.is_question || false,
          webhook_on_negative_id: step.webhook_on_negative_id || null,
        }));

        const { error: stepsError } = await supabase
          .from('followup_steps')
          .insert(stepsToInsert);

        if (stepsError) throw stepsError;
      }

      toast.success('Follow-up salvo com sucesso!');
      await fetchSequence();
    } catch (error) {
      console.error('[FollowUp] Error saving:', error);
      toast.error('Erro ao salvar follow-up');
    } finally {
      setSaving(false);
    }
  };

  const addStep = () => {
    if (!sequence) return;
    setSequence({
      ...sequence,
      steps: [
        ...sequence.steps,
        {
          step_order: sequence.steps.length + 1,
          delay_minutes: -60,
          message_template: '',
          is_active: true,
          is_question: false,
          webhook_on_negative_id: null,
        },
      ],
    });
  };

  const removeStep = (index: number) => {
    if (!sequence) return;
    setSequence({
      ...sequence,
      steps: sequence.steps.filter((_, i) => i !== index),
    });
  };

  const updateStep = (index: number, updates: Partial<FollowUpStep>) => {
    if (!sequence) return;
    const newSteps = [...sequence.steps];
    newSteps[index] = { ...newSteps[index], ...updates };
    setSequence({ ...sequence, steps: newSteps });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!sequence) return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Sequência de Follow-up</h3>
            <p className="text-sm text-slate-400 mt-1">
              Mensagens automáticas de confirmação antes das reuniões
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="seq-active" className="text-sm text-slate-400">Ativo</Label>
            <Switch
              id="seq-active"
              checked={sequence.is_active}
              onCheckedChange={(checked) => setSequence({ ...sequence, is_active: checked })}
              disabled={!isAdmin}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm text-slate-300">Nome da sequência</Label>
            <Input
              value={sequence.name}
              onChange={(e) => setSequence({ ...sequence, name: e.target.value })}
              disabled={!isAdmin}
              className="mt-1 bg-slate-800 border-slate-700"
            />
          </div>
          <div>
            <Label className="text-sm text-slate-300">Evento gatilho</Label>
            <Input
              value="Agendamento criado"
              disabled
              className="mt-1 bg-slate-800/50 border-slate-700 text-slate-500"
            />
          </div>
        </div>
      </div>

      {/* Variables Help */}
      <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-cyan-400">Variáveis disponíveis</span>
        </div>
        <div className="flex flex-wrap gap-3">
          {VARIABLES_HELP.map((v) => (
            <div key={v.var} className="flex items-center gap-2 text-xs">
              <code className="px-2 py-0.5 bg-slate-800 text-cyan-300 rounded font-mono">{v.var}</code>
              <span className="text-slate-400">{v.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-md font-medium text-white">Passos do follow-up</h4>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={addStep} className="gap-2 text-cyan-400">
              <Plus className="w-4 h-4" />
              Adicionar passo
            </Button>
          )}
        </div>

        {sequence.steps.map((step, index) => (
          <div
            key={index}
            className={`bg-slate-900 border rounded-xl p-5 transition-colors ${
              step.is_active ? 'border-slate-700' : 'border-slate-800 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-cyan-400" />
                </div>
                <span className="text-sm font-medium text-white">Passo {index + 1}</span>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={step.is_active}
                  onCheckedChange={(checked) => updateStep(index, { is_active: checked })}
                  disabled={!isAdmin}
                />
                {isAdmin && sequence.steps.length > 1 && (
                  <button
                    onClick={() => removeStep(index)}
                    className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-xs text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Quando disparar
                </Label>
                <select
                  value={step.delay_minutes}
                  onChange={(e) => updateStep(index, { delay_minutes: Number(e.target.value) })}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500"
                >
                  {DELAY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label className="text-xs text-slate-400">Mensagem</Label>
                <Textarea
                  value={step.message_template}
                  onChange={(e) => updateStep(index, { message_template: e.target.value })}
                  disabled={!isAdmin}
                  rows={3}
                  placeholder="Ex: Oi {{nome}}, lembrando da nossa {{titulo}} amanhã às {{horario}}!"
                  className="mt-1 bg-slate-800 border-slate-700 text-white placeholder:text-slate-600"
                />
              </div>

              {/* Preview */}
              {step.message_template && (
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <span className="text-xs text-slate-500 block mb-1">Preview:</span>
                  <p className="text-sm text-slate-300">
                    {step.message_template
                      .replace(/\{\{nome\}\}/gi, 'João')
                      .replace(/\{\{data\}\}/gi, '25/02/2026')
                      .replace(/\{\{horario\}\}/gi, '14:00')
                      .replace(/\{\{titulo\}\}/gi, 'Demo do Produto')
                      .replace(/\{\{link_calendly\}\}/gi, 'https://calendly.com/...')}
                  </p>
                </div>
              )}

              {/* Question toggle */}
              <div className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-amber-400" />
                  <div>
                    <Label className="text-xs text-slate-300">Este passo é uma pergunta?</Label>
                    <p className="text-[10px] text-slate-500 mt-0.5">Webhook só dispara após resposta do lead</p>
                  </div>
                </div>
                <Switch
                  checked={step.is_question || false}
                  onCheckedChange={(checked) => updateStep(index, { is_question: checked })}
                  disabled={!isAdmin}
                />
              </div>

              {/* Webhook selector per step */}
              {webhookEndpoints.length > 0 && (
                <div>
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Webhook className="w-3 h-3" />
                    {step.is_question ? 'Webhook se confirmar ✅' : 'Webhook ao executar este passo'}
                  </Label>
                  <select
                    value={step.webhook_endpoint_id || ''}
                    onChange={(e) => updateStep(index, { webhook_endpoint_id: e.target.value || null })}
                    disabled={!isAdmin}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="">Nenhum webhook</option>
                    {webhookEndpoints.map((ep) => (
                      <option key={ep.id} value={ep.id}>{ep.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Negative webhook - only for questions */}
              {webhookEndpoints.length > 0 && step.is_question && (
                <div>
                  <Label className="text-xs text-slate-400 flex items-center gap-1">
                    <Webhook className="w-3 h-3" />
                    Webhook se recusar ❌
                  </Label>
                  <select
                    value={step.webhook_on_negative_id || ''}
                    onChange={(e) => updateStep(index, { webhook_on_negative_id: e.target.value || null })}
                    disabled={!isAdmin}
                    className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="">Nenhum webhook</option>
                    {webhookEndpoints.map((ep) => (
                      <option key={ep.id} value={ep.id}>{ep.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Webhooks for special columns */}
      {webhookEndpoints.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Webhook className="w-4 h-4 text-cyan-400" />
            <h4 className="text-md font-medium text-white">Webhooks por etapa do funil</h4>
          </div>
          <p className="text-sm text-slate-400">
            Dispare webhooks automaticamente quando um lead entrar nas etapas especiais do funil de follow-up.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm text-slate-300">✅ Concluído (todos os steps enviados)</Label>
              <select
                value={sequence.webhook_on_completed_id || ''}
                onChange={(e) => setSequence({ ...sequence, webhook_on_completed_id: e.target.value || null })}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500"
              >
                <option value="">Nenhum webhook</option>
                {webhookEndpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>{ep.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-sm text-slate-300">❌ Cancelou Agendamento</Label>
              <select
                value={sequence.webhook_on_cancelled_id || ''}
                onChange={(e) => setSequence({ ...sequence, webhook_on_cancelled_id: e.target.value || null })}
                disabled={!isAdmin}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-cyan-500"
              >
                <option value="">Nenhum webhook</option>
                {webhookEndpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>{ep.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Save */}
      {isAdmin && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving}
            className="gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Salvar Follow-up
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
};

export default FollowUpSettings;
