import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/Button';
import { Loader2, RefreshCw, WifiOff, QrCode, Check, Smartphone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';

type ConnectionStatus = 'idle' | 'loading' | 'qrcode' | 'paircode' | 'connecting' | 'connected' | 'timeout' | 'error';
type ConnectionMode = 'qrcode' | 'paircode';

interface UazapiConnectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId?: string;
}

const QR_TIMEOUT_MS = 2 * 60 * 1000;
const PAIR_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

export const UazapiConnectionModal: React.FC<UazapiConnectionModalProps> = ({ open, onOpenChange, instanceId }) => {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [mode, setMode] = useState<ConnectionMode>('qrcode');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollingRef.current = null;
    timeoutRef.current = null;
  }, []);

  const triggerConfetti = () => {
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
  };

  const configureWebhook = useCallback(async () => {
    try {
      const body: Record<string, string> = { action: 'configure-webhook' };
      if (instanceId) body.instance_id = instanceId;
      const { data, error } = await supabase.functions.invoke('uazapi-connect', { body });
      if (error) throw error;
      if (data?.success) {
        toast.success('Webhook configurado automaticamente!');
      }
    } catch (e) {
      console.error('[UazapiModal] Webhook config error:', e);
      toast.error('Conectado, mas falha ao configurar webhook.');
    }
  }, [instanceId]);

  const checkStatus = useCallback(async () => {
    try {
      const body: Record<string, string> = { action: 'status' };
      if (instanceId) body.instance_id = instanceId;
      const { data, error } = await supabase.functions.invoke('uazapi-connect', { body });
      if (error) throw error;

      const s = data?.status?.toLowerCase?.() || '';
      if (s === 'connected' || s === 'open') {
        setStatus('connected');
        cleanup();
        triggerConfetti();
        toast.success('WhatsApp conectado com sucesso!');
        configureWebhook();
      } else {
        if (data?.qrcode) setQrCode(data.qrcode);
        if (data?.paircode) setPairCode(data.paircode);
      }
    } catch (e) {
      console.error('[UazapiModal] Poll error:', e);
    }
  }, [cleanup, configureWebhook, instanceId]);

  const startConnection = useCallback(async (connectionMode: ConnectionMode, phoneNumber?: string) => {
    setStatus(connectionMode === 'paircode' ? 'paircode' : 'qrcode');
    setQrCode(null);
    setPairCode(null);
    setErrorMsg(null);
    cleanup();

    pollingRef.current = setInterval(checkStatus, POLL_INTERVAL_MS);
    const timeout = connectionMode === 'paircode' ? PAIR_TIMEOUT_MS : QR_TIMEOUT_MS;
    timeoutRef.current = setTimeout(() => { cleanup(); setStatus('timeout'); }, timeout);

    checkStatus();

    try {
      const body: Record<string, string> = { action: 'connect' };
      if (instanceId) body.instance_id = instanceId;
      if (connectionMode === 'paircode' && phoneNumber) {
        body.phone = phoneNumber.replace(/\D/g, '');
      }

      const { data, error } = await supabase.functions.invoke('uazapi-connect', { body });
      if (error) {
        console.warn('[UazapiModal] Connect returned error (polling continues):', error);
        return;
      }

      const instanceStatus = data?.status?.toLowerCase?.() || '';
      if (instanceStatus === 'connected' || instanceStatus === 'open') {
        setStatus('connected');
        cleanup();
        triggerConfetti();
        toast.success('Instância já está conectada!');
        return;
      }

      if (data?.qrcode) setQrCode(data.qrcode);
      if (data?.paircode) setPairCode(data.paircode);
    } catch (e: any) {
      console.warn('[UazapiModal] Connect error (polling continues):', e);
    }
  }, [cleanup, checkStatus, instanceId]);

  useEffect(() => {
    if (!open) {
      cleanup();
      setStatus('idle');
      setQrCode(null);
      setPairCode(null);
      setErrorMsg(null);
    }
    return cleanup;
  }, [open, cleanup]);

  const getQrSrc = (qr: string): string => {
    if (qr.startsWith('data:')) return qr;
    if (qr.startsWith('http')) return qr;
    return `data:image/png;base64,${qr}`;
  };

  const handleStartQR = () => {
    setMode('qrcode');
    startConnection('qrcode');
  };

  const handleStartPaircode = () => {
    if (!phone.replace(/\D/g, '')) {
      toast.error('Informe o número de telefone');
      return;
    }
    setMode('paircode');
    startConnection('paircode', phone);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-400" />
            Conectar WhatsApp
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center py-6 space-y-4 min-h-[300px]">
          {status === 'idle' && (
            <div className="w-full space-y-4">
              <p className="text-sm text-muted-foreground text-center">Escolha como conectar:</p>

              <div className="space-y-3">
                <button
                  onClick={handleStartQR}
                  className="w-full flex items-center gap-3 p-4 rounded-lg border border-border hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <QrCode className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">QR Code</p>
                    <p className="text-xs text-muted-foreground">Escaneie com o WhatsApp do celular (2 min)</p>
                  </div>
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                  <div className="relative flex justify-center text-xs"><span className="bg-background px-2 text-muted-foreground">ou</span></div>
                </div>

                <div className="w-full p-4 rounded-lg border border-border space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Smartphone className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Código de Pareamento</p>
                      <p className="text-xs text-muted-foreground">Insira o código no WhatsApp (5 min)</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="5511999999999"
                      className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <Button variant="outline" size="sm" onClick={handleStartPaircode}>
                      Conectar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {status === 'loading' && (
            <>
              <Loader2 className="w-12 h-12 text-emerald-400 animate-spin" />
              <p className="text-sm text-muted-foreground">
                {mode === 'paircode' ? 'Gerando código de pareamento...' : 'Gerando QR Code...'}
              </p>
            </>
          )}

          {status === 'qrcode' && qrCode && (
            <>
              <div className="p-3 bg-white rounded-xl">
                <img src={getQrSrc(qrCode)} alt="QR Code WhatsApp" className="w-64 h-64 object-contain" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground">Escaneie o QR Code</p>
                <p className="text-xs text-muted-foreground">
                  WhatsApp → Dispositivos conectados → Conectar dispositivo
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Aguardando conexão...
              </div>
            </>
          )}

          {status === 'paircode' && pairCode && (
            <>
              <div className="p-6 bg-muted rounded-xl">
                <p className="text-3xl font-mono font-bold tracking-[0.3em] text-foreground text-center">
                  {pairCode}
                </p>
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground">Insira o código no WhatsApp</p>
                <p className="text-xs text-muted-foreground">
                  WhatsApp → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Aguardando pareamento...
              </div>
            </>
          )}

          {status === 'connected' && (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="text-lg font-semibold text-emerald-400">Conectado!</p>
              <p className="text-xs text-muted-foreground">Sua instância WhatsApp está ativa.</p>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </>
          )}

          {status === 'timeout' && (
            <>
              <WifiOff className="w-12 h-12 text-amber-400" />
              <p className="text-sm font-medium text-amber-400">Tempo esgotado</p>
              <p className="text-xs text-muted-foreground">
                {mode === 'paircode' ? 'O código de pareamento expirou.' : 'O QR code expirou.'} Tente novamente.
              </p>
              <Button variant="outline" size="sm" onClick={() => { setStatus('idle'); }}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Tentar novamente
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <WifiOff className="w-12 h-12 text-destructive" />
              <p className="text-sm text-destructive">{errorMsg || 'Erro desconhecido'}</p>
              <Button variant="outline" size="sm" onClick={() => { setStatus('idle'); }}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Tentar novamente
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
