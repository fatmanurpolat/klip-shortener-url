import type { ReactNode } from "react";
import { Link2, Settings as SettingsIcon, Plus, LogOut } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { useAuth, displayFromEmail } from "@/auth/AuthContext";

export type AppView = "dashboard" | "settings";

const NAV: { id: AppView; label: string; icon: typeof Link2 }[] = [
  { id: "dashboard", label: "Links", icon: Link2 },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell({
  active,
  onNavigate,
  onCreate,
  children,
}: {
  active: AppView;
  onNavigate: (v: AppView) => void;
  onCreate: () => void;
  children: ReactNode;
}) {
  const { email, signOut } = useAuth();
  const who = displayFromEmail(email);

  return (
    <div className="kd-shell">
      {/* Mobile top bar */}
      <header className="kd-topbar">
        <Logo size={24} />
        <nav className="kd-topnav" aria-label="Main">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={active === item.id ? "on" : ""}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <Button variant="primary" size="sm" onClick={onCreate} iconLeft={<Icon icon={Plus} size={15} color="#fff" />}>
          New
        </Button>
      </header>

      {/* Sidebar */}
      <aside className="kd-sidebar">
        <div style={{ padding: "4px 8px" }}>
          <Logo size={26} />
        </div>

        <Button
          variant="primary"
          fullWidth
          onClick={onCreate}
          style={{ background: "var(--brand-create)", boxShadow: "var(--glow-create)" }}
          iconLeft={<Icon icon={Plus} size={16} color="#fff" />}
        >
          New link
        </Button>

        <nav className="kd-nav" aria-label="Main">
          {NAV.map((item) => {
            const on = active === item.id;
            return (
              <button key={item.id} className={`kd-nav-item${on ? " on" : ""}`} onClick={() => onNavigate(item.id)} aria-current={on ? "page" : undefined}>
                <Icon icon={item.icon} size={18} color={on ? "var(--lavender-600)" : "var(--plum-500)"} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: 14, borderRadius: "var(--radius-lg)", background: "var(--lavender-50)", border: "1px solid var(--lavender-100)" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--lavender-700)", fontSize: "var(--text-md)" }}>
              Webview escapes
            </div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>
              Every Klipo link escapes in-app browsers by default. Open a link to see who you rescued.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px" }}>
            <Avatar name={who.name} size={34} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-heading)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {who.name}
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {who.email || "Signed in"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
              style={{ display: "inline-flex", padding: 6, border: "none", background: "transparent", cursor: "pointer", borderRadius: "var(--radius-sm)", color: "var(--text-muted)" }}
            >
              <Icon icon={LogOut} size={16} color="var(--text-muted)" />
            </button>
          </div>
        </div>
      </aside>

      <main className="kd-main">{children}</main>
    </div>
  );
}
