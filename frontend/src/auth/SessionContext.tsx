import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, setUnauthorizedHandler } from "../services/api";
import { forgetAccountKey } from "../services/crypto";
import type { MeResponse } from "../types/api";

export type Role = "admin" | "voter";

interface SessionState {
  /** Null until the initial /api/auth/me round trip resolves. */
  role: Role | null;
  subject: string | null;
  /** True during the first check, so the UI can avoid flashing the login screen. */
  checking: boolean;
  /**
   * Set when the session ended without the user asking. The shell shows it on the
   * sign-in form, because an expired session otherwise looks exactly like a page
   * that has stopped working.
   */
  expiredNotice: string | null;
  signInAsAdmin: (name: string, passphrase: string) => Promise<void>;
  signInAsAccount: (
    username: string,
    sign: (challenge: string) => string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  /** Called after a successful account login so callers can refresh their view. */
  refresh: () => Promise<void>;
  dismissExpiredNotice: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [role, setRole] = useState<Role | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null);

  const clear = useCallback(() => {
    forgetAccountKey();
    setRole(null);
    setSubject(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me: MeResponse = await api.me();
      setRole(me.signed_in ? (me.role ?? null) : null);
      setSubject(me.subject ?? null);
      // A successful check means the session is good, so a stale expiry notice
      // from the previous one should not still be on screen.
      setExpiredNotice(null);
    } catch {
      // A failed check means signed out rather than an error screen: the server
      // may simply not be running yet.
      clear();
    } finally {
      setChecking(false);
    }
  }, [clear]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A 401 from anywhere that is not a sign-in attempt. Registered once, through a
  // ref, so re-rendering the provider does not re-register on every render and
  // the handler never closes over a stale `clear`.
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearRef.current();
      setExpiredNotice("Your session expired. Sign in again to carry on.");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signInAsAdmin = useCallback(
    async (name: string, passphrase: string) => {
      await api.adminLogin({ name, passphrase });
      await refresh();
    },
    [refresh],
  );

  const signInAsAccount = useCallback(
    async (username: string, sign: (challenge: string) => string) => {
      await api.accountLogin(username, sign);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    // The server may already have forgotten this session, which is the case the
    // handler above exists for. Losing that 401 must not stop the local sign-out.
    await api.logout().catch(() => undefined);
    // The key was only ever in this tab's memory. Leaving it behind would mean
    // signing out did not actually end the session.
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({
      role,
      subject,
      checking,
      expiredNotice,
      signInAsAdmin,
      signInAsAccount,
      signOut,
      refresh,
      dismissExpiredNotice: () => setExpiredNotice(null),
    }),
    [
      role,
      subject,
      checking,
      expiredNotice,
      signInAsAdmin,
      signInAsAccount,
      signOut,
      refresh,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
};

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (context === null) {
    throw new Error("useSession must be used inside a SessionProvider");
  }
  return context;
}
