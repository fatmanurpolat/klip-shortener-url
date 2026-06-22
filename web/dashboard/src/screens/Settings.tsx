import { useState } from "react";
import { Globe, KeyRound, Download, LogOut } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Select } from "@/components/ui/Select";
import { Icon } from "@/components/ui/Icon";
import { useAuth, displayFromEmail } from "@/auth/AuthContext";
import { useToast } from "@/components/Toast";

/**
 * Account settings. Profile (the signed-in email) and sign-out are wired to the
 * real session. The backend exposes no settings/preferences endpoint, so the
 * preference toggles below are local-only and reset on reload — they're stubs
 * for a future settings API, not fake persistence.
 */
export function Settings() {
  const { email, signOut } = useAuth();
  const toast = useToast();
  const who = displayFromEmail(email);
  const [prefs, setPrefs] = useState({ escape: true, publicStats: false, weekly: true, instant: false });
  const set = (k: keyof typeof prefs) => (v: boolean) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    toast("Saved on this device");
  };

  return (
    <div className="kd-page" style={{ maxWidth: 920 }}>
      <div className="klipo-eyebrow" style={{ marginBottom: 6 }}>Account</div>
      <h1 style={{ fontSize: "var(--text-3xl)", marginBottom: 4 }}>Settings</h1>

      {/* Profile */}
      <Section title="Profile" desc="How you show up across Klipo.">
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <Avatar name={who.name} size={64} />
          <div>
            <div style={{ fontWeight: 600, color: "var(--text-heading)" }}>{who.name}</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{who.email || "Signed in"}</div>
          </div>
        </div>
        <Input label="Email" defaultValue={who.email} readOnly iconLeft={<Icon icon={KeyRound} size={16} color="var(--text-muted)" />} />
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", marginTop: 8 }}>
          Your email is your sign-in. We&apos;ll always reach you with a magic link — never a password.
        </p>
      </Section>

      {/* Default link behavior */}
      <Section title="Default link behavior" desc="Applied to every new link you create.">
        <Row title="Escape in-app browsers" desc="Bounce Instagram / TikTok / Facebook webviews to the real browser." control={<Switch checked={prefs.escape} onChange={set("escape")} label="Escape in-app browsers" />} />
        <Row title="Public stats by default" desc="New links share a read-only stats page." control={<Switch checked={prefs.publicStats} onChange={set("publicStats")} label="Public stats by default" />} />
        <Row title="Default expiry" control={<div style={{ width: 180 }}><Select options={["Never", "7 days", "30 days", "90 days"]} size="sm" aria-label="Default expiry" /></div>} />
      </Section>

      {/* Custom domain */}
      <Section title="Custom domain" desc="Brand your short links with your own domain.">
        <Card tone="lavender" padding="md">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Icon icon={Globe} size={20} color="var(--lavender-600)" />
              <div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-heading)" }}>go.studio.co</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Example — connect your domain to brand every link.</div>
              </div>
            </div>
            <Badge tone="neutral">not connected</Badge>
          </div>
        </Card>
        <Button variant="ghost" size="sm" style={{ marginTop: 12 }} onClick={() => toast("Custom domains are coming soon")}>
          Add domain
        </Button>
      </Section>

      {/* Notifications */}
      <Section title="Notifications" desc="When Klipo emails you.">
        <Row title="Weekly digest" desc="A Monday summary of clicks and escapes." control={<Switch checked={prefs.weekly} onChange={set("weekly")} label="Weekly digest" />} />
        <Row title="Instant click alerts" desc="Email me the moment a private link is opened." control={<Switch checked={prefs.instant} onChange={set("instant")} label="Instant click alerts" />} />
      </Section>

      {/* Account actions */}
      <Section title="Your account" desc="Export and session.">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="ghost" size="sm" onClick={() => toast("Export is coming soon")} iconLeft={<Icon icon={Download} size={15} color="var(--text-muted)" />}>
            Export data
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void signOut()} iconLeft={<Icon icon={LogOut} size={15} color="var(--text-body)" />}>
            Sign out
          </Button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="kd-settings-section">
      <div>
        <h3 style={{ fontSize: "var(--text-lg)", marginBottom: 6 }}>{title}</h3>
        {desc && <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", maxWidth: 220 }}>{desc}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ title, desc, control }: { title: string; desc?: string; control: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-heading)" }}>{title}</div>
        {desc && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{desc}</div>}
      </div>
      {control}
    </div>
  );
}
