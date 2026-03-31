import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '../Button';
import {
  Plus, Trash2, Send, Check, X, Loader2, RefreshCw, ExternalLink,
  ChevronDown, Eye, EyeOff, AlertTriangle, CheckCircle, Clock, XCircle, Skull,
  Activity, TrendingUp, BarChart3, Zap, RotateCcw, BookOpen, Settings2, Copy, Webhook
} from 'lucide-react';
import WebhookPayloadBuilder from './WebhookPayloadBuilder';
import WebhookTestModal from './WebhookTestModal';

interface PayloadField {
  key: string;
  variable: string;
}

interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  headers: Record<string, string>;
  signing_secret: string | null;
  payload_template: Record<string, string> | null;
  created_at: string;
}

interface OutboxEvent {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: any;
  idempotency_key: string;
  status: string;
  attempts: number;
  next_retry_at: string;
  last_error: string | null;
  last_status_code: number | null;
  sent_at: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  pending: { icon: <Clock className="w-3.5 h-3.5" />, label: 'Pendente', color: 'text-amber-400 bg-amber-500/10' },
  processing: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, label: 'Processando', color: 'text-blue-400 bg-blue-500/10' },
  sent: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Enviado', color: 'text-emerald-400 bg-emerald-500/10' },
  failed: { icon: <XCircle className="w-3.5 h-3.5" />, label: 'Falhou', color: 'text-red-400 bg-red-500/10' },
  dead_letter: { icon: <Skull className="w-3.5 h-3.5" />, label: 'Dead Letter', color: 'text-red-500 bg-red-500/10' },
};

// ─── Health Panel ─────────────────────────────────────────────
interface HealthMetrics {
  pendingCount: number;
  processingCount: number;
  sentLast24h: number;
  failedLast24h: number;
  deadLetterCount: number;
  oldestPendingAge: string | null; // human-readable
  oldestPendingMinutes: number;
  failureRate24h: number; // percentage
  endpointHealth: { name: string; consecutiveFailures: number; lastError: string | null }[];
}

function computeMetrics(events: OutboxEvent[], endpoints: WebhookEndpoint[]): HealthMetrics {
  const now = Date.now();
  const h24ago = now - 24 * 60 * 60 * 1000;

  const pending = events.filter(e => e.status === 'pending');
  const processing = events.filter(e => e.status === 'processing');
  const sentLast24h = events.filter(e => e.status === 'sent' && e.sent_at && new Date(e.sent_at).getTime() > h24ago).length;
  const failedLast24h = events.filter(e => (e.status === 'failed' || e.status === 'dead_letter') && new Date(e.created_at).getTime() > h24ago).length;
  const deadLetterCount = events.filter(e => e.status === 'dead_letter').length;

  let oldestPendingAge: string | null = null;
  let oldestPendingMinutes = 0;
  if (pending.length > 0) {
    const oldest = pending.reduce((a, b) => new Date(a.created_at) < new Date(b.created_at) ? a : b);
    const diffMs = now - new Date(oldest.created_at).getTime();
    oldestPendingMinutes = Math.floor(diffMs / 60_000);
    if (oldestPendingMinutes < 60) {
      oldestPendingAge = `${oldestPendingMinutes}min`;
    } else if (oldestPendingMinutes < 1440) {
      oldestPendingAge = `${Math.floor(oldestPendingMinutes / 60)}h ${oldestPendingMinutes % 60}min`;
    } else {
      oldestPendingAge = `${Math.floor(oldestPendingMinutes / 1440)}d`;
    }
  }

  const total24h = sentLast24h + failedLast24h;
  const failureRate24h = total24h > 0 ? (failedLast24h / total24h) * 100 : 0;

  // Per-endpoint health: count consecutive failures from most recent events
  const endpointHealth = endpoints.map(ep => {
    const epEvents = events
      .filter(e => e.endpoint_id === ep.id)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    let consecutiveFailures = 0;
    let lastError: string | null = null;
    for (const ev of epEvents) {
      if (ev.status === 'failed' || ev.status === 'dead_letter') {
        consecutiveFailures++;
        if (!lastError) lastError = ev.last_error;
      } else if (ev.status === 'sent') break;
      else continue; // skip pending/processing
    }
    return { name: ep.name, consecutiveFailures, lastError };
  });

  return {
    pendingCount: pending.length,
    processingCount: processing.length,
    sentLast24h,
    failedLast24h,
    deadLetterCount,
    oldestPendingAge,
    oldestPendingMinutes,
    failureRate24h,
    endpointHealth,
  };
}

// ─── Runbook Modal ────────────────────────────────────────────
const RunbookContent: React.FC = () => (
  <div className="space-y-4 text-sm text-slate-300">
    <div>
      <h4 className="text-white font-semibold mb-1">🔧 Pausar um endpoint</h4>
      <p className="text-xs text-slate-400">Na lista de endpoints, use o toggle para desabilitar. Eventos futuros não serão enfileirados e o dispatcher ignorará eventos desse endpoint.</p>
    </div>
    <div>
      <h4 className="text-white font-semibold mb-1">🔄 Reprocessar eventos falhos</h4>
      <p className="text-xs text-slate-400">Clique em "Retry" individual ou use "Replay All Failed" para recolocar todos os eventos failed/dead_letter na fila com status pending.</p>
    </div>
    <div>
      <h4 className="text-white font-semibold mb-1">📋 Inspecionar logs</h4>
      <p className="text-xs text-slate-400">Acesse Cloud → Logs → Edge Functions → dispatch-webhooks. Os logs são estruturados em JSON com delivery_id, endpoint_id, http_status, attempt e elapsed_ms.</p>
    </div>
    <div>
      <h4 className="text-white font-semibold mb-1">🚨 Alertas</h4>
      <p className="text-xs text-slate-400">Configure um webhook de alerta nas configurações. O sistema notifica quando: falhas &gt; 5 em 10min, evento pendente &gt; 30min, ou endpoint com 5+ falhas consecutivas.</p>
    </div>
    <div>
      <h4 className="text-white font-semibold mb-1">💀 Dead Letters</h4>
      <p className="text-xs text-slate-400">Eventos com 10+ tentativas viram dead_letter. Investigue o last_error, corrija o endpoint, e clique em Retry para reprocessar.</p>
    </div>
  </div>
);

// ─── API Doc Section ─────────────────────────────────────────
const ApiDocSection: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [loadingKey, setLoadingKey] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-deal-webhook`;

  // Load existing API key from nina_settings
  useEffect(() => {
    if (expanded && apiKey === null) {
      loadApiKey();
    }
  }, [expanded]);

  const loadApiKey = async () => {
    setLoadingKey(true);
    try {
      const { data } = await supabase
        .from('nina_settings')
        .select('webhook_api_key')
        .limit(1)
        .maybeSingle();
      setApiKey((data as any)?.webhook_api_key || '');
    } catch (e) {
      console.error('Error loading webhook API key:', e);
    } finally {
      setLoadingKey(false);
    }
  };

  const handleGenerateKey = async () => {
    setGeneratingKey(true);
    try {
      const newKey = `wh_${crypto.randomUUID().replace(/-/g, '')}`;
      const { error } = await supabase
        .from('nina_settings')
        .update({ webhook_api_key: newKey } as any)
        .not('id', 'is', null);
      if (error) throw error;
      setApiKey(newKey);
      setShowApiKey(true);
      toast.success('Token de API gerado! Copie e guarde em local seguro.');
    } catch (e: any) {
      toast.error(`Erro ao gerar token: ${e.message}`);
    } finally {
      setGeneratingKey(false);
    }
  };

  const examplePayload = `{
  "phone": "5511999990001",
  "name": "João Silva",
  "email": "joao@email.com",
  "deal_title": "Lead do Facebook",
  "deal_value": 3000,
  "priority": "high",
  "company": "Empresa X",
  "tags": ["Facebook", "Ads"],
  "utm_source": "facebook",
  "custom_fields": {
    "cidade": "São Paulo",
    "interesse": "Plano Pro"
  }
}`;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Webhook className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-white">API de Criação de Deals (Entrada)</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">POST</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-slate-800 p-4 space-y-4">
          <p className="text-xs text-slate-400">
            Use este endpoint para criar deals + contatos via automações externas (Zapier, Make, n8n, etc).
            Os campos personalizados serão preenchidos automaticamente.
          </p>

          {/* URL */}
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">URL do Webhook</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-cyan-400 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 truncate">
                {webhookUrl}
              </code>
              <button onClick={() => copyToClipboard(webhookUrl, 'url')} className="p-2 text-slate-500 hover:text-white transition-colors">
                {copied === 'url' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Auth - API Key */}
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Token de Autenticação (x-api-key)</label>
            <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 space-y-2">
              {loadingKey ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Carregando...
                </div>
              ) : apiKey ? (
                <>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono text-amber-400 truncate">
                      {showApiKey ? apiKey : '••••••••••••••••••••••••••••••••'}
                    </code>
                    <button onClick={() => setShowApiKey(!showApiKey)} className="p-1 text-slate-500 hover:text-white transition-colors">
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => copyToClipboard(apiKey, 'apikey')} className="p-1 text-slate-500 hover:text-white transition-colors">
                      {copied === 'apikey' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleGenerateKey}
                      disabled={generatingKey}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-400 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${generatingKey ? 'animate-spin' : ''}`} />
                      Regenerar token
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={handleGenerateKey}
                  disabled={generatingKey}
                  className="flex items-center gap-2 text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                >
                  {generatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  Gerar Token de API
                </button>
              )}
              <p className="text-xs text-slate-500 mt-1">
                Envie no header: <code className="text-amber-400">x-api-key: SEU_TOKEN</code> ou query param: <code className="text-amber-400">?api_key=SEU_TOKEN</code>
              </p>
            </div>
          </div>

          {/* Fields table */}
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Campos Aceitos</label>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 px-2 text-slate-500 font-medium">Campo</th>
                    <th className="text-left py-2 px-2 text-slate-500 font-medium">Obrig.</th>
                    <th className="text-left py-2 px-2 text-slate-500 font-medium">Alternativas</th>
                    <th className="text-left py-2 px-2 text-slate-500 font-medium">Descrição</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {[
                    ['phone', '✓', 'telefone, phone_number', 'Telefone do contato'],
                    ['name', '—', 'nome', 'Nome do contato'],
                    ['email', '—', '—', 'Email do contato'],
                    ['deal_title', '—', 'titulo', 'Título do deal'],
                    ['deal_value', '—', 'valor', 'Valor monetário'],
                    ['priority', '—', 'prioridade', 'low, medium, high'],
                    ['company', '—', 'empresa', 'Empresa do contato'],
                    ['tags', '—', '—', 'Array de tags'],
                    ['stage_id', '—', '—', 'ID do estágio (senão usa o primeiro)'],
                    ['utm_source', '—', '—', 'UTM Source (+ medium, campaign, content, term)'],
                    ['custom_fields', '—', 'campos_personalizados', 'Objeto { field_key: valor }'],
                  ].map(([field, req, alt, desc], i) => (
                    <tr key={i} className="border-b border-slate-800 last:border-0">
                      <td className="py-1.5 px-2 font-mono text-cyan-400">{field}</td>
                      <td className={`py-1.5 px-2 ${req === '✓' ? 'text-emerald-400' : 'text-slate-500'}`}>{req}</td>
                      <td className="py-1.5 px-2 font-mono text-slate-500">{alt}</td>
                      <td className="py-1.5 px-2">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Example */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-500">Exemplo de Payload</label>
              <button onClick={() => copyToClipboard(examplePayload, 'payload')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors">
                {copied === 'payload' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied === 'payload' ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <pre className="text-xs text-cyan-400 bg-slate-950 border border-slate-700 rounded-lg p-3 overflow-auto max-h-64 font-mono">
              {examplePayload}
            </pre>
          </div>

          {/* Tips */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1">
            <p className="text-xs text-primary font-medium">💡 Dicas</p>
            <ul className="text-xs text-slate-400 space-y-1 list-disc pl-4">
              <li>Os <code className="text-primary">custom_fields</code> usam a mesma <strong>field_key</strong> configurada em Campos Personalizados.</li>
              <li>Se o telefone já existir, o contato é atualizado com os novos dados.</li>
              <li>Se <code className="text-primary">stage_id</code> não for enviado, o deal vai para a primeira etapa do pipeline.</li>
              <li>Aceita UTMs: <code className="text-primary">utm_source, utm_medium, utm_campaign, utm_content, utm_term</code>.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────
const WebhookSettings: React.FC = () => {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showRunbook, setShowRunbook] = useState(false);
  const [replayingAll, setReplayingAll] = useState(false);
  const [testModalEndpoint, setTestModalEndpoint] = useState<WebhookEndpoint | null>(null);

  // New endpoint form
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [newPayloadFields, setNewPayloadFields] = useState<PayloadField[]>([]);
  const [editingEndpointId, setEditingEndpointId] = useState<string | null>(null);
  const [editPayloadFields, setEditPayloadFields] = useState<PayloadField[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [epRes, evRes] = await Promise.all([
        supabase.from('webhook_endpoints').select('*').order('created_at', { ascending: false }),
        supabase.from('webhook_outbox').select('*').order('created_at', { ascending: false }).limit(200),
      ]);

      if (epRes.data) setEndpoints(epRes.data as any);
      if (evRes.data) setEvents(evRes.data as any);
    } catch (e) {
      console.error('Error loading webhook data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const metrics = useMemo(() => computeMetrics(events, endpoints), [events, endpoints]);

  const handleAddEndpoint = async () => {
    if (!newName.trim() || !newUrl.trim()) {
      toast.error('Nome e URL são obrigatórios');
      return;
    }
    try {
      // Build payload_template from fields
      const template: Record<string, string> = {};
      newPayloadFields.forEach(f => {
        if (f.key && f.variable) template[f.key] = `{{${f.variable}}}`;
      });

      const { error } = await supabase.from('webhook_endpoints').insert({
        name: newName.trim(), url: newUrl.trim(),
        signing_secret: newSecret.trim() || null, enabled: true, headers: {},
        payload_template: Object.keys(template).length > 0 ? template : null,
      } as any);
      if (error) throw error;
      toast.success('Endpoint criado!');
      setNewName(''); setNewUrl(''); setNewSecret(''); setNewPayloadFields([]); setShowAddForm(false);
      loadData();
    } catch (e: any) { toast.error(`Erro: ${e.message}`); }
  };

  const handleDeleteEndpoint = async (id: string) => {
    if (!confirm('Deletar este endpoint? Todos os eventos associados também serão removidos.')) return;
    try {
      const { error } = await supabase.from('webhook_endpoints').delete().eq('id', id);
      if (error) throw error;
      toast.success('Endpoint removido'); loadData();
    } catch (e: any) { toast.error(`Erro: ${e.message}`); }
  };

  const handleToggleEndpoint = async (id: string, enabled: boolean) => {
    try {
      const { error } = await supabase.from('webhook_endpoints').update({ enabled: !enabled } as any).eq('id', id);
      if (error) throw error; loadData();
    } catch (e: any) { toast.error(`Erro: ${e.message}`); }
  };

  const handleTestEndpoint = async (endpoint: WebhookEndpoint) => {
    setTestingId(endpoint.id);
    try {
      const { data, error } = await supabase.functions.invoke('enqueue-event', {
        body: { event_type: 'test.ping', payload: { message: 'Test ping', timestamp: new Date().toISOString() }, endpoint_id: endpoint.id },
      });
      if (error) throw error;
      toast.success(`Evento de teste enfileirado! (${data?.enqueued || 0} eventos)`); loadData();
    } catch (e: any) { toast.error(`Erro ao testar: ${e.message}`); }
    finally { setTestingId(null); }
  };

  const handleDispatch = async () => {
    setDispatching(true);
    try {
      const { data, error } = await supabase.functions.invoke('dispatch-webhooks');
      if (error) throw error;
      toast.success(`Dispatch: ${data?.sent || 0} enviados, ${data?.failed || 0} falhas, ${data?.deadLetter || 0} dead letter`);
      loadData();
    } catch (e: any) { toast.error(`Erro no dispatch: ${e.message}`); }
    finally { setDispatching(false); }
  };

  const handleRetry = async (eventId: string) => {
    try {
      const { error } = await supabase.from('webhook_outbox')
        .update({ status: 'pending', next_retry_at: new Date().toISOString(), attempts: 0 } as any)
        .eq('id', eventId);
      if (error) throw error;
      toast.success('Evento reagendado'); loadData();
    } catch (e: any) { toast.error(`Erro: ${e.message}`); }
  };

  const handleReplayAllFailed = async () => {
    const failedIds = events.filter(e => e.status === 'failed' || e.status === 'dead_letter').map(e => e.id);
    if (failedIds.length === 0) { toast.info('Nenhum evento falho para reprocessar'); return; }
    if (!confirm(`Reprocessar ${failedIds.length} evento(s) falho(s)?`)) return;
    setReplayingAll(true);
    try {
      const { error } = await supabase.from('webhook_outbox')
        .update({ status: 'pending', next_retry_at: new Date().toISOString(), attempts: 0 } as any)
        .in('id', failedIds);
      if (error) throw error;
      toast.success(`${failedIds.length} evento(s) recolocado(s) na fila`); loadData();
    } catch (e: any) { toast.error(`Erro: ${e.message}`); }
    finally { setReplayingAll(false); }
  };

  const getEndpointName = (id: string) => endpoints.find(ep => ep.id === id)?.name || 'Desconhecido';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasAlerts = metrics.oldestPendingMinutes > 30 || metrics.failureRate24h > 20 ||
    metrics.endpointHealth.some(e => e.consecutiveFailures >= 5);

  return (
    <div className="space-y-6">
      {/* ─── Health Panel ─────────────────────────────────── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-white">Saúde do Sistema</h3>
            {hasAlerts && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-amber-400 bg-amber-500/10">
                <AlertTriangle className="w-3 h-3" /> Atenção
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowRunbook(!showRunbook)} className="text-xs">
              <BookOpen className="w-3.5 h-3.5 mr-1" /> Runbook
            </Button>
            <Button variant="ghost" size="sm" onClick={loadData} className="text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Metrics cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
          <MetricCard label="Fila pendente" value={metrics.pendingCount + metrics.processingCount}
            alert={metrics.pendingCount > 20} icon={<Clock className="w-4 h-4" />} />
          <MetricCard label="Enviados (24h)" value={metrics.sentLast24h}
            icon={<CheckCircle className="w-4 h-4" />} color="text-emerald-400" />
          <MetricCard label="Falhas (24h)" value={metrics.failedLast24h}
            alert={metrics.failedLast24h > 5} icon={<XCircle className="w-4 h-4" />} />
          <MetricCard label="Dead Letters" value={metrics.deadLetterCount}
            alert={metrics.deadLetterCount > 0} icon={<Skull className="w-4 h-4" />} />
          <MetricCard label="Mais antigo" value={metrics.oldestPendingAge || '—'}
            alert={metrics.oldestPendingMinutes > 30} icon={<TrendingUp className="w-4 h-4" />} />
        </div>

        {/* Failure rate bar */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 w-24 shrink-0">Taxa falhas 24h</span>
          <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${metrics.failureRate24h > 20 ? 'bg-red-500' : metrics.failureRate24h > 5 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(metrics.failureRate24h, 100)}%` }}
            />
          </div>
          <span className={`text-xs font-mono w-12 text-right ${metrics.failureRate24h > 20 ? 'text-red-400' : 'text-slate-400'}`}>
            {metrics.failureRate24h.toFixed(1)}%
          </span>
        </div>

        {/* Endpoint health alerts */}
        {metrics.endpointHealth.filter(e => e.consecutiveFailures >= 3).length > 0 && (
          <div className="mt-3 space-y-1">
            {metrics.endpointHealth.filter(e => e.consecutiveFailures >= 3).map((ep, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${ep.consecutiveFailures >= 5 ? 'text-red-400' : 'text-amber-400'}`} />
                <span className="text-xs text-slate-300">
                  <strong className="text-white">{ep.name}</strong>: {ep.consecutiveFailures} falhas consecutivas
                </span>
                {ep.lastError && <span className="text-xs text-slate-500 truncate max-w-xs">— {ep.lastError}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Runbook */}
        {showRunbook && (
          <div className="mt-4 p-4 rounded-lg border border-slate-700 bg-slate-950/50">
            <RunbookContent />
          </div>
        )}
      </div>

      {/* ─── API de Criação de Deals ─────────────────── */}
      <ApiDocSection />

      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Webhook Endpoints (Saída)</h3>
          <p className="text-xs text-slate-400 mt-1">Configure destinos para envio automático de eventos via HTTP webhooks.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleDispatch} disabled={dispatching}>
            {dispatching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Dispatch Agora
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="w-4 h-4 mr-2" /> Novo Endpoint
          </Button>
        </div>
      </div>

      {/* ─── Add form ────────────────────────────────────── */}
      {showAddForm && (
        <div className="rounded-xl border border-primary/20 bg-slate-900/50 p-6 space-y-4">
          <h4 className="text-sm font-medium text-white">Novo Endpoint</h4>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">Nome</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="HubSpot CRM"
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">URL</label>
              <input type="url" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://api.hubspot.com/webhooks/v1/..."
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">
              Signing Secret <span className="text-slate-500">(HMAC SHA-256, opcional)</span>
            </label>
            <div className="relative">
              <input type={showSecret ? 'text' : 'password'} value={newSecret} onChange={(e) => setNewSecret(e.target.value)} placeholder="whsec_..."
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 pr-10 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/50" />
              <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <WebhookPayloadBuilder value={newPayloadFields} onChange={setNewPayloadFields} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setShowAddForm(false); setNewPayloadFields([]); }}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={handleAddEndpoint}><Check className="w-4 h-4 mr-1" /> Salvar</Button>
          </div>
        </div>
      )}

      {/* ─── Endpoints list ──────────────────────────────── */}
      {endpoints.length === 0 && !showAddForm ? (
        <div className="text-center py-12 text-slate-500">
          <ExternalLink className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Nenhum endpoint configurado</p>
          <p className="text-xs mt-1">Clique em "Novo Endpoint" para adicionar um destino de webhook</p>
        </div>
      ) : (
        <div className="space-y-3">
          {endpoints.map((ep) => (
            <div key={ep.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${ep.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                  <div>
                    <p className="text-sm font-medium text-white">{ep.name}</p>
                    <p className="text-xs text-slate-500 font-mono truncate max-w-md">{ep.url}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => {
                    if (editingEndpointId === ep.id) {
                      setEditingEndpointId(null);
                    } else {
                      // Parse existing template into fields
                      const fields: PayloadField[] = [];
                      if (ep.payload_template) {
                        Object.entries(ep.payload_template).forEach(([key, val]) => {
                          const match = String(val).match(/^\{\{(.+?)\}\}$/);
                          fields.push({ key, variable: match ? match[1] : '' });
                        });
                      }
                      setEditPayloadFields(fields);
                      setEditingEndpointId(ep.id);
                    }
                  }} className="text-xs">
                    <Settings2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleTestEndpoint(ep)} disabled={testingId === ep.id} className="text-xs" title="Ping de teste">
                    {testingId === ep.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setTestModalEndpoint(ep)} className="text-xs text-primary hover:text-primary/80" title="Testar com lead real">
                    <Zap className="w-3.5 h-3.5" />
                  </Button>
                  <button onClick={() => handleToggleEndpoint(ep.id, ep.enabled)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors ${ep.enabled ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                    <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg transition-transform ${ep.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteEndpoint(ep.id)} className="text-red-400 hover:text-red-300">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              {/* Payload template badge */}
              {ep.payload_template && Object.keys(ep.payload_template).length > 0 && editingEndpointId !== ep.id && (
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    Payload personalizado ({Object.keys(ep.payload_template).length} campos)
                  </span>
                </div>
              )}
              {/* Inline edit payload template */}
              {editingEndpointId === ep.id && (
                <div className="border-t border-slate-800 pt-3 space-y-3">
                  <WebhookPayloadBuilder value={editPayloadFields} onChange={setEditPayloadFields} />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingEndpointId(null)}>Cancelar</Button>
                    <Button variant="primary" size="sm" onClick={async () => {
                      const template: Record<string, string> = {};
                      editPayloadFields.forEach(f => {
                        if (f.key && f.variable) template[f.key] = `{{${f.variable}}}`;
                      });
                      try {
                        const { error } = await supabase.from('webhook_endpoints')
                          .update({ payload_template: Object.keys(template).length > 0 ? template : null } as any)
                          .eq('id', ep.id);
                        if (error) throw error;
                        toast.success('Template de payload atualizado!');
                        setEditingEndpointId(null);
                        loadData();
                      } catch (e: any) { toast.error(`Erro: ${e.message}`); }
                    }}>
                      <Check className="w-4 h-4 mr-1" /> Salvar Template
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Events history ──────────────────────────────── */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Histórico de Eventos</h3>
          <div className="flex items-center gap-2">
            {events.some(e => e.status === 'failed' || e.status === 'dead_letter') && (
              <Button variant="outline" size="sm" onClick={handleReplayAllFailed} disabled={replayingAll} className="text-xs">
                {replayingAll ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
                Replay All Failed
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={loadData}>
              <RefreshCw className="w-4 h-4 mr-1" /> Atualizar
            </Button>
          </div>
        </div>

        {events.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <p className="text-sm">Nenhum evento ainda</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
            {events.map((ev) => {
              const statusCfg = STATUS_CONFIG[ev.status] || STATUS_CONFIG.pending;
              return (
                <div key={ev.id} className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                        {statusCfg.icon} {statusCfg.label}
                      </span>
                      <span className="text-xs font-mono text-slate-300">{ev.event_type}</span>
                      <span className="text-xs text-slate-600">→ {getEndpointName(ev.endpoint_id)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {ev.last_status_code && (
                        <span className={`text-xs font-mono ${ev.last_status_code < 300 ? 'text-emerald-500' : 'text-red-400'}`}>
                          {ev.last_status_code}
                        </span>
                      )}
                      {ev.attempts > 0 && <span className="text-xs text-slate-500">{ev.attempts}/10</span>}
                      {(ev.status === 'failed' || ev.status === 'dead_letter') && (
                        <Button variant="ghost" size="sm" onClick={() => handleRetry(ev.id)} className="text-xs text-amber-400">
                          <RefreshCw className="w-3 h-3 mr-1" /> Retry
                        </Button>
                      )}
                      <span className="text-xs text-slate-600">
                        {new Date(ev.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  {ev.last_error && (
                    <div className="mt-2 p-2 rounded bg-red-500/5 border border-red-500/10">
                      <p className="text-xs text-red-400 font-mono truncate">{ev.last_error}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Test with real lead modal */}
      {testModalEndpoint && (
        <WebhookTestModal
          endpointId={testModalEndpoint.id}
          endpointName={testModalEndpoint.name}
          payloadTemplate={testModalEndpoint.payload_template}
          onClose={() => { setTestModalEndpoint(null); loadData(); }}
        />
      )}
    </div>
  );
};

// ─── MetricCard ──────────────────────────────────────────────
const MetricCard: React.FC<{
  label: string; value: number | string;
  icon: React.ReactNode; alert?: boolean; color?: string;
}> = ({ label, value, icon, alert, color }) => (
  <div className={`rounded-lg border p-3 ${alert ? 'border-red-500/30 bg-red-500/5' : 'border-slate-800 bg-slate-950/50'}`}>
    <div className="flex items-center gap-2 mb-1">
      <span className={alert ? 'text-red-400' : color || 'text-slate-500'}>{icon}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
    <p className={`text-lg font-bold ${alert ? 'text-red-400' : color || 'text-white'}`}>{value}</p>
  </div>
);

export default WebhookSettings;
