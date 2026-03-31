import React, { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Calendar, Clock, CheckCircle2, XCircle, ChevronDown, ChevronRight, User, Send, MessageCircleQuestion, ThumbsUp, ThumbsDown, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';

interface FollowUpStep {
  id: string;
  step_order: number;
  delay_minutes: number;
  message_template: string;
  is_active: boolean;
  is_question: boolean;
  sequence_id: string;
}

interface FollowUpExecution {
  id: string;
  appointment_id: string;
  contact_id: string;
  step_id: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  reply_status: string | null;
}

interface ContactInfo {
  id: string;
  name: string | null;
  phone_number: string;
}

interface AppointmentInfo {
  id: string;
  title: string;
  date: string;
  time: string;
  status: string | null;
  contact_id: string | null;
}

interface FunnelCard {
  appointmentId: string;
  contact: ContactInfo;
  appointment: AppointmentInfo;
  executions: FollowUpExecution[];
  totalSteps: number;
  sentCount: number;
  lastSentStepOrder: number;
  columnIndex: number; // 0=agendado, 1..N=steps, N+1=confirmou, N+2=concluído, N+3=cancelado
}

const getDelayLabel = (delayMinutes: number): string => {
  const abs = Math.abs(delayMinutes);
  if (abs < 60) return `${abs}min antes`;
  if (abs < 1440) return `${abs / 60}h antes`;
  return `${abs / 1440}d antes`;
};

const statusColors: Record<string, string> = {
  scheduled: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  cancelled: 'bg-destructive/20 text-red-400 border-red-500/30',
  no_show: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const FollowUpFunnel: React.FC = () => {
  const [steps, setSteps] = useState<FollowUpStep[]>([]);
  const [executions, setExecutions] = useState<FollowUpExecution[]>([]);
  const [contacts, setContacts] = useState<Map<string, ContactInfo>>(new Map());
  const [appointments, setAppointments] = useState<Map<string, AppointmentInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedCard, setSelectedCard] = useState<FunnelCard | null>(null);
  const dragItem = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);

  const fetchData = async () => {
    try {
      // 1. Fetch active sequence
      const { data: seqData } = await supabase
        .from('followup_sequences')
        .select('id')
        .eq('is_active', true)
        .limit(1)
        .single();

      if (!seqData) {
        setLoading(false);
        return;
      }

      // 2. Fetch steps
      const { data: stepsData } = await supabase
        .from('followup_steps')
        .select('*')
        .eq('sequence_id', seqData.id)
        .eq('is_active', true)
        .order('step_order', { ascending: true });

      setSteps((stepsData as FollowUpStep[]) || []);

      // 3. Fetch executions
      const { data: execData } = await supabase
        .from('followup_executions')
        .select('*')
        .order('created_at', { ascending: true });

      const execs = (execData as FollowUpExecution[]) || [];
      setExecutions(execs);

      // 4. Fetch related contacts & appointments
      const contactIds = [...new Set(execs.map(e => e.contact_id))];
      const appointmentIds = [...new Set(execs.map(e => e.appointment_id))];

      if (contactIds.length > 0) {
        const { data: contactsData } = await supabase
          .from('contacts')
          .select('id, name, phone_number')
          .in('id', contactIds);

        const cMap = new Map<string, ContactInfo>();
        (contactsData || []).forEach(c => cMap.set(c.id, c as ContactInfo));
        setContacts(cMap);
      }

      if (appointmentIds.length > 0) {
        const { data: apptData } = await supabase
          .from('appointments')
          .select('id, title, date, time, status, contact_id')
          .in('id', appointmentIds);

        const aMap = new Map<string, AppointmentInfo>();
        (apptData || []).forEach(a => aMap.set(a.id, a as AppointmentInfo));
        setAppointments(aMap);
      }
    } catch (err) {
      console.error('Erro ao carregar funil de follow-up:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    // Realtime subscription
    const channel = supabase
      .channel('followup-funnel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'followup_executions' }, () => {
        fetchData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Build step order map
  const stepOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    steps.forEach(s => map.set(s.id, s.step_order));
    return map;
  }, [steps]);

  // Build funnel cards grouped by appointment
  const cards = useMemo<FunnelCard[]>(() => {
    const grouped = new Map<string, FollowUpExecution[]>();
    executions.forEach(e => {
      const arr = grouped.get(e.appointment_id) || [];
      arr.push(e);
      grouped.set(e.appointment_id, arr);
    });

    return Array.from(grouped.entries()).map(([apptId, execs]) => {
      const contact = contacts.get(execs[0].contact_id) || { id: execs[0].contact_id, name: null, phone_number: '' };
      const appointment = appointments.get(apptId) || { id: apptId, title: '', date: '', time: '', status: 'scheduled', contact_id: null };

      const sentExecs = execs.filter(e => e.status === 'sent');
      const sentCount = sentExecs.length;
      const totalSteps = steps.length;

      let lastSentStepOrder = 0;
      sentExecs.forEach(e => {
        const order = stepOrderMap.get(e.step_id) || 0;
        if (order > lastSentStepOrder) lastSentStepOrder = order;
      });

      let columnIndex: number;
      const isCancelled = appointment.status === 'cancelled' || appointment.status === 'canceled';
      const hasConfirmed = executions.some(e => e.reply_status === 'confirmed');
      const hasDeclined = executions.some(e => e.reply_status === 'declined');
      const allSent = sentCount >= totalSteps && totalSteps > 0;

      if (hasConfirmed) {
        columnIndex = totalSteps + 1; // confirmou agendamento
      } else if (isCancelled || hasDeclined) {
        columnIndex = totalSteps + 2; // cancelado
      } else if (allSent) {
        columnIndex = totalSteps + 3; // concluído (last column)
      } else if (sentCount === 0) {
        columnIndex = 0; // agendado
      } else {
        columnIndex = lastSentStepOrder;
      }

      return { appointmentId: apptId, contact, appointment, executions: execs, totalSteps, sentCount, lastSentStepOrder, columnIndex };
    });
  }, [executions, contacts, appointments, steps, stepOrderMap]);

  // Columns definition
  const columns = useMemo(() => {
    const cols: { id: string; title: string; colorClass: string }[] = [
      { id: 'agendado', title: 'Agendado', colorClass: 'border-blue-500/50' },
    ];
    steps.forEach(s => {
      cols.push({
        id: `step-${s.step_order}`,
        title: `Step ${s.step_order} · ${getDelayLabel(s.delay_minutes)}`,
        colorClass: 'border-primary/50',
      });
    });
    cols.push({ id: 'confirmou', title: 'Confirmou Agendamento', colorClass: 'border-cyan-500/50' });
    cols.push({ id: 'cancelado', title: 'Cancelou Agendamento', colorClass: 'border-red-500/50' });
    cols.push({ id: 'concluido', title: 'Concluído', colorClass: 'border-emerald-500/50' });
    return cols;
  }, [steps]);

  const activeCards = cards;

  // Drag handlers
  const onDragStart = (e: React.DragEvent, appointmentId: string) => {
    dragItem.current = appointmentId;
    e.dataTransfer.effectAllowed = 'move';
    (e.target as HTMLElement).style.opacity = '0.5';
  };

  const onDragEnd = (e: React.DragEvent) => {
    dragItem.current = null;
    setDragOverCol(null);
    (e.target as HTMLElement).style.opacity = '1';
  };

  const onDragOver = (e: React.DragEvent, colIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragOverCol !== colIdx) setDragOverCol(colIdx);
  };

  const onDragLeave = () => {
    setDragOverCol(null);
  };

  const onDrop = async (e: React.DragEvent, targetColIdx: number) => {
    e.preventDefault();
    setDragOverCol(null);
    const apptId = dragItem.current;
    if (!apptId) return;

    const card = cards.find(c => c.appointmentId === apptId);
    if (!card || card.columnIndex === targetColIdx) return;

    try {
      const totalSteps = steps.length;

      // Dropped on "Cancelado" column
      if (targetColIdx === totalSteps + 2) {
        await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', apptId);
        toast.success('Agendamento cancelado');
        fetchData();
        return;
      }

      // Dropped on "Concluído" column (last)
      if (targetColIdx === totalSteps + 3) {
        // Mark all pending executions as sent
        const pendingExecs = card.executions.filter(ex => ex.status !== 'sent');
        for (const ex of pendingExecs) {
          await supabase.from('followup_executions').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', ex.id);
        }
        await supabase.from('appointments').update({ status: 'completed' }).eq('id', apptId);
        toast.success('Follow-up concluído');
        fetchData();
        return;
      }

      // Dropped on "Confirmou Agendamento" column
      if (targetColIdx === totalSteps + 1) {
        // Mark all pending executions as sent, set one as confirmed
        const pendingExecs = card.executions.filter(ex => ex.status !== 'sent');
        for (const ex of pendingExecs) {
          await supabase.from('followup_executions').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', ex.id);
        }
        // Mark the last question step (or last step) as confirmed
        const questionExec = card.executions.find(e => {
          const step = steps.find(s => s.id === e.step_id);
          return step?.is_question;
        }) || card.executions[card.executions.length - 1];
        if (questionExec) {
          await supabase.from('followup_executions').update({ reply_status: 'confirmed' }).eq('id', questionExec.id);
        }
        toast.success('Agendamento confirmado!');
        fetchData();
        return;
      }

      // Dropped on "Agendado" (col 0) — reset
      if (targetColIdx === 0) {
        await supabase.from('appointments').update({ status: 'scheduled' }).eq('id', apptId);
        // Reset all executions to scheduled
        for (const ex of card.executions) {
          await supabase.from('followup_executions').update({ status: 'scheduled', sent_at: null, reply_status: null }).eq('id', ex.id);
        }
        toast.success('Resetado para Agendado');
        fetchData();
        return;
      }

      // Dropped on a step column (1..N) — mark all steps up to that order as sent
      const targetStepOrder = targetColIdx;
      for (const step of steps) {
        const exec = card.executions.find(ex => ex.step_id === step.id);
        if (step.step_order <= targetStepOrder) {
          if (exec && exec.status !== 'sent') {
            await supabase.from('followup_executions').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', exec.id);
          }
        } else {
          if (exec && exec.status === 'sent') {
            await supabase.from('followup_executions').update({ status: 'scheduled', sent_at: null }).eq('id', exec.id);
          }
        }
      }
      await supabase.from('appointments').update({ status: 'scheduled' }).eq('id', apptId);
      toast.success(`Movido para Step ${targetStepOrder}`);
      fetchData();
    } catch (err) {
      console.error('Erro ao mover card:', err);
      toast.error('Erro ao mover card');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Calendar className="w-12 h-12" />
        <p className="text-lg font-medium">Nenhuma sequência de follow-up ativa</p>
        <p className="text-sm">Configure uma sequência em Configurações → Follow-up</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4 gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-foreground">Funil de Follow-up</h1>
          <p className="text-sm text-muted-foreground">{cards.length} leads em acompanhamento</p>
        </div>
      </div>

      {/* Kanban columns */}
      <div className="flex-1 flex gap-3 overflow-x-auto pb-2 min-h-0">
        {columns.map((col, colIdx) => {
          const colCards = activeCards.filter(c => c.columnIndex === colIdx);
          return (
            <div key={col.id}
              className={`flex flex-col min-w-[260px] max-w-[300px] flex-shrink-0 rounded-xl border ${col.colorClass} bg-card/40 backdrop-blur-sm transition-colors ${dragOverCol === colIdx ? 'ring-2 ring-primary/50 bg-primary/5' : ''}`}
              onDragOver={(e) => onDragOver(e, colIdx)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, colIdx)}
            >
              {/* Column header */}
              <div className="p-3 border-b border-border/50 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{col.title}</h3>
                <span className="text-xs bg-secondary px-2 py-0.5 rounded-full text-muted-foreground">{colCards.length}</span>
              </div>
              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                <AnimatePresence>
                  {colCards.map(card => (
                    <FunnelCardComponent key={card.appointmentId} card={card} steps={steps} onClick={() => setSelectedCard(card)} onDragStart={onDragStart} onDragEnd={onDragEnd} />
                  ))}
                </AnimatePresence>
                {colCards.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">Nenhum lead</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cancelled section removed - now a proper column */}

      {/* Detail modal */}
      {selectedCard && (
        <CardDetailModal card={selectedCard} steps={steps} stepOrderMap={stepOrderMap} onClose={() => setSelectedCard(null)} />
      )}
    </div>
  );
};

/* ─── Card Component ─── */
const FunnelCardComponent: React.FC<{
  card: FunnelCard;
  steps: FollowUpStep[];
  onClick: () => void;
  onDragStart: (e: React.DragEvent, appointmentId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
}> = ({ card, steps, onClick, onDragStart, onDragEnd }) => {
  const { contact, appointment, executions, sentCount, totalSteps } = card;
  const appointmentStatus = appointment.status || 'scheduled';
  const colorClass = statusColors[appointmentStatus] || statusColors.scheduled;

  // Reply status indicator
  const awaitingReply = executions.some(e => e.reply_status === 'awaiting_reply');
  const hasConfirmed = executions.some(e => e.reply_status === 'confirmed');
  const hasDeclined = executions.some(e => e.reply_status === 'declined');

  const replyIndicator = awaitingReply ? (
    <span className="flex items-center" aria-label="Aguardando resposta">
      <MessageCircleQuestion className="w-3.5 h-3.5 text-amber-400" />
    </span>
  ) : hasDeclined ? (
    <span className="flex items-center" aria-label="Recusou">
      <ThumbsDown className="w-3.5 h-3.5 text-destructive" />
    </span>
  ) : hasConfirmed ? (
    <span className="flex items-center" aria-label="Confirmou">
      <ThumbsUp className="w-3.5 h-3.5 text-emerald-400" />
    </span>
  ) : null;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, card.appointmentId)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="bg-secondary/60 border border-border/50 rounded-lg p-3 cursor-grab active:cursor-grabbing hover:bg-secondary/80 hover:border-primary/30 transition-all group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <User className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="text-sm font-medium text-foreground truncate">
            {contact.name || contact.phone_number}
          </span>
        </div>
      </div>

      {appointment.date && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
          <Calendar className="w-3 h-3" />
          <span>
            {format(new Date(appointment.date + 'T' + appointment.time), "dd/MM · HH:mm", { locale: ptBR })}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${colorClass}`}>
          {appointmentStatus}
        </span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {replyIndicator}
          <Send className="w-3 h-3" />
          <span>{sentCount}/{totalSteps}</span>
        </div>
      </div>

      {/* Progress bar */}
      {totalSteps > 0 && (
        <div className="mt-2 h-1 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${(sentCount / totalSteps) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
};

/* ─── Detail Modal ─── */
const CardDetailModal: React.FC<{
  card: FunnelCard;
  steps: FollowUpStep[];
  stepOrderMap: Map<string, number>;
  onClose: () => void;
}> = ({ card, steps, stepOrderMap, onClose }) => {
  const { contact, appointment, executions } = card;
  const [forcing, setForcing] = useState<string | null>(null);

  const handleForceSend = async (step: FollowUpStep, exec: FollowUpExecution | undefined) => {
    if (forcing) return;
    setForcing(step.id);
    try {
      // Fetch settings for template variables
      const { data: settings } = await supabase
        .from('nina_settings')
        .select('calendly_scheduling_url')
        .limit(1)
        .maybeSingle();

      const nome = contact.name || 'cliente';
      const data = appointment.date ? appointment.date.split('-').reverse().join('/') : '';
      const horario = appointment.time?.substring(0, 5) || '';
      const titulo = appointment.title || 'reunião';
      const linkCalendly = settings?.calendly_scheduling_url || '';

      let message = step.message_template
        .replace(/\{\{nome\}\}/gi, nome)
        .replace(/\{\{data\}\}/gi, data)
        .replace(/\{\{horario\}\}/gi, horario)
        .replace(/\{\{titulo\}\}/gi, titulo)
        .replace(/\{\{link_calendly\}\}/gi, linkCalendly);

      // Find conversation
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', contact.id)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!conv) {
        toast.error('Nenhuma conversa encontrada para este contato');
        return;
      }

      // Build send_queue payload - use buttons for question steps
      const isQuestion = !!(step as any).is_question;
      const sendPayload: any = {
        contact_id: contact.id,
        conversation_id: conv.id,
        content: message,
        message_type: isQuestion ? 'menu' : 'text',
        from_type: 'nina',
        status: 'pending',
        priority: 3,
        metadata: {
          source: 'followup_forced',
          step_order: step.step_order,
          appointment_id: appointment.id,
          ...(isQuestion ? {
            menu_type: 'button',
            menu_text: message,
            menu_choices: ['Sim, confirmo ✅|confirm', 'Não poderei ❌|decline'],
            menu_footer: 'Responda clicando em um botão',
          } : {})
        }
      };

      const { error: sendError } = await supabase
        .from('send_queue')
        .insert(sendPayload);

      if (sendError) throw sendError;

      // Update or create execution
      if (exec) {
        await supabase
          .from('followup_executions')
          .update({ status: 'sent', sent_at: new Date().toISOString(), ...(isQuestion ? { reply_status: 'awaiting_reply' } : {}) })
          .eq('id', exec.id);
      }

      toast.success(`Step ${step.step_order} enviado com sucesso!`);
    } catch (err) {
      console.error('Erro ao forçar envio:', err);
      toast.error('Erro ao forçar envio');
    } finally {
      setForcing(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-xl w-full max-w-md mx-4 p-5 shadow-2xl"
      >
        <h2 className="text-lg font-bold text-foreground mb-1">{contact.name || contact.phone_number}</h2>
        {appointment.date && (
          <p className="text-sm text-muted-foreground mb-4 flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            {format(new Date(appointment.date + 'T' + appointment.time), "dd 'de' MMMM · HH:mm", { locale: ptBR })}
          </p>
        )}

        <h3 className="text-sm font-semibold text-foreground mb-3">Timeline dos Steps</h3>
        <div className="space-y-3">
          {steps.map(step => {
            const exec = executions.find(e => e.step_id === step.id);
            const isSent = exec?.status === 'sent';
            const isScheduled = exec?.status === 'scheduled';
            const isForcing = forcing === step.id;
            return (
              <div key={step.id} className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isSent ? 'bg-emerald-500/20' : isScheduled ? 'bg-blue-500/20' : 'bg-secondary'}`}>
                  {isSent ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    Step {step.step_order} · {getDelayLabel(step.delay_minutes)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isSent && exec?.sent_at
                      ? `Enviado em ${format(new Date(exec.sent_at), "dd/MM HH:mm", { locale: ptBR })}`
                      : isScheduled && exec?.scheduled_for
                        ? `Agendado para ${format(new Date(exec.scheduled_for), "dd/MM HH:mm", { locale: ptBR })}`
                        : 'Pendente'}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleForceSend(step, exec); }}
                  disabled={isForcing}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                  title="Forçar envio agora"
                >
                  {isForcing ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3" />}
                  <span>Enviar</span>
                </button>
              </div>
            );
          })}
        </div>

        <button onClick={onClose} className="mt-5 w-full py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
          Fechar
        </button>
      </motion.div>
    </div>
  );
};

export default FollowUpFunnel;
