import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Unplug, Pencil, Copy, Check, Loader2, QrCode, Link2, Trash2, Power, PowerOff } from 'lucide-react';
import { Button } from './Button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface UazapiInstanceCardProps {
  instanceId: string;
  instanceName: string;
  endpoint: string;
  sessionKey: string;
  isActive?: boolean;
  onEditClick: () => void;
  onConnectClick: () => void;
  onDeleteClick: () => void;
  onToggleClick?: () => void;
}

type InstanceStatus = 'loading' | 'connected' | 'disconnected' | 'connecting' | 'error';

export const UazapiInstanceCard: React.FC<UazapiInstanceCardProps> = ({
  instanceId,
  instanceName,
  endpoint,
  sessionKey,
  isActive = true,
  onEditClick,
  onConnectClick,
  onDeleteClick,
  onToggleClick,
}) => {
  const [status, setStatus] = useState<InstanceStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [configuringWebhook, setConfiguringWebhook] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/uazapi-webhook`;

  const checkStatus = useCallback(async () => {
    if (!isActive) {
      setStatus('disconnected');
      return;
    }
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('uazapi-connect', {
        body: { action: 'status', instance_id: instanceId },
      });
      if (error) throw error;

      const s = data?.status?.toLowerCase?.() || '';

      if (s === 'connected' || s === 'open') {
        setStatus('connected');
      } else if (s === 'connecting') {
        setStatus('connecting');
      } else {
        setStatus('disconnected');
      }
    } catch (e) {
      console.error('[InstanceCard] Status error:', e);
      setStatus('error');
    } finally {
      setRefreshing(false);
    }
  }, [instanceId, isActive]);

  useEffect(() => {
    if (instanceId && endpoint && sessionKey) {
      checkStatus();
    }
  }, [instanceId, endpoint, sessionKey, checkStatus]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('uazapi-connect', {
        body: { action: 'disconnect', instance_id: instanceId },
      });
      if (error) throw error;
      toast.success('Instância desconectada');
      setStatus('disconnected');
    } catch (e) {
      console.error('[InstanceCard] Disconnect error:', e);
      toast.error('Erro ao desconectar instância');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleConfigureWebhook = async () => {
    setConfiguringWebhook(true);
    try {
      const { data, error } = await supabase.functions.invoke('uazapi-connect', {
        body: { action: 'configure-webhook', instance_id: instanceId },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success('Webhook configurado com sucesso!');
      } else {
        toast.error('Falha ao configurar webhook');
      }
    } catch (e) {
      console.error('[InstanceCard] Webhook error:', e);
      toast.error('Erro ao configurar webhook');
    } finally {
      setConfiguringWebhook(false);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
    toast.success('Copiado!');
  };

  const statusConfig = {
    loading: { color: 'bg-slate-500', text: 'Verificando...', textColor: 'text-slate-400', dotPulse: true },
    connected: { color: 'bg-emerald-500', text: 'Conectado', textColor: 'text-emerald-400', dotPulse: false },
    disconnected: { color: 'bg-red-500', text: 'Desconectado', textColor: 'text-red-400', dotPulse: false },
    connecting: { color: 'bg-amber-500', text: 'Conectando...', textColor: 'text-amber-400', dotPulse: true },
    error: { color: 'bg-red-500', text: 'Erro', textColor: 'text-red-400', dotPulse: false },
  };

  const cfg = isActive ? statusConfig[status] : { color: 'bg-slate-600', text: 'Desativado', textColor: 'text-slate-500', dotPulse: false };

  return (
    <div className={`rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden transition-opacity ${!isActive ? 'opacity-50' : ''}`}>
      {/* Instance info row */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700/30">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Instância</p>
          <p className="text-slate-200 text-sm font-medium">{instanceName}</p>
        </div>
        <div className="flex items-center gap-3">
          {!isActive && (
            <span className="px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-[10px] font-semibold uppercase tracking-wider text-red-400">
              Desativado
            </span>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Status</p>
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${cfg.color} ${cfg.dotPulse ? 'animate-pulse' : ''}`} />
              <span className={`text-xs font-medium ${cfg.textColor}`}>{cfg.text}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Webhook URL + Actions */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500 shrink-0">
            <Link2 className="w-3 h-3" />
            Webhook
          </div>
          <div className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-slate-700/50 text-[11px] text-slate-400 font-mono truncate">
            {webhookUrl}
          </div>
          <button
            onClick={() => copyText(webhookUrl)}
            className="p-1.5 rounded-md border border-slate-700/50 bg-slate-900/50 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
          >
            {copiedWebhook ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={checkStatus}
            disabled={refreshing || !isActive}
            title="Atualizar status"
            className="p-2 rounded-lg border border-slate-700/50 bg-slate-900/50 text-slate-400 hover:text-white hover:border-slate-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleConfigureWebhook}
            disabled={configuringWebhook || !isActive}
            title="Configurar webhook"
            className="p-2 rounded-lg border border-slate-700/50 bg-slate-900/50 text-slate-400 hover:text-white hover:border-slate-600 transition-colors disabled:opacity-50"
          >
            {configuringWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          </button>

          {isActive && status === 'connected' ? (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              title="Desconectar"
              className="p-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-colors disabled:opacity-50"
            >
              {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
            </button>
          ) : isActive ? (
            <button
              onClick={onConnectClick}
              title="Conectar via QR Code"
              className="p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-colors"
            >
              <QrCode className="w-4 h-4" />
            </button>
          ) : null}

          {/* Toggle active/inactive */}
          {onToggleClick && (
            <button
              onClick={onToggleClick}
              title={isActive ? 'Desativar instância' : 'Ativar instância'}
              className={`p-2 rounded-lg border transition-colors ${
                isActive
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50'
              }`}
            >
              {isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
            </button>
          )}

          <button
            onClick={onEditClick}
            title="Editar credenciais"
            className="p-2 rounded-lg border border-slate-700/50 bg-slate-900/50 text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>

          <button
            onClick={onDeleteClick}
            title="Excluir instância permanentemente"
            className="p-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
