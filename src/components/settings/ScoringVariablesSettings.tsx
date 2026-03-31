import React, { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Check, Loader2, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { useCompanySettings } from '@/hooks/useCompanySettings';

interface ScoringVariable {
  id: string;
  title: string;
  description: string;
  score: number;
  is_active: boolean;
  position: number;
  field_key: string | null;
  match_condition: string;
  match_value: string | null;
}

interface CustomField {
  id: string;
  field_key: string;
  field_label: string;
}

const MATCH_CONDITIONS = [
  { value: 'not_empty', label: 'Preenchido (qualquer valor)' },
  { value: 'equals', label: 'Igual a' },
  { value: 'contains', label: 'Contém' },
  { value: 'not_equals', label: 'Diferente de' },
];

const ScoringVariablesSettings: React.FC = () => {
  const { isAdmin } = useCompanySettings();
  const [variables, setVariables] = useState<ScoringVariable[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formScore, setFormScore] = useState(0);
  const [formFieldKey, setFormFieldKey] = useState('');
  const [formMatchCondition, setFormMatchCondition] = useState('not_empty');
  const [formMatchValue, setFormMatchValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchVariables();
    fetchCustomFields();
  }, []);

  const fetchVariables = async () => {
    const { data, error } = await supabase
      .from('scoring_variables')
      .select('*')
      .order('position', { ascending: true });

    if (error) {
      toast.error('Erro ao carregar variáveis');
      console.error(error);
    } else {
      setVariables((data || []).map((d: any) => ({
        ...d,
        is_active: d.is_active ?? true,
        position: d.position ?? 0,
        field_key: d.field_key || null,
        match_condition: d.match_condition || 'not_empty',
        match_value: d.match_value || null,
      })));
    }
    setLoading(false);
  };

  const fetchCustomFields = async () => {
    const { data } = await supabase
      .from('contact_custom_fields')
      .select('id, field_key, field_label')
      .eq('is_active', true)
      .order('position', { ascending: true });
    setCustomFields(data || []);
  };

  const handleCreate = async () => {
    if (!formTitle.trim()) {
      toast.error('Título é obrigatório');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('scoring_variables')
      .insert({
        title: formTitle.trim(),
        description: formDescription.trim(),
        score: formScore,
        position: variables.length,
        field_key: formFieldKey || null,
        match_condition: formMatchCondition,
        match_value: formMatchValue || null,
      } as any);

    if (error) {
      toast.error('Erro ao criar variável');
    } else {
      toast.success('Variável criada');
      resetForm();
      fetchVariables();
    }
    setSaving(false);
  };

  const handleUpdate = async (id: string) => {
    if (!formTitle.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from('scoring_variables')
      .update({
        title: formTitle.trim(),
        description: formDescription.trim(),
        score: formScore,
        field_key: formFieldKey || null,
        match_condition: formMatchCondition,
        match_value: formMatchValue || null,
      } as any)
      .eq('id', id);

    if (error) {
      toast.error('Erro ao atualizar');
    } else {
      toast.success('Variável atualizada');
      resetForm();
      fetchVariables();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('scoring_variables').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir');
    } else {
      toast.success('Variável excluída');
      fetchVariables();
    }
  };

  const resetForm = () => {
    setFormTitle('');
    setFormDescription('');
    setFormScore(0);
    setFormFieldKey('');
    setFormMatchCondition('not_empty');
    setFormMatchValue('');
    setShowCreate(false);
    setEditingId(null);
  };

  const startEdit = (v: ScoringVariable) => {
    setEditingId(v.id);
    setFormTitle(v.title);
    setFormDescription(v.description);
    setFormScore(v.score);
    setFormFieldKey(v.field_key || '');
    setFormMatchCondition(v.match_condition || 'not_empty');
    setFormMatchValue(v.match_value || '');
    setShowCreate(false);
  };

  const getFieldLabel = (key: string) => {
    const field = customFields.find(f => f.field_key === key);
    return field?.field_label || key;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Target className="w-4 h-4 text-amber-400" />
            Variáveis de Pontuação
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Defina critérios e pontos para qualificar leads. Vincule a campos personalizados para scoring automático via webhook.
          </p>
        </div>
        {isAdmin && !showCreate && !editingId && (
          <button
            onClick={() => { resetForm(); setShowCreate(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova Variável
          </button>
        )}
      </div>

      {/* Create / Edit Form */}
      {(showCreate || editingId) && isAdmin && (
        <div className="p-4 rounded-lg border border-slate-700 bg-slate-800/50 space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Título *</label>
            <Input
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Ex: Tem orçamento definido, Cargo de decisão..."
              className="bg-slate-900 border-slate-700"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Descrição (instrução para a IA)</label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Ex: Pontuar quando o lead mencionar que possui verba ou orçamento aprovado..."
              rows={2}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-y"
            />
          </div>

          {/* Field mapping section */}
          <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-3">
            <p className="text-xs font-medium text-amber-400">Scoring Automático (via webhook)</p>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Campo Personalizado</label>
              <select
                value={formFieldKey}
                onChange={(e) => setFormFieldKey(e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              >
                <option value="">Nenhum (apenas IA)</option>
                {customFields.map(f => (
                  <option key={f.id} value={f.field_key}>{f.field_label} ({f.field_key})</option>
                ))}
              </select>
            </div>
            {formFieldKey && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Condição</label>
                  <select
                    value={formMatchCondition}
                    onChange={(e) => setFormMatchCondition(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  >
                    {MATCH_CONDITIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                {(formMatchCondition === 'equals' || formMatchCondition === 'contains' || formMatchCondition === 'not_equals') && (
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Valor</label>
                    <Input
                      value={formMatchValue}
                      onChange={(e) => setFormMatchValue(e.target.value)}
                      placeholder="Ex: sim, true, premium..."
                      className="bg-slate-900 border-slate-700"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">Pontuação</label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                value={formScore}
                onChange={(e) => setFormScore(Number(e.target.value))}
                className="bg-slate-900 border-slate-700 w-24"
              />
              <span className="text-xs text-slate-500">pontos</span>
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={resetForm} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => editingId ? handleUpdate(editingId) : handleCreate()}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              {editingId ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {variables.length === 0 ? (
        <div className="text-center py-8 text-slate-600 text-xs">
          Nenhuma variável de pontuação criada ainda.
        </div>
      ) : (
        <div className="space-y-1.5">
          {variables.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-slate-700/50 bg-slate-800/20 hover:bg-slate-800/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <span className="text-sm font-bold text-amber-400">{v.score > 0 ? `+${v.score}` : v.score}</span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-white block truncate">{v.title}</span>
                <div className="flex items-center gap-2">
                  {v.description && (
                    <span className="text-xs text-slate-500 truncate">{v.description}</span>
                  )}
                  {v.field_key && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                      {getFieldLabel(v.field_key)}
                    </span>
                  )}
                </div>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(v)}
                    className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="p-1.5 rounded hover:bg-red-900/30 text-slate-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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

export default ScoringVariablesSettings;
