import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Search, MoreVertical, Phone, Paperclip, Send, Check, CheckCheck, 
  Smile, Play, Loader2, MessageSquare, Info, X, Mail, Eye, EyeOff, 
  Tag, Bot, User, Pause, Brain, Plus, Target, TrendingUp, ChevronDown, ChevronUp, FileText,
  Pencil, Trash2, Filter, ArrowUpDown, CheckSquare, Square, XCircle, ArrowLeft
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { MessageDirection, MessageType, UIConversation, UIMessage, ConversationStatus, TagDefinition, LeadClassification, LeadScoreBreakdown } from '../types';
import { Button } from './Button';
import { useConversations } from '../hooks/useConversations';
import { toast } from 'sonner';
import { useCompanySettings } from '@/hooks/useCompanySettings';
import { api } from '@/services/api';
import { TagSelector } from './TagSelector';
import ContactCustomFields from './ContactCustomFields';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { supabase } from '@/integrations/supabase/client';

const ChatInterface: React.FC = () => {
  const isMobile = useIsMobile();
  const { conversations, loading, sendMessage, updateStatus, markAsRead, assignConversation, markMessageAsDeleted, markMessageAsEdited } = useConversations();
  const { sdrName, companyName } = useCompanySettings();
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [inputText, setInputText] = useState('');
  const [showProfileInfo, setShowProfileInfo] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [availableTags, setAvailableTags] = useState<TagDefinition[]>([]);
  const [isTagSelectorOpen, setIsTagSelectorOpen] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [notesValue, setNotesValue] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  
  // Filter & Sort state
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | 'all'>('all');
  const [sortOrder, setSortOrder] = useState<'recent' | 'oldest'>('recent');
  
  // Bulk selection state
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkActioning, setIsBulkActioning] = useState(false);
  
  // Transcription state
  const [transcriptions, setTranscriptions] = useState<Record<string, { open: boolean; loading: boolean; text: string | null; error: string | null }>>({});
  
  // Edit message state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isEditSaving, setIsEditSaving] = useState(false);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  
  // Delete confirmation state (message)
  const [deletingMessage, setDeletingMessage] = useState<UIMessage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Delete conversation/contact confirmation state
  const [deletingTarget, setDeletingTarget] = useState<'conversation' | 'contact' | null>(null);
  const [isDeletingTarget, setIsDeletingTarget] = useState(false);
  
  // Lightbox state
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  
  // Revealed deleted messages
  const [revealedDeletedIds, setRevealedDeletedIds] = useState<Set<string>>(new Set());
  
  // Revealed edited messages (show original)
  const [revealedEditedIds, setRevealedEditedIds] = useState<Set<string>>(new Set());
  
  // Audio player state
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
  const [audioProgress, setAudioProgress] = useState<Record<string, number>>({});
  const [audioSpeed, setAudioSpeed] = useState<number>(() => {
    const saved = localStorage.getItem('audioPlaybackSpeed');
    return saved ? Number(saved) : 1;
  });
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  
  const activeChat = conversations.find(c => c.id === selectedChatId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Format audio time helper
  const formatAudioTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Profile picture fetching state
  const [fetchedPicContactIds, setFetchedPicContactIds] = useState<Set<string>>(new Set());
  const [profilePicOverrides, setProfilePicOverrides] = useState<Record<string, string | null>>({});

  // Load tag definitions and team members
  useEffect(() => {
    api.fetchTagDefinitions().then(setAvailableTags).catch(err => {
      console.error('Error loading tags:', err);
      toast.error('Erro ao carregar tags');
    });

    api.fetchTeam().then(setTeamMembers).catch(err => {
      console.error('Error loading team members:', err);
    });
  }, []);

  // Lazy-load profile pictures for visible conversations
  useEffect(() => {
    if (conversations.length === 0) return;

    // Get contact IDs that haven't been fetched yet and have default avatars
    const contactIdsToFetch = conversations
      .filter(c => !fetchedPicContactIds.has(c.contactId) && c.contactAvatar.includes('ui-avatars.com'))
      .map(c => c.contactId)
      .slice(0, 20);

    if (contactIdsToFetch.length === 0) return;

    // Mark as being fetched to avoid duplicates
    setFetchedPicContactIds(prev => {
      const next = new Set(prev);
      contactIdsToFetch.forEach(id => next.add(id));
      return next;
    });

    api.fetchProfilePictures(contactIdsToFetch).then(results => {
      if (!results || Object.keys(results).length === 0) return;

      // We don't update conversation state directly - the cached URL in DB
      // will be used on next load. But we can force a UI update now:
      // Update contact avatars in conversations state via a refetch isn't ideal,
      // so we store the results locally for immediate display
      setProfilePicOverrides(prev => ({ ...prev, ...results }));
    }).catch(err => {
      console.error('Error fetching profile pictures:', err);
    });
  }, [conversations.length]);

  // Auto-select first conversation or from URL param
  useEffect(() => {
    // Check for conversation param in URL
    const urlParams = new URLSearchParams(window.location.search);
    const conversationParam = urlParams.get('conversation');
    
    if (conversationParam && conversations.some(c => c.id === conversationParam)) {
      setSelectedChatId(conversationParam);
    } else if (conversations.length > 0 && !selectedChatId) {
      setSelectedChatId(conversations[0].id);
    }
  }, [conversations, selectedChatId]);

  // Mark as read when selecting conversation
  useEffect(() => {
    if (selectedChatId && (activeChat?.unreadCount ?? 0) > 0) {
      markAsRead(selectedChatId);
    }
  }, [selectedChatId, activeChat?.unreadCount, markAsRead]);

  // Sync notes value with active chat
  useEffect(() => {
    if (activeChat) {
      setNotesValue(activeChat.notes || '');
    }
  }, [activeChat?.id]);

  // Handle notes save on blur
  const handleNotesBlur = async () => {
    if (!activeChat || notesValue === (activeChat.notes || '')) return;
    
    setIsSavingNotes(true);
    try {
      await api.updateContactNotes(activeChat.contactId, notesValue);
      toast.success('Notas salvas');
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error('Erro ao salvar notas');
    } finally {
      setIsSavingNotes(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (activeChat) {
      scrollToBottom();
    }
  }, [activeChat?.id, selectedChatId]); 

  useEffect(() => {
    scrollToBottom();
  }, [activeChat?.messages]);

  const handleToggleTag = async (tagKey: string) => {
    if (!activeChat) return;
    
    const currentTags = activeChat.tags || [];
    const newTags = currentTags.includes(tagKey)
      ? currentTags.filter(t => t !== tagKey)
      : [...currentTags, tagKey];
    
    try {
      await api.updateContactTags(activeChat.contactId, newTags);
      toast.success('Tag atualizada');
    } catch (error) {
      console.error('Error updating tag:', error);
      toast.error('Erro ao atualizar tag');
    }
  };

  const handleCreateTag = async (tag: { key: string; label: string; color: string; category: string }) => {
    try {
      const newTag = await api.createTagDefinition(tag);
      setAvailableTags(prev => [...prev, newTag]);
      toast.success('Tag criada com sucesso');
      
      // Adicionar a tag ao contato automaticamente
      if (activeChat) {
        await handleToggleTag(tag.key);
      }
    } catch (error) {
      console.error('Error creating tag:', error);
      toast.error('Erro ao criar tag');
    }
  };

  // Helper to get avatar URL with profile picture override
  const getAvatar = useCallback((chat: UIConversation) => {
    const override = profilePicOverrides[chat.contactId];
    if (override) return override;
    return chat.contactAvatar;
  }, [profilePicOverrides]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || !activeChat) return;

    const content = inputText.trim();
    setInputText('');
    
    await sendMessage(activeChat.id, content);
  };

  const handleStatusChange = async (status: ConversationStatus) => {
    if (!activeChat) return;
    await updateStatus(activeChat.id, status);
  };

  const filteredConversations = useMemo(() => {
    let result = conversations.filter(chat => {
      // Status filter
      if (statusFilter !== 'all' && chat.status !== statusFilter) return false;
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          chat.contactName.toLowerCase().includes(query) ||
          chat.contactPhone.includes(query) ||
          chat.lastMessage.toLowerCase().includes(query)
        );
      }
      return true;
    });

    // Sort
    result.sort((a, b) => {
      const dateA = new Date(a.lastMessageAt).getTime();
      const dateB = new Date(b.lastMessageAt).getTime();
      return sortOrder === 'recent' ? dateB - dateA : dateA - dateB;
    });

    return result;
  }, [conversations, statusFilter, searchQuery, sortOrder]);

  // Bulk action handlers
  const toggleSelectChat = (chatId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredConversations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredConversations.map(c => c.id)));
    }
  };

  const handleBulkStatusChange = async (status: ConversationStatus) => {
    setIsBulkActioning(true);
    try {
      for (const id of selectedIds) {
        await updateStatus(id, status);
      }
      toast.success(`${selectedIds.size} conversas alteradas para ${status === 'nina' ? sdrName : status === 'human' ? 'Humano' : 'Pausado'}`);
      setSelectedIds(new Set());
      setBulkMode(false);
    } catch (err) {
      toast.error('Erro ao alterar status em massa');
    } finally {
      setIsBulkActioning(false);
    }
  };

  const handleBulkDelete = async () => {
    setIsBulkActioning(true);
    try {
      for (const id of selectedIds) {
        await api.deleteConversation(id);
      }
      toast.success(`${selectedIds.size} conversas apagadas`);
      setSelectedIds(new Set());
      setBulkMode(false);
      window.location.reload();
    } catch (err) {
      toast.error('Erro ao apagar conversas em massa');
    } finally {
      setIsBulkActioning(false);
    }
  };

  const renderStatusBadge = (status: ConversationStatus) => {
    const config = {
      nina: { label: sdrName, icon: Bot, color: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
      human: { label: 'Humano', icon: User, color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
      paused: { label: 'Pausado', icon: Pause, color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' }
    };
    const { label, icon: Icon, color } = config[status];
    return (
      <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border flex items-center gap-1 ${color}`}>
        <Icon className="w-3 h-3" />
        {label}
      </span>
    );
  };

  // Helper: detect if content is raw JSON metadata (URLs, media keys, etc.)
  const isJsonMetadata = (content: string | null): boolean => {
    if (!content) return false;
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
    try { JSON.parse(trimmed); return true; } catch { return false; }
  };

  const renderMessageContent = (msg: UIMessage) => {
    if (msg.type === MessageType.IMAGE) {
      const contentLower = (msg.content || '').toLowerCase().trim();
      const jsonContent = isJsonMetadata(msg.content);
      const isSticker = contentLower === '[figurinha enviada]' || contentLower === '[sticker]' ||
        (jsonContent && (msg.content || '').includes('"isAnimated"')) ||
        (jsonContent && (msg.content || '').includes('image/webp'));
      const hasMediaUrl = !!msg.mediaUrl;
      const isPlaceholder = ['[imagem recebida]', '[imagem enviada]', '[figurinha enviada]', '[sticker]'].includes(contentLower);
      const isJsonContent = isJsonMetadata(msg.content);
      // Only show caption if it's real text, not placeholder or JSON metadata
      const captionText = (!isPlaceholder && !isJsonContent && msg.content) ? msg.content : null;
      
      return (
        <div className={`mb-1 group relative ${isSticker ? 'max-w-[120px]' : ''}`}>
          {hasMediaUrl ? (
            <img 
              src={msg.mediaUrl!} 
              alt={isSticker ? 'Figurinha' : 'Anexo'}
              className={`object-contain ${
                isSticker 
                  ? 'w-[120px] h-[120px] bg-transparent border-none shadow-none rounded-none' 
                  : 'rounded-lg max-w-full h-auto max-h-72 border border-slate-700/50 shadow-lg cursor-pointer hover:opacity-90 transition-opacity'
              }`}
              loading="lazy"
              style={isSticker ? {} : { minHeight: 120, minWidth: 160, background: '#1e3a5f' }}
              onClick={() => !isSticker && msg.mediaUrl && setLightboxUrl(msg.mediaUrl)}
              onError={(e) => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
              }}
            />
          ) : isSticker ? (
            /* Sticker without media URL - show placeholder icon, NOT the JSON */
            <div className="w-[120px] h-[120px] rounded-lg flex items-center justify-center bg-slate-800/50">
              <span className="text-3xl">📌</span>
            </div>
          ) : (
            <div 
              className="rounded-lg flex items-center justify-center"
              style={{ minHeight: 120, minWidth: 160, background: '#1e3a5f' }}
            >
              <div className="animate-pulse text-white/50 text-xs">Carregando imagem...</div>
            </div>
          )}
          {captionText && !isSticker && (
            <p className="mt-1 text-sm whitespace-pre-wrap break-words">{captionText}</p>
          )}
        </div>
      );
    }

    if (msg.type === MessageType.AUDIO) {
      const isPlaying = playingAudioId === msg.id;
      const duration = audioDurations[msg.id] || 0;
      const progress = audioProgress[msg.id] || 0;
      
      const togglePlay = () => {
        const audio = audioRefs.current[msg.id];
        if (!audio) return;
        
        if (isPlaying) {
          audio.pause();
          setPlayingAudioId(null);
        } else {
          Object.values(audioRefs.current).forEach(a => a.pause());
          audio.playbackRate = audioSpeed;
          audio.play();
          setPlayingAudioId(msg.id);
        }
      };

      const cycleSpeed = () => {
        const next = audioSpeed === 1 ? 1.5 : audioSpeed === 1.5 ? 2 : 1;
        setAudioSpeed(next);
        localStorage.setItem('audioPlaybackSpeed', next.toString());
        // Apply to currently playing audio
        Object.values(audioRefs.current).forEach(a => { a.playbackRate = next; });
      };

      const audioPlaceholders = ['[áudio]', '[mensagem de áudio]', '[audio]', '[áudio enviado]', '[audio enviado]', '[audio message]'];
      const isContentTranscription = msg.content && 
        !audioPlaceholders.includes(msg.content.trim().toLowerCase()) &&
        !msg.content.trim().startsWith('{') &&
        !msg.content.trim().startsWith('[');
      
      const transcriptionState = transcriptions[msg.id] || { open: false, loading: false, text: null, error: null };
      
      const handleTranscriptionToggle = async () => {
        const currentState = transcriptions[msg.id] || { open: false, loading: false, text: null, error: null };
        const nextOpen = !currentState.open;
        
        setTranscriptions(prev => ({
          ...prev,
          [msg.id]: { ...currentState, open: nextOpen }
        }));
        
        if (!nextOpen) return;
        
        // If we already have text (cached or from content), don't fetch
        if (currentState.text) return;
        if (isContentTranscription) {
          setTranscriptions(prev => ({
            ...prev,
            [msg.id]: { ...currentState, open: true, text: msg.content, loading: false }
          }));
          return;
        }
        
        // Fetch transcription from backend
        setTranscriptions(prev => ({
          ...prev,
          [msg.id]: { ...currentState, open: true, loading: true, error: null }
        }));
        
        try {
          const { data, error } = await supabase.functions.invoke('transcribe-audio', {
            body: { messageId: msg.id }
          });
          
          if (error) throw error;
          
          if (data?.transcription) {
            setTranscriptions(prev => ({
              ...prev,
              [msg.id]: { open: true, loading: false, text: data.transcription, error: null }
            }));
          } else if (data?.status === 'processing') {
            setTranscriptions(prev => ({
              ...prev,
              [msg.id]: { open: true, loading: true, text: null, error: null }
            }));
            // Poll after 3 seconds
            setTimeout(async () => {
              try {
                const { data: retryData } = await supabase.functions.invoke('transcribe-audio', {
                  body: { messageId: msg.id }
                });
                setTranscriptions(prev => ({
                  ...prev,
                  [msg.id]: { open: true, loading: false, text: retryData?.transcription || null, error: retryData?.transcription ? null : 'Sem transcrição disponível' }
                }));
              } catch {
                setTranscriptions(prev => ({
                  ...prev,
                  [msg.id]: { open: true, loading: false, text: null, error: 'Falha ao transcrever' }
                }));
              }
            }, 3000);
          } else {
            setTranscriptions(prev => ({
              ...prev,
              [msg.id]: { open: true, loading: false, text: null, error: data?.error || 'Sem transcrição disponível' }
            }));
          }
        } catch (e: any) {
          setTranscriptions(prev => ({
            ...prev,
            [msg.id]: { open: true, loading: false, text: null, error: e?.message || 'Falha ao transcrever' }
          }));
        }
      };

      return (
        <div className="min-w-[250px]">
          <div className="flex items-center gap-2.5 py-1">
            {msg.mediaUrl && (
              <audio
                ref={el => { if (el) { audioRefs.current[msg.id] = el; el.playbackRate = audioSpeed; } }}
                src={msg.mediaUrl}
                onLoadedMetadata={(e) => {
                  const audio = e.currentTarget;
                  audio.playbackRate = audioSpeed;
                  setAudioDurations(prev => ({ ...prev, [msg.id]: audio.duration }));
                }}
                onTimeUpdate={(e) => {
                  const audio = e.currentTarget;
                  setAudioProgress(prev => ({ ...prev, [msg.id]: audio.currentTime }));
                }}
                onEnded={() => setPlayingAudioId(null)}
              />
            )}
            
            {/* Play/Pause button */}
            <button 
              onClick={togglePlay}
              disabled={!msg.mediaUrl}
              className={`flex items-center justify-center w-9 h-9 rounded-full transition-all shadow-md flex-shrink-0 ${
                msg.direction === MessageDirection.OUTGOING 
                  ? 'bg-white text-cyan-600 hover:bg-cyan-50 disabled:opacity-50' 
                  : 'bg-cyan-500 text-white hover:bg-cyan-400 disabled:opacity-50'
              }`}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />
              )}
            </button>
            
            {/* Progress bar and duration */}
            <div className="flex-1 flex flex-col gap-1 justify-center h-9">
              <div 
                className={`h-1.5 rounded-full overflow-hidden cursor-pointer ${
                  msg.direction === MessageDirection.OUTGOING ? 'bg-white/30' : 'bg-slate-600'
                }`}
                onClick={(e) => {
                  const audio = audioRefs.current[msg.id];
                  if (!audio || !duration) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = (e.clientX - rect.left) / rect.width;
                  audio.currentTime = percent * duration;
                }}
              >
                <div 
                  className={`h-full rounded-full transition-all ${
                    msg.direction === MessageDirection.OUTGOING ? 'bg-white' : 'bg-cyan-400'
                  }`}
                  style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }}
                />
              </div>
              <span className={`text-[10px] font-medium ${
                msg.direction === MessageDirection.OUTGOING ? 'text-cyan-100' : 'text-slate-400'
              }`}>
                {formatAudioTime(progress)} / {formatAudioTime(duration)}
              </span>
            </div>

            {/* Speed button */}
            <button
              onClick={cycleSpeed}
              className={`flex items-center justify-center w-8 h-8 rounded-full text-[10px] font-bold transition-all flex-shrink-0 ${
                msg.direction === MessageDirection.OUTGOING
                  ? 'bg-white/20 text-white hover:bg-white/30'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
              title="Velocidade de reprodução"
            >
              {audioSpeed}x
            </button>
          </div>
          
          {/* Transcription toggle */}
          <button
            onClick={handleTranscriptionToggle}
            className={`flex items-center gap-1.5 mt-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
              msg.direction === MessageDirection.OUTGOING
                ? 'text-white/70 hover:text-white hover:bg-white/10'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
            }`}
          >
            <FileText className="w-3 h-3" />
            {transcriptionState.open ? 'Ocultar transcrição' : 'Ver transcrição'}
            {transcriptionState.open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          
          {/* Transcription content */}
          {transcriptionState.open && (
            <div className={`mt-1.5 px-3 py-2 rounded-lg text-xs leading-relaxed ${
              msg.direction === MessageDirection.OUTGOING
                ? 'bg-black/20 text-white/80'
                : 'bg-slate-700/50 text-slate-300'
            }`}>
              {transcriptionState.loading && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Transcrevendo...</span>
                </div>
              )}
              {!transcriptionState.loading && transcriptionState.error && (
                <span className="text-red-400">{transcriptionState.error}</span>
              )}
              {!transcriptionState.loading && !transcriptionState.error && transcriptionState.text && (
                <span>{transcriptionState.text}</span>
              )}
              {!transcriptionState.loading && !transcriptionState.error && !transcriptionState.text && (
                <span className="italic opacity-60">Sem transcrição disponível</span>
              )}
            </div>
          )}
        </div>
      );
    }

    // Don't render raw JSON metadata as text
    if (isJsonMetadata(msg.content)) {
      return <p className="text-xs text-slate-500 italic">📎 Mídia recebida</p>;
    }
    return <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>;
  };

  // Handle editing a message
  const handleStartEdit = (msg: UIMessage) => {
    setEditingMessageId(msg.id);
    setEditText(msg.content || '');
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditText('');
  };

  const handleSaveEdit = async (msg: UIMessage) => {
    if (!editText.trim() || editText.trim() === msg.content) {
      handleCancelEdit();
      return;
    }
    setIsEditSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('edit-message', {
        body: { messageId: msg.id, newText: editText.trim() }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Mensagem editada');
      if (selectedChatId) {
        markMessageAsEdited(selectedChatId, msg.id, editText.trim(), msg.content || '');
      }
      handleCancelEdit();
    } catch (err: any) {
      console.error('[Edit] Error:', err);
      toast.error(err?.message || 'Erro ao editar mensagem');
    } finally {
      setIsEditSaving(false);
    }
  };

  // Handle deleting a message
  const handleDeleteMessage = async (msg: UIMessage) => {
    setDeletingMessage(msg);
  };

  const confirmDeleteMessage = async () => {
    if (!deletingMessage) return;
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-message', {
        body: { messageId: deletingMessage.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Mensagem apagada');
      if (selectedChatId) {
        markMessageAsDeleted(selectedChatId, deletingMessage.id);
      }
    } catch (err: any) {
      console.error('[Delete] Error:', err);
      toast.error(err?.message || 'Erro ao apagar mensagem');
    } finally {
      setIsDeleting(false);
      setDeletingMessage(null);
    }
  };

  // Handle deleting a conversation
  const handleDeleteConversation = async () => {
    if (!activeChat) return;
    setIsDeletingTarget(true);
    try {
      await api.deleteConversation(activeChat.id);
      toast.success('Conversa apagada');
      setSelectedChatId(null);
      setDeletingTarget(null);
      // Remove from local state
      // Force a refetch by reloading
      window.location.reload();
    } catch (err: any) {
      console.error('[Delete] Error:', err);
      toast.error(err?.message || 'Erro ao apagar conversa');
    } finally {
      setIsDeletingTarget(false);
    }
  };

  // Handle deleting a contact (and all related conversations)
  const handleDeleteContact = async () => {
    if (!activeChat) return;
    setIsDeletingTarget(true);
    try {
      await api.deleteContact(activeChat.contactId);
      toast.success('Contato e todas as conversas apagados');
      setSelectedChatId(null);
      setDeletingTarget(null);
      window.location.reload();
    } catch (err: any) {
      console.error('[Delete] Error:', err);
      toast.error(err?.message || 'Erro ao apagar contato');
    } finally {
      setIsDeletingTarget(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full bg-slate-950 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
          <p className="text-sm text-slate-500">Sincronizando conversas...</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="flex h-full bg-slate-950 rounded-tl-2xl overflow-hidden border-t border-l border-slate-800/50 shadow-2xl">
      
      {/* Left Sidebar: Chat List */}
      <div className={`${isMobile ? (mobileShowChat ? 'hidden' : 'w-full') : 'w-80 lg:w-96'} border-r border-slate-800 flex flex-col bg-slate-900/50 backdrop-blur-md z-20 flex-shrink-0`}>
        {/* Search Header */}
        <div className="p-4 border-b border-slate-800/50 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white px-1">Chats Ativos</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSortOrder(prev => prev === 'recent' ? 'oldest' : 'recent')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title={sortOrder === 'recent' ? 'Mais recentes primeiro' : 'Mais antigas primeiro'}
              >
                <ArrowUpDown className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
                className={`p-1.5 rounded-lg transition-colors ${bulkMode ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                title="Seleção em massa"
              >
                <CheckSquare className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
            <input 
              type="text" 
              placeholder="Buscar conversa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-slate-950/50 border border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 outline-none text-slate-200 placeholder:text-slate-600 transition-all"
            />
          </div>
          {/* Status Filters */}
          <div className="flex items-center gap-1.5">
            {([
              { key: 'all' as const, label: 'Todos', icon: MessageSquare },
              { key: 'nina' as const, label: sdrName || 'IA', icon: Bot },
              { key: 'human' as const, label: 'Humano', icon: User },
              { key: 'paused' as const, label: 'Pausado', icon: Pause },
            ]).map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  statusFilter === f.key
                    ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <f.icon className="w-3 h-3" />
                {f.key === 'all' ? f.label : f.label}
              </button>
            ))}
          </div>
          {/* Sort indicator */}
          <div className="flex items-center justify-between text-[10px] text-slate-600 px-1">
            <span>{filteredConversations.length} conversa{filteredConversations.length !== 1 ? 's' : ''}</span>
            <span>{sortOrder === 'recent' ? '↓ Mais recentes' : '↑ Mais antigas'}</span>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {bulkMode && selectedIds.size > 0 && (
          <div className="px-3 py-2 bg-slate-800/80 border-b border-slate-700/50 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-300 font-medium mr-1">{selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}</span>
            <button onClick={toggleSelectAll} className="text-[10px] text-cyan-400 hover:text-cyan-300 underline">
              {selectedIds.size === filteredConversations.length ? 'Desmarcar' : 'Selecionar todos'}
            </button>
            <div className="flex-1" />
            <button
              onClick={() => handleBulkStatusChange('nina')}
              disabled={isBulkActioning}
              className="px-2 py-1 text-[10px] rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30 transition-colors disabled:opacity-50"
            >
              <Bot className="w-3 h-3 inline mr-0.5" />{sdrName}
            </button>
            <button
              onClick={() => handleBulkStatusChange('human')}
              disabled={isBulkActioning}
              className="px-2 py-1 text-[10px] rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
            >
              <User className="w-3 h-3 inline mr-0.5" />Humano
            </button>
            <button
              onClick={() => handleBulkStatusChange('paused')}
              disabled={isBulkActioning}
              className="px-2 py-1 text-[10px] rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
            >
              <Pause className="w-3 h-3 inline mr-0.5" />Pausar
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={isBulkActioning}
              className="px-2 py-1 text-[10px] rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3 inline mr-0.5" />Apagar
            </button>
          </div>
        )}

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 text-center">
              <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-sm">Nenhuma conversa encontrada</p>
              <p className="text-xs mt-1 opacity-70">As conversas aparecerão aqui quando receberem mensagens</p>
            </div>
          ) : (
            filteredConversations.map((chat) => (
              <div 
                key={chat.id}
                onClick={() => { 
                  if (bulkMode) { 
                    toggleSelectChat(chat.id); 
                  } else { 
                    setSelectedChatId(chat.id); 
                    if (isMobile) setMobileShowChat(true); 
                  } 
                }}
                className={`flex items-center p-4 cursor-pointer transition-all duration-200 border-b border-slate-800/30 hover:bg-slate-800/50 ${
                  selectedChatId === chat.id && !bulkMode
                    ? 'bg-slate-800/80 border-l-2 border-l-cyan-500' 
                    : selectedIds.has(chat.id) 
                    ? 'bg-cyan-500/5 border-l-2 border-l-cyan-500/50'
                    : 'border-l-2 border-l-transparent'
                }`}
              >
                {bulkMode && (
                  <div className="mr-3 flex-shrink-0">
                    {selectedIds.has(chat.id) ? (
                      <CheckSquare className="w-5 h-5 text-cyan-400" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-600" />
                    )}
                  </div>
                )}
                <div className="relative">
                  <div className="w-12 h-12 rounded-full p-0.5 bg-gradient-to-tr from-slate-700 to-slate-900">
                    <img 
                      src={getAvatar(chat)} 
                      alt={chat.contactName} 
                      className="w-full h-full rounded-full object-cover border border-slate-800" 
                    />
                  </div>
                  {chat.unreadCount > 0 ? (
                    <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-cyan-500 border-2 border-slate-900 rounded-full animate-pulse"></span>
                  ) : (
                    <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-slate-600 border-2 border-slate-900 rounded-full"></span>
                  )}
                </div>
                
                <div className="ml-3 flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <h3 className={`text-sm font-semibold truncate ${selectedChatId === chat.id ? 'text-white' : 'text-slate-300'}`}>
                      {chat.contactName}
                    </h3>
                    <span className="text-[10px] text-slate-500 font-medium">{chat.lastMessageTime}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">
                    {chat.messages[chat.messages.length - 1]?.type === MessageType.IMAGE ? '📷 Imagem' : 
                     chat.messages[chat.messages.length - 1]?.type === MessageType.AUDIO ? '🎵 Áudio' : 
                     chat.lastMessage || 'Sem mensagens'}
                  </p>
                  
                  <div className="flex items-center mt-2 gap-1.5">
                    {renderStatusBadge(chat.status)}
                    {chat.tags.slice(0, 1).map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-slate-800/80 border border-slate-700 text-slate-400 text-[10px] rounded-md font-medium">
                        {tag}
                      </span>
                    ))}
                    {chat.unreadCount > 0 && (
                      <span className="ml-auto bg-gradient-to-r from-cyan-600 to-teal-600 text-white text-[10px] font-bold px-1.5 h-4 min-w-[1rem] flex items-center justify-center rounded-full shadow-lg shadow-cyan-500/20">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Area: Chat Window & Profile */}
      {activeChat ? (
        <div className={`flex-1 flex overflow-hidden bg-[#0B0E14] ${isMobile && !mobileShowChat ? 'hidden' : ''}`}>
          {/* Main Chat Content */}
          <div className="flex-1 flex flex-col min-w-0 relative">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>

            {/* Chat Header */}
            <div className="h-14 md:h-16 px-3 md:px-6 flex items-center justify-between bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-10 shrink-0">
              <div className="flex items-center gap-2">
                {isMobile && (
                  <button
                    onClick={() => setMobileShowChat(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <div 
                  className="flex items-center cursor-pointer hover:bg-slate-800/50 p-1.5 rounded-lg transition-colors pr-3"
                  onClick={() => setShowProfileInfo(!showProfileInfo)}
                >
                  <div className="relative">
                    <img src={getAvatar(activeChat)} alt={activeChat.contactName} className="w-9 h-9 rounded-full ring-2 ring-slate-800" />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-slate-900 rounded-full"></span>
                  </div>
                  <div className="ml-3">
                    <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      {activeChat.contactName}
                      {!isMobile && renderStatusBadge(activeChat.status)}
                    </h2>
                    <p className="text-xs text-cyan-500 font-medium">{activeChat.contactPhone}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {/* Status control buttons */}
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`text-slate-400 hover:text-white ${activeChat.status === 'nina' ? 'bg-violet-500/20 text-violet-400' : ''}`}
                  onClick={() => handleStatusChange('nina')}
                  title={`Ativar ${sdrName} (IA)`}
                >
                  <Bot className="w-5 h-5" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`text-slate-400 hover:text-white ${activeChat.status === 'human' ? 'bg-emerald-500/20 text-emerald-400' : ''}`}
                  onClick={() => handleStatusChange('human')}
                  title="Assumir conversa"
                >
                  <User className="w-5 h-5" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`text-slate-400 hover:text-white ${activeChat.status === 'paused' ? 'bg-amber-500/20 text-amber-400' : ''}`}
                  onClick={() => handleStatusChange('paused')}
                  title="Pausar conversa"
                >
                  <Pause className="w-5 h-5" />
                </Button>
                <div className="h-6 w-px bg-slate-800 mx-1"></div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`text-slate-400 hover:text-white ${showProfileInfo ? 'bg-slate-800 text-cyan-400' : ''}`} 
                  onClick={() => setShowProfileInfo(!showProfileInfo)} 
                  title="Ver Informações"
                >
                  <Info className="w-5 h-5" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  disabled
                  title="Em breve: Mais opções"
                  className="text-slate-500 cursor-not-allowed opacity-50"
                >
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1 custom-scrollbar relative z-0">
              {activeChat.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500">
                  <MessageSquare className="w-16 h-16 mb-4 opacity-30" />
                  <p className="text-sm">Nenhuma mensagem ainda</p>
                  <p className="text-xs mt-1 opacity-70">Envie uma mensagem para iniciar a conversa</p>
                </div>
              ) : (
                <>
                  {activeChat.messages.map((msg, index) => {
                    // Date separator logic using sentAt ISO string
                    const getDateKey = (sentAt: string) => {
                      const d = new Date(sentAt);
                      return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
                    };
                    const getDateLabel = (sentAt: string) => {
                      const now = new Date();
                      const todayKey = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
                      const yesterday = new Date(now);
                      yesterday.setDate(yesterday.getDate() - 1);
                      const yesterdayKey = yesterday.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
                      const key = getDateKey(sentAt);
                      if (key === todayKey) return 'Hoje';
                      if (key === yesterdayKey) return 'Ontem';
                      return key; // dd/mm/yyyy
                    };
                    
                    const currentDateKey = msg.sentAt ? getDateKey(msg.sentAt) : '';
                    const prevMsg = index > 0 ? activeChat.messages[index - 1] : undefined;
                    const prevDateKey = prevMsg?.sentAt ? getDateKey(prevMsg.sentAt) : '';
                    const showDateSeparator = index === 0 || currentDateKey !== prevDateKey;
                    const dateLabel = msg.sentAt ? getDateLabel(msg.sentAt) : 'Hoje';
                    const isOutgoing = msg.direction === MessageDirection.OUTGOING;
                    const isEditing = editingMessageId === msg.id;
                    const canEdit = isOutgoing && msg.type === MessageType.TEXT && !msg.id.startsWith('temp-') && !msg.isDeleted;
                    const canDelete = isOutgoing && !msg.id.startsWith('temp-') && !msg.isDeleted;
                    const isRevealed = revealedDeletedIds.has(msg.id);

                    const toggleReveal = () => {
                      setRevealedDeletedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(msg.id)) next.delete(msg.id);
                        else next.add(msg.id);
                        return next;
                      });
                    };

                    return (
                      <React.Fragment key={msg.id}>
                        {showDateSeparator && (
                          <div className="flex justify-center my-3">
                            <span className="px-4 py-1.5 bg-slate-800/80 border border-slate-700 text-slate-400 text-xs font-medium rounded-full shadow-sm backdrop-blur-sm">{dateLabel}</span>
                          </div>
                        )}
                      <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} group animate-in fade-in slide-in-from-bottom-2 duration-300 mb-0.5`}>
                        <div className={`flex items-center gap-1 max-w-[80%] ${isOutgoing ? 'flex-row-reverse' : 'flex-row'}`}>
                          {/* Message content wrapper */}
                          <div className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>

                          {msg.isDeleted ? (
                            /* Deleted message placeholder */
                            <div className="px-4 py-2.5 rounded-2xl border border-dashed border-slate-700 bg-slate-900/50">
                              <div className="flex items-center gap-2 text-slate-500">
                                <Trash2 className="w-3.5 h-3.5" />
                                <span className="text-xs italic">Mensagem apagada</span>
                                <button
                                  onClick={toggleReveal}
                                  className="ml-1 text-slate-600 hover:text-slate-400 transition-colors"
                                  title={isRevealed ? 'Ocultar conteúdo original' : 'Ver conteúdo original'}
                                >
                                  {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                              {isRevealed && (
                                <div className="mt-2 pt-2 border-t border-slate-800">
                                  {msg.originalMediaUrl && (
                                    <img 
                                      src={msg.originalMediaUrl} 
                                      alt="Imagem original" 
                                      className="rounded-lg max-w-full max-h-48 object-cover mb-1 opacity-60 cursor-pointer"
                                      onClick={() => setLightboxUrl(msg.originalMediaUrl!)}
                                    />
                                  )}
                                  {msg.originalContent && (
                                    <p className="text-xs text-slate-500 whitespace-pre-wrap">{msg.originalContent}</p>
                                  )}
                                  {!msg.originalContent && !msg.originalMediaUrl && msg.content && (
                                    <p className="text-xs text-slate-500 whitespace-pre-wrap">{msg.content}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            /* Normal message bubble */
                            <div 
                              className={`px-3.5 py-2 rounded-2xl shadow-md relative text-sm leading-snug ${
                                isOutgoing 
                                  ? msg.fromType === 'nina'
                                    ? 'bg-gradient-to-br from-violet-600 to-purple-700 text-white rounded-tr-sm shadow-violet-900/20'
                                    : 'bg-gradient-to-br from-cyan-600 to-teal-700 text-white rounded-tr-sm shadow-cyan-900/20'
                                  : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700/50'
                              }`}
                            >
                              {isEditing ? (
                                <div className="min-w-[200px]">
                                  <textarea
                                    ref={editInputRef}
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSaveEdit(msg);
                                      }
                                      if (e.key === 'Escape') handleCancelEdit();
                                    }}
                                    className="w-full bg-black/30 text-white rounded-lg px-3 py-2 text-sm resize-none outline-none focus:ring-1 focus:ring-white/30"
                                    rows={Math.min(editText.split('\n').length + 1, 5)}
                                    disabled={isEditSaving}
                                  />
                                  <div className="flex items-center gap-2 mt-2 justify-end">
                                    <button
                                      onClick={handleCancelEdit}
                                      disabled={isEditSaving}
                                      className="text-xs text-white/60 hover:text-white/90 px-2 py-1 rounded"
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      onClick={() => handleSaveEdit(msg)}
                                      disabled={isEditSaving || !editText.trim()}
                                      className="text-xs bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded-md flex items-center gap-1 disabled:opacity-50"
                                    >
                                      {isEditSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                      Salvar
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                renderMessageContent(msg)
                              )}
                            </div>
                          )}
                          
                          <div className="flex items-center mt-1.5 gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity px-1">
                            {isOutgoing && msg.fromType === 'nina' && (
                              <Bot className="w-3 h-3 text-violet-400" />
                            )}
                            {isOutgoing && msg.fromType === 'human' && (
                              <User className="w-3 h-3 text-cyan-400" />
                            )}
                            {msg.isEdited && (
                              <button
                                onClick={() => setRevealedEditedIds(prev => {
                                  const next = new Set(prev);
                                  next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id);
                                  return next;
                                })}
                                className="flex items-center gap-0.5 text-[10px] text-slate-500 italic hover:text-slate-300 transition-colors cursor-pointer"
                                title={revealedEditedIds.has(msg.id) ? 'Ocultar original' : 'Ver original'}
                              >
                                <Pencil className="w-2.5 h-2.5" />
                                Editada
                              </button>
                            )}
                            {msg.isEdited && revealedEditedIds.has(msg.id) && msg.originalContent && (
                              <div className="w-full mt-1 px-2 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50">
                                <p className="text-[11px] text-slate-400 italic whitespace-pre-wrap">
                                  <span className="text-slate-500 font-medium">Original:</span> {msg.originalContent}
                                </p>
                              </div>
                            )}
                            {msg.isDeleted && (
                              <span className="text-[10px] text-red-500/60 italic">apagada</span>
                            )}
                            <span className="text-[10px] text-slate-500 font-medium">{msg.timestamp}</span>
                            {isOutgoing && !msg.isDeleted && (
                              msg.status === 'read' ? <CheckCheck className="w-3.5 h-3.5 text-cyan-500" /> : 
                              msg.status === 'delivered' ? <CheckCheck className="w-3.5 h-3.5 text-slate-500" /> :
                              <Check className="w-3.5 h-3.5 text-slate-500" />
                            )}
                          </div>
                          </div>

                          {/* Action buttons - appear on hover, to the side */}
                          {(canEdit || canDelete) && !isEditing && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              {canEdit && (
                                <button
                                  onClick={() => handleStartEdit(msg)}
                                  className="text-slate-500 hover:text-cyan-400 p-1 rounded"
                                  title="Editar mensagem"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  onClick={() => handleDeleteMessage(msg)}
                                  className="text-slate-500 hover:text-red-400 p-1 rounded"
                                  title="Apagar para todos"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      </React.Fragment>
                    );
                  })}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-slate-900/90 border-t border-slate-800 backdrop-blur-sm z-10">
              <form onSubmit={handleSendMessage} className="flex items-end gap-3 max-w-4xl mx-auto">
                <div className="flex items-center gap-1">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="icon" 
                    disabled
                    title="Em breve: Emoji picker"
                    className="text-slate-500 rounded-full cursor-not-allowed opacity-50"
                  >
                    <Smile className="w-5 h-5" />
                  </Button>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    size="icon"
                    disabled
                    title="Em breve: Enviar anexos"
                    className="text-slate-500 rounded-full cursor-not-allowed opacity-50"
                  >
                    <Paperclip className="w-5 h-5" />
                  </Button>
                </div>
                
                <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 focus-within:ring-2 focus-within:ring-cyan-500/30 focus-within:border-cyan-500/50 transition-all shadow-inner">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={activeChat.status === 'nina' ? `${sdrName} está respondendo automaticamente...` : 'Digite sua mensagem...'}
                    className="w-full bg-transparent border-none p-3.5 max-h-32 min-h-[48px] text-sm text-slate-200 focus:ring-0 resize-none outline-none placeholder:text-slate-600"
                    rows={1}
                  />
                </div>

                <Button 
                  type="submit" 
                  disabled={!inputText.trim()}
                  className={`rounded-full w-12 h-12 p-0 transition-all ${
                    inputText.trim() 
                      ? 'shadow-lg shadow-cyan-500/20 hover:scale-105 active:scale-95' 
                      : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <Send className="w-5 h-5 ml-0.5" />
                </Button>
              </form>
            </div>
          </div>

          {/* Right Profile Sidebar (CRM View) */}
          <div 
            className={`${showProfileInfo ? 'w-80 border-l border-slate-800 opacity-100' : 'w-0 opacity-0 border-none'} transition-all duration-300 ease-in-out bg-slate-900/95 flex-shrink-0 flex flex-col overflow-hidden`}
          >
            <div className="w-80 h-full flex flex-col">
              {/* Header */}
              <div className="h-16 flex items-center justify-between px-6 border-b border-slate-800 flex-shrink-0">
                <span className="font-semibold text-white">Informações do Lead</span>
                <button 
                  onClick={() => setShowProfileInfo(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
                {/* Identity */}
                <div className="flex flex-col items-center text-center">
                  <div className="w-24 h-24 rounded-full p-1 bg-gradient-to-tr from-cyan-500 to-teal-600 shadow-xl mb-4">
                    <img src={getAvatar(activeChat)} alt={activeChat.contactName} className="w-full h-full rounded-full object-cover border-2 border-slate-900" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-1">{activeChat.contactName}</h3>
                  <p className="text-sm text-slate-400 mb-4">
                    {activeChat.clientMemory.lead_profile.lead_stage === 'new' ? 'Novo Lead' : 
                     activeChat.clientMemory.lead_profile.lead_stage === 'qualified' ? 'Lead Qualificado' :
                     activeChat.clientMemory.lead_profile.lead_stage}
                  </p>
                </div>

                {/* Details List */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Dados do Negócio</h4>
                  
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-400">
                      <Phone className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-500">Telefone</span>
                      <span className="text-slate-200 font-medium">{activeChat.contactPhone}</span>
                    </div>
                  </div>

                  {activeChat.contactEmail && (
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-400">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-slate-500">Email</span>
                        <span className="text-slate-200 font-medium">{activeChat.contactEmail}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Custom Fields Section */}
                <ContactCustomFields contactId={activeChat.contactId} />

                <div className="h-px bg-slate-800/50 w-full"></div>

                {/* Lead Scoring Section */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Lead Scoring
                  </h4>
                  
                  {/* Score Display */}
                  <div className="p-4 rounded-lg bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-slate-700/50">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`text-3xl font-bold ${
                          activeChat.leadScore >= 90 ? 'text-emerald-400' :
                          activeChat.leadScore >= 70 ? 'text-cyan-400' :
                          activeChat.leadScore >= 40 ? 'text-amber-400' :
                          'text-slate-400'
                        }`}>
                          {activeChat.leadScore}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-slate-400">pontos</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            activeChat.leadClassification === 'sql' ? 'bg-emerald-500/20 text-emerald-400' :
                            activeChat.leadClassification === 'mql' ? 'bg-cyan-500/20 text-cyan-400' :
                            activeChat.leadClassification === 'pre_mql' ? 'bg-amber-500/20 text-amber-400' :
                            activeChat.leadClassification === 'nutricao' ? 'bg-orange-500/20 text-orange-400' :
                            activeChat.leadClassification === 'dq' ? 'bg-red-500/20 text-red-400' :
                            'bg-slate-500/20 text-slate-400'
                          }`}>
                            {activeChat.leadClassification === 'sql' ? 'SQL' :
                             activeChat.leadClassification === 'mql' ? 'MQL' :
                             activeChat.leadClassification === 'pre_mql' ? 'Pré-MQL' :
                             activeChat.leadClassification === 'nutricao' ? 'Nutrição' :
                             activeChat.leadClassification === 'dq' ? 'Desqualificado' :
                             'Novo'}
                          </span>
                        </div>
                      </div>
                      <TrendingUp className={`w-5 h-5 ${
                        activeChat.leadScore >= 70 ? 'text-emerald-400' : 'text-slate-500'
                      }`} />
                    </div>
                    
                    {/* Progress bar */}
                    <div className="w-full bg-slate-700/50 rounded-full h-2 mb-3">
                      <div 
                        className={`h-2 rounded-full transition-all duration-500 ${
                          activeChat.leadScore >= 90 ? 'bg-emerald-500' :
                          activeChat.leadScore >= 70 ? 'bg-cyan-500' :
                          activeChat.leadScore >= 40 ? 'bg-amber-500' :
                          'bg-slate-500'
                        }`}
                        style={{ width: `${Math.min(activeChat.leadScore, 100)}%` }}
                      />
                    </div>
                    
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>Nutrição</span>
                      <span>Pré-MQL</span>
                      <span>MQL</span>
                      <span>SQL</span>
                    </div>
                  </div>

                  {/* Breakdown Details */}
                  {activeChat.leadScoreBreakdown && (
                    <div className="space-y-2">
                      {activeChat.leadScoreBreakdown.fit?.points !== undefined && activeChat.leadScoreBreakdown.fit.points > 0 && (
                        <div className="flex items-center justify-between text-sm p-2 rounded bg-slate-800/30">
                          <span className="text-slate-400">FIT (Produto)</span>
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-400 font-medium">+{activeChat.leadScoreBreakdown.fit.points}</span>
                          </div>
                        </div>
                      )}
                      {activeChat.leadScoreBreakdown.maturity?.points !== undefined && activeChat.leadScoreBreakdown.maturity.points > 0 && (
                        <div className="flex items-center justify-between text-sm p-2 rounded bg-slate-800/30">
                          <span className="text-slate-400">Maturidade</span>
                          <div className="flex items-center gap-2">
                            <span className="text-cyan-400 font-medium">+{activeChat.leadScoreBreakdown.maturity.points}</span>
                          </div>
                        </div>
                      )}
                      {activeChat.leadScoreBreakdown.value_potential?.points !== undefined && activeChat.leadScoreBreakdown.value_potential.points > 0 && (
                        <div className="flex items-center justify-between text-sm p-2 rounded bg-slate-800/30">
                          <span className="text-slate-400">Potencial de Valor</span>
                          <div className="flex items-center gap-2">
                            <span className="text-amber-400 font-medium">+{activeChat.leadScoreBreakdown.value_potential.points}</span>
                          </div>
                        </div>
                      )}
                      {activeChat.leadScoreBreakdown.intent_signals?.points !== undefined && activeChat.leadScoreBreakdown.intent_signals.points > 0 && (
                        <div className="flex items-center justify-between text-sm p-2 rounded bg-slate-800/30">
                          <span className="text-slate-400">Sinais de Intenção</span>
                          <div className="flex items-center gap-2">
                            <span className="text-purple-400 font-medium">+{activeChat.leadScoreBreakdown.intent_signals.points}</span>
                          </div>
                        </div>
                      )}
                      {activeChat.leadScoreBreakdown.origin?.points !== undefined && activeChat.leadScoreBreakdown.origin.points > 0 && (
                        <div className="flex items-center justify-between text-sm p-2 rounded bg-slate-800/30">
                          <span className="text-slate-400">Origem</span>
                          <div className="flex items-center gap-2">
                            <span className="text-blue-400 font-medium">+{activeChat.leadScoreBreakdown.origin.points}</span>
                          </div>
                        </div>
                      )}
                      {activeChat.leadScoreBreakdown.contact_completeness?.points !== undefined && activeChat.leadScoreBreakdown.contact_completeness.points > 0 && (
                        <div className="flex items-center justify-between text-sm p-2 rounded bg-slate-800/30">
                          <span className="text-slate-400">Completude Contato</span>
                          <div className="flex items-center gap-2">
                            <span className="text-teal-400 font-medium">+{activeChat.leadScoreBreakdown.contact_completeness.points}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {(!activeChat.leadScoreBreakdown || activeChat.leadScore === 0) && (
                    <p className="text-xs text-slate-500 text-center italic">
                      A IA irá pontuar este lead durante a conversa
                    </p>
                  )}
                </div>

                <div className="h-px bg-slate-800/50 w-full"></div>

                {/* AI Memory Section */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <Brain className="w-4 h-4" />
                    Memória do(a) {sdrName}
                  </h4>
                  
                  {activeChat.clientMemory.lead_profile.interests.length > 0 && (
                    <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                      <span className="text-xs text-slate-400">Interesses</span>
                      <p className="text-sm text-slate-200 mt-1">
                        {activeChat.clientMemory.lead_profile.interests.join(', ')}
                      </p>
                    </div>
                  )}

                  {activeChat.clientMemory.sales_intelligence.pain_points.length > 0 && (
                    <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                      <span className="text-xs text-slate-400">Dores Identificadas</span>
                      <p className="text-sm text-slate-200 mt-1">
                        {activeChat.clientMemory.sales_intelligence.pain_points.join(', ')}
                      </p>
                    </div>
                  )}

                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                    <span className="text-xs text-slate-400">Próxima Ação Sugerida</span>
                    <p className="text-sm text-slate-200 mt-1">
                      {activeChat.clientMemory.sales_intelligence.next_best_action === 'qualify' ? 'Qualificar lead' :
                       activeChat.clientMemory.sales_intelligence.next_best_action === 'demo' ? 'Agendar demonstração' :
                       activeChat.clientMemory.sales_intelligence.next_best_action}
                    </p>
                  </div>

                  <div className="text-xs text-slate-500 text-center">
                    Total de conversas: {activeChat.clientMemory.interaction_summary.total_conversations}
                  </div>
                </div>

                <div className="h-px bg-slate-800/50 w-full"></div>

                {/* Assigned User */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Responsável
                  </h4>
                  <select
                    value={activeChat.assignedUserId || ''}
                    onChange={(e) => {
                      const userId = e.target.value || null;
                      assignConversation(activeChat.id, userId);
                      toast.success('Conversa atribuída. Deal atualizado automaticamente.');
                    }}
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-lg p-3 text-sm text-slate-300 focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 outline-none transition-all"
                  >
                    <option value="">Não atribuído</option>
                    {teamMembers.map(member => (
                      <option key={member.id} value={member.id}>
                        {member.name} ({member.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="h-px bg-slate-800/50 w-full"></div>

                {/* Tags */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                    Tags
                    <Popover open={isTagSelectorOpen} onOpenChange={setIsTagSelectorOpen}>
                      <PopoverTrigger asChild>
                        <button className="text-cyan-500 hover:text-cyan-400 transition-colors">
                          <Plus className="w-4 h-4" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-0 bg-slate-900 border-slate-700" align="end">
                        <TagSelector 
                          availableTags={availableTags}
                          selectedTags={activeChat.tags || []}
                          onToggleTag={handleToggleTag}
                          onCreateTag={handleCreateTag}
                        />
                      </PopoverContent>
                    </Popover>
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {activeChat.tags && activeChat.tags.length > 0 ? (
                      activeChat.tags.map(tagKey => {
                        const tagDef = availableTags.find(t => t.key === tagKey);
                        return (
                          <span 
                            key={tagKey}
                            style={{ 
                              backgroundColor: tagDef?.color ? `${tagDef.color}20` : 'rgba(59, 130, 246, 0.2)',
                              borderColor: tagDef?.color || '#3b82f6'
                            }}
                            className="px-2.5 py-1 rounded-md border text-xs font-medium flex items-center gap-1.5 group hover:brightness-110 transition-all"
                          >
                            <span className="text-slate-200">{tagDef?.label || tagKey}</span>
                            <button
                              onClick={() => handleToggleTag(tagKey)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3 text-slate-400 hover:text-slate-200" />
                            </button>
                          </span>
                        );
                      })
                    ) : (
                      <p className="text-xs text-slate-500 italic">Nenhuma tag adicionada</p>
                    )}
                  </div>
                </div>

                {/* Notes Area */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                    Notas Internas
                    {isSavingNotes && <Loader2 className="w-3 h-3 animate-spin text-cyan-500" />}
                  </h4>
                  <textarea 
                    className="w-full bg-slate-950/50 border border-slate-800 rounded-lg p-3 text-sm text-slate-300 placeholder:text-slate-600 focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 outline-none resize-none transition-all"
                    rows={4}
                    placeholder="Adicione observações sobre este lead..."
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    onBlur={handleNotesBlur}
                  />
                </div>

                <div className="h-px bg-slate-800/50 w-full"></div>

                {/* Danger Zone */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-red-500/70 uppercase tracking-wider flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    Zona de Perigo
                  </h4>
                  <button
                    onClick={() => setDeletingTarget('conversation')}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-700/50 bg-slate-800/30 text-slate-300 hover:bg-red-950/30 hover:border-red-500/30 hover:text-red-400 transition-all text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Apagar Conversa
                  </button>
                  <button
                    onClick={() => setDeletingTarget('contact')}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-red-500/20 bg-red-950/10 text-red-400 hover:bg-red-950/40 hover:border-red-500/40 transition-all text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Apagar Contato e Conversas
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-[#0B0E14] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/20 to-transparent"></div>
          <div className="relative z-10 flex flex-col items-center p-8 text-center max-w-md">
            <div className="w-24 h-24 bg-slate-900 rounded-full flex items-center justify-center mb-6 shadow-2xl border border-slate-800 relative group">
              <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-xl group-hover:bg-cyan-500/30 transition-all duration-1000"></div>
              <MessageSquare className="w-10 h-10 text-cyan-500" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">{companyName} Workspace</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              {conversations.length === 0 
                ? 'Aguardando novas conversas. Configure o webhook do WhatsApp para começar a receber mensagens.'
                : 'Selecione uma conversa ao lado para iniciar o atendimento inteligente.'}
            </p>
            <div className="mt-8 flex gap-3 text-xs text-slate-500 font-mono bg-slate-900/50 px-4 py-2 rounded-lg border border-slate-800/50">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                {sdrName} Online
              </span>
              <span className="w-px h-4 bg-slate-800"></span>
              <span>{conversations.length} conversas</span>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Delete Confirmation Dialog */}
    {deletingMessage && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
          <h3 className="text-white font-semibold text-base mb-2">Apagar mensagem</h3>
          <p className="text-slate-400 text-sm mb-6">Apagar esta mensagem para todos? Esta ação não pode ser desfeita.</p>
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setDeletingMessage(null)}
              disabled={isDeleting}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={confirmDeleteMessage}
              disabled={isDeleting}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Apagar
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Delete Conversation/Contact Confirmation Dialog */}
    {deletingTarget && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
          <h3 className="text-white font-semibold text-base mb-2">
            {deletingTarget === 'conversation' ? 'Apagar Conversa' : 'Apagar Contato'}
          </h3>
          <p className="text-slate-400 text-sm mb-6">
            {deletingTarget === 'conversation' 
              ? 'Apagar esta conversa e todas as mensagens? Esta ação não pode ser desfeita.'
              : 'Apagar este contato, todas as suas conversas, mensagens e deals associados? Esta ação não pode ser desfeita.'}
          </p>
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setDeletingTarget(null)}
              disabled={isDeletingTarget}
              className="px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={deletingTarget === 'conversation' ? handleDeleteConversation : handleDeleteContact}
              disabled={isDeletingTarget}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {isDeletingTarget ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Apagar
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Image Lightbox */}
    {lightboxUrl && (
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer"
        onClick={() => setLightboxUrl(null)}
      >
        <button
          onClick={() => setLightboxUrl(null)}
          className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/50 rounded-full p-2 transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
        <img 
          src={lightboxUrl} 
          alt="Imagem ampliada" 
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}
  </>
  );

};

export default ChatInterface;
