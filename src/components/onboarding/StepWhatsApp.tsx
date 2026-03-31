import React, { useState, useEffect } from 'react';
import { MessageSquare, Key, Phone, ExternalLink, Copy, Check, ChevronDown, Building2, Sparkles, RefreshCw, Globe, Server, QrCode } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/Button';
import { UazapiConnectionModal } from '@/components/UazapiConnectionModal';

type WhatsAppProvider = 'cloud' | 'uazapi';

interface StepWhatsAppProps {
  // Provider selection
  provider: WhatsAppProvider;
  onProviderChange: (value: WhatsAppProvider) => void;
  // WhatsApp Cloud API fields
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  verifyToken: string;
  onAccessTokenChange: (value: string) => void;
  onPhoneNumberIdChange: (value: string) => void;
  onBusinessAccountIdChange: (value: string) => void;
  onVerifyTokenChange: (value: string) => void;
  webhookUrl: string;
  // Uazapi fields
  uazapiEndpoint: string;
  uazapiSession: string;
  uazapiSessionkey: string;
  onUazapiEndpointChange: (value: string) => void;
  onUazapiSessionChange: (value: string) => void;
  onUazapiSessionkeyChange: (value: string) => void;
  uazapiWebhookUrl: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: "spring" as const, stiffness: 300, damping: 24 }
  },
};

// Generate a unique verify token
const generateVerifyToken = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'viver-ia-';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const StepWhatsApp: React.FC<StepWhatsAppProps> = ({
  provider,
  onProviderChange,
  accessToken,
  phoneNumberId,
  businessAccountId,
  verifyToken,
  onAccessTokenChange,
  onPhoneNumberIdChange,
  onBusinessAccountIdChange,
  onVerifyTokenChange,
  webhookUrl,
  uazapiEndpoint,
  uazapiSession,
  uazapiSessionkey,
  onUazapiEndpointChange,
  onUazapiSessionChange,
  onUazapiSessionkeyChange,
  uazapiWebhookUrl,
}) => {
  const [showWebhook, setShowWebhook] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showConnectionModal, setShowConnectionModal] = useState(false);

  const uazapiConfigured = !!(uazapiEndpoint && uazapiSession && uazapiSessionkey);

  // Auto-generate verify token if empty or default
  useEffect(() => {
    if (!verifyToken || verifyToken === 'viver-de-ia-nina-webhook') {
      onVerifyTokenChange(generateVerifyToken());
    }
  }, []);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const regenerateToken = () => {
    onVerifyTokenChange(generateVerifyToken());
  };

  return (
    <motion.div 
      className="space-y-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={itemVariants} className="text-center mb-8">
        <motion.div 
          className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-green-500/20 border border-emerald-500/30 flex items-center justify-center"
          whileHover={{ scale: 1.05, rotate: 5 }}
          transition={{ type: "spring", stiffness: 400 }}
        >
          <MessageSquare className="w-8 h-8 text-emerald-400" />
        </motion.div>
        <h3 className="text-xl font-semibold text-foreground mb-2">Integração WhatsApp</h3>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Escolha seu provedor de WhatsApp e configure as credenciais.
        </p>
      </motion.div>

      {/* Provider Selection */}
      <motion.div variants={itemVariants} className="max-w-md mx-auto">
        <Label className="text-sm text-muted-foreground mb-3 block">Provedor de WhatsApp</Label>
        <div className="grid grid-cols-2 gap-3">
          <motion.button
            type="button"
            onClick={() => onProviderChange('cloud')}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`p-4 rounded-xl border-2 transition-all ${
              provider === 'cloud'
                ? 'border-cyan-500 bg-cyan-500/10 shadow-lg shadow-cyan-500/20'
                : 'border-border bg-card hover:border-muted-foreground/30'
            }`}
          >
            <Globe className={`w-6 h-6 mx-auto mb-2 ${provider === 'cloud' ? 'text-cyan-400' : 'text-muted-foreground'}`} />
            <div className={`font-medium text-sm ${provider === 'cloud' ? 'text-foreground' : 'text-muted-foreground'}`}>
              WhatsApp Cloud
            </div>
            <div className="text-xs text-muted-foreground mt-1">API Oficial Meta</div>
          </motion.button>

          <motion.button
            type="button"
            onClick={() => onProviderChange('uazapi')}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`p-4 rounded-xl border-2 transition-all ${
              provider === 'uazapi'
                ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/20'
                : 'border-border bg-card hover:border-muted-foreground/30'
            }`}
          >
            <Server className={`w-6 h-6 mx-auto mb-2 ${provider === 'uazapi' ? 'text-emerald-400' : 'text-muted-foreground'}`} />
            <div className={`font-medium text-sm ${provider === 'uazapi' ? 'text-foreground' : 'text-muted-foreground'}`}>
              Uazapi
            </div>
            <div className="text-xs text-muted-foreground mt-1">WhatsApp Web API</div>
          </motion.button>
        </div>
      </motion.div>

      {/* Provider-specific fields */}
      <AnimatePresence mode="wait">
        {provider === 'cloud' ? (
          <motion.div
            key="cloud"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="space-y-6 max-w-md mx-auto"
          >
            {/* Cloud API Fields */}
            <div className="space-y-2">
              <Label htmlFor="accessToken" className="flex items-center gap-2">
                <Key className="w-4 h-4 text-muted-foreground" />
                Access Token
              </Label>
              <Input
                id="accessToken"
                type="password"
                value={accessToken}
                onChange={(e) => onAccessTokenChange(e.target.value)}
                placeholder="EAAxxxxxxxx..."
                className="font-mono text-sm focus:ring-cyan-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneNumberId" className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                Phone Number ID
              </Label>
              <Input
                id="phoneNumberId"
                value={phoneNumberId}
                onChange={(e) => onPhoneNumberIdChange(e.target.value)}
                placeholder="123456789012345"
                className="font-mono text-sm focus:ring-cyan-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="businessAccountId" className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                Business Account ID (WABA)
              </Label>
              <Input
                id="businessAccountId"
                value={businessAccountId}
                onChange={(e) => onBusinessAccountIdChange(e.target.value)}
                placeholder="123456789012345"
                className="font-mono text-sm focus:ring-cyan-500"
              />
              <p className="text-xs text-muted-foreground">
                Encontrado em Meta Business Suite → Configurações → WhatsApp Accounts
              </p>
            </div>

            {/* Webhook Configuration (Collapsible) */}
            <div className="pt-4 border-t border-border">
              <motion.button
                onClick={() => setShowWebhook(!showWebhook)}
                whileHover={{ x: 4 }}
                className="flex items-center justify-between w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="flex items-center gap-2">
                  <ExternalLink className="w-4 h-4" />
                  Configuração de Webhook
                </span>
                <motion.div
                  animate={{ rotate: showWebhook ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-4 h-4" />
                </motion.div>
              </motion.button>

              <AnimatePresence>
                {showWebhook && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">Webhook URL</Label>
                        <div className="flex gap-2">
                          <Input
                            value={webhookUrl}
                            readOnly
                            className="bg-background border-border font-mono text-xs flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(webhookUrl, 'url')}
                            className="px-3"
                          >
                            {copied === 'url' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="verifyToken" className="text-muted-foreground text-xs flex items-center gap-2">
                          Verify Token
                          <span className="text-cyan-400 flex items-center gap-1 text-[10px]">
                            <Sparkles className="w-3 h-3" />
                            Auto-gerado
                          </span>
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="verifyToken"
                            value={verifyToken}
                            readOnly
                            className="bg-background border-border font-mono text-xs flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(verifyToken, 'token')}
                            className="px-3"
                            disabled={!verifyToken}
                          >
                            {copied === 'token' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={regenerateToken}
                            className="px-3"
                            title="Regenerar token"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Token gerado automaticamente. Use este mesmo valor no Meta Business.
                        </p>
                      </div>

                      <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                        <p className="text-xs text-primary font-medium mb-2">Como configurar:</p>
                        <ol className="text-xs text-primary/80 space-y-1 list-decimal list-inside">
                          <li>Copie a Webhook URL e o Verify Token</li>
                          <li>Acesse o <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">Meta Business Dashboard</a></li>
                          <li>Vá em WhatsApp → Configuration → Webhook</li>
                          <li>Cole os valores e selecione: messages, message_echoes</li>
                        </ol>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Tutorial Link */}
            <div className="text-center pt-4">
              <motion.a
                href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }}
                className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Como obter as credenciais do WhatsApp Cloud
              </motion.a>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="uazapi"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="space-y-6 max-w-md mx-auto"
          >
            {/* Uazapi Fields */}
            <div className="space-y-2">
              <Label htmlFor="uazapiEndpoint" className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                Endpoint da API
              </Label>
              <Input
                id="uazapiEndpoint"
                value={uazapiEndpoint}
                onChange={(e) => onUazapiEndpointChange(e.target.value)}
                placeholder="https://seuservidor.uazapi.com"
                className="font-mono text-sm focus:ring-emerald-500"
              />
              <p className="text-xs text-muted-foreground">
                URL do seu servidor Uazapi (sem barra no final)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="uazapiSession" className="flex items-center gap-2">
                <Key className="w-4 h-4 text-muted-foreground" />
                Session
              </Label>
              <Input
                id="uazapiSession"
                value={uazapiSession}
                onChange={(e) => onUazapiSessionChange(e.target.value)}
                placeholder="minha-sessao"
                className="font-mono text-sm focus:ring-emerald-500"
              />
              <p className="text-xs text-muted-foreground">
                Nome da sessão configurada no painel Uazapi
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="uazapiSessionkey" className="flex items-center gap-2">
                <Key className="w-4 h-4 text-muted-foreground" />
                Session Key
              </Label>
              <Input
                id="uazapiSessionkey"
                type="password"
                value={uazapiSessionkey}
                onChange={(e) => onUazapiSessionkeyChange(e.target.value)}
                placeholder="sua-session-key"
                className="font-mono text-sm focus:ring-emerald-500"
              />
            </div>

            {/* Webhook Configuration for Uazapi */}
            <div className="pt-4 border-t border-border">
              <motion.button
                onClick={() => setShowWebhook(!showWebhook)}
                whileHover={{ x: 4 }}
                className="flex items-center justify-between w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="flex items-center gap-2">
                  <ExternalLink className="w-4 h-4" />
                  Configuração de Webhook
                </span>
                <motion.div
                  animate={{ rotate: showWebhook ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-4 h-4" />
                </motion.div>
              </motion.button>

              <AnimatePresence>
                {showWebhook && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">Webhook URL para Uazapi</Label>
                        <div className="flex gap-2">
                          <Input
                            value={uazapiWebhookUrl}
                            readOnly
                            className="bg-background border-border font-mono text-xs flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(uazapiWebhookUrl, 'uazapi-url')}
                            className="px-3"
                          >
                            {copied === 'uazapi-url' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <p className="text-xs text-emerald-400 font-medium mb-2">Como configurar:</p>
                        <ol className="text-xs text-emerald-400/80 space-y-1 list-decimal list-inside">
                          <li>Copie a Webhook URL acima</li>
                          <li>No painel da Uazapi, configure o webhook de mensagens</li>
                          <li>Cole esta URL no campo "wh_message"</li>
                          <li>Salve as configurações e conecte o WhatsApp</li>
                        </ol>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Connect Instance Button */}
            {uazapiConfigured && (
              <motion.div variants={itemVariants} className="pt-2">
                <Button
                  variant="outline"
                  onClick={() => setShowConnectionModal(true)}
                  className="w-full border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                >
                  <QrCode className="w-4 h-4 mr-2" />
                  Conectar Instância via QR Code
                </Button>
              </motion.div>
            )}

            {/* Tutorial Link */}
            <div className="text-center pt-4">
              <motion.a
                href="https://docs.uazapi.com/"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }}
                className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Documentação Uazapi
              </motion.a>
            </div>

            <UazapiConnectionModal open={showConnectionModal} onOpenChange={setShowConnectionModal} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
