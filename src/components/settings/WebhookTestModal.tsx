import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '../Button';
import {
  X, Search, Loader2, Send, User, Phone, ChevronDown, Eye, Zap, CheckCircle
} from 'lucide-react';

interface Contact {
  id: string;
  name: string | null;
  phone_number: string;
  email: string | null;
  call_name: string | null;
  tags: string[] | null;
}

interface CustomFieldValue {
  value: string | null;
  field: {
    field_key: string;
    field_label: string;
    field_type: string;
    options: any;
  };
}

interface Props {
  endpointId: string;
  endpointName: string;
  payloadTemplate: Record<string, string> | null;
  onClose: () => void;
}

/** Normalize a field value for select fields to match the exact registered label */
function normalizeFieldValue(rawValue: string | null, fieldDef: any): string | null {
  if (!rawValue) return rawValue;
  if (fieldDef.field_type !== 'select') return rawValue;
  const options: string[] = fieldDef.options || [];
  if (options.length === 0) return rawValue;
  const exactMatch = options.find((opt: string) => opt === rawValue);
  if (exactMatch) return exactMatch;
  const lowerRaw = rawValue.toLowerCase().trim();
  const ciMatch = options.find((opt: string) => opt.toLowerCase().trim() === lowerRaw);
  if (ciMatch) return ciMatch;
  const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const strippedRaw = stripAccents(rawValue);
  const accentMatch = options.find((opt: string) => stripAccents(opt) === strippedRaw);
  if (accentMatch) return accentMatch;
  const toSlug = (s: string) => stripAccents(s).replace(/[\s\-_]+/g, '');
  const slugMatch = options.find((opt: string) => toSlug(opt) === toSlug(rawValue));
  if (slugMatch) return slugMatch;
  const partialMatch = options.find((opt: string) => {
    const optLower = stripAccents(opt);
    return optLower.includes(strippedRaw) || strippedRaw.includes(optLower);
  });
  if (partialMatch) return partialMatch;
  return rawValue;
}

const EVENT_TYPES = [
  { value: 'lead.new', label: 'Lead Novo' },
  { value: 'lead.handoff', label: 'Handoff' },
  { value: 'lead.qualified', label: 'Lead Qualificado' },
  { value: 'deal.stage_changed', label: 'Mudança de Estágio' },
  { value: 'appointment.scheduled', label: 'Agendamento Criado' },
  { value: 'followup.completed', label: 'Follow-up Concluído' },
  { value: 'test.ping', label: 'Teste Ping' },
];

const WebhookTestModal: React.FC<Props> = ({ endpointId, endpointName, payloadTemplate, onClose }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [eventType, setEventType] = useState('lead.handoff');
  const [loading, setLoading] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [preview, setPreview] = useState<Record<string, any> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    setLoadingContacts(true);
    try {
      const { data } = await supabase
        .from('contacts')
        .select('id, name, phone_number, email, call_name, tags')
        .order('last_activity', { ascending: false })
        .limit(100);
      setContacts(data || []);
    } catch (e) {
      console.error('Error loading contacts:', e);
    } finally {
      setLoadingContacts(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.call_name || '').toLowerCase().includes(q) ||
      c.phone_number.includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  }, [contacts, search]);

  // Build full payload with all contact + custom field data
  const buildFullPayload = async (contact: Contact) => {
    const [contactRes, customRes, allFieldsRes, conversationRes] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', contact.id).single(),
      supabase.from('contact_custom_field_values')
        .select('value, field:contact_custom_fields(field_key, field_label, field_type, options)')
        .eq('contact_id', contact.id),
      supabase.from('contact_custom_fields').select('field_key, field_label, field_type, options').eq('is_active', true).order('position'),
      supabase.from('conversations').select('id, handoff_summary, status, started_at, last_message_at').eq('contact_id', contact.id).order('last_message_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    const contactData = contactRes.data as any;
    const customValues = (customRes.data || []) as unknown as CustomFieldValue[];
    const allFields = (allFieldsRes.data || []) as any[];
    const conversationData = conversationRes.data as any;

    // Build custom_fields object with ALL fields (even if null)
    const customFieldsObj: Record<string, string | null> = {};
    for (const field of allFields) {
      const cfv = customValues.find(cv => cv.field?.field_key === field.field_key);
      customFieldsObj[field.field_key] = normalizeFieldValue(cfv?.value ?? null, field);
    }

    return { contactData, customFieldsObj, conversationData };
  };

  const loadPreview = async (contact: Contact) => {
    setLoadingPreview(true);
    try {
      const { contactData, customFieldsObj, conversationData } = await buildFullPayload(contact);
      const hasTemplate = payloadTemplate && Object.keys(payloadTemplate).length > 0;

      if (hasTemplate) {
        // Resolve template variables
        const resolved: Record<string, any> = {};
        for (const [jsonKey, varExpr] of Object.entries(payloadTemplate!)) {
          const match = varExpr.match(/^\{\{(.+?)\}\}$/);
          if (!match) { resolved[jsonKey] = varExpr; continue; }
          const varPath = match[1];
          if (varPath.startsWith('contact.') && contactData) {
            resolved[jsonKey] = contactData[varPath.replace('contact.', '')] ?? null;
          } else if (varPath.startsWith('custom.')) {
            resolved[jsonKey] = customFieldsObj[varPath.replace('custom.', '')] ?? null;
          } else if (varPath === 'event.type') { resolved[jsonKey] = eventType; }
          else if (varPath === 'event.timestamp') { resolved[jsonKey] = new Date().toISOString(); }
          else if (varPath === 'event.handoff_summary') { resolved[jsonKey] = conversationData?.handoff_summary ?? null; }
          else { resolved[jsonKey] = null; }
        }
        setPreview(resolved);
      } else {
        // No template: send ALL data
        setPreview({
          event_type: eventType,
          timestamp: new Date().toISOString(),
          is_test: true,
          handoff_summary: conversationData?.handoff_summary ?? null,
          contact: {
            id: contactData?.id ?? null,
            name: contactData?.name ?? null,
            call_name: contactData?.call_name ?? null,
            phone_number: contactData?.phone_number ?? null,
            email: contactData?.email ?? null,
            tags: contactData?.tags ?? [],
            lead_score: contactData?.lead_score ?? null,
            lead_classification: contactData?.lead_classification ?? null,
            notes: contactData?.notes ?? null,
            utm_source: contactData?.utm_source ?? null,
            utm_medium: contactData?.utm_medium ?? null,
            utm_campaign: contactData?.utm_campaign ?? null,
            first_contact_date: contactData?.first_contact_date ?? null,
            last_activity: contactData?.last_activity ?? null,
          },
          conversation: {
            id: conversationData?.id ?? null,
            status: conversationData?.status ?? null,
            started_at: conversationData?.started_at ?? null,
            last_message_at: conversationData?.last_message_at ?? null,
            handoff_summary: conversationData?.handoff_summary ?? null,
          },
          custom_fields: customFieldsObj,
        });
      }
    } catch (e) {
      console.error('Error loading preview:', e);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact);
    setSent(false);
    loadPreview(contact);
  };

  const handleSend = async () => {
    if (!selectedContact) return;
    setLoading(true);
    try {
      const { contactData, customFieldsObj, conversationData } = await buildFullPayload(selectedContact);

      const payload: any = {
        contact_id: selectedContact.id,
        event_type: eventType,
        timestamp: new Date().toISOString(),
        is_test: true,
        handoff_summary: conversationData?.handoff_summary ?? null,
        contact: {
          id: contactData?.id ?? null,
          name: contactData?.name ?? null,
          call_name: contactData?.call_name ?? null,
          phone_number: contactData?.phone_number ?? null,
          email: contactData?.email ?? null,
          tags: contactData?.tags ?? [],
          lead_score: contactData?.lead_score ?? null,
          lead_classification: contactData?.lead_classification ?? null,
          notes: contactData?.notes ?? null,
          utm_source: contactData?.utm_source ?? null,
          utm_medium: contactData?.utm_medium ?? null,
          utm_campaign: contactData?.utm_campaign ?? null,
          first_contact_date: contactData?.first_contact_date ?? null,
          last_activity: contactData?.last_activity ?? null,
        },
        conversation: {
          id: conversationData?.id ?? null,
          status: conversationData?.status ?? null,
          started_at: conversationData?.started_at ?? null,
          last_message_at: conversationData?.last_message_at ?? null,
          handoff_summary: conversationData?.handoff_summary ?? null,
        },
        custom_fields: customFieldsObj,
      };

      const { data, error } = await supabase.functions.invoke('enqueue-event', {
        body: {
          event_type: eventType,
          payload,
          endpoint_id: endpointId,
          idempotency_key: `test-${endpointId}-${selectedContact.id}-${Date.now()}`,
        },
      });
      if (error) throw error;
      setSent(true);
      toast.success(`Webhook de teste disparado para "${endpointName}"!`);
    } catch (e: any) {
      toast.error(`Erro ao disparar: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Testar Webhook com Lead Real
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Endpoint: <span className="text-slate-300">{endpointName}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-5" style={{ maxHeight: 'calc(90vh - 140px)' }}>
          {/* Event type selector */}
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">Tipo de Evento</label>
            <div className="flex flex-wrap gap-2">
              {EVENT_TYPES.map(et => (
                <button
                  key={et.value}
                  onClick={() => { setEventType(et.value); if (selectedContact) loadPreview(selectedContact); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    eventType === et.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  {et.label}
                </button>
              ))}
            </div>
          </div>

          {/* Contact search */}
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">Selecionar Lead</label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nome, telefone ou email..."
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {loadingContacts ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
                {filtered.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">Nenhum contato encontrado</p>
                ) : (
                  filtered.slice(0, 30).map(contact => (
                    <button
                      key={contact.id}
                      onClick={() => handleSelectContact(contact)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        selectedContact?.id === contact.id
                          ? 'bg-primary/10 border-l-2 border-primary'
                          : 'hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{contact.name || contact.call_name || 'Sem nome'}</p>
                        <p className="text-xs text-slate-500 font-mono truncate">{contact.phone_number}</p>
                      </div>
                      {contact.email && (
                        <span className="text-xs text-slate-500 truncate max-w-[120px]">{contact.email}</span>
                      )}
                      {contact.tags && contact.tags.length > 0 && (
                        <div className="flex gap-1">
                          {contact.tags.slice(0, 2).map((tag, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{tag}</span>
                          ))}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Payload preview */}
          {selectedContact && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Eye className="w-3.5 h-3.5 text-slate-500" />
                <label className="text-xs font-medium text-slate-400">
                  Preview do Payload {payloadTemplate && Object.keys(payloadTemplate).length > 0 ? '(Template)' : '(Completo)'}
                </label>
              </div>
              {loadingPreview ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                </div>
              ) : preview ? (
                <pre className="text-xs text-cyan-400 bg-slate-950 border border-slate-700 rounded-lg p-3 overflow-auto max-h-64 font-mono">
                  {JSON.stringify(preview, null, 2)}
                </pre>
              ) : null}
            </div>
          )}

          {/* Success state */}
          {sent && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <p className="text-xs text-emerald-400">
                Evento enfileirado com sucesso! Verifique a fila de eventos abaixo para acompanhar o status.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-6 py-4">
          <Button variant="ghost" size="sm" onClick={onClose}>Fechar</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={!selectedContact || loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Disparar Teste
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WebhookTestModal;
