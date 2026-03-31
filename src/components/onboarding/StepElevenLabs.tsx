import React, { useState, useEffect, useCallback } from 'react';
import { Mic, Eye, EyeOff, Play, Loader2, Volume2, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/Button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface StepElevenLabsProps {
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
  audioResponseEnabled: boolean;
  elevenLabsStability: number;
  elevenLabsSimilarityBoost: number;
  elevenLabsSpeed: number;
  onApiKeyChange: (value: string) => void;
  onVoiceIdChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onAudioEnabledChange: (value: boolean) => void;
  onStabilityChange: (value: number) => void;
  onSimilarityBoostChange: (value: number) => void;
  onSpeedChange: (value: number) => void;
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

const MODELS = [
  { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5', description: 'Rápido, 32 idiomas' },
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2', description: 'Alta qualidade, 29 idiomas' },
  { id: 'eleven_turbo_v2', name: 'Turbo v2', description: 'Rápido, apenas inglês' },
];

export const StepElevenLabs: React.FC<StepElevenLabsProps> = ({
  elevenLabsApiKey,
  elevenLabsVoiceId,
  elevenLabsModel,
  audioResponseEnabled,
  elevenLabsStability,
  elevenLabsSimilarityBoost,
  elevenLabsSpeed,
  onApiKeyChange,
  onVoiceIdChange,
  onModelChange,
  onAudioEnabledChange,
  onStabilityChange,
  onSimilarityBoostChange,
  onSpeedChange,
}) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  
  // Dynamic voices state
  const [voices, setVoices] = useState<ElevenLabsVoice[]>(FALLBACK_VOICES);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voicesLoaded, setVoicesLoaded] = useState(false);

  // Load voices from ElevenLabs API
  const loadVoices = useCallback(async (apiKey: string) => {
    if (!apiKey || loadingVoices) return;
    
    setLoadingVoices(true);
    try {
      const { data, error } = await supabase.functions.invoke('list-elevenlabs-voices', {
        body: { apiKey },
      });

      if (error) throw error;

      if (data?.success && data?.voices?.length > 0) {
        setVoices(data.voices);
        setVoicesLoaded(true);
        
        // If current voice is not in the list, keep it
        const currentVoiceExists = data.voices.some((v: ElevenLabsVoice) => v.id === elevenLabsVoiceId);
        if (!currentVoiceExists && elevenLabsVoiceId) {
          setVoices((prev) => [
            { id: elevenLabsVoiceId, name: 'Voz Atual', category: 'custom' as const, description: 'Selecionada anteriormente' },
            ...prev,
          ]);
        }
      }
    } catch (error) {
      console.error('[StepElevenLabs] Failed to load voices:', error);
    } finally {
      setLoadingVoices(false);
    }
  }, [loadingVoices, elevenLabsVoiceId]);

  // Load voices when API key is provided
  useEffect(() => {
    if (elevenLabsApiKey && !voicesLoaded) {
      loadVoices(elevenLabsApiKey);
    }
  }, [elevenLabsApiKey, voicesLoaded, loadVoices]);

  const handleTestVoice = async () => {
    if (!elevenLabsApiKey) {
      toast.error('Digite a API Key primeiro');
      return;
    }

    setIsTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-elevenlabs-tts', {
        body: {
          text: 'Olá! Esta é uma mensagem de teste do sistema de voz.',
          apiKey: elevenLabsApiKey,
          voiceId: elevenLabsVoiceId,
          model: elevenLabsModel,
          stability: elevenLabsStability,
          similarityBoost: elevenLabsSimilarityBoost,
          speed: elevenLabsSpeed,
        },
      });

      if (error) throw error;

      if (data?.success && data?.audioBase64) {
        // Create audio from base64
        const audioBlob = new Blob(
          [Uint8Array.from(atob(data.audioBase64), c => c.charCodeAt(0))],
          { type: 'audio/mpeg' }
        );
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
        toast.success(`Áudio reproduzido com sucesso! (${(data.duration_ms / 1000).toFixed(1)}s)`);
      } else if (data?.error) {
        throw new Error(data.error);
      } else {
        toast.success('Teste de voz concluído!');
      }
    } catch (error: any) {
      console.error('Error testing voice:', error);
      toast.error(error.message || 'Erro ao testar voz');
    } finally {
      setIsTesting(false);
    }
  };

  const selectedVoice = voices.find(v => v.id === elevenLabsVoiceId);
  const customVoices = voices.filter(v => v.category === 'cloned' || v.category === 'custom');
  const premadeVoices = voices.filter(v => v.category === 'premade' || v.category === 'professional');

  return (
    <motion.div 
      className="space-y-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={itemVariants} className="text-center mb-8">
        <motion.div 
          className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30 flex items-center justify-center"
          whileHover={{ scale: 1.05, rotate: 5 }}
          transition={{ type: "spring", stiffness: 400 }}
        >
          <Mic className="w-8 h-8 text-violet-400" />
        </motion.div>
        <h3 className="text-xl font-semibold text-white mb-2">Respostas em Áudio</h3>
        <p className="text-slate-400 text-sm max-w-md mx-auto">
          Configure o ElevenLabs para que seu agente responda também por áudio.
        </p>
        <p className="text-xs text-amber-400/80 mt-2">
          ⚡ Esta configuração é opcional
        </p>
      </motion.div>

      <div className="space-y-6 max-w-md mx-auto">
        {/* Enable Audio Toggle */}
        <motion.div variants={itemVariants} className="flex items-center justify-between p-4 rounded-lg bg-slate-800/30 border border-slate-700/50">
          <div className="flex items-center gap-3">
            <Volume2 className="w-5 h-5 text-violet-400" />
            <div>
              <Label className="text-slate-300">Habilitar Respostas em Áudio</Label>
              <p className="text-xs text-slate-500">O agente enviará mensagens de voz</p>
            </div>
          </div>
          <Switch
            checked={audioResponseEnabled}
            onCheckedChange={onAudioEnabledChange}
          />
        </motion.div>

        {/* API Key */}
        <motion.div variants={itemVariants} className="space-y-2">
          <Label htmlFor="elevenLabsApiKey" className="text-slate-300 flex items-center gap-2">
            <Mic className="w-4 h-4 text-slate-500" />
            API Key do ElevenLabs
          </Label>
          <div className="relative">
            <Input
              id="elevenLabsApiKey"
              type={showApiKey ? 'text' : 'password'}
              value={elevenLabsApiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="sk-..."
              className="bg-slate-800/50 border-slate-700 focus:border-violet-500 text-white placeholder:text-slate-500 pr-10 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Obtenha em{' '}
            <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">
              elevenlabs.io
            </a>
          </p>
        </motion.div>

        {/* Voice Selector */}
        <motion.div variants={itemVariants} className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-slate-300">Voz</Label>
            {elevenLabsApiKey && (
              <button
                type="button"
                onClick={() => {
                  setVoicesLoaded(false);
                  loadVoices(elevenLabsApiKey);
                }}
                disabled={loadingVoices}
                className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${loadingVoices ? 'animate-spin' : ''}`} />
                {loadingVoices ? 'Carregando...' : 'Atualizar vozes'}
              </button>
            )}
          </div>
          <Select value={elevenLabsVoiceId} onValueChange={onVoiceIdChange}>
            <SelectTrigger className="bg-slate-800/50 border-slate-700 text-white">
              <SelectValue placeholder="Selecione uma voz">
                {selectedVoice ? `${selectedVoice.name} - ${selectedVoice.description}` : 'Selecione uma voz'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700 z-50 max-h-80">
              {/* Custom/Cloned voices first */}
              {customVoices.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-violet-400 text-xs">🎤 Minhas Vozes</SelectLabel>
                  {customVoices.map((voice) => (
                    <SelectItem key={voice.id} value={voice.id} className="text-white hover:bg-violet-500/20 focus:bg-violet-500/20 focus:text-white">
                      <span className="font-medium">{voice.name}</span>
                      <span className="text-slate-400 ml-2">- {voice.description}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {/* Premade voices */}
              <SelectGroup>
                <SelectLabel className="text-slate-400 text-xs">📚 Vozes Padrão</SelectLabel>
                {premadeVoices.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id} className="text-white hover:bg-violet-500/20 focus:bg-violet-500/20 focus:text-white">
                    <span className="font-medium">{voice.name}</span>
                    <span className="text-slate-400 ml-2">- {voice.description}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {!elevenLabsApiKey && (
            <p className="text-xs text-amber-400/70">
              Configure a API Key para ver suas vozes personalizadas
            </p>
          )}
          {voicesLoaded && customVoices.length > 0 && (
            <p className="text-xs text-emerald-400/70">
              ✓ {customVoices.length} voz(es) personalizada(s) carregada(s)
            </p>
          )}
        </motion.div>

        {/* Model Selector */}
        <motion.div variants={itemVariants} className="space-y-2">
          <Label className="text-slate-300">Modelo</Label>
          <Select value={elevenLabsModel} onValueChange={onModelChange}>
            <SelectTrigger className="bg-slate-800/50 border-slate-700 text-white">
              <SelectValue placeholder="Selecione um modelo" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700 z-50">
              {MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id} className="text-white hover:bg-violet-500/20 focus:bg-violet-500/20 focus:text-white">
                  <span className="font-medium">{model.name}</span>
                  <span className="text-slate-400 ml-2">- {model.description}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </motion.div>

        {/* Voice Settings Sliders */}
        <motion.div variants={itemVariants} className="space-y-4 p-4 rounded-lg bg-slate-800/20 border border-slate-700/30">
          <h4 className="text-sm font-medium text-slate-300">Ajustes da Voz</h4>
          
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Estabilidade</span>
                <span className="text-slate-500">{(elevenLabsStability * 100).toFixed(0)}%</span>
              </div>
              <Slider
                value={[elevenLabsStability]}
                onValueChange={([v]) => onStabilityChange(v)}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Similaridade</span>
                <span className="text-slate-500">{(elevenLabsSimilarityBoost * 100).toFixed(0)}%</span>
              </div>
              <Slider
                value={[elevenLabsSimilarityBoost]}
                onValueChange={([v]) => onSimilarityBoostChange(v)}
                min={0}
                max={1}
                step={0.05}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Velocidade</span>
                <span className="text-slate-500">{elevenLabsSpeed.toFixed(1)}x</span>
              </div>
              <Slider
                value={[elevenLabsSpeed]}
                onValueChange={([v]) => onSpeedChange(v)}
                min={0.5}
                max={2}
                step={0.1}
                className="w-full"
              />
            </div>
          </div>
        </motion.div>

        {/* Test Button */}
        <motion.div variants={itemVariants}>
          <Button
            variant="outline"
            onClick={handleTestVoice}
            disabled={!elevenLabsApiKey || isTesting}
            className="w-full gap-2"
          >
            {isTesting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Testando...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Testar Voz
              </>
            )}
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
};
