import { useEffect, useRef, useState } from "react";
import { Link as LinkIcon, X, ShieldCheck, Sparkles, ChartLine, Lock, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/Toast";
import { shorten, ApiError, SHORT_DOMAIN, type ShortenResult } from "@/lib/api";

const EXPIRY_OPTIONS = ["Never", "24 hours", "7 days", "30 days"] as const;
type Expiry = (typeof EXPIRY_OPTIONS)[number];

/** Compute an ISO expiry from a friendly choice (future-dated, as the API requires). */
function expiryToIso(choice: Expiry): string | undefined {
  const hours: Record<Expiry, number> = { Never: 0, "24 hours": 24, "7 days": 24 * 7, "30 days": 24 * 30 };
  const h = hours[choice];
  if (!h) return undefined;
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
}

export function CreateLinkModal({ onClose, onCreated }: { onClose: () => void; onCreated: (link: ShortenResult) => void }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("Never");
  const [analytics, setAnalytics] = useState(true);
  const [priv, setPriv] = useState(false);
  const [status, setStatus] = useState<"idle" | "creating" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<ShortenResult | null>(null);
  const [copied, setCopied] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // Escape-to-close + focus trap (Tab/Shift+Tab cycle within the dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey && activeEl === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Restore focus to whatever opened the modal when it unmounts.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    return () => trigger?.focus?.();
  }, []);

  // On success the form is replaced by the result panel — move focus to it so
  // keyboard users land on the new short-link/copy controls.
  useEffect(() => {
    if (status === "done") resultRef.current?.focus();
  }, [status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setStatus("creating");
    setErrorMsg("");
    try {
      const link = await shorten({
        url: trimmed,
        customAlias: alias.trim() || undefined,
        expiresAt: expiryToIso(expiry),
        private: priv,
        analytics,
      });
      setResult(link);
      setStatus("done");
      onCreated(link);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : "Couldn't create that link — please try again.");
      setStatus("error");
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shortUrl);
      setCopied(true);
      toast("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Press ⌘C to copy");
    }
  }

  return (
    <div className="kd-modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="kd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kd-create-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header band */}
        <div style={{ backgroundImage: "linear-gradient(135deg, var(--lavender-600) 0%, var(--lavender-500) 45%, var(--peri-500) 100%)", padding: "22px 26px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "rgba(255,255,255,0.85)", fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>New short link</div>
            <h2 id="kd-create-title" style={{ color: "#fff", fontSize: "var(--text-2xl)", marginTop: 2 }}>
              {status === "done" ? "Your link is in bloom" : "Shorten a link"}
            </h2>
          </div>
          <IconButton label="Close" variant="quiet" onClick={onClose} style={{ background: "rgba(255,255,255,0.16)" }}>
            <Icon icon={X} size={20} color="#fff" />
          </IconButton>
        </div>

        {status === "done" && result ? (
          <div ref={resultRef} tabIndex={-1} style={{ padding: 26, outline: "none" }} role="status" aria-live="polite">
            <div style={{ background: "var(--rose-50)", border: "1px solid var(--rose-100)", borderRadius: "var(--radius-lg)", padding: "18px 20px", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <a href={result.shortUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--rose-600)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {result.shortUrl.replace(/^https?:\/\//, "")}
                </a>
                <Badge tone="info" dot>escape on</Badge>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="secondary" size="sm" onClick={copyResult} iconLeft={<Icon icon={copied ? Check : Copy} size={15} color="var(--lavender-700)" />}>
                  {copied ? "copied 🌸" : "copy the link"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => window.open(result.shortUrl, "_blank", "noopener")} iconLeft={<Icon icon={ExternalLink} size={15} color="var(--text-body)" />}>
                  open
                </Button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={{ padding: 26, display: "flex", flexDirection: "column", gap: 18 }}>
              <Input
                label="Destination URL"
                placeholder="https://your-shop.com/spring-sale"
                size="lg"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); if (status === "error") setStatus("idle"); }}
                required
                autoFocus
                error={status === "error" ? errorMsg : undefined}
                iconLeft={<Icon icon={LinkIcon} size={18} color="var(--text-muted)" />}
              />

              <Input
                label="Custom alias"
                prefix={`${SHORT_DOMAIN}/`}
                placeholder="spring-drop"
                value={alias}
                onChange={(e) => setAlias(e.target.value.replace(/\s/g, "-").toLowerCase())}
                hint="Leave blank for a random short code."
              />

              <Select label="Expires" options={[...EXPIRY_OPTIONS]} value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)} />

              {/* Toggles */}
              <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
                <ToggleRow icon={ChartLine} title="Click analytics" desc="Track clicks, referrers and webview escapes." checked={analytics} onChange={setAnalytics} />
                <div style={{ height: 1, background: "var(--border-soft)" }} />
                <ToggleRow icon={Lock} title="Private link" desc="Only you can see this link's stats." checked={priv} onChange={setPriv} />
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: "18px 26px", borderTop: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--cream-50)", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--peri-600)", fontSize: "var(--text-sm)", fontWeight: 600 }}>
                <Icon icon={ShieldCheck} size={16} color="var(--peri-500)" /> Webview escape is always on
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={status === "creating"} iconLeft={status === "creating" ? undefined : <Icon icon={Sparkles} size={16} color="#fff" />}>
                  {status === "creating" ? "creating…" : "Create link"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  onChange,
}: {
  icon: typeof Lock;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: "var(--white)" }}>
      <span style={{ width: 36, height: 36, flex: "none", borderRadius: "var(--radius-sm)", background: "var(--lavender-50)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon icon={icon} size={18} color="var(--lavender-600)" />
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-heading)" }}>{title}</div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{desc}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}
