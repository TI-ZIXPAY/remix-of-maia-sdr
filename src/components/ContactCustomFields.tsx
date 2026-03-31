import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Loader2, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CustomField {
  id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  options: string[];
  is_required: boolean;
}

interface FieldValue {
  field_id: string;
  value: string | null;
}

interface ContactCustomFieldsProps {
  contactId: string;
}

const ContactCustomFields: React.FC<ContactCustomFieldsProps> = ({ contactId }) => {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    // Fetch active fields
    const { data: fieldDefs } = await supabase
      .from('contact_custom_fields')
      .select('*')
      .eq('is_active', true)
      .order('position', { ascending: true });

    if (!fieldDefs || fieldDefs.length === 0) {
      setFields([]);
      setLoading(false);
      return;
    }

    setFields(fieldDefs.map((f: any) => ({
      ...f,
      options: Array.isArray(f.options) ? f.options : [],
    })));

    // Fetch values for this contact
    const { data: fieldValues } = await supabase
      .from('contact_custom_field_values')
      .select('field_id, value')
      .eq('contact_id', contactId);

    const valMap: Record<string, string> = {};
    (fieldValues || []).forEach((fv: any) => {
      valMap[fv.field_id] = fv.value || '';
    });
    setValues(valMap);
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Realtime subscription for value changes
  useEffect(() => {
    const channel = supabase
      .channel(`custom-fields-${contactId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'contact_custom_field_values',
        filter: `contact_id=eq.${contactId}`,
      }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [contactId, fetchData]);

  const handleSave = async (field: CustomField) => {
    setSaving(true);
    const { error } = await supabase
      .from('contact_custom_field_values')
      .upsert(
        {
          contact_id: contactId,
          field_id: field.id,
          value: editValue.trim() || null,
        },
        { onConflict: 'contact_id,field_id' }
      );

    if (error) {
      toast.error('Erro ao salvar campo');
      console.error(error);
    } else {
      setValues(prev => ({ ...prev, [field.id]: editValue.trim() }));
      // Trigger lead score recalculation
      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        fetch(`https://${projectId}.supabase.co/functions/v1/recalculate-lead-score`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ contact_id: contactId }),
        }).catch(e => console.error('Score recalc error:', e));
      } catch (e) {
        console.error('Score recalc error:', e);
      }
    }
    setEditingKey(null);
    setSaving(false);
  };

  if (loading) return null;
  if (fields.length === 0) return null;

  return (
    <>
      <div className="h-px bg-slate-800/50 w-full"></div>
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Dados do Contato
        </h4>
        <div className="space-y-2">
          {fields.map(field => {
            const currentValue = values[field.id] || '';
            const isEditing = editingKey === field.id;

            return (
              <div key={field.id} className="group">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">{field.field_label}</span>
                {isEditing ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    {field.field_type === 'select' ? (
                      <select
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        autoFocus
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-cyan-500"
                      >
                        <option value="">---</option>
                        {field.options.map(opt => (
                          <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
                        ))}
                      </select>
                    ) : field.field_type === 'boolean' ? (
                      <select
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        autoFocus
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-cyan-500"
                      >
                        <option value="">---</option>
                        <option value="sim">Sim</option>
                        <option value="não">Não</option>
                      </select>
                    ) : field.field_type === 'multiselect' ? (
                      <select
                        value={editValue}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, o => o.value);
                          setEditValue(selected.join(', '));
                        }}
                        multiple
                        autoFocus
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-cyan-500 min-h-[80px]"
                      >
                        {field.options.map(opt => (
                          <option key={String(opt)} value={String(opt)} selected={editValue.split(', ').includes(String(opt))}>{String(opt)}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : field.field_type === 'datetime' ? 'datetime-local' : 'text'}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSave(field);
                          if (e.key === 'Escape') setEditingKey(null);
                        }}
                        className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 outline-none focus:border-cyan-500"
                      />
                    )}
                    <button
                      onClick={() => handleSave(field)}
                      disabled={saving}
                      className="p-1 text-cyan-400 hover:text-cyan-300"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : '✓'}
                    </button>
                    <button
                      onClick={() => setEditingKey(null)}
                      className="p-1 text-slate-500 hover:text-slate-300"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => {
                      setEditingKey(field.id);
                      setEditValue(currentValue);
                    }}
                    className="flex items-center justify-between cursor-pointer hover:bg-slate-800/50 rounded px-1 py-0.5 -mx-1 transition-colors"
                  >
                    <span className={`text-sm ${currentValue ? 'text-slate-200' : 'text-slate-600 italic'}`}>
                      {currentValue || '---'}
                    </span>
                    <Pencil className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default ContactCustomFields;
