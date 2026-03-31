import React, { useEffect, useState } from 'react';
import { Search, Filter, MoreHorizontal, UserPlus, MessageSquare, Loader2, Mail, Phone, Users, Target, TrendingUp, Brain, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';
import { api } from '../services/api';
import { Contact, LeadClassification, ClientMemory } from '../types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

const Contacts: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedContact, setExpandedContact] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const loadContacts = async () => {
      try {
        const data = await api.fetchContacts();
        setContacts(data);
      } catch (error) {
        console.error("Erro ao carregar contatos", error);
      } finally {
        setLoading(false);
      }
    };
    loadContacts();
  }, []);

  const filteredContacts = contacts.filter(c => {
    const term = searchTerm.toLowerCase();
    return (
      (c.name?.toLowerCase() || '').includes(term) ||
      (c.phone || '').includes(term) ||
      (c.email?.toLowerCase() || '').includes(term)
    );
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'customer': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'lead': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'churned': return 'bg-slate-800 text-slate-400 border-slate-700';
      default: return 'bg-slate-800 text-slate-400';
    }
  };

  const getClassificationStyle = (classification: LeadClassification | undefined) => {
    switch (classification) {
      case 'sql': return { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', label: 'SQL' };
      case 'mql': return { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', label: 'MQL' };
      case 'pre_mql': return { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30', label: 'Pré-MQL' };
      case 'nutricao': return { bg: 'bg-violet-500/20', text: 'text-violet-400', border: 'border-violet-500/30', label: 'Nutrição' };
      case 'dq': return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', label: 'DQ' };
      case 'new': 
      default: return { bg: 'bg-slate-700/20', text: 'text-slate-400', border: 'border-slate-600/30', label: 'Novo' };
    }
  };

  const getScoreColor = (score: number | undefined) => {
    if (!score) return 'text-slate-500';
    if (score >= 90) return 'text-emerald-400';
    if (score >= 70) return 'text-cyan-400';
    if (score >= 40) return 'text-amber-400';
    return 'text-slate-400';
  };

  const formatBreakdown = (contact: Contact) => {
    const breakdown = contact.leadScoreBreakdown;
    if (!breakdown) return 'Sem dados de qualificação';
    
    const lines: string[] = [];
    if (breakdown.origin?.points) lines.push(`Origem: +${breakdown.origin.points} (${breakdown.origin.reason || '-'})`);
    if (breakdown.contact_completeness?.points) lines.push(`Contato: +${breakdown.contact_completeness.points} (${breakdown.contact_completeness.reason || '-'})`);
    if (breakdown.fit?.points) lines.push(`FIT: +${breakdown.fit.points} (${breakdown.fit.reason || '-'})`);
    if (breakdown.maturity?.points) lines.push(`Maturidade: +${breakdown.maturity.points} (${breakdown.maturity.reason || '-'})`);
    if (breakdown.value_potential?.points) lines.push(`Valor: +${breakdown.value_potential.points} (${breakdown.value_potential.reason || '-'})`);
    if (breakdown.intent_signals?.points) lines.push(`Intenção: +${breakdown.intent_signals.points} (${breakdown.intent_signals.reason || '-'})`);
    if (breakdown.disqualification_reason) lines.push(`DQ: ${breakdown.disqualification_reason}`);
    
    return lines.length > 0 ? lines.join('\n') : 'Sem dados ainda';
  };

  const handleStartConversation = (contact: Contact) => {
    navigate(`/chat?contact=${encodeURIComponent(contact.phone)}`);
  };

  return (
    <div className="p-4 md:p-8 h-full overflow-y-auto bg-slate-950 text-slate-50">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Contatos</h2>
          <p className="text-sm text-slate-400 mt-1">Gerencie sua base de leads e clientes com inteligência.</p>
        </div>
        <Button 
          className="shadow-lg shadow-cyan-500/20 opacity-50 cursor-not-allowed"
          disabled
          title="Em breve: Adicionar contato"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Novo Contato
        </Button>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-4 mb-8 bg-slate-900/50 p-2 rounded-xl border border-slate-800">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input 
            type="text" 
            placeholder="Buscar por nome, email ou telefone"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 placeholder:text-slate-600 transition-all"
          />
        </div>
        <Button 
          variant="outline" 
          className="w-full sm:w-auto bg-slate-950 border-slate-800 text-slate-500 cursor-not-allowed opacity-50"
          disabled
          title="Em breve: Filtros avançados"
        >
          <Filter className="w-4 h-4 mr-2" />
          Filtros Avançados
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur-sm shadow-xl overflow-hidden min-h-[400px]">
        {loading ? (
           <div className="flex flex-col items-center justify-center h-80">
             <Loader2 className="h-10 w-10 animate-spin text-cyan-500 mb-3" />
             <span className="text-sm text-slate-400 animate-pulse">Carregando base de dados...</span>
           </div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-80 text-slate-400">
            <Users className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Nenhum contato encontrado</p>
            <p className="text-sm text-slate-500 mt-1">
              {searchTerm ? 'Tente buscar por outro termo' : 'Os contatos aparecerão aqui'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
               <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 md:px-6 py-4">Nome / Telefone</th>
                  <th className="px-4 md:px-6 py-4">Lead Score</th>
                  <th className="px-4 md:px-6 py-4 hidden md:table-cell">Canais</th>
                  <th className="px-4 md:px-6 py-4 hidden lg:table-cell">Última Interação</th>
                  <th className="px-4 md:px-6 py-4 text-right hidden sm:table-cell">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                <TooltipProvider>
                {filteredContacts.map((contact) => {
                  const classStyle = getClassificationStyle(contact.leadClassification);
                  const isExpanded = expandedContact === contact.id;
                  const memory = contact.clientMemory;
                  const hasInsights = memory && (
                    (memory.lead_profile?.interests?.length > 0) ||
                    (memory.sales_intelligence?.pain_points?.length > 0) ||
                    (memory.lead_profile?.qualification_score > 0) ||
                    (memory.interaction_summary?.total_conversations > 0)
                  );
                  return (
                  <React.Fragment key={contact.id}>
                  <tr 
                    className={`hover:bg-slate-800/40 transition-colors group ${hasInsights ? 'cursor-pointer' : ''}`}
                    onClick={() => hasInsights && setExpandedContact(isExpanded ? null : contact.id)}
                  >
                    <td className="px-4 md:px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-700 flex items-center justify-center text-sm font-bold text-cyan-400 shadow-inner">
                          {(contact.name || contact.phone || '?').substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                            <div className="font-semibold text-slate-200 group-hover:text-cyan-400 transition-colors flex items-center gap-2">
                              {contact.name || 'Sem nome'}
                              {hasInsights && (
                                <Brain className="w-3.5 h-3.5 text-violet-400 opacity-60" />
                              )}
                            </div>
                            <div className="text-xs text-slate-500">{contact.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 md:px-6 py-4">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 cursor-help" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              <Target className={`w-4 h-4 ${getScoreColor(contact.leadScore)}`} />
                              <span className={`font-bold text-lg ${getScoreColor(contact.leadScore)}`}>
                                {contact.leadScore || 0}
                              </span>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${classStyle.bg} ${classStyle.text} ${classStyle.border}`}>
                              {classStyle.label}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs bg-slate-900 border-slate-700 text-slate-200">
                          <div className="text-xs font-medium mb-1 text-cyan-400">Breakdown do Score</div>
                          <pre className="text-[10px] whitespace-pre-wrap text-slate-400">{formatBreakdown(contact)}</pre>
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="px-4 md:px-6 py-4 hidden md:table-cell">
                      <div className="flex flex-col gap-1">
                        {contact.email && (
                          <div className="flex items-center gap-2 text-slate-400 text-xs">
                              <Mail className="w-3.5 h-3.5" />
                              {contact.email}
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-slate-400 text-xs">
                            <Phone className="w-3.5 h-3.5" />
                            {contact.phone}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 md:px-6 py-4 hidden lg:table-cell">
                       <span className="text-slate-400">{contact.lastContact}</span>
                       <div className="text-[10px] text-slate-600">via WhatsApp</div>
                    </td>
                    <td className="px-4 md:px-6 py-4 text-right hidden sm:table-cell">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                        {hasInsights && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 rounded-lg text-violet-400"
                            title="Ver insights da IA"
                            onClick={(e) => { e.stopPropagation(); setExpandedContact(isExpanded ? null : contact.id); }}
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </Button>
                        )}
                        <Button 
                          size="sm" 
                          variant="primary" 
                          className="h-8 w-8 p-0 rounded-lg shadow-none" 
                          title="Iniciar Conversa"
                          onClick={(e) => { e.stopPropagation(); handleStartConversation(contact); }}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 w-8 p-0 rounded-lg text-slate-500 cursor-not-allowed opacity-50"
                          disabled
                          title="Em breve: Mais opções"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {/* Expanded AI Insights Row */}
                  {isExpanded && memory && (
                    <tr className="bg-slate-900/60">
                      <td colSpan={5} className="px-6 py-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Brain className="w-4 h-4 text-violet-400" />
                          <span className="text-xs font-bold text-violet-400 uppercase tracking-wider">Insights da IA</span>
                          <span className="text-[10px] text-slate-600 ml-2">
                            {memory.interaction_summary?.total_conversations || 0} interações • Atualizado: {memory.last_updated ? new Date(memory.last_updated).toLocaleDateString('pt-BR') : 'N/A'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {/* Qualification Score */}
                          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                            <span className="text-[10px] text-slate-500 uppercase">Qualificação IA</span>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-lg font-bold text-cyan-400">{memory.lead_profile?.qualification_score || 0}%</span>
                            </div>
                            <div className="w-full bg-slate-800 rounded-full h-1 mt-1.5">
                              <div className="bg-gradient-to-r from-cyan-500 to-violet-500 h-1 rounded-full" style={{ width: `${memory.lead_profile?.qualification_score || 0}%` }} />
                            </div>
                          </div>
                          {/* Next Action */}
                          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                            <span className="text-[10px] text-slate-500 uppercase">Próxima Ação</span>
                            <p className="text-sm text-cyan-400 mt-1 font-medium">
                              {memory.sales_intelligence?.next_best_action === 'qualify' ? '📋 Qualificar' :
                               memory.sales_intelligence?.next_best_action === 'demo' ? '🎯 Demo' :
                               memory.sales_intelligence?.next_best_action === 'followup' ? '📞 Follow-up' :
                               memory.sales_intelligence?.next_best_action === 'close' ? '🤝 Fechar' :
                               memory.sales_intelligence?.next_best_action === 'nurture' ? '🌱 Nutrir' :
                               memory.sales_intelligence?.next_best_action || '—'}
                            </p>
                          </div>
                          {/* Budget */}
                          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                            <span className="text-[10px] text-slate-500 uppercase">Orçamento</span>
                            <p className="text-sm text-slate-200 mt-1">
                              {memory.sales_intelligence?.budget_indication === 'high' ? '💰 Alto' :
                               memory.sales_intelligence?.budget_indication === 'medium' ? '💵 Médio' :
                               memory.sales_intelligence?.budget_indication === 'low' ? '📉 Baixo' :
                               '❓ Não informado'}
                            </p>
                          </div>
                          {/* Timeline */}
                          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                            <span className="text-[10px] text-slate-500 uppercase">Urgência</span>
                            <p className="text-sm text-slate-200 mt-1">
                              {memory.sales_intelligence?.decision_timeline === 'immediate' ? '🔥 Imediata' :
                               memory.sales_intelligence?.decision_timeline === '1month' ? '📅 1 mês' :
                               memory.sales_intelligence?.decision_timeline === '3months' ? '📆 3 meses' :
                               memory.sales_intelligence?.decision_timeline === '6months+' ? '🕐 6+ meses' :
                               '❓ Indefinido'}
                            </p>
                          </div>
                        </div>
                        {/* Interests & Pain Points */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                          {memory.lead_profile?.interests?.length > 0 && (
                            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                              <span className="text-[10px] text-slate-500 uppercase mb-2 block">Interesses</span>
                              <div className="flex flex-wrap gap-1.5">
                                {memory.lead_profile.interests.map((i, idx) => (
                                  <span key={idx} className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-md border border-emerald-500/20">{i}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {memory.sales_intelligence?.pain_points?.length > 0 && (
                            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                              <span className="text-[10px] text-slate-500 uppercase mb-2 block">Dores</span>
                              <div className="flex flex-wrap gap-1.5">
                                {memory.sales_intelligence.pain_points.map((p, idx) => (
                                  <span key={idx} className="px-2 py-0.5 bg-red-500/10 text-red-400 text-xs rounded-md border border-red-500/20">{p}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        {/* Notes */}
                        {contact.notes && (
                          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 mt-3">
                            <span className="text-[10px] text-slate-500 uppercase mb-1 block">Observações</span>
                            <p className="text-xs text-slate-300">{contact.notes}</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                })}
                </TooltipProvider>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Contacts;
