import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowDownRight, Copy, Check, MousePointerClick, Users, ShieldCheck,
  Smartphone, Globe, AlertCircle, Info,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/Toast";
import {
  getStats, deriveStatus, SHORT_DOMAIN, ApiError,
  type LinkItem, type LinkStatus, type StatsResponse,
} from "@/lib/api";

const STATUS_BADGE: Record<LinkStatus, { tone: "live" | "warn" | "expired"; label: string; dot: boolean }> = {
  live: { tone: "live", label: "Live", dot: true },
  expiring: { tone: "warn", label: "Expiring", dot: true },
  expired: { tone: "expired", label: "Expired", dot: false },
};

export function LinkStats({ link, onBack }: { link: LinkItem; onBack: () => void }) {
  const toast = useToast();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(null);
    (async () => {
      try {
        const s = await getStats(link.code);
        if (!cancelled) setStats(s);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load this link's stats.");
      }
    })();
    return () => { cancelled = true; };
  }, [link.code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.shortUrl);
      setCopied(true);
      toast("Link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Press ⌘C to copy");
    }
  }

  const st = STATUS_BADGE[deriveStatus(link.expiresAt)];

  return (
    <div className="kd-page">
      {/* Back */}
      <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "var(--text-sm)", fontWeight: 600, fontFamily: "var(--font-body)", marginBottom: 16, padding: 0 }}>
        <Icon icon={ArrowLeft} size={16} color="var(--text-muted)" /> All links
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 26 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-heading)" }}>
              {SHORT_DOMAIN}/<span style={{ color: "var(--rose-600)" }}>{link.code}</span>
            </h1>
            <Badge tone={st.tone} dot={st.dot}>{st.label}</Badge>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: "var(--text-sm)", minWidth: 0 }}>
            <Icon icon={ArrowDownRight} size={14} color="var(--text-faint)" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link.longUrl}</span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={copy} iconLeft={<Icon icon={copied ? Check : Copy} size={15} color={copied ? "var(--sage-500)" : "var(--text-muted)"} />}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {error ? (
        <Card tone="default" padding="xl" style={{ textAlign: "center" }}>
          <div style={{ display: "inline-flex", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "var(--blush-100)", marginBottom: 16 }}>
            <Icon icon={AlertCircle} size={24} color="var(--blush-700)" />
          </div>
          <h2 style={{ fontSize: "var(--text-xl)", marginBottom: 8 }}>We couldn&apos;t load these stats</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: 20 }}>{error}</p>
          <Button variant="ghost" onClick={onBack}>Back to links</Button>
        </Card>
      ) : stats === null ? (
        <StatsSkeleton />
      ) : stats.analytics === false ? (
        <NoAnalytics message={stats.message} />
      ) : (
        <StatsBody stats={stats} />
      )}
    </div>
  );
}

function StatsBody({ stats }: { stats: StatsResponse }) {
  const webview = stats.webviewVsNative?.webview ?? 0;
  const native = stats.webviewVsNative?.native ?? 0;
  const totalWv = webview + native;
  const rescuedPct = totalWv > 0 ? Math.round((webview / totalWv) * 100) : 0;

  const series = useMemo(() => (stats.byDay ?? []).map((d) => d.clicks), [stats.byDay]);
  const dayLabels = useMemo(() => (stats.byDay ?? []).map((d) => d.date), [stats.byDay]);

  const referrers = useMemo(() => toPercent(stats.topReferrers?.map((r) => ({ name: r.referrer || "Direct / unknown", value: r.clicks }))), [stats.topReferrers]);
  const devices = useMemo(() => toPercent(stats.byDevice?.map((d) => ({ name: d.device || "Unknown", value: d.clicks }))), [stats.byDevice]);

  const [barShown, setBarShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setBarShown(rescuedPct), 120);
    return () => clearTimeout(t);
  }, [rescuedPct]);

  return (
    <>
      {/* Webview vs real device — quick pill */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 14, background: "var(--lavender-50)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius-pill)", padding: "8px 16px", marginBottom: 16 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--text-sm)", color: "var(--text-body)" }}>
          <Icon icon={Smartphone} size={14} color="var(--peri-500)" />
          Webview <strong style={{ fontFamily: "var(--font-number)", color: "var(--peri-600)" }}>{rescuedPct}%</strong>
        </span>
        <span style={{ width: 1, height: 16, background: "var(--border-soft)" }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--text-sm)", color: "var(--text-body)" }}>
          <Icon icon={Globe} size={14} color="var(--text-muted)" />
          Real device <strong style={{ fontFamily: "var(--font-number)", color: "var(--text-muted)" }}>{100 - rescuedPct}%</strong>
        </span>
      </div>

      {/* Stat tiles */}
      <div className="kd-stat-tiles">
        <StatTile label="Total clicks" value={stats.totalClicks ?? 0} tone="rose" icon={MousePointerClick} />
        <StatTile label="Unique visitors" value={stats.uniqueClicks ?? 0} tone="lavender" icon={Users} />
        <StatTile label="Rescued from webviews" value={webview} sub={totalWv > 0 ? `${rescuedPct}% of clicks` : undefined} tone="peri" icon={ShieldCheck} />
      </div>

      {/* Clicks over time */}
      <Card tone="default" padding="lg" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
          <h3 style={{ fontSize: "var(--text-lg)" }}>Clicks over time</h3>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--rose-500)" }} /> Clicks
          </span>
        </div>
        {series.length >= 2 ? (
          <AreaChart series={series} labels={dayLabels} />
        ) : (
          <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            Not enough clicks yet to draw a curve — check back soon.
          </div>
        )}
      </Card>

      {/* Webview vs Real Browser — the signature */}
      <Card tone="default" padding="lg" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ width: 40, height: 40, flex: "none", borderRadius: "var(--radius-md)", background: "var(--peri-100)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon icon={ShieldCheck} size={20} color="var(--peri-600)" />
          </span>
          <div>
            <h3 style={{ fontSize: "var(--text-lg)" }}>Webview vs Real Browser</h3>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              <strong style={{ fontFamily: "var(--font-number)", color: "var(--peri-600)" }}>{webview.toLocaleString()}</strong> visitors escaped to Chrome / Safari
            </div>
          </div>
        </div>
        <div style={{ display: "flex", height: 16, borderRadius: "var(--radius-pill)", overflow: "hidden", background: "var(--cream-200)" }} role="img" aria-label={`${rescuedPct}% of clicks rescued from in-app browsers`}>
          <div style={{ width: `${barShown}%`, background: "var(--wash-petal)", transition: "width 900ms var(--ease-out)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          <span><strong style={{ fontFamily: "var(--font-number)", color: "var(--peri-600)" }}>{rescuedPct}%</strong> rescued from webviews</span>
          <span>{100 - rescuedPct}% real browser</span>
        </div>

        {stats.webviewByNetwork && stats.webviewByNetwork.length > 0 && (
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {stats.webviewByNetwork.map((wv) => (
              <div key={wv.network} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", color: "var(--text-body)" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--lavender-500)" }} />
                <span style={{ textTransform: "capitalize" }}>{wv.network}</span>
                <strong style={{ fontFamily: "var(--font-number)" }}>{wv.clicks.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Referrers + devices */}
      <Card tone="default" padding="lg">
        <div className="kd-two-col">
          <div>
            <h3 style={{ fontSize: "var(--text-lg)", marginBottom: 18 }}>Top referrers</h3>
            {referrers.length > 0 ? <BarList items={referrers} tones={["rose", "lavender", "peri", "honey", "sage"]} /> : <Empty />}
          </div>
          <div className="kd-divider" />
          <div>
            <h3 style={{ fontSize: "var(--text-lg)", marginBottom: 18 }}>Devices</h3>
            {devices.length > 0 ? <BarList items={devices} tones={["peri", "lavender", "rose", "honey", "sage"]} /> : <Empty />}
          </div>
        </div>
      </Card>
    </>
  );
}

function Empty() {
  return <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No data yet.</div>;
}

function toPercent(items?: { name: string; value: number }[]): { name: string; value: number }[] {
  if (!items || items.length === 0) return [];
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return items
    .slice(0, 5)
    .map((i) => ({ name: i.name, value: Math.round((i.value / total) * 100) }));
}

function StatTile({
  label, value, sub, tone, icon,
}: {
  label: string; value: number; sub?: string; tone: "rose" | "lavender" | "peri"; icon: typeof Users;
}) {
  return (
    <Card tone="default" padding="md" style={{ flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon icon={icon} size={16} color={`var(--${tone}-500)`} />
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontFamily: "var(--font-number)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-heading)" }}>{value.toLocaleString()}</div>
      {sub && <div style={{ fontSize: "var(--text-xs)", color: "var(--peri-600)", marginTop: 2, fontWeight: 600 }}>{sub}</div>}
    </Card>
  );
}

function BarList({ items, tones }: { items: { name: string; value: number }[]; tones: string[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {items.map((it, i) => (
        <div key={it.name}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-body)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{it.name}</span>
            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-number)" }}>{it.value}%</span>
          </div>
          <div style={{ height: 8, background: "var(--cream-200)", borderRadius: "var(--radius-pill)", overflow: "hidden" }}>
            <div style={{ width: `${(it.value / max) * 100}%`, height: "100%", background: `var(--${tones[i % tones.length]}-400)`, borderRadius: "var(--radius-pill)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Area chart for the daily click series.
function AreaChart({ series, labels, w = 660, h = 220 }: { series: number[]; labels: string[]; w?: number; h?: number }) {
  const max = Math.max(...series, 1) * 1.1;
  const padB = 26;
  const innerH = h - padB;
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const pts = series.map((v, i) => [i * step, innerH - (v / max) * (innerH - 8)] as const);
  const line = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${line} L${w},${innerH} L0,${innerH} Z`;
  const lastIdx = series.length - 1;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="kd-clk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--rose-400)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--rose-400)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1="0" x2={w} y1={innerH - g * (innerH - 8)} y2={innerH - g * (innerH - 8)} stroke="var(--border-soft)" strokeWidth="1" strokeDasharray="2 4" />
      ))}
      <path d={area} fill="url(#kd-clk)" />
      <path d={line} fill="none" stroke="var(--rose-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) =>
        i === 0 || i === lastIdx ? (
          <text key={i} x={p[0]} y={h - 6} fontSize="11" fontFamily="var(--font-body)" fill="var(--text-faint)" textAnchor={i === lastIdx ? "end" : "start"}>
            {labels[i]?.slice(5) ?? ""}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function StatsSkeleton() {
  return (
    <div>
      <div className="kd-stat-tiles">
        {[0, 1, 2].map((i) => (
          <Card key={i} tone="default" padding="md" style={{ flex: 1 }}>
            <div className="klipo-skeleton" style={{ height: 14, width: "55%", marginBottom: 12 }} />
            <div className="klipo-skeleton" style={{ height: 26, width: "40%" }} />
          </Card>
        ))}
      </div>
      <Card tone="default" padding="lg" style={{ marginTop: 16 }}>
        <div className="klipo-skeleton" style={{ height: 200, width: "100%", borderRadius: "var(--radius-md)" }} />
      </Card>
    </div>
  );
}

function NoAnalytics({ message }: { message?: string }) {
  return (
    <Card tone="lavender" padding="xl" style={{ textAlign: "center" }}>
      <div style={{ display: "inline-flex", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "var(--white)", marginBottom: 16, boxShadow: "var(--shadow-sm)" }}>
        <Icon icon={Info} size={22} color="var(--lavender-600)" />
      </div>
      <h2 style={{ fontSize: "var(--text-xl)", marginBottom: 8 }}>Analytics are off for this link</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-base)", maxWidth: 440, margin: "0 auto" }}>
        {message ??
          "This link uses fast 301 redirects, so clicks skip our servers and aren't counted. Turn analytics on when creating a link to see its stats."}
      </p>
    </Card>
  );
}
