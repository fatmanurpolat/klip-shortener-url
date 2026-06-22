import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { logout as apiLogout, probeSession, verifyToken } from "@/lib/api";

/**
 * Auth state for the dashboard, built on the backend's magic-link flow.
 *
 * The session lives in an HttpOnly cookie (set by GET /api/v1/auth/verify), so
 * JS can't read it; we instead PROBE the session by calling a real authed
 * endpoint on load. The signed-in email isn't returned by any endpoint, so we
 * remember it in localStorage (purely for the sidebar's name/avatar) when the
 * user signs in, and clear it on logout.
 */

interface AuthState {
  status: "loading" | "authed" | "anon" | "error";
  email: string | null;
  /** Complete sign-in from a magic-link token (sets cookie server-side). */
  completeSignIn: (token: string, email?: string) => Promise<void>;
  /** Mark the email we'll show in the shell (called when requesting a login). */
  rememberEmail: (email: string) => void;
  /** Re-run the session probe after a transient boot failure. */
  retry: () => void;
  signOut: () => Promise<void>;
}

const EMAIL_KEY = "klipo.email";

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [email, setEmail] = useState<string | null>(() => {
    try {
      return localStorage.getItem(EMAIL_KEY);
    } catch {
      return null;
    }
  });

  // Bumping this re-runs the boot effect (used by retry()).
  const [bootKey, setBootKey] = useState(0);

  // On load: if the URL carries a magic-link token, complete sign-in; otherwise
  // probe the cookie session. A genuine 401 → "anon"; a transient failure
  // (network / 5xx) → "error" so we don't masquerade a blip as "signed out".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      if (token) {
        try {
          await verifyToken(token);
          // Strip the token from the URL so a refresh/copy doesn't replay it.
          params.delete("token");
          const clean = window.location.pathname + (params.toString() ? `?${params}` : "") + window.location.hash;
          window.history.replaceState({}, "", clean);
          if (!cancelled) setStatus("authed");
          return;
        } catch {
          /* token invalid/expired → fall through to a normal session probe */
        }
      }
      try {
        const ok = await probeSession(); // false only on a real 401
        if (!cancelled) setStatus(ok ? "authed" : "anon");
      } catch {
        if (!cancelled) setStatus("error"); // network / 5xx → recoverable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootKey]);

  const retry = useCallback(() => setBootKey((k) => k + 1), []);

  const rememberEmail = useCallback((next: string) => {
    setEmail(next);
    try {
      localStorage.setItem(EMAIL_KEY, next);
    } catch {
      /* storage unavailable — name just falls back in the shell */
    }
  }, []);

  const completeSignIn = useCallback(
    async (token: string, nextEmail?: string) => {
      await verifyToken(token);
      if (nextEmail) rememberEmail(nextEmail);
      setStatus("authed");
    },
    [rememberEmail],
  );

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      try {
        localStorage.removeItem(EMAIL_KEY);
      } catch {
        /* ignore */
      }
      setEmail(null);
      setStatus("anon");
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, email, completeSignIn, rememberEmail, retry, signOut }),
    [status, email, completeSignIn, rememberEmail, retry, signOut],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

/** Derive a display name + initials from an email (no profile endpoint exists). */
export function displayFromEmail(email: string | null): { name: string; email: string } {
  if (!email) return { name: "Your account", email: "" };
  const handle = email.split("@")[0] ?? email;
  const name = handle
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
  return { name: name || email, email };
}
