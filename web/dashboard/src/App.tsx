import { useState } from "react";
import { CloudOff } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { AppShell, type AppView } from "@/screens/AppShell";
import { Login } from "@/screens/Login";
import { Dashboard } from "@/screens/Dashboard";
import { LinkStats } from "@/screens/LinkStats";
import { Settings } from "@/screens/Settings";
import { CreateLinkModal } from "@/screens/CreateLinkModal";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import type { LinkItem, ShortenResult } from "@/lib/api";

/**
 * Top-level view orchestration. Auth gates the whole app: a loading splash while
 * the session is probed, the Login screen when anonymous, the shell otherwise.
 * Navigation is local state (no router) — simple and static-host friendly. A
 * `reloadKey` bump forces the Dashboard to refetch after a create.
 */
export function App() {
  const { status, retry } = useAuth();
  const [view, setView] = useState<AppView>("dashboard");
  const [statsLink, setStatsLink] = useState<LinkItem | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  if (status === "loading") {
    return (
      <div className="kd-center">
        <div className="kd-spinner" role="status" aria-label="Loading Klipo" />
      </div>
    );
  }

  if (status === "error") {
    return <BootError onRetry={retry} />;
  }

  if (status === "anon") {
    return <Login />;
  }

  const onCreated = (_link: ShortenResult) => {
    // Refetch the dashboard so the new link appears with server-truth fields.
    setReloadKey((k) => k + 1);
  };

  const navigate = (next: AppView) => {
    setStatsLink(null);
    setView(next);
  };

  let content;
  if (statsLink) {
    content = <LinkStats link={statsLink} onBack={() => setStatsLink(null)} />;
  } else if (view === "settings") {
    content = <Settings />;
  } else {
    content = <Dashboard key={reloadKey} onOpenLink={setStatsLink} onCreate={() => setModalOpen(true)} />;
  }

  return (
    <AppShell active={statsLink ? "dashboard" : view} onNavigate={navigate} onCreate={() => setModalOpen(true)}>
      {content}
      {modalOpen && <CreateLinkModal onClose={() => setModalOpen(false)} onCreated={onCreated} />}
    </AppShell>
  );
}

/** Shown when the boot session probe fails for a transient reason (not a 401). */
function BootError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="kd-center" style={{ padding: 24 }}>
      <Card tone="default" padding="xl" style={{ maxWidth: 420, textAlign: "center" }}>
        <Logo size={26} style={{ marginBottom: 20 }} />
        <div style={{ display: "inline-flex", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "var(--blush-100)", marginBottom: 16 }}>
          <Icon icon={CloudOff} size={24} color="var(--blush-700)" />
        </div>
        <h2 style={{ fontSize: "var(--text-xl)", marginBottom: 8 }}>We couldn&apos;t reach Klipo</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "var(--text-base)", marginBottom: 20 }}>
          Your connection dropped or our servers are catching their breath. Your session is safe — give it another try.
        </p>
        <Button variant="primary" onClick={onRetry}>Try again</Button>
      </Card>
    </div>
  );
}
