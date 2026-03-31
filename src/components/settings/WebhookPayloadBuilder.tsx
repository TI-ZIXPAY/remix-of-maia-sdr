import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Plus, Trash2, ChevronDown } from 'lucide-react';
import { Button } from '../Button';

interface PayloadField {
  key: string;
  variable: string;
}

interface CustomField {
  id: string;
  field_key: string;
  field_label: string;
}

interface Props {
  value: PayloadField[];
  onChange: (fields: PayloadField[]) => void;
}

const SYSTEM_VARIABLES = [
  { group: 'Contato', variables: [
    { value: 'contact.name', label: 'Nome' },
    { value: 'contact.phone_number', label: 'Telefone' },
    { value: 'contact.email', label: 'Email' },
    { value: 'contact.lead_score', label: 'Pontuação' },
    { value: 'contact.lead_classification', label: 'Classificação' },
    { value: 'contact.tags', label: 'Tags' },
    { value: 'contact.notes', label: 'Observações' },
    { value: 'contact.call_name', label: 'Apelido' },
    { value: 'contact.first_contact_date', label: 'Primeiro contato' },
    { value: 'contact.last_activity', label: 'Última atividade' },
  ]},
  { group: 'Evento', variables: [
    { value: 'event.type', label: 'Tipo do evento' },
    { value: 'event.timestamp', label: 'Data/hora do disparo' },
    { value: 'event.handoff_summary', label: 'Resumo da conversa (handoff)' },
  ]},
];

const WebhookPayloadBuilder: React.FC<Props> = ({ value, onChange }) => {
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  useEffect(() => {
    supabase.from('contact_custom_fields').select('id, field_key, field_label').eq('is_active', true)
      .order('position').then(({ data }) => {
        if (data) setCustomFields(data);
      });
  }, []);

  const allGroups = useMemo(() => {
    const groups = [...SYSTEM_VARIABLES];
    if (customFields.length > 0) {
      groups.splice(1, 0, {
        group: 'Campos Personalizados',
        variables: customFields.map(f => ({ value: `custom.${f.field_key}`, label: f.field_label })),
      });
    }
    return groups;
  }, [customFields]);

  const addField = () => {
    onChange([...value, { key: '', variable: '' }]);
  };

  const updateField = (index: number, field: Partial<PayloadField>) => {
    const updated = [...value];
    updated[index] = { ...updated[index], ...field };
    onChange(updated);
  };

  const removeField = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const previewJson = useMemo(() => {
    const obj: Record<string, string> = {};
    value.forEach(f => {
      if (f.key && f.variable) obj[f.key] = `{{${f.variable}}}`;
    });
    return JSON.stringify(obj, null, 2);
  }, [value]);

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-slate-400 block">
        Corpo da Requisição (Payload Template)
      </label>
      <p className="text-xs text-slate-500">
        Defina quais campos serão enviados no JSON. Se vazio, o payload padrão do evento será usado.
      </p>

      {/* Field rows */}
      <div className="space-y-2">
        {value.map((field, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={field.key}
              onChange={(e) => updateField(i, { key: e.target.value })}
              placeholder="chave_json"
              className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="relative flex-1">
              <select
                value={field.variable}
                onChange={(e) => updateField(i, { variable: e.target.value })}
                className="h-9 w-full appearance-none rounded-lg border border-slate-700 bg-slate-950 px-3 pr-8 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Selecionar variável...</option>
                {allGroups.map(group => (
                  <optgroup key={group.group} label={group.group}>
                    {group.variables.map(v => (
                      <option key={v.value} value={v.value}>{v.label} ({v.value})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            </div>
            <button
              type="button"
              onClick={() => removeField(i)}
              className="p-2 text-slate-500 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <Button variant="ghost" size="sm" onClick={addField} className="text-xs">
        <Plus className="w-3.5 h-3.5 mr-1" /> Adicionar campo
      </Button>

      {/* Preview */}
      {value.some(f => f.key && f.variable) && (
        <div className="mt-2">
          <label className="text-xs font-medium text-slate-500 block mb-1">Preview JSON</label>
          <pre className="text-xs text-cyan-400 bg-slate-950 border border-slate-700 rounded-lg p-3 overflow-auto max-h-48 font-mono">
            {previewJson}
          </pre>
        </div>
      )}
    </div>
  );
};

export default WebhookPayloadBuilder;
