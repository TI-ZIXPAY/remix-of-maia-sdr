import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Check, X, Clock, Loader2 } from 'lucide-react';
import { Button } from './Button';
import { toast } from 'sonner';
import { Team, TeamFunction } from '@/types';

interface PendingUser {
  user_id: string;
  email: string;
  full_name: string | null;
  created_at: string;
}

interface PendingUsersSectionProps {
  teams: Team[];
  functions: TeamFunction[];
  onApproved: () => void;
}

const PendingUsersSection: React.FC<PendingUsersSectionProps> = ({ teams, functions, onApproved }) => {
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  
  // Approval form state per user
  const [approvalForms, setApprovalForms] = useState<Record<string, {
    role: string;
    team_id: string;
    function_id: string;
  }>>({});

  const fetchPending = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-pending-users');
      
      if (error) throw error;
      
      const users = data?.users || [];
      setPendingUsers(users);
      
      // Initialize forms
      const forms: Record<string, any> = {};
      for (const u of users) {
        forms[u.user_id] = { role: 'user', team_id: '', function_id: '' };
      }
      setApprovalForms(forms);
    } catch (err) {
      console.error('Error fetching pending users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();

    const channel = supabase
      .channel('pending-users-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles' }, () => {
        fetchPending();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleApprove = async (userId: string) => {
    setApproving(userId);
    const form = approvalForms[userId];
    
    try {
      // 1. Approve the user role
      const { error: roleError } = await supabase
        .from('user_roles')
        .update({ 
          is_approved: true,
          role: form.role as any
        })
        .eq('user_id', userId);

      if (roleError) throw roleError;

      // 2. Create team_member entry
      const pending = pendingUsers.find(p => p.user_id === userId);
      const memberName = pending?.full_name || 'Novo Membro';
      
      const { error: memberError } = await supabase
        .from('team_members')
        .insert({
          name: memberName,
          email: pending?.email || `user-${userId.slice(0, 8)}@pending`,
          role: (form.role === 'admin' ? 'admin' : form.role === 'manager' ? 'manager' : 'agent') as any,
          status: 'active',
          user_id: userId,
          team_id: form.team_id || null,
          function_id: form.function_id || null,
        });

      if (memberError) {
        console.warn('Error creating team member (may already exist):', memberError);
      }

      toast.success('Usuário aprovado com sucesso!');
      onApproved();
      fetchPending();
    } catch (err) {
      console.error('Error approving user:', err);
      toast.error('Erro ao aprovar usuário');
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (userId: string) => {
    if (!confirm('Tem certeza que deseja rejeitar este usuário? A conta será removida.')) return;
    
    setRejecting(userId);
    try {
      // Delete the user_role entry (user won't be able to access)
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('is_approved', false);

      if (error) throw error;

      toast.success('Usuário rejeitado');
      fetchPending();
    } catch (err) {
      console.error('Error rejecting user:', err);
      toast.error('Erro ao rejeitar usuário');
    } finally {
      setRejecting(null);
    }
  };

  const updateForm = (userId: string, field: string, value: string) => {
    setApprovalForms(prev => ({
      ...prev,
      [userId]: { ...prev[userId], [field]: value }
    }));
  };

  if (loading) return null;
  if (pendingUsers.length === 0) return null;

  return (
    <div className="bg-amber-950/10 border border-amber-800/30 rounded-xl overflow-hidden shadow-xl mb-8">
      <div className="p-6 border-b border-amber-800/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center">
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Usuários Pendentes</h3>
            <p className="text-sm text-slate-500">{pendingUsers.length} usuário(s) aguardando aprovação</p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-amber-800/10">
        {pendingUsers.map((user) => (
          <div key={user.user_id} className="p-6 hover:bg-amber-950/10 transition-colors">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              {/* User Info */}
              <div className="flex items-center gap-3 min-w-[200px]">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-sm font-bold text-amber-400 uppercase">
                  {(user.full_name || '?').substring(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{user.full_name || 'Sem nome'}</p>
                  <p className="text-xs text-slate-400 font-mono">{user.email}</p>
                  <p className="text-xs text-slate-500">
                    Cadastrado em {new Date(user.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
              </div>

              {/* Assignment Selectors */}
              <div className="flex flex-wrap gap-3 flex-1">
                <select
                  value={approvalForms[user.user_id]?.role || 'user'}
                  onChange={(e) => updateForm(user.user_id, 'role', e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-300"
                >
                  <option value="user">Usuário</option>
                  <option value="admin">Admin</option>
                </select>

                <select
                  value={approvalForms[user.user_id]?.team_id || ''}
                  onChange={(e) => updateForm(user.user_id, 'team_id', e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-300"
                >
                  <option value="">Sem time</option>
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>

                <select
                  value={approvalForms[user.user_id]?.function_id || ''}
                  onChange={(e) => updateForm(user.user_id, 'function_id', e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-md text-sm text-slate-300"
                >
                  <option value="">Sem função</option>
                  {functions.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleApprove(user.user_id)}
                  disabled={approving === user.user_id}
                  className="bg-emerald-600 hover:bg-emerald-500 gap-1.5"
                >
                  {approving === user.user_id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Aprovar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleReject(user.user_id)}
                  disabled={rejecting === user.user_id}
                  className="text-red-400 hover:text-red-300 hover:bg-red-950/20 gap-1.5"
                >
                  {rejecting === user.user_id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                  Rejeitar
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PendingUsersSection;
