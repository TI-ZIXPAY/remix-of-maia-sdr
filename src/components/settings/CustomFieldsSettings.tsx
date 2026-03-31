import React, { useState, useEffect } from 'react';
import { Plus, GripVertical, Pencil, Trash2, Check, X, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useCompanySettings } from '@/hooks/useCompanySettings';

interface OptionItem {
  label: string;
  value: string;
}

interface CustomField {
  id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: string[];
  is_required: boolean;
  position: number;
  is_active: boolean;
}

const FIELD_TYPES = [
  { value: 'text', label: 'Texto', icon: 'T' },
  { value: 'number', label: 'Número', icon: '#' },
  { value: 'date', label: 'Data', icon: '📅' },
  { value: 'datetime', label: 'Data e Hora', icon: '🕐' },
  { value: 'select', label: 'Lista – seleção única', icon: '☰' },
  { value: 'multiselect', label: 'Lista – seleção múltipla', icon: '☷' },
  { value: 'boolean', label: 'Sim/Não', icon: '◉' },
];

const CustomFieldsSettings: React.FC = () => {
  const { isAdmin } = useCompanySettings();
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Form state
  const [formLabel, setFormLabel] = useState('');
  const [formType, setFormType] = useState('text');
  const [formOptions, setFormOptions] = useState<OptionItem[]>([]);
  const [formRequired, setFormRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newOptLabel, setNewOptLabel] = useState('');
  const [newOptValue, setNewOptValue] = useState('');

  useEffect(() => {
    fetchFields();
  }, []);

  const fetchFields = async () => {
    const { data, error } = await supabase
      .from('contact_custom_fields')
      .select('*')
      .order('position', { ascending: true });
    
    if (error) {
      toast.error('Erro ao carregar campos');
      console.error(error);
    } else {
      setFields((data || []).map((f: any) => ({
        ...f,
        options: Array.isArray(f.options) ? f.options : [],
      })));
    }
    setLoading(false);
  };

  const generateKey = (label: string) => {
    return label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  };

  const handleCreate = async () => {
    if (!formLabel.trim()) {
      toast.error('Nome do campo é obrigatório');
      return;
    }
    setSaving(true);
    const key = generateKey(formLabel);
    const options = (formType === 'select' || formType === 'multiselect') ? formOptions.map(o => o.label) : [];

    const { error } = await supabase
      .from('contact_custom_fields')
      .insert({
        field_key: key,
        field_label: formLabel.trim(),
        field_type: formType,
        options,
        is_required: formRequired,
        position: fields.length,
      });

    if (error) {
      toast.error(error.message.includes('unique') ? 'Já existe um campo com esse nome' : 'Erro ao criar campo');
    } else {
      toast.success('Campo criado');
      resetForm();
      fetchFields();
    }
    setSaving(false);
  };

  const handleUpdate = async (field: CustomField) => {
    if (!formLabel.trim()) return;
    setSaving(true);
    const options = (formType === 'select' || formType === 'multiselect') ? formOptions.map(o => o.label) : [];

    const { error } = await supabase
      .from('contact_custom_fields')
      .update({
        field_label: formLabel.trim(),
        field_type: formType,
        options,
        is_required: formRequired,
      })
      .eq('id', field.id);

    if (error) {
      toast.error('Erro ao atualizar campo');
    } else {
      toast.success('Campo atualizado');
      setEditingId(null);
      resetForm();
      fetchFields();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('contact_custom_fields').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir campo');
    } else {
      toast.success('Campo excluído');
      fetchFields();
    }
  };

  const handleToggleActive = async (field: CustomField) => {
    const { error } = await supabase
      .from('contact_custom_fields')
      .update({ is_active: !field.is_active })
      .eq('id', field.id);
    if (!error) fetchFields();
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= fields.length) return;

    const updates = [
      { id: fields[index].id, position: fields[swapIndex].position },
      { id: fields[swapIndex].id, position: fields[index].position },
    ];

    for (const u of updates) {
      await supabase.from('contact_custom_fields').update({ position: u.position }).eq('id', u.id);
    }
    fetchFields();
  };

  const resetForm = () => {
    setFormLabel('');
    setFormType('text');
    setFormOptions([]);
    setFormRequired(false);
    setShowCreate(false);
    setEditingId(null);
    setNewOptLabel('');
    setNewOptValue('');
  };

  const startEdit = (field: CustomField) => {
    setEditingId(field.id);
    setFormLabel(field.field_label);
    setFormType(field.field_type);
    setFormOptions(field.options.map(o => ({ label: String(o), value: generateKey(String(o)) })));
    setFormRequired(field.is_required);
    setShowCreate(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Campos Personalizados</h3>
          <p className="text-sm text-slate-400 mt-1">
            Campos que aparecem na sidebar do chat e são preenchidos automaticamente pela IA.
          </p>
        </div>
        {isAdmin && !showCreate && !editingId && (
          <button
            onClick={() => { resetForm(); setShowCreate(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Campo
          </button>
        )}
      </div>

      {/* Create / Edit Form */}
      {(showCreate || editingId) && isAdmin && (
        <div className="p-6 rounded-xl border border-slate-700 bg-slate-800/60 space-y-5">
          <div>
            <h4 className="text-base font-semibold text-white">
              {editingId ? 'Editar Campo' : 'Novo Campo de Contato'}
            </h4>
            <p className="text-xs text-slate-400 mt-0.5">Configure um novo campo para seus contatos</p>
          </div>

          {/* Nome do campo */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">Nome do campo *</label>
            <Input
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="Ex: Empresa, Cargo, CNPJ..."
              className="bg-slate-900 border-slate-700"
            />
          </div>

          {/* Nome da variável (auto-generated) */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">Nome da variável</label>
            <div className="flex items-center gap-0">
              <span className="px-2.5 py-2 bg-slate-900 border border-r-0 border-slate-700 rounded-l-md text-sm text-slate-500 font-mono">{'{{'}</span>
              <input
                value={formLabel ? generateKey(formLabel) : ''}
                readOnly
                className="flex-1 bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-400 font-mono outline-none"
                placeholder="nome_variavel"
              />
              <span className="px-2.5 py-2 bg-slate-900 border border-l-0 border-slate-700 rounded-r-md text-sm text-slate-500 font-mono">{'}}'}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Use esta variável em automações e mensagens</p>
          </div>

          {/* Tipo de campo */}
          <div>
            <label className="text-xs font-medium text-slate-300 mb-1.5 block">Tipo de campo</label>
            <div className="relative">
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="w-full h-11 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 appearance-none cursor-pointer"
              >
                {FIELD_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.icon}  {t.label}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Opções (para select/multiselect) */}
          {(formType === 'select' || formType === 'multiselect') && (
            <div>
              <label className="text-xs font-medium text-slate-300 mb-1.5 block">Opções (label e valor)</label>
              <div className="flex items-center gap-2 mb-2">
                <Input
                  value={newOptLabel}
                  onChange={(e) => {
                    setNewOptLabel(e.target.value);
                    if (!newOptValue || newOptValue === generateKey(newOptLabel)) {
                      setNewOptValue(generateKey(e.target.value));
                    }
                  }}
                  placeholder="Label (exibição)"
                  className="bg-slate-900 border-slate-700 flex-1"
                />
                <Input
                  value={newOptValue}
                  onChange={(e) => setNewOptValue(e.target.value)}
                  placeholder="Valor (interno)"
                  className="bg-slate-900 border-slate-700 flex-1 font-mono text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newOptLabel.trim()) return;
                    const val = newOptValue.trim() || generateKey(newOptLabel);
                    setFormOptions(prev => [...prev, { label: newOptLabel.trim(), value: val }]);
                    setNewOptLabel('');
                    setNewOptValue('');
                  }}
                  className="p-2 rounded-md bg-slate-700 hover:bg-slate-600 text-white transition-colors shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mb-3">O valor é gerado automaticamente se não preenchido. Use-o na API.</p>

              {/* Options list */}
              {formOptions.length > 0 && (
                <div className="space-y-1 border border-slate-700 rounded-md overflow-hidden">
                  {formOptions.map((opt, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-slate-900/50 hover:bg-slate-800/50 transition-colors">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-200 truncate">{opt.label}</span>
                        <span className="text-xs text-slate-500 font-mono truncate">{opt.value}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormOptions(prev => prev.filter((_, idx) => idx !== i))}
                        className="p-1 text-slate-500 hover:text-red-400 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Obrigatório */}
          <div className="flex items-center gap-3">
            <Switch checked={formRequired} onCheckedChange={setFormRequired} />
            <span className="text-sm text-slate-300">Campo obrigatório</span>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-2 border-t border-slate-700/50">
            <button
              onClick={resetForm}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-700/50"
            >
              Cancelar
            </button>
            <button
              onClick={() => editingId ? handleUpdate(fields.find(f => f.id === editingId)!) : handleCreate()}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              {editingId ? 'Salvar' : 'Criar Campo'}
            </button>
          </div>
        </div>
      )}

      {/* Fields List */}
      {fields.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          Nenhum campo personalizado criado ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                field.is_active
                  ? 'border-slate-700 bg-slate-800/30'
                  : 'border-slate-800 bg-slate-900/30 opacity-60'
              }`}
            >
              {/* Reorder */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => handleMove(index, 'up')}
                  disabled={index === 0}
                  className="text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleMove(index, 'down')}
                  disabled={index === fields.length - 1}
                  className="text-slate-500 hover:text-white disabled:opacity-20 transition-colors"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{field.field_label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 font-mono">
                    {FIELD_TYPES.find(t => t.value === field.field_type)?.label || field.field_type}
                  </span>
                  {field.is_required && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">obrigatório</span>
                  )}
                </div>
                <span className="text-xs text-slate-500 font-mono">{field.field_key}</span>
              </div>

              {/* Actions */}
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <Switch
                    checked={field.is_active}
                    onCheckedChange={() => handleToggleActive(field)}
                  />
                  <button
                    onClick={() => startEdit(field)}
                    className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(field.id)}
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

export default CustomFieldsSettings;
