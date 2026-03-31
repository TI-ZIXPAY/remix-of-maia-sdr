import React, { useState, useEffect, forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { Save, MessageSquare, Mic, Eye, EyeOff, Copy, Check, Loader2, Send, ChevronDown, Volume2, Download, Upload, FileAudio, HelpCircle, RefreshCw, Wrench, QrCode, Calendar, Plus } from 'lucide-react';
import { UazapiConnectionModal } from '../UazapiConnectionModal';
import { UazapiInstanceCard } from '../UazapiInstanceCard';
import { Button } from '../Button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import * as Collapsible from '@radix-ui/react-collapsible';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { useAuth } from '@/hooks/useAuth';

interface NinaSettings {
  id?: string;
  // WhatsApp provider selection
  whatsapp_provider: 'cloud' | 'uazapi';
  // WhatsApp Cloud API fields
  whatsapp_access_token: string | null;
  whatsapp_phone_number_id: string | null;
  whatsapp_verify_token: string | null;
  // Uazapi fields
  uazapi_endpoint: string | null;
  uazapi_session: string | null;
  uazapi_sessionkey: string | null;
  // ElevenLabs fields
  elevenlabs_api_key: string | null;
  elevenlabs_voice_id: string;
  elevenlabs_model: string | null;
  elevenlabs_stability: number;
  elevenlabs_similarity_boost: number;
  elevenlabs_style: number;
  elevenlabs_speed: number | null;
  elevenlabs_speaker_boost: boolean;
  audio_response_enabled: boolean;
  // Google Calendar fields
  google_calendar_client_id: string | null;
  google_calendar_client_secret: string | null;
  google_calendar_refresh_token: string | null;
  google_calendar_id: string | null;
  google_calendar_enabled: boolean;
  // Calendly fields
  calendly_enabled: boolean;
  calendly_event_type_uri: string | null;
  calendly_scheduling_url: string | null;
}

interface ElevenLabsVoice {
  id: string;
  name: string;
  category: 'custom' | 'cloned' | 'premade' | 'professional';
  description: string;
}

// Fallback voices when API key is not configured
const FALLBACK_VOICES: ElevenLabsVoice[] = [
  { id: '33B4UnXyTNbgLmdEDh5P', name: 'Keren - Young Brazilian Female', category: 'premade', description: 'Feminina, brasileira (Padrão)' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', category: 'premade', description: 'Masculina, confiante' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', category: 'premade', description: 'Feminina, suave' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', category: 'premade', description: 'Masculina, britânica' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', category: 'premade', description: 'Masculina, clara' },
];

const MODEL_OPTIONS = [
  { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5 (Recomendado)' },
  { id: 'eleven_turbo_v2', name: 'Turbo v2' },
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2' },
];

export interface ApiSettingsRef {
  save: () => Promise<void>;
  cancel: () => void;
  isSaving: boolean;
}

const ApiSettings = forwardRef<ApiSettingsRef>((props, ref) => {
  const { companyName } = useCompanySettings();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showWhatsAppToken, setShowWhatsAppToken] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [connectingInstanceId, setConnectingInstanceId] = useState<string | null>(null);
  const [editingUazapiCredentials, setEditingUazapiCredentials] = useState(false);
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  // Multi-instance state
  const [uazapiInstances, setUazapiInstances] = useState<Array<{
    id: string;
    name: string;
    endpoint: string;
    session: string | null;
    sessionkey: string;
    is_active: boolean;
  }>>([]);
  const [showAddInstance, setShowAddInstance] = useState(false);
  const [newInstance, setNewInstance] = useState({ name: '', endpoint: '', session: '', sessionkey: '' });
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [advancedVoiceOpen, setAdvancedVoiceOpen] = useState(false);
  const [showGCalSecret, setShowGCalSecret] = useState(false);
  const [showGCalClientId, setShowGCalClientId] = useState(false);
  const [savingGCal, setSavingGCal] = useState(false);
  const [testingGCal, setTestingGCal] = useState(false);
  const [authorizingGCal, setAuthorizingGCal] = useState(false);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [availableCalendars, setAvailableCalendars] = useState<Array<{ id: string; summary: string; primary: boolean }>>([]);
  const [gCalTestResult, setGCalTestResult] = useState<{ success: boolean; calendarId?: string; error?: string } | null>(null);
  // Calendly states
  const [calendlyTestResult, setCalendlyTestResult] = useState<{ success: boolean; userName?: string; error?: string } | null>(null);
  const [testingCalendly, setTestingCalendly] = useState(false);
  const [savingCalendly, setSavingCalendly] = useState(false);
  const [calendlyEventTypes, setCalendlyEventTypes] = useState<Array<{ uri: string; name: string; scheduling_url: string }>>([]);
  const [loadingCalendlyTypes, setLoadingCalendlyTypes] = useState(false);
  const [testSectionOpen, setTestSectionOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testSending, setTestSending] = useState(false);
  
  // ElevenLabs voices states
  const [voices, setVoices] = useState<ElevenLabsVoice[]>(FALLBACK_VOICES);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  
  // Audio test states
  const [audioTestOpen, setAudioTestOpen] = useState(false);
  const [audioTestText, setAudioTestText] = useState('Olá! Esta é uma mensagem de teste para verificar a qualidade da voz.');
  const [audioGenerating, setAudioGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioStats, setAudioStats] = useState<{ duration_ms: number; size_kb: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  // Audio simulation states
  const [audioSimulateOpen, setAudioSimulateOpen] = useState(false);
  const [audioSimulatePhone, setAudioSimulatePhone] = useState('');
  const [audioSimulateName, setAudioSimulateName] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioSimulating, setAudioSimulating] = useState(false);
  const [audioSimulateResult, setAudioSimulateResult] = useState<{
    transcription: string;
    contact_id: string;
    conversation_id: string;
    message_id: string;
    queued_for_nina: boolean;
  } | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  
  // Gera um verify token único para esta instalação
  const generateUniqueToken = () => `verify-${crypto.randomUUID().slice(0, 8)}`;
  
  const [settings, setSettings] = useState<NinaSettings>({
    whatsapp_provider: 'cloud',
    whatsapp_access_token: null,
    whatsapp_phone_number_id: null,
    whatsapp_verify_token: generateUniqueToken(),
    uazapi_endpoint: null,
    uazapi_session: null,
    uazapi_sessionkey: null,
    elevenlabs_api_key: null,
    elevenlabs_voice_id: '33B4UnXyTNbgLmdEDh5P',
    elevenlabs_model: 'eleven_turbo_v2_5',
    elevenlabs_stability: 0.75,
    elevenlabs_similarity_boost: 0.80,
    elevenlabs_style: 0.30,
    elevenlabs_speed: 1.0,
    elevenlabs_speaker_boost: true,
    audio_response_enabled: false,
    google_calendar_client_id: null,
    google_calendar_client_secret: null,
    google_calendar_refresh_token: null,
    google_calendar_id: 'primary',
    google_calendar_enabled: false,
    calendly_enabled: false,
    calendly_event_type_uri: null,
    calendly_scheduling_url: null,
  });

  // Load ElevenLabs voices from API
  const loadVoices = useCallback(async (apiKey: string) => {
    if (!apiKey || loadingVoices) return;
    
    setLoadingVoices(true);
    try {
      console.log('[ApiSettings] Fetching ElevenLabs voices...');
      const { data, error } = await supabase.functions.invoke('list-elevenlabs-voices', {
        body: { apiKey },
      });

      if (error) throw error;

      if (data?.success && data?.voices?.length > 0) {
        setVoices(data.voices);
        setVoicesLoaded(true);
        console.log(`[ApiSettings] Loaded ${data.voices.length} voices (${data.counts?.custom || 0} custom)`);
        
        // If current voice is not in the list, add it to avoid issues
        const currentVoiceExists = data.voices.some((v: ElevenLabsVoice) => v.id === settings.elevenlabs_voice_id);
        if (!currentVoiceExists && settings.elevenlabs_voice_id) {
          setVoices((prev) => [
            { id: settings.elevenlabs_voice_id, name: 'Voz Atual', category: 'custom' as const, description: 'Selecionada anteriormente' },
            ...prev,
          ]);
        }
      } else if (data?.error) {
        console.error('[ApiSettings] Error loading voices:', data.error);
        toast.error(`Erro ao carregar vozes: ${data.error}`);
      }
    } catch (error: any) {
      console.error('[ApiSettings] Failed to load voices:', error);
    } finally {
      setLoadingVoices(false);
    }
  }, [loadingVoices, settings.elevenlabs_voice_id]);

  // Load voices when API key changes
  useEffect(() => {
    if (settings.elevenlabs_api_key && !voicesLoaded) {
      loadVoices(settings.elevenlabs_api_key);
    }
  }, [settings.elevenlabs_api_key, voicesLoaded, loadVoices]);

  // Auto-save ElevenLabs API key when field loses focus
  const handleElevenLabsKeyBlur = async () => {
    if (!settings.id || !settings.elevenlabs_api_key) return;
    
    try {
      const { error } = await supabase
        .from('nina_settings')
        .update({
          elevenlabs_api_key: settings.elevenlabs_api_key,
          updated_at: new Date().toISOString(),
        })
        .eq('id', settings.id);

      if (error) throw error;
      toast.success('API Key da ElevenLabs salva automaticamente');
    } catch (error) {
      console.error('Error auto-saving ElevenLabs key:', error);
    }
  };

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  useEffect(() => {
    setTestMessage(`Olá! Esta é uma mensagem de teste do sistema ${companyName}. 🚀`);
  }, [companyName]);

  useEffect(() => {
    loadSettings();
    loadUazapiInstances();
  }, []);

  const loadUazapiInstances = async () => {
    const { data } = await supabase
      .from('uazapi_instances')
      .select('*')
      .order('created_at', { ascending: true });
    if (data) setUazapiInstances(data as any);
  };

  const handleAddInstance = async () => {
    if (!newInstance.endpoint || !newInstance.sessionkey) {
      toast.error('Endpoint e Session Key são obrigatórios');
      return;
    }

    if (editingInstanceId) {
      // Update existing instance
      const { error } = await supabase.from('uazapi_instances').update({
        name: newInstance.name || 'Nova Instância',
        endpoint: newInstance.endpoint,
        session: newInstance.session || null,
        sessionkey: newInstance.sessionkey,
      } as any).eq('id', editingInstanceId);
      if (error) { toast.error('Erro ao atualizar instância'); return; }
      toast.success('Instância atualizada!');
    } else {
      // Insert new instance
      const { error } = await supabase.from('uazapi_instances').insert({
        name: newInstance.name || 'Nova Instância',
        endpoint: newInstance.endpoint,
        session: newInstance.session || null,
        sessionkey: newInstance.sessionkey,
      } as any);
      if (error) { toast.error('Erro ao adicionar instância'); return; }
      toast.success('Instância adicionada!');
    }

    setNewInstance({ name: '', endpoint: '', session: '', sessionkey: '' });
    setShowAddInstance(false);
    setEditingInstanceId(null);
    loadUazapiInstances();
  };

  const handleStartEditInstance = (inst: typeof uazapiInstances[0]) => {
    setEditingInstanceId(inst.id);
    setNewInstance({
      name: inst.name,
      endpoint: inst.endpoint,
      session: inst.session || '',
      sessionkey: inst.sessionkey,
    });
    setShowAddInstance(true);
  };

  const [deletingInstanceId, setDeletingInstanceId] = useState<string | null>(null);

  const handleDeleteInstance = async (id: string) => {
    setDeletingInstanceId(id);
  };

  const confirmDeleteInstance = async () => {
    if (!deletingInstanceId) return;
    try {
      // First, clean up contacts referencing this instance
      await supabase
        .from('contacts')
        .update({ uazapi_instance_id: null })
        .eq('uazapi_instance_id', deletingInstanceId);

      // Then hard delete the instance
      const { error } = await supabase
        .from('uazapi_instances')
        .delete()
        .eq('id', deletingInstanceId);
      if (error) throw error;
      toast.success('Instância excluída definitivamente');
      loadUazapiInstances();
    } catch (e) {
      console.error('[ApiSettings] Delete instance error:', e);
      toast.error('Erro ao excluir instância');
    } finally {
      setDeletingInstanceId(null);
    }
  };

  const handleToggleInstance = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('uazapi_instances')
        .update({ is_active: !currentStatus })
        .eq('id', id);
      if (error) throw error;
      toast.success(currentStatus ? 'Instância desativada' : 'Instância ativada');
      loadUazapiInstances();
    } catch (e) {
      console.error('[ApiSettings] Toggle instance error:', e);
      toast.error('Erro ao alterar status da instância');
    }
  };

  useImperativeHandle(ref, () => ({
    save: handleSave,
    cancel: loadSettings,
    isSaving: saving
  }));

  const loadSettings = async () => {
    if (!user?.id) {
      console.log('[ApiSettings] No user, skipping load');
      setLoading(false);
      return;
    }
    
    try {
      // Fetch global nina_settings (no user_id filter - single tenant)
      const { data, error } = await supabase
        .from('nina_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      // Se não existe registro, admin precisa configurar via onboarding
      if (!data) {
        console.log('[ApiSettings] No global settings found');
        setLoading(false);
        return;
      }

      // Load settings from global data
      const uniqueToken = data.whatsapp_verify_token || generateUniqueToken();
      setSettings({
        id: data.id,
        whatsapp_provider: (data.whatsapp_provider === 'uazapi' ? 'uazapi' : 'cloud') as 'cloud' | 'uazapi',
        whatsapp_access_token: data.whatsapp_access_token,
        whatsapp_phone_number_id: data.whatsapp_phone_number_id,
        whatsapp_verify_token: uniqueToken,
        uazapi_endpoint: data.uazapi_endpoint,
        uazapi_session: data.uazapi_session,
        uazapi_sessionkey: data.uazapi_sessionkey,
        elevenlabs_api_key: data.elevenlabs_api_key,
        elevenlabs_voice_id: data.elevenlabs_voice_id,
        elevenlabs_model: data.elevenlabs_model,
        elevenlabs_stability: data.elevenlabs_stability,
        elevenlabs_similarity_boost: data.elevenlabs_similarity_boost,
        elevenlabs_style: data.elevenlabs_style,
        elevenlabs_speed: data.elevenlabs_speed,
        elevenlabs_speaker_boost: data.elevenlabs_speaker_boost,
        audio_response_enabled: data.audio_response_enabled || false,
        google_calendar_client_id: (data as any).google_calendar_client_id || null,
        google_calendar_client_secret: (data as any).google_calendar_client_secret || null,
        google_calendar_refresh_token: (data as any).google_calendar_refresh_token || null,
        google_calendar_id: (data as any).google_calendar_id || 'primary',
        google_calendar_enabled: (data as any).google_calendar_enabled || false,
        calendly_enabled: (data as any).calendly_enabled || false,
        calendly_event_type_uri: (data as any).calendly_event_type_uri || null,
        calendly_scheduling_url: (data as any).calendly_scheduling_url || null,
      });
    } catch (error) {
      console.error('[ApiSettings] Error loading settings:', error);
      toast.error('Erro ao carregar configurações');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Validation based on provider
      if (settings.whatsapp_provider === 'cloud') {
        if (settings.whatsapp_phone_number_id && !/^\d+$/.test(settings.whatsapp_phone_number_id)) {
          toast.error('Phone Number ID deve conter apenas números');
          setSaving(false);
          return;
        }
      } else if (settings.whatsapp_provider === 'uazapi') {
        if (settings.uazapi_endpoint && !settings.uazapi_endpoint.startsWith('http')) {
          toast.error('Endpoint da Uazapi deve começar com http:// ou https://');
          setSaving(false);
          return;
        }
      }

      // Update global settings (no user_id filter - RLS handles admin check)
      const { error } = await supabase
        .from('nina_settings')
        .update({
          whatsapp_provider: settings.whatsapp_provider,
          whatsapp_access_token: settings.whatsapp_access_token,
          whatsapp_phone_number_id: settings.whatsapp_phone_number_id,
          whatsapp_verify_token: settings.whatsapp_verify_token,
          uazapi_endpoint: settings.uazapi_endpoint,
          uazapi_session: settings.uazapi_session,
          uazapi_sessionkey: settings.uazapi_sessionkey,
          elevenlabs_api_key: settings.elevenlabs_api_key,
          elevenlabs_voice_id: settings.elevenlabs_voice_id,
          elevenlabs_model: settings.elevenlabs_model,
          elevenlabs_stability: settings.elevenlabs_stability,
          elevenlabs_similarity_boost: settings.elevenlabs_similarity_boost,
          elevenlabs_style: settings.elevenlabs_style,
          elevenlabs_speed: settings.elevenlabs_speed,
          elevenlabs_speaker_boost: settings.elevenlabs_speaker_boost,
          audio_response_enabled: settings.audio_response_enabled,
          google_calendar_client_id: settings.google_calendar_client_id,
          google_calendar_client_secret: settings.google_calendar_client_secret,
          google_calendar_refresh_token: settings.google_calendar_refresh_token,
          google_calendar_id: settings.google_calendar_id,
          google_calendar_enabled: settings.google_calendar_enabled,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', settings.id!);

      if (error) throw error;

      toast.success('Configurações de APIs salvas com sucesso!');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Erro ao salvar configurações');
    } finally {
      setSaving(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    toast.success('URL do webhook copiada!');
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleGenerateAudio = async () => {
    if (!settings.elevenlabs_api_key) {
      toast.error('Configure sua API Key da ElevenLabs primeiro');
      return;
    }

    if (!audioTestText.trim()) {
      toast.error('Insira um texto para converter em áudio');
      return;
    }

    setAudioGenerating(true);
    setAudioUrl(null);
    setAudioStats(null);

    try {
      const { data, error } = await supabase.functions.invoke('test-elevenlabs-tts', {
        body: { 
          text: audioTestText,
          apiKey: settings.elevenlabs_api_key,
          voiceId: settings.elevenlabs_voice_id,
          model: settings.elevenlabs_model,
          stability: settings.elevenlabs_stability,
          similarityBoost: settings.elevenlabs_similarity_boost,
          speed: settings.elevenlabs_speed,
        }
      });

      if (error) throw error;

      if (data?.success && data?.audioBase64) {
        // Create audio URL from base64
        const audioBlob = new Blob(
          [Uint8Array.from(atob(data.audioBase64), c => c.charCodeAt(0))],
          { type: 'audio/mpeg' }
        );
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setAudioStats({ duration_ms: data.duration_ms, size_kb: data.size_kb });
        toast.success(`Áudio gerado em ${(data.duration_ms / 1000).toFixed(1)}s`);
      } else {
        throw new Error(data?.error || 'Erro ao gerar áudio');
      }
    } catch (error) {
      console.error('Error generating audio:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erro ao gerar áudio';
      toast.error(errorMessage);
    } finally {
      setAudioGenerating(false);
    }
  };

  const handleDownloadAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = 'elevenlabs-test.mp3';
    a.click();
  };

  const handleSaveGoogleCalendar = async () => {
    if (!settings.id) return;
    setSavingGCal(true);
    setGCalTestResult(null);
    try {
      const { error } = await supabase
        .from('nina_settings')
        .update({
          google_calendar_client_id: settings.google_calendar_client_id,
          google_calendar_client_secret: settings.google_calendar_client_secret,
          google_calendar_id: settings.google_calendar_id,
          google_calendar_enabled: settings.google_calendar_enabled,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', settings.id);
      if (error) throw error;
      toast.success('Google Calendar salvo com sucesso!');
    } catch (error) {
      console.error('Error saving Google Calendar:', error);
      toast.error('Erro ao salvar Google Calendar');
    } finally {
      setSavingGCal(false);
    }
  };

  const handleAuthorizeGoogleCalendar = async () => {
    if (!settings.google_calendar_client_id || !settings.google_calendar_client_secret) {
      toast.error('Preencha e salve o Client ID e Client Secret primeiro');
      return;
    }

    // Save credentials first
    await handleSaveGoogleCalendar();

    setAuthorizingGCal(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-auth?action=get-auth-url`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ client_id: settings.google_calendar_client_id }),
        }
      );

      const data = await response.json();
      if (!response.ok || !data.authUrl) {
        throw new Error(data.error || 'Erro ao gerar URL de autorização');
      }

      // Open OAuth in new window
      const authWindow = window.open(data.authUrl, 'google-calendar-auth', 'width=600,height=700,left=200,top=100');
      
      toast.info('Autorize o acesso na janela que abriu. Após autorizar, atualize as configurações.', { duration: 8000 });

      // Poll for completion
      const pollInterval = setInterval(async () => {
        if (authWindow?.closed) {
          clearInterval(pollInterval);
          setAuthorizingGCal(false);
          // Reload settings to get the saved refresh token
          await loadSettings();
          toast.success('Verifique se a autorização foi concluída com sucesso.');
        }
      }, 1000);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setAuthorizingGCal(false);
      }, 300000);
    } catch (error) {
      console.error('Error authorizing Google Calendar:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao autorizar');
      setAuthorizingGCal(false);
    }
  };

  const handleLoadCalendars = async () => {
    setLoadingCalendars(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar?action=list-calendars`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({}),
        }
      );
      const data = await response.json();
      if (response.ok && data.success && data.calendars) {
        setAvailableCalendars(data.calendars);
        if (data.calendars.length > 0 && !settings.google_calendar_id) {
          const primary = data.calendars.find((c: any) => c.primary);
          if (primary) {
            setSettings(prev => ({ ...prev, google_calendar_id: primary.id }));
          }
        }
        toast.success(`${data.calendars.length} calendários encontrados`);
      } else {
        throw new Error(data.error || 'Erro ao listar calendários');
      }
    } catch (error) {
      console.error('Error loading calendars:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar calendários');
    } finally {
      setLoadingCalendars(false);
    }
  };

  const handleTestGoogleCalendar = async () => {
    setTestingGCal(true);
    setGCalTestResult(null);
    try {
      const today = new Date().toISOString().split('T')[0];
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar?action=free-busy`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ date: today }),
        }
      );

      const result = await response.json();

      if (response.ok && result.success) {
        setGCalTestResult({ success: true, calendarId: result.calendarId || settings.google_calendar_id || 'primary' });
        toast.success('Conexão com Google Calendar funcionando!');
      } else {
        setGCalTestResult({ success: false, error: result.error || 'Erro desconhecido' });
        toast.error('Falha na conexão com Google Calendar');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao testar';
      setGCalTestResult({ success: false, error: msg });
      toast.error('Falha ao testar Google Calendar');
    } finally {
      setTestingGCal(false);
    }
  };

  // Calendly handlers
  const handleTestCalendly = async () => {
    setTestingCalendly(true);
    setCalendlyTestResult(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendly-integration?action=get-user`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      const data = await response.json();
      if (response.ok && data.resource?.name) {
        setCalendlyTestResult({ success: true, userName: data.resource.name });
        toast.success('Conexão com Calendly funcionando!');
      } else {
        setCalendlyTestResult({ success: false, error: data.error || 'Erro desconhecido' });
        toast.error('Falha na conexão com Calendly');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao testar';
      setCalendlyTestResult({ success: false, error: msg });
      toast.error('Falha ao testar Calendly');
    } finally {
      setTestingCalendly(false);
    }
  };

  const handleLoadCalendlyEventTypes = async () => {
    setLoadingCalendlyTypes(true);
    try {
      // First get user URI
      const userRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendly-integration?action=get-user`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      const userData = await userRes.json();
      if (!userRes.ok || !userData.resource?.uri) {
        throw new Error('Não foi possível obter dados do usuário Calendly');
      }

      const userUri = userData.resource.uri;
      const typesRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendly-integration?action=list-types&user=${encodeURIComponent(userUri)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );
      const typesData = await typesRes.json();
      if (typesRes.ok && typesData.collection) {
        const types = typesData.collection.map((et: any) => ({
          uri: et.uri,
          name: et.name,
          scheduling_url: et.scheduling_url,
        }));
        setCalendlyEventTypes(types);
        toast.success(`${types.length} tipos de evento encontrados`);
        
        // Auto-select first if none selected
        if (types.length > 0 && !settings.calendly_event_type_uri) {
          setSettings(prev => ({
            ...prev,
            calendly_event_type_uri: types[0].uri,
            calendly_scheduling_url: types[0].scheduling_url,
          }));
        }
      } else {
        throw new Error(typesData.error || 'Erro ao listar tipos de evento');
      }
    } catch (error) {
      console.error('Error loading Calendly event types:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao carregar tipos de evento');
    } finally {
      setLoadingCalendlyTypes(false);
    }
  };

  const handleSaveCalendly = async () => {
    if (!settings.id) return;
    setSavingCalendly(true);
    try {
      const { error } = await supabase
        .from('nina_settings')
        .update({
          calendly_enabled: settings.calendly_enabled,
          calendly_event_type_uri: settings.calendly_event_type_uri,
          calendly_scheduling_url: settings.calendly_scheduling_url,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', settings.id);
      if (error) throw error;
      toast.success('Calendly salvo com sucesso!');
    } catch (error) {
      console.error('Error saving Calendly:', error);
      toast.error('Erro ao salvar Calendly');
    } finally {
      setSavingCalendly(false);
    }
  };

  const handleTestMessage = async () => {
    if (!settings.whatsapp_access_token || !settings.whatsapp_phone_number_id) {
      toast.error('⚠️ Preencha e SALVE as credenciais do WhatsApp primeiro!', {
        description: 'Clique em "Salvar Alterações" no topo da página antes de testar.'
      });
      return;
    }

    if (!testPhone.trim()) {
      toast.error('Insira um número de telefone');
      return;
    }

    if (!testMessage.trim()) {
      toast.error('Insira uma mensagem');
      return;
    }

    if (!testPhone.startsWith('+')) {
      toast.error('O número deve estar no formato internacional (ex: +5511999999999)');
      return;
    }

    setTestSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-whatsapp-message', {
        body: {
          phone_number: testPhone,
          message: testMessage
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('Mensagem enviada com sucesso! ✅', {
          description: `ID: ${data.message_id}`
        });
      } else {
        throw new Error(data?.error || 'Erro desconhecido');
      }
    } catch (error) {
      console.error('Error sending test message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erro ao enviar mensagem de teste';
      toast.error('Falha ao enviar mensagem', {
        description: errorMessage
      });
    } finally {
      setTestSending(false);
    }
  };

  const handleSimulateAudioWebhook = async () => {
    if (!audioSimulatePhone.trim()) {
      toast.error('Insira um número de telefone');
      return;
    }

    if (!audioFile) {
      toast.error('Selecione um arquivo de áudio');
      return;
    }

    // Validate phone format
    const cleanPhone = audioSimulatePhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      toast.error('Número de telefone inválido');
      return;
    }

    setAudioSimulating(true);
    setAudioSimulateResult(null);

    try {
      // Convert file to base64
      const arrayBuffer = await audioFile.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const { data, error } = await supabase.functions.invoke('simulate-audio-webhook', {
        body: {
          phone: cleanPhone,
          name: audioSimulateName.trim() || undefined,
          audio_base64: base64,
          audio_mime_type: audioFile.type || 'audio/ogg'
        }
      });

      if (error) throw error;

      if (data?.success) {
        setAudioSimulateResult({
          transcription: data.transcription,
          contact_id: data.contact_id,
          conversation_id: data.conversation_id,
          message_id: data.message_id,
          queued_for_nina: data.queued_for_nina
        });
        toast.success('Áudio simulado com sucesso!', {
          description: `Transcrição: "${data.transcription?.substring(0, 50)}..."`
        });
      } else {
        throw new Error(data?.error || 'Erro ao simular áudio');
      }
    } catch (error) {
      console.error('Error simulating audio webhook:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erro ao simular recebimento de áudio';
      toast.error('Falha na simulação', {
        description: errorMessage
      });
    } finally {
      setAudioSimulating(false);
    }
  };

  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/webm', 'audio/mp4'];
      if (!validTypes.includes(file.type) && !file.name.match(/\.(ogg|mp3|wav|m4a|webm|mp4)$/i)) {
        toast.error('Formato de áudio não suportado', {
          description: 'Use .ogg, .mp3, .wav, .m4a ou .webm'
        });
        return;
      }
      
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error('Arquivo muito grande', {
          description: 'O arquivo deve ter no máximo 10MB'
        });
        return;
      }
      
      setAudioFile(file);
      setAudioSimulateResult(null);
    }
  };

  const whatsappConfigured = settings.whatsapp_provider === 'uazapi' 
    ? (uazapiInstances.length > 0 || !!(settings.uazapi_endpoint && settings.uazapi_session && settings.uazapi_sessionkey))
    : !!(settings.whatsapp_access_token && settings.whatsapp_phone_number_id);
  const elevenlabsConfigured = settings.elevenlabs_api_key;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* WhatsApp Integration */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-white">WhatsApp</h3>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
            whatsappConfigured 
              ? 'bg-emerald-500/10 text-emerald-400' 
              : 'bg-amber-500/10 text-amber-400'
          }`}>
            <span className={`h-2 w-2 rounded-full ${whatsappConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            {whatsappConfigured ? 'Configurado' : 'Aguardando'}
          </div>
        </div>

        {/* Provider Selector */}
        <div className="mb-4">
          <label className="text-xs font-medium text-slate-400 mb-2 block">Provedor</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSettings({ ...settings, whatsapp_provider: 'cloud' })}
              className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                settings.whatsapp_provider === 'cloud'
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                  : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <MessageSquare className="w-4 h-4" />
                WhatsApp Cloud API
              </div>
              <p className="text-xs text-slate-500 mt-1">API oficial do Meta</p>
            </button>
            <button
              type="button"
              onClick={() => setSettings({ ...settings, whatsapp_provider: 'uazapi' })}
              className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                settings.whatsapp_provider === 'uazapi'
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                  : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Send className="w-4 h-4" />
                Uazapi
              </div>
              <p className="text-xs text-slate-500 mt-1">WhatsApp não-oficial</p>
            </button>
          </div>
        </div>

        {/* WhatsApp Cloud API Fields */}
        {settings.whatsapp_provider === 'cloud' && (
          <>
            <details className="mb-4">
              <summary className="text-xs text-cyan-400 cursor-pointer hover:text-cyan-300 flex items-center gap-2 py-2">
                <HelpCircle className="w-4 h-4" />
                Como obter as credenciais do WhatsApp?
              </summary>
              <div className="mt-2 p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-3">
                <div className="space-y-2">
                  <p className="text-white font-medium">📋 Passo a passo:</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-400">
                    <li>Acesse o <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Meta for Developers</a></li>
                    <li>Crie ou selecione um App do tipo "Business"</li>
                    <li>Adicione o produto "WhatsApp" ao app</li>
                    <li>Na seção "API Setup", copie o <strong className="text-white">Access Token</strong> temporário (ou gere um permanente)</li>
                    <li>Copie também o <strong className="text-white">Phone Number ID</strong> (número de identificação)</li>
                    <li>Em "Configuration" → "Webhook", cole a URL e o Verify Token abaixo</li>
                  </ol>
                </div>
                <div className="pt-2 border-t border-slate-700">
                  <p className="text-slate-500">
                    📚 <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Documentação oficial do WhatsApp Cloud API</a>
                  </p>
                </div>
              </div>
            </details>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Access Token <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showWhatsAppToken ? "text" : "password"}
                    value={settings.whatsapp_access_token || ''}
                    onChange={(e) => setSettings({ ...settings, whatsapp_access_token: e.target.value })}
                    placeholder="EAAxxxxxxxxxxxxxxx..."
                    className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 pr-10 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowWhatsAppToken(!showWhatsAppToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showWhatsAppToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                  Phone Number ID <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={settings.whatsapp_phone_number_id || ''}
                  onChange={(e) => setSettings({ ...settings, whatsapp_phone_number_id: e.target.value })}
                  placeholder="123456789012345"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>

            {/* Webhook Collapsible */}
            <Collapsible.Root open={webhookOpen} onOpenChange={setWebhookOpen}>
              <Collapsible.Trigger className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300 transition-colors">
                <ChevronDown className={`w-4 h-4 transition-transform ${webhookOpen ? 'rotate-180' : ''}`} />
                Configuração de Webhook
              </Collapsible.Trigger>
              <Collapsible.Content className="mt-3 space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1.5 block">Callback URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={webhookUrl}
                      readOnly
                      className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-400 font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyWebhookUrl}
                      className="px-3"
                    >
                      {copiedWebhook ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1.5 block">Verify Token</label>
                  <input
                    type="text"
                    value={settings.whatsapp_verify_token || ''}
                    onChange={(e) => setSettings({ ...settings, whatsapp_verify_token: e.target.value })}
                    className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  />
                </div>
              </Collapsible.Content>
            </Collapsible.Root>
          </>
        )}

        {/* Uazapi Fields */}
        {settings.whatsapp_provider === 'uazapi' && (
          <>
            {/* Multi-instance list */}
            <div className="space-y-3">
              {uazapiInstances.map((inst) => (
                <UazapiInstanceCard
                  key={inst.id}
                  instanceId={inst.id}
                  instanceName={inst.name}
                  endpoint={inst.endpoint}
                  sessionKey={inst.sessionkey}
                  isActive={inst.is_active}
                  onEditClick={() => handleStartEditInstance(inst)}
                  onConnectClick={() => { setConnectingInstanceId(inst.id); setShowConnectionModal(true); }}
                  onDeleteClick={() => handleDeleteInstance(inst.id)}
                  onToggleClick={() => handleToggleInstance(inst.id, inst.is_active)}
                />
              ))}

              {/* Delete confirmation dialog */}
              {deletingInstanceId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
                    <h3 className="text-lg font-semibold text-slate-100">Excluir instância permanentemente?</h3>
                    <p className="text-sm text-slate-400">
                      Esta ação é <span className="text-red-400 font-semibold">irreversível</span>. A instância será removida definitivamente do sistema e os contatos vinculados serão desassociados.
                    </p>
                    <div className="flex gap-3 justify-end">
                      <button
                        onClick={() => setDeletingInstanceId(null)}
                        className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={confirmDeleteInstance}
                        className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors text-sm font-medium"
                      >
                        Excluir Definitivamente
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Add instance button */}
              {!showAddInstance ? (
                <button
                  onClick={() => { setEditingInstanceId(null); setNewInstance({ name: '', endpoint: '', session: '', sessionkey: '' }); setShowAddInstance(true); }}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 transition-colors text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Instância
                </button>
              ) : (
                <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-3">
                  <p className="text-sm font-medium text-emerald-400">{editingInstanceId ? 'Editar Instância' : 'Nova Instância'}</p>
                  <div>
                    <label className="text-xs font-medium text-slate-400 mb-1 block">Nome</label>
                    <input type="text" value={newInstance.name} onChange={(e) => setNewInstance({ ...newInstance, name: e.target.value })} placeholder="Ex: Comercial" className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-400 mb-1 block">Endpoint <span className="text-red-400">*</span></label>
                    <input type="text" value={newInstance.endpoint} onChange={(e) => setNewInstance({ ...newInstance, endpoint: e.target.value })} placeholder="https://api.uazapi.com" className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-400 mb-1 block">Sessão</label>
                      <input type="text" value={newInstance.session} onChange={(e) => setNewInstance({ ...newInstance, session: e.target.value })} placeholder="minha-sessao" className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-400 mb-1 block">Session Key <span className="text-red-400">*</span></label>
                      <input type="password" value={newInstance.sessionkey} onChange={(e) => setNewInstance({ ...newInstance, sessionkey: e.target.value })} placeholder="token" className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => { setShowAddInstance(false); setEditingInstanceId(null); setNewInstance({ name: '', endpoint: '', session: '', sessionkey: '' }); }}>Cancelar</Button>
                    <Button variant="default" size="sm" onClick={handleAddInstance}>{editingInstanceId ? 'Atualizar' : 'Salvar'}</Button>
                  </div>
                </div>
              )}
            </div>

          </>
        )}
      </div>

      <UazapiConnectionModal open={showConnectionModal} onOpenChange={setShowConnectionModal} instanceId={connectingInstanceId || undefined} />

      {/* ElevenLabs */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Mic className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold text-white">ElevenLabs (Text-to-Speech)</h3>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
            elevenlabsConfigured 
              ? 'bg-emerald-500/10 text-emerald-400' 
              : 'bg-amber-500/10 text-amber-400'
          }`}>
            <span className={`h-2 w-2 rounded-full ${elevenlabsConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
            {elevenlabsConfigured ? 'Configurado' : 'Aguardando'}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">API Key</label>
            <div className="relative">
              <input
                type={showElevenLabsKey ? "text" : "password"}
                value={settings.elevenlabs_api_key || ''}
                onChange={(e) => setSettings({ ...settings, elevenlabs_api_key: e.target.value })}
                onBlur={handleElevenLabsKeyBlur}
                placeholder="sk_xxxxxxxxxxxxxxxxxxxxxxxx"
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 pr-10 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
              <button
                type="button"
                onClick={() => setShowElevenLabsKey(!showElevenLabsKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showElevenLabsKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-400">Voz</label>
                {settings.elevenlabs_api_key && (
                  <button
                    type="button"
                    onClick={() => {
                      setVoicesLoaded(false);
                      loadVoices(settings.elevenlabs_api_key!);
                    }}
                    disabled={loadingVoices}
                    className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                    title="Atualizar lista de vozes"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingVoices ? 'animate-spin' : ''}`} />
                    {loadingVoices ? 'Carregando...' : 'Atualizar'}
                  </button>
                )}
              </div>
              <select
                value={settings.elevenlabs_voice_id}
                onChange={(e) => setSettings({ ...settings, elevenlabs_voice_id: e.target.value })}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              >
                {/* Group: Custom/Cloned voices */}
                {voices.filter(v => v.category === 'cloned' || v.category === 'custom').length > 0 && (
                  <optgroup label="🎤 Minhas Vozes">
                    {voices.filter(v => v.category === 'cloned' || v.category === 'custom').map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name} - {voice.description}
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* Group: Professional/Premade voices */}
                <optgroup label="📚 Vozes Padrão">
                  {voices.filter(v => v.category === 'premade' || v.category === 'professional').map(voice => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} - {voice.description}
                    </option>
                  ))}
                </optgroup>
              </select>
              {!settings.elevenlabs_api_key && (
                <p className="text-xs text-amber-400/70 mt-1">
                  Configure a API Key para ver suas vozes personalizadas
                </p>
              )}
              {voicesLoaded && voices.filter(v => v.category === 'cloned' || v.category === 'custom').length > 0 && (
                <p className="text-xs text-emerald-400/70 mt-1">
                  ✓ {voices.filter(v => v.category === 'cloned' || v.category === 'custom').length} voz(es) personalizada(s) carregada(s)
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">Modelo</label>
              <select
                value={settings.elevenlabs_model || 'eleven_turbo_v2_5'}
                onChange={(e) => setSettings({ ...settings, elevenlabs_model: e.target.value })}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              >
                {MODEL_OPTIONS.map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Audio Response Toggle */}
          <div className="p-4 bg-violet-500/5 border border-violet-500/20 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Volume2 className="w-4 h-4 text-violet-400" />
                  <span className="text-sm font-medium text-white">Respostas em Áudio</span>
                </div>
                <p className="text-xs text-slate-400">
                  Quando ativado, o agente responderá com áudios em vez de texto
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.audio_response_enabled}
                  onChange={(e) => setSettings({ ...settings, audio_response_enabled: e.target.checked })}
                  disabled={!elevenlabsConfigured}
                  className="sr-only peer"
                />
                <div className={`w-11 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-violet-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500 ${!elevenlabsConfigured ? 'opacity-50 cursor-not-allowed' : ''}`}></div>
              </label>
            </div>
            {!elevenlabsConfigured && (
              <p className="text-xs text-amber-400 mt-2">
                ⚠️ Configure a API Key da ElevenLabs para habilitar respostas em áudio
              </p>
            )}
            {settings.audio_response_enabled && elevenlabsConfigured && (
              <p className="text-xs text-emerald-400 mt-2">
                ✅ Áudios recebidos serão transcritos automaticamente e o agente responderá com áudio
              </p>
            )}
          </div>

          {/* Advanced Voice Settings Collapsible */}
          <Collapsible.Root open={advancedVoiceOpen} onOpenChange={setAdvancedVoiceOpen}>
            <Collapsible.Trigger className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300 transition-colors">
              <ChevronDown className={`w-4 h-4 transition-transform ${advancedVoiceOpen ? 'rotate-180' : ''}`} />
              Configurações Avançadas de Voz
            </Collapsible.Trigger>
            <Collapsible.Content className="mt-3 p-4 bg-slate-950/50 rounded-lg border border-slate-800 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs text-slate-400">Stability</label>
                    <span className="text-xs font-mono text-slate-300">{settings.elevenlabs_stability.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.elevenlabs_stability}
                    onChange={(e) => setSettings({ ...settings, elevenlabs_stability: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs text-slate-400">Similarity</label>
                    <span className="text-xs font-mono text-slate-300">{settings.elevenlabs_similarity_boost.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.elevenlabs_similarity_boost}
                    onChange={(e) => setSettings({ ...settings, elevenlabs_similarity_boost: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs text-slate-400">Style</label>
                    <span className="text-xs font-mono text-slate-300">{settings.elevenlabs_style.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.elevenlabs_style}
                    onChange={(e) => setSettings({ ...settings, elevenlabs_style: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs text-slate-400">Speed</label>
                    <span className="text-xs font-mono text-slate-300">{settings.elevenlabs_speed?.toFixed(1) || '1.0'}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={settings.elevenlabs_speed || 1.0}
                    onChange={(e) => setSettings({ ...settings, elevenlabs_speed: parseFloat(e.target.value) })}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.elevenlabs_speaker_boost}
                    onChange={(e) => setSettings({ ...settings, elevenlabs_speaker_boost: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-violet-500/50 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-500"></div>
                </label>
                <span className="text-sm text-slate-300">Speaker Boost</span>
              </div>
            </Collapsible.Content>
          </Collapsible.Root>

          {/* Audio Test Section */}
          <Collapsible.Root open={audioTestOpen} onOpenChange={setAudioTestOpen} className="mt-4">
            <Collapsible.Trigger className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300 transition-colors">
              <ChevronDown className={`w-4 h-4 transition-transform ${audioTestOpen ? 'rotate-180' : ''}`} />
              <Volume2 className="w-4 h-4" />
              Testar Áudio
            </Collapsible.Trigger>
            <Collapsible.Content className="mt-3 p-4 bg-slate-950/50 rounded-lg border border-slate-800 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Texto para converter em áudio</label>
                <textarea
                  value={audioTestText}
                  onChange={(e) => setAudioTestText(e.target.value)}
                  placeholder="Digite o texto que deseja converter em áudio..."
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 resize-none"
                />
                <p className="text-xs text-slate-500 mt-1">{audioTestText.length}/1000 caracteres</p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleGenerateAudio}
                  disabled={audioGenerating || !settings.elevenlabs_api_key}
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  {audioGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Gerando...
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4 mr-2" />
                      Gerar e Ouvir
                    </>
                  )}
                </Button>

                {audioUrl && (
                  <Button
                    onClick={handleDownloadAudio}
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-slate-200"
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Baixar
                  </Button>
                )}
              </div>

              {!settings.elevenlabs_api_key && (
                <p className="text-xs text-amber-400">
                  ⚠️ Configure sua API Key da ElevenLabs acima para testar
                </p>
              )}

              {audioUrl && (
                <div className="space-y-2">
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    controls
                    className="w-full h-10"
                    autoPlay
                  />
                  {audioStats && (
                    <p className="text-xs text-slate-500">
                      ✅ Gerado em {(audioStats.duration_ms / 1000).toFixed(1)}s • {audioStats.size_kb}KB
                    </p>
                  )}
                </div>
              )}
            </Collapsible.Content>
          </Collapsible.Root>
        </div>
      </div>

      {/* Google Calendar Integration */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold text-white">Google Calendar</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
              settings.google_calendar_enabled && settings.google_calendar_client_id
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-slate-500/10 text-slate-400'
            }`}>
              <span className={`h-2 w-2 rounded-full ${
                settings.google_calendar_enabled && settings.google_calendar_client_id ? 'bg-emerald-500' : 'bg-slate-500'
              }`}></span>
              {settings.google_calendar_enabled && settings.google_calendar_client_id ? 'Ativo' : 'Desativado'}
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-slate-400">Ativar</span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.google_calendar_enabled}
                onClick={() => setSettings({ ...settings, google_calendar_enabled: !settings.google_calendar_enabled })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors ${
                  settings.google_calendar_enabled ? 'bg-blue-500' : 'bg-slate-600'
                }`}
              >
                <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg transition-transform ${
                  settings.google_calendar_enabled ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
            </label>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-4">
          Conecte ao Google Calendar para que a Nina consulte horários ocupados antes de agendar e crie eventos automaticamente.
        </p>

        {/* Setup instructions */}
        <details className="mb-4">
          <summary className="text-xs text-blue-400 cursor-pointer hover:text-blue-300 flex items-center gap-2 py-2">
            <HelpCircle className="w-4 h-4" />
            Como configurar o Google Calendar?
          </summary>
          <div className="mt-2 p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-3">
            <div className="space-y-2">
              <p className="text-white font-medium">📋 Passo a passo:</p>
              <ol className="list-decimal list-inside space-y-1.5 text-slate-400">
                <li>Acesse o <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google Cloud Console</a></li>
                <li>Crie ou selecione um projeto</li>
                <li>Ative a <strong className="text-white">Google Calendar API</strong> em "APIs & Services"</li>
                <li>Vá em <strong className="text-white">Credentials</strong> → "Create Credentials" → "OAuth Client ID"</li>
                <li>Tipo: <strong className="text-white">Web Application</strong></li>
                <li>Em <strong className="text-white">Authorized redirect URIs</strong>, adicione:<br/>
                  <code className="bg-slate-800 px-1 rounded text-emerald-300">{import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-auth?action=callback</code>
                </li>
                <li>Copie o <strong className="text-white">Client ID</strong> e <strong className="text-white">Client Secret</strong></li>
                <li>Cole abaixo e clique em <strong className="text-white">"Autorizar Google Calendar"</strong></li>
                <li>Vá em <strong className="text-white">OAuth consent screen</strong> → <strong className="text-emerald-400">Publish App</strong> para modo Produção (token não expira)</li>
              </ol>
            </div>
          </div>
        </details>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Client ID</label>
            <div className="relative">
              <input
                type={showGCalClientId ? "text" : "password"}
                value={settings.google_calendar_client_id || ''}
                onChange={(e) => setSettings({ ...settings, google_calendar_client_id: e.target.value })}
                placeholder="123456789.apps.googleusercontent.com"
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 pr-10 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
              <button
                type="button"
                onClick={() => setShowGCalClientId(!showGCalClientId)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showGCalClientId ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Client Secret</label>
            <div className="relative">
              <input
                type={showGCalSecret ? "text" : "password"}
                value={settings.google_calendar_client_secret || ''}
                onChange={(e) => setSettings({ ...settings, google_calendar_client_secret: e.target.value })}
                placeholder="GOCSPX-xxxxxxxxxxxxxxxx"
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 pr-10 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
              <button
                type="button"
                onClick={() => setShowGCalSecret(!showGCalSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showGCalSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Redirect URI hint */}
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">URI de Redirecionamento (adicione no Google Cloud Console)</label>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-slate-950 border border-slate-700 rounded px-3 py-2 text-cyan-400 break-all select-all flex-1">
                {`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-auth?action=callback`}
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-auth?action=callback`);
                  toast.success('URI copiada!');
                }}
                className="text-slate-400 hover:text-white p-2"
                title="Copiar"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* OAuth Authorization - replaces manual Refresh Token */}
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Autorização</label>
            <div className="flex items-center gap-3">
              <Button
                variant={settings.google_calendar_refresh_token ? 'ghost' : 'primary'}
                onClick={handleAuthorizeGoogleCalendar}
                disabled={authorizingGCal || !settings.google_calendar_client_id || !settings.google_calendar_client_secret}
                className="gap-2"
              >
                {authorizingGCal ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Aguardando autorização...
                  </>
                ) : settings.google_calendar_refresh_token ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Reautorizar
                  </>
                ) : (
                  <>
                    <Calendar className="w-4 h-4" />
                    Autorizar Google Calendar
                  </>
                )}
              </Button>
              {settings.google_calendar_refresh_token && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                  Autorizado
                </span>
              )}
              {!settings.google_calendar_refresh_token && !authorizingGCal && (
                <span className="text-xs text-amber-400">
                  Clique para conectar sua conta Google
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              Ao clicar, uma janela será aberta para você autorizar o acesso ao Google Calendar. O token será salvo automaticamente.
            </p>
          </div>

          {/* Calendar Selector - auto-fetched */}
          {settings.google_calendar_refresh_token && (
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">Calendário</label>
              <div className="flex items-center gap-2">
                <select
                  value={settings.google_calendar_id || 'primary'}
                  onChange={(e) => setSettings({ ...settings, google_calendar_id: e.target.value })}
                  className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  {availableCalendars.length === 0 && (
                    <option value={settings.google_calendar_id || 'primary'}>
                      {settings.google_calendar_id || 'primary'} (clique em carregar)
                    </option>
                  )}
                  {availableCalendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.summary} {cal.primary ? '(Principal)' : ''}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadCalendars}
                  disabled={loadingCalendars}
                  className="gap-1 text-blue-400 hover:text-blue-300 shrink-0"
                >
                  {loadingCalendars ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Carregar
                </Button>
              </div>
            </div>
          )}

          {/* Save & Test buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              onClick={handleSaveGoogleCalendar}
              disabled={savingGCal}
              className="gap-2"
            >
              {savingGCal ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Salvar
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={handleTestGoogleCalendar}
              disabled={testingGCal || !settings.google_calendar_refresh_token}
              className="gap-2 text-blue-400 hover:text-blue-300"
            >
              {testingGCal ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testando...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Testar Conexão
                </>
              )}
            </Button>
          </div>
          {gCalTestResult && (
            <div className={`p-3 rounded-lg text-xs ${
              gCalTestResult.success 
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300' 
                : 'bg-red-500/10 border border-red-500/20 text-red-300'
            }`}>
              {gCalTestResult.success 
                ? `✅ Conexão bem-sucedida! Calendário "${gCalTestResult.calendarId}" acessível.`
                : `❌ Erro: ${gCalTestResult.error}`
              }
            </div>
          )}
        </div>
      </div>

      {/* Calendly Integration */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-violet-400" />
            <h3 className="font-semibold text-white">Calendly</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              {settings.calendly_enabled ? 'Ativo' : 'Inativo'}
            </span>
            <button
              onClick={() => setSettings({ ...settings, calendly_enabled: !settings.calendly_enabled })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                settings.calendly_enabled ? 'bg-violet-500' : 'bg-slate-600'
              }`}
            >
              <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg transition-transform ${
                settings.calendly_enabled ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-4">
          Conecte ao Calendly para que a Nina consulte horários disponíveis e envie o link de agendamento ao cliente.
        </p>

        <div className="space-y-4">
          {/* Test Connection */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTestCalendly}
              disabled={testingCalendly}
              className="gap-2 text-violet-400 hover:text-violet-300"
            >
              {testingCalendly ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testando...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Testar Conexão
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLoadCalendlyEventTypes}
              disabled={loadingCalendlyTypes}
              className="gap-2 text-violet-400 hover:text-violet-300"
            >
              {loadingCalendlyTypes ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Carregando...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Carregar Tipos de Evento
                </>
              )}
            </Button>
          </div>

          {calendlyTestResult && (
            <div className={`p-3 rounded-lg text-xs ${
              calendlyTestResult.success
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                : 'bg-red-500/10 border border-red-500/20 text-red-300'
            }`}>
              {calendlyTestResult.success
                ? `✅ Conectado! Usuário: ${calendlyTestResult.userName}`
                : `❌ Erro: ${calendlyTestResult.error}`
              }
            </div>
          )}

          {/* Event Type Selector */}
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Tipo de Evento</label>
            {calendlyEventTypes.length > 0 ? (
              <select
                value={settings.calendly_event_type_uri || ''}
                onChange={(e) => {
                  const selected = calendlyEventTypes.find(t => t.uri === e.target.value);
                  setSettings({
                    ...settings,
                    calendly_event_type_uri: e.target.value,
                    calendly_scheduling_url: selected?.scheduling_url || settings.calendly_scheduling_url,
                  });
                }}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              >
                <option value="">Selecione...</option>
                {calendlyEventTypes.map((et) => (
                  <option key={et.uri} value={et.uri}>{et.name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={settings.calendly_event_type_uri || ''}
                onChange={(e) => setSettings({ ...settings, calendly_event_type_uri: e.target.value })}
                placeholder="URI do Event Type (clique em 'Carregar Tipos')"
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
            )}
          </div>

          {/* Scheduling URL */}
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">Link de Agendamento</label>
            <input
              type="url"
              value={settings.calendly_scheduling_url || ''}
              onChange={(e) => setSettings({ ...settings, calendly_scheduling_url: e.target.value })}
              placeholder="https://calendly.com/seu-usuario/evento"
              className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            />
            <p className="text-xs text-slate-500 mt-1">Link público que a Nina enviará para o cliente agendar.</p>
          </div>

          {/* Save */}
          <Button
            variant="primary"
            onClick={handleSaveCalendly}
            disabled={savingCalendly}
            className="gap-2"
          >
            {savingCalendly ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Salvar Calendly
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Test Message Collapsible */}
      <Collapsible.Root open={testSectionOpen} onOpenChange={setTestSectionOpen}>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <Collapsible.Trigger className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors w-full">
            <Send className="w-4 h-4" />
            <span>Teste de Envio</span>
            <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${testSectionOpen ? 'rotate-180' : ''}`} />
          </Collapsible.Trigger>
          <Collapsible.Content className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Telefone</label>
                <input
                  type="tel"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+5511999999999"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Mensagem</label>
                <input
                  type="text"
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  placeholder="Mensagem de teste..."
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleTestMessage}
                disabled={testSending}
                className="shadow-lg shadow-cyan-500/20"
              >
                {testSending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Enviar Teste
                  </>
                )}
              </Button>
            </div>
          </Collapsible.Content>
        </div>
      </Collapsible.Root>

      {/* Simulate Audio Reception - Seção Avançada (escondida por padrão) */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-400 flex items-center gap-2 py-2">
          <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" />
          Ferramentas Avançadas de Teste
        </summary>
        <div className="mt-2">
      <Collapsible.Root open={audioSimulateOpen} onOpenChange={setAudioSimulateOpen}>
        <div className="rounded-xl border border-amber-500/20 bg-slate-900/50 p-6">
          <Collapsible.Trigger className="flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors w-full">
            <FileAudio className="w-4 h-4 text-amber-400" />
            <span>Simular Recebimento de Áudio</span>
            <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${audioSimulateOpen ? 'rotate-180' : ''}`} />
          </Collapsible.Trigger>
          <Collapsible.Content className="mt-4 space-y-4">
            <p className="text-xs text-slate-400">
              Simula o recebimento de um áudio pelo WhatsApp. O áudio será transcrito e processado pela IA.
            </p>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Telefone do Contato *</label>
                <input
                  type="tel"
                  value={audioSimulatePhone}
                  onChange={(e) => setAudioSimulatePhone(e.target.value)}
                  placeholder="5511999999999"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Nome do Contato (opcional)</label>
                <input
                  type="text"
                  value={audioSimulateName}
                  onChange={(e) => setAudioSimulateName(e.target.value)}
                  placeholder="João da Silva"
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </div>
            </div>

            {/* File Upload */}
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">Arquivo de Áudio *</label>
              <div 
                className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                  audioFile 
                    ? 'border-amber-500/50 bg-amber-500/5' 
                    : 'border-slate-700 hover:border-slate-600 bg-slate-950/50'
                }`}
                onClick={() => audioFileInputRef.current?.click()}
              >
                <input
                  ref={audioFileInputRef}
                  type="file"
                  accept=".ogg,.mp3,.wav,.m4a,.webm,audio/*"
                  onChange={handleAudioFileChange}
                  className="hidden"
                />
                {audioFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileAudio className="w-5 h-5 text-amber-400" />
                    <div className="text-left">
                      <p className="text-sm text-slate-200">{audioFile.name}</p>
                      <p className="text-xs text-slate-500">{(audioFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAudioFile(null);
                        setAudioSimulateResult(null);
                      }}
                      className="ml-2 text-slate-500 hover:text-slate-300"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-8 h-8 mx-auto text-slate-500 mb-2" />
                    <p className="text-sm text-slate-400">Clique ou arraste um arquivo de áudio</p>
                    <p className="text-xs text-slate-600 mt-1">.ogg, .mp3, .wav, .m4a, .webm (máx 10MB)</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSimulateAudioWebhook}
                disabled={audioSimulating || !audioFile || !audioSimulatePhone.trim()}
                className="bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-500/20"
              >
                {audioSimulating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <FileAudio className="w-4 h-4 mr-2" />
                    Simular Áudio Recebido
                  </>
                )}
              </Button>
            </div>

            {/* Result Display */}
            {audioSimulateResult && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-medium">Áudio processado com sucesso!</span>
                </div>
                
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-slate-400">Transcrição:</span>
                    <p className="text-slate-200 mt-1 p-2 bg-slate-950/50 rounded border border-slate-800">
                      "{audioSimulateResult.transcription}"
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">Contact ID:</span>
                      <p className="text-slate-300 font-mono">{audioSimulateResult.contact_id.slice(0, 8)}...</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Conversation ID:</span>
                      <p className="text-slate-300 font-mono">{audioSimulateResult.conversation_id.slice(0, 8)}...</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Message ID:</span>
                      <p className="text-slate-300 font-mono">{audioSimulateResult.message_id.slice(0, 8)}...</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Nina:</span>
                      <p className={audioSimulateResult.queued_for_nina ? 'text-emerald-400' : 'text-amber-400'}>
                        {audioSimulateResult.queued_for_nina ? '✅ Processando' : '⏸️ Não enfileirado'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Collapsible.Content>
        </div>
      </Collapsible.Root>

      {/* Repair Audio Messages */}
      <div className="rounded-xl border border-orange-500/20 bg-slate-900/50 p-6">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300 w-full mb-4">
          <Wrench className="w-4 h-4 text-orange-400" />
          <span>Reparar Áudios Antigos</span>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Repara mensagens de áudio antigas que não foram processadas corretamente. 
          Baixa os áudios via Uazapi, salva no storage e transcreve.
        </p>
        
        <div className="flex justify-end">
          <Button
            onClick={async () => {
              const loadingToast = toast.loading('Reparando áudios antigos...');
              try {
                const { data, error } = await supabase.functions.invoke('repair-audio-messages');
                if (error) throw error;
                
                toast.dismiss(loadingToast);
                toast.success(`Áudios reparados!`, {
                  description: `${data.repaired} de ${data.total} áudios reparados. ${data.failed} falhas.`
                });
              } catch (err) {
                toast.dismiss(loadingToast);
                toast.error('Erro ao reparar áudios', {
                  description: err instanceof Error ? err.message : 'Erro desconhecido'
                });
              }
            }}
            className="bg-orange-600 hover:bg-orange-700 shadow-lg shadow-orange-500/20"
          >
            <Wrench className="w-4 h-4 mr-2" />
            Reparar Áudios
          </Button>
        </div>
      </div>
        </div>
      </details>
    </div>
  );
});

ApiSettings.displayName = 'ApiSettings';

export default ApiSettings;
