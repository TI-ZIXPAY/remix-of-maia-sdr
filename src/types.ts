// ============= Legacy Types (for backward compatibility) =============
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio'
}

export enum MessageDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing'
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  role: 'agent' | 'admin';
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'agent';
  status: 'active' | 'invited' | 'disabled';
  avatar: string;
  lastActive?: string;
  team_id?: string | null;
  function_id?: string | null;
  weight?: number | null;
  external_id?: string | null;
  team?: Team;
  function?: TeamFunction;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface TeamFunction {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  content: string;
  timestamp: string;
  direction: MessageDirection;
  type: MessageType;
  status: 'sent' | 'delivered' | 'read';
}

export interface Conversation {
  id: string;
  contactName: string;
  contactPhone: string;
  contactAvatar: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  tags: string[];
  messages: Message[];
}

// Metadata for AI-created appointments
export interface AppointmentMetadata {
  source?: 'nina_ai' | 'manual' | 'calendly';
  conversation_id?: string;
  created_at_conversation?: string;
  calendly_event_uri?: string;
  calendly_invitee_uri?: string;
  calendly_cancel_url?: string;
  calendly_reschedule_url?: string;
  invitee_name?: string;
  invitee_email?: string;
  invitee_phone?: string;
  invitee_status?: 'accepted' | 'canceled' | 'no_show';
  cancel_reason?: string;
  canceled_by?: string;
  canceled_at?: string;
}

export interface LeadScoreBreakdown {
  origin?: { points: number; reason: string | null };
  contact_completeness?: { points: number; reason: string | null };
  fit?: { points: number; reason: string | null };
  maturity?: { points: number; reason: string | null };
  value_potential?: { points: number; reason: string | null };
  intent_signals?: { points: number; reason: string | null };
  disqualification_reason?: string;
}

export type LeadClassification = 'new' | 'dq' | 'nutricao' | 'pre_mql' | 'mql' | 'sql';

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: 'lead' | 'customer' | 'churned';
  lastContact: string;
  leadScore?: number;
  leadClassification?: LeadClassification;
  leadScoreBreakdown?: LeadScoreBreakdown;
  clientMemory?: ClientMemory;
  notes?: string | null;
  tags?: string[];
}

export interface StatMetric {
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
}

export interface Appointment {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  type: 'demo' | 'meeting' | 'support' | 'followup';
  description?: string | null;
  status?: string | null;
  meeting_url?: string | null;
  attendees?: string[];
  contact_id?: string | null;
  contact?: {
    id: string;
    name: string | null;
    phone_number: string;
  };
  metadata?: AppointmentMetadata;
}

export interface Deal {
  id: string;
  title: string;
  company: string;
  value: number;
  stage: string;
  stageId?: string; // New: reference to pipeline_stages
  ownerAvatar: string;
  ownerId?: string;
  ownerName?: string;
  tags: string[];
  dueDate?: string;
  priority: 'low' | 'medium' | 'high';
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  wonAt?: string;
  lostAt?: string;
  lostReason?: string;
  notes?: string | null;
  createdAt?: string;
  clientMemory?: ClientMemory;
  conversationId?: string | null;
  handoffSummary?: string | null;
  customFields?: Array<{ label: string; value: string; type: string }>;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  appointmentTitle?: string | null;
  appointmentStatus?: string | null;
  appointmentMeetingUrl?: string | null;
  appointmentDescription?: string | null;
}

export interface DealActivity {
  id: string;
  dealId: string;
  type: 'note' | 'call' | 'email' | 'meeting' | 'task';
  title: string;
  description?: string;
  scheduledAt?: string;
  completedAt?: string;
  isCompleted: boolean;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  color: string;
  position: number;
  isSystem: boolean;
  isActive: boolean;
  isAiManaged: boolean;
  aiTriggerCriteria: string | null;
  webhookEndpointId: string | null;
}


export interface TagDefinition {
  id: string;
  key: string;
  label: string;
  color: string;
  category: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============= Database Types (Real Supabase Schema) =============
export type ConversationStatus = 'nina' | 'human' | 'paused';
export type MessageFromType = 'user' | 'nina' | 'human';
export type DBMessageStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'processing';
export type DBMessageType = 'text' | 'audio' | 'image' | 'document' | 'video';

export interface ClientMemory {
  last_updated: string | null;
  lead_profile: {
    interests: string[];
    lead_stage: string;
    objections: string[];
    products_discussed: string[];
    communication_style: string;
    qualification_score: number;
  };
  sales_intelligence: {
    pain_points: string[];
    next_best_action: string;
    budget_indication: string;
    decision_timeline: string;
  };
  interaction_summary: {
    response_pattern: string;
    last_contact_reason: string;
    total_conversations: number;
    preferred_contact_time: string;
  };
  conversation_history: Array<{
    timestamp: string;
    user_summary: string;
    ai_action: string;
  }>;
}

export interface DBContact {
  id: string;
  phone_number: string;
  whatsapp_id: string | null;
  name: string | null;
  call_name: string | null;
  email: string | null;
  profile_picture_url: string | null;
  tags: string[];
  notes: string | null;
  is_business: boolean;
  is_blocked: boolean;
  blocked_at: string | null;
  blocked_reason: string | null;
  client_memory: ClientMemory;
  first_contact_date: string;
  last_activity: string;
  created_at: string;
  updated_at: string;
}

export interface DBConversation {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  is_active: boolean;
  assigned_user_id: string | null;
  assigned_team: string | null;
  tags: string[];
  metadata: Record<string, any>;
  nina_context: Record<string, any>;
  started_at: string;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  // Joined data
  contact?: DBContact;
  messages?: DBMessage[];
}

export interface DBMessage {
  id: string;
  conversation_id: string;
  whatsapp_message_id: string | null;
  content: string | null;
  type: DBMessageType;
  from_type: MessageFromType;
  status: DBMessageStatus;
  media_url: string | null;
  media_type: string | null;
  reply_to_id: string | null;
  processed_by_nina: boolean;
  nina_response_time: number | null;
  metadata: Record<string, any>;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

// ============= Transformed Types for UI =============
export interface UIConversation {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  contactAvatar: string;
  contactEmail: string | null;
  status: ConversationStatus;
  isActive: boolean;
  assignedTeam: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  lastMessage: string;
  lastMessageTime: string;
  lastMessageAt: string;
  unreadCount: number;
  tags: string[];
  messages: UIMessage[];
  clientMemory: ClientMemory;
  notes: string | null;
  // Lead Scoring
  leadScore: number;
  leadClassification: LeadClassification;
  leadScoreBreakdown: LeadScoreBreakdown | null;
}

export interface UIMessage {
  id: string;
  content: string;
  timestamp: string;
  sentAt: string; // ISO timestamp for date grouping
  direction: MessageDirection;
  type: MessageType;
  status: 'sent' | 'delivered' | 'read';
  fromType: MessageFromType;
  mediaUrl: string | null;
  whatsappMessageId: string | null;
  isEdited?: boolean;
  isDeleted?: boolean;
  originalContent?: string | null;
  originalMediaUrl?: string | null;
}

// ============= Utility Functions =============
export function transformDBToUIConversation(
  conv: DBConversation,
  messages: DBMessage[]
): UIConversation {
  const sortedMessages = [...messages].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
  );

  const lastMsg = sortedMessages[sortedMessages.length - 1];
  const unreadCount = messages.filter(
    m => m.from_type === 'user' && m.status !== 'read'
  ).length;

  return {
    id: conv.id,
    contactId: conv.contact_id,
    contactName: conv.contact?.name || conv.contact?.call_name || conv.contact?.phone_number || 'Desconhecido',
    contactPhone: conv.contact?.phone_number || '',
    contactAvatar: conv.contact?.profile_picture_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(conv.contact?.name || 'U')}&background=0ea5e9&color=fff`,
    contactEmail: conv.contact?.email || null,
    status: conv.status,
    isActive: conv.is_active,
    assignedTeam: conv.assigned_team,
    assignedUserId: conv.assigned_user_id,
    assignedUserName: null, // Will be populated if needed
    lastMessage: lastMsg?.content || '',
    lastMessageTime: formatRelativeTime(conv.last_message_at),
    lastMessageAt: conv.last_message_at,
    unreadCount,
    tags: [...(conv.tags || []), ...(conv.contact?.tags || [])],
    messages: sortedMessages.map(transformDBToUIMessage),
    clientMemory: conv.contact?.client_memory || getDefaultClientMemory(),
    notes: conv.contact?.notes || null,
    // Lead Scoring from contact
    leadScore: (conv.contact as any)?.lead_score || 0,
    leadClassification: ((conv.contact as any)?.lead_classification || 'new') as LeadClassification,
    leadScoreBreakdown: (conv.contact as any)?.lead_score_breakdown || null
  };
}

export function transformDBToUIMessage(msg: DBMessage): UIMessage {
  // Legacy: some providers store media payload as a JSON string in `content`
  // Example: {"URL":"https://...","mimetype":"audio/ogg; codecs=opus", ... }
  const legacy = parseLegacyMediaJson(msg.content || '');
  const legacyMime = legacy.mimetype?.toLowerCase() || '';
  const legacyUrl = legacy.url;

  // Infer media type when DB type is incorrect (e.g. stored as text) but payload indicates media.
  const inferredAudio = !!legacyUrl && legacyMime.includes('audio');
  const inferredImage = !!legacyUrl && (legacyMime.includes('image') || legacyMime.includes('webp'));

  const mappedType = mapDBMessageType(msg.type);
  let type = mappedType;
  if (mappedType === MessageType.TEXT) {
    if (inferredAudio) type = MessageType.AUDIO;
    else if (inferredImage) type = MessageType.IMAGE;
  }

  const mediaUrl = msg.media_url || (type === MessageType.AUDIO ? legacyUrl : null) || (type === MessageType.IMAGE ? legacyUrl : null);

  const metadata = (msg.metadata || {}) as Record<string, unknown>;

  return {
    id: msg.id,
    content: (type === MessageType.AUDIO && inferredAudio) ? '[mensagem de áudio]' : (msg.content || ''),
    timestamp: formatMessageTime(msg.sent_at),
    sentAt: msg.sent_at,
    direction: msg.from_type === 'user' ? MessageDirection.INCOMING : MessageDirection.OUTGOING,
    type,
    status: mapDBMessageStatus(msg.status),
    fromType: msg.from_type,
    mediaUrl,
    whatsappMessageId: msg.whatsapp_message_id,
    isEdited: !!metadata.edited,
    isDeleted: !!metadata.deleted,
    originalContent: (metadata.original_content as string) || null,
    originalMediaUrl: (metadata.original_media_url as string) || null
  };
}

function parseLegacyMediaJson(content: string): { url: string | null; mimetype: string | null } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('{')) return { url: null, mimetype: null };

  try {
    const parsed = JSON.parse(trimmed);
    const url = typeof parsed?.URL === 'string'
      ? parsed.URL
      : (typeof parsed?.url === 'string' ? parsed.url : null);
    const mimetype = typeof parsed?.mimetype === 'string'
      ? parsed.mimetype
      : (typeof parsed?.mimeType === 'string' ? parsed.mimeType : null);
    return { url, mimetype };
  } catch {
    return { url: null, mimetype: null };
  }
}

function mapDBMessageType(type: DBMessageType): MessageType {
  switch (type) {
    case 'image': return MessageType.IMAGE;
    case 'audio': return MessageType.AUDIO;
    case 'video': return MessageType.IMAGE; // Show video thumbnail as image for now
    default: return MessageType.TEXT;
  }
}

function mapDBMessageStatus(status: DBMessageStatus): 'sent' | 'delivered' | 'read' {
  switch (status) {
    case 'read': return 'read';
    case 'delivered': return 'delivered';
    default: return 'sent';
  }
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  
  // Convert both to Sao Paulo timezone for comparison
  const spFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const nowParts = spFormatter.formatToParts(now);
  const dateParts = spFormatter.formatToParts(date);
  
  const getNow = (type: string) => nowParts.find(p => p.type === type)?.value || '';
  const getDate = (type: string) => dateParts.find(p => p.type === type)?.value || '';
  
  const nowDay = `${getNow('year')}-${getNow('month')}-${getNow('day')}`;
  const dateDay = `${getDate('year')}-${getDate('month')}-${getDate('day')}`;
  
  if (nowDay === dateDay) {
    // Today - show relative time
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffMins < 1) return 'Agora';
    if (diffMins < 60) return `${diffMins}min`;
    return `${diffHours}h`;
  }
  
  // Check yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayParts = spFormatter.formatToParts(yesterday);
  const getYesterday = (type: string) => yesterdayParts.find(p => p.type === type)?.value || '';
  const yesterdayDay = `${getYesterday('year')}-${getYesterday('month')}-${getYesterday('day')}`;
  
  if (dateDay === yesterdayDay) return 'Ontem';
  
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 7) return `${diffDays}d`;
  
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' } as any);
}

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function getDefaultClientMemory(): ClientMemory {
  return {
    last_updated: null,
    lead_profile: {
      interests: [],
      lead_stage: 'new',
      objections: [],
      products_discussed: [],
      communication_style: 'unknown',
      qualification_score: 0
    },
    sales_intelligence: {
      pain_points: [],
      next_best_action: 'qualify',
      budget_indication: 'unknown',
      decision_timeline: 'unknown'
    },
    interaction_summary: {
      response_pattern: 'unknown',
      last_contact_reason: '',
      total_conversations: 0,
      preferred_contact_time: 'unknown'
    },
    conversation_history: []
  };
}
