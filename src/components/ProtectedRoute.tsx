import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Clock, LogOut } from 'lucide-react';
import { Button } from './Button';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const [approvalStatus, setApprovalStatus] = useState<'loading' | 'approved' | 'pending'>('loading');

  useEffect(() => {
    if (!user) {
      setApprovalStatus('loading');
      return;
    }

    let cancelled = false;
    let retryCount = 0;

    const checkApproval = async () => {
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('is_approved')
          .eq('user_id', user.id)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          console.error('[ProtectedRoute] Error checking approval:', error);
          // Retry up to 3 times before showing pending
          if (retryCount < 3) {
            retryCount++;
            setTimeout(checkApproval, 1000);
            return;
          }
          setApprovalStatus('pending');
          return;
        }

        // If no row exists yet (trigger delay), retry a few times
        if (!data) {
          if (retryCount < 3) {
            retryCount++;
            console.log(`[ProtectedRoute] No role row yet, retry ${retryCount}/3`);
            setTimeout(checkApproval, 1500);
            return;
          }
          setApprovalStatus('pending');
          return;
        }

        setApprovalStatus(data.is_approved ? 'approved' : 'pending');
      } catch (e) {
        console.error('[ProtectedRoute] Unexpected error:', e);
        if (!cancelled && retryCount < 3) {
          retryCount++;
          setTimeout(checkApproval, 1000);
        } else if (!cancelled) {
          setApprovalStatus('pending');
        }
      }
    };

    checkApproval();

    // Listen for realtime changes to user_roles (admin approving)
    const channel = supabase
      .channel('user-approval-' + user.id)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_roles',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        if ((payload.new as any).is_approved) {
          setApprovalStatus('approved');
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
          <p className="text-slate-400 text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (approvalStatus === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
          <p className="text-slate-400 text-sm">Verificando acesso...</p>
        </div>
      </div>
    );
  }

  if (approvalStatus === 'pending') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/50 border border-slate-800 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-6">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">Aguardando Aprovação</h2>
          <p className="text-slate-400 mb-2">
            Seu cadastro foi recebido com sucesso!
          </p>
          <p className="text-slate-500 text-sm mb-8">
            Um administrador precisa aprovar seu acesso antes que você possa utilizar o sistema. 
            Você será notificado quando seu acesso for liberado.
          </p>
          <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 mb-6">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Logado como</p>
            <p className="text-sm text-slate-300 font-mono">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            onClick={signOut}
            className="text-slate-400 hover:text-white gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
