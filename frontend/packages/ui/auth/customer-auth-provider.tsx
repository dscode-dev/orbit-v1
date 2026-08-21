'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { customerPortalApi, hasSession, onSessionInvalid, setSessionScope, type CustomerPortalSession } from '@erp/api';

type CustomerSessionStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'password-change';
type CustomerAuthContextValue = {
  status: CustomerSessionStatus;
  session: CustomerPortalSession | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const CustomerAuthContext = createContext<CustomerAuthContextValue | null>(null);

export function useCustomerAuth(): CustomerAuthContextValue {
  const value = useContext(CustomerAuthContext);
  if (!value) throw new Error('useCustomerAuth must be used inside CustomerAuthProvider');
  return value;
}

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  setSessionScope('customer');
  const [status, setStatus] = useState<CustomerSessionStatus>('loading');
  const [session, setSession] = useState<CustomerPortalSession | null>(null);

  const loadSession = useCallback(async () => {
    if (!hasSession()) {
      setSession(null);
      setStatus('unauthenticated');
      return;
    }
    try {
      const current = await customerPortalApi.me();
      setSession(current);
      setStatus(current.account.mustChangePassword ? 'password-change' : 'authenticated');
    } catch {
      setSession(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => onSessionInvalid((reason) => {
    if (reason === 'password-change') setStatus('password-change');
    else { setSession(null); setStatus('unauthenticated'); }
  }), []);

  const login = useCallback(async (email: string, password: string) => {
    await customerPortalApi.login(email, password);
    await loadSession();
  }, [loadSession]);
  const logout = useCallback(async () => {
    await customerPortalApi.logout();
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(() => ({ status, session, login, logout, refresh: loadSession }), [status, session, login, logout, loadSession]);
  return <CustomerAuthContext.Provider value={value}>{children}</CustomerAuthContext.Provider>;
}
