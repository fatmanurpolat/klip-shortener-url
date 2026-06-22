import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Search, MousePointerClick, Link2, ShieldCheck, Copy, Check, Lock,
  ArrowDownRight, BarChart3, Trash2, AlertCircle, Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/Toast";
import {
  listLinks, deleteLink, deriveStatus, relativeTime, SHORT_DOMAIN, ApiError,
  type LinkItem, type LinkStatus,
} from "@/lib/api";

type Filter = "all" | "live" | "expired";

const STATUS_BADGE: Record<LinkStatus, { tone: "live" | "warn" | "expired"; label: string; dot: boolean }> = {
  live: { tone: "live", label: "Live", dot: true },
  expiring: { tone: "warn", label: "Expiring", dot: true },
  expired: { tone: "expired", label: "Expired", dot: false },
};

export function Dashboard({ onOpenLink, onCreate }: { onOpenLink: (link: LinkItem) => void; onCreate: () => void }) {
  const toast = useToast();
  const [links, setLinks] = useState<LinkItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLinks(null);
    try {
      const page = await listLinks({ limit: 50 });
      setLinks(page.links);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong loading your links.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listLinks({ limit: 50, cursor: nextCursor });
      setLinks((prev) => [...(prev ?? []), ...page.links]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't load more links.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function copy(link: LinkItem) {
    try {
      await navigator.clipboard.writeText(link.shortUrl);
      setCopiedCode(link.code);
      toast("Link copied");
      setTimeout(() => setCopiedCode((c) => (c === link.code ? null : c)), 1500);
    } catch {
      toast("Press ⌘C to copy");
    }
  }

  async function remove(link: LinkItem) {
    const ok = window.confirm(`Delete klipo.to/${link.code}? This can't be undone.`);
    if (!ok) return;
    const prev = links;
    setLinks((cur) => (cur ?? []).filter((l) => l.code !== link.code)); // optimistic
    try {
      await deleteLink(link.code);
      toast("Link deleted");
    } catch (err) {
      setLinks(prev); // rollback
      toast(err instanceof ApiError ? err.message : "Couldn't delete that link.");
    }
  }

  const filtered = useMemo(() => {
    if (!links) return [];
    return links.filter((l) => {
      const matchQ = !q || l.code.includes(q) || l.longUrl.toLowerCase().includes(q.toLowerCase());
      const status = deriveStatus(l.expiresAt);
      const matchF =
        filter === "all" || (filter === "live" && status !== "expired") || (filter === "expired" && status === "expired");
      return matchQ && matchF;
    });
  }, [links, q, filter]);

  const totalClicks = useMemo(() => (links ?? []).reduce((s, l) => s + l.clicks, 0), [links]);
  const activeCount = useMemo(() => (links ?? []).filter((l) => deriveStatus(l.expiresAt) !== "expired").length, [links]);

  return (
    <div className="kd-page">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="klipo-eyebrow" style={{ marginBottom: 6 }}>Your links</div>
          <h1 style={{ fontSize: "var(--text-3xl)" }}>Links</h1>
        </div>
        <Button variant="primary" onClick={onCreate} style={{ background: "var(--brand-create)", boxShadow: "var(--glow-create)" }} iconLeft={<Icon icon={Plus} size={16} color="#fff" />}>
          New link
        </Button>
      </div>

      {/* Stat strip */}
      <div className="kd-stat-strip">
        {/* The list endpoint offers no account-wide totals; when more pages exist
            these sums are page-scoped, so a "+" signals "at least this many". */}
        <StatTile label="Total clicks" value={links === null ? null : totalClicks} suffix={nextCursor ? "+" : ""} icon={MousePointerClick} tone="rose" />
        <StatTile label="Active links" value={links === null ? null : activeCount} suffix={nextCursor ? "+" : ""} icon={Link2} tone="lavender" />
        <StatTile label="Links" value={links === null ? null : links.length} suffix={nextCursor ? "+" : ""} icon={ShieldCheck} tone="peri" />
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, maxWidth: 320, minWidth: 200 }}>
          <Input placeholder="Search links…" value={q} onChange={(e) => setQ(e.target.value)} size="sm" iconLeft={<Icon icon={Search} size={16} color="var(--text-muted)" />} />
        </div>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto", background: "var(--cream-200)", padding: 4, borderRadius: "var(--radius-md)" }}>
          {(["all", "live", "expired"] as Filter[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                border: "none",
                cursor: "pointer",
                padding: "6px 14px",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--font-body)",
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                background: filter === k ? "var(--white)" : "transparent",
                color: filter === k ? "var(--text-heading)" : "var(--text-muted)",
                boxShadow: filter === k ? "var(--shadow-xs)" : "none",
                textTransform: "capitalize",
              }}
            >
              {k === "all" ? "All" : k === "live" ? "Active" : "Expired"}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : links === null ? (
        <SkeletonList />
      ) : filtered.length === 0 ? (
        <EmptyState hasLinks={links.length > 0} query={q} onCreate={onCreate} />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map((l) => (
              <LinkRow
                key={l.code}
                link={l}
                copied={copiedCode === l.code}
                onOpen={() => onOpenLink(l)}
                onCopy={() => void copy(l)}
                onDelete={() => void remove(l)}
              />
            ))}
          </div>
          {nextCursor && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <Button variant="ghost" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "loading…" : "Load more links"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  suffix = "",
  icon,
  tone,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  icon: typeof Link2;
  tone: "rose" | "lavender" | "peri";
}) {
  return (
    <Card tone="default" padding="md">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", justifyContent: "center", background: `var(--${tone}-100)` }}>
          <Icon icon={icon} size={18} color={`var(--${tone}-600)`} />
        </span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
      </div>
      {value === null ? (
        <div className="klipo-skeleton" style={{ height: 28, width: 90 }} />
      ) : (
        <div style={{ fontFamily: "var(--font-number)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-heading)" }}>
          {value.toLocaleString()}
          {suffix}
        </div>
      )}
    </Card>
  );
}

function LinkRow({
  link,
  copied,
  onOpen,
  onCopy,
  onDelete,
}: {
  link: LinkItem;
  copied: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const status = deriveStatus(link.expiresAt);
  const st = STATUS_BADGE[status];
  const dim = status === "expired";

  return (
    <Card tone="default" padding="none" style={{ padding: "16px 20px", opacity: dim ? 0.72 : 1 }}>
      <div className="kd-link-row">
        {/* alias + dest */}
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <button
            type="button"
            onClick={onOpen}
            style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", maxWidth: "100%" }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {SHORT_DOMAIN}/<span style={{ color: "var(--rose-600)" }}>{link.code}</span>
            </span>
            <Badge tone={st.tone} dot={st.dot} size="sm">{st.label}</Badge>
            {link.private && <Icon icon={Lock} size={13} color="var(--text-faint)" />}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: "var(--text-sm)", minWidth: 0 }}>
            <Icon icon={ArrowDownRight} size={14} color="var(--text-faint)" />
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{link.longUrl}</span>
            <span style={{ color: "var(--text-faint)", whiteSpace: "nowrap" }}>· {relativeTime(link.createdAt)}</span>
          </div>
        </div>

        {/* clicks */}
        <div className="kd-link-row-metric" style={{ flex: "none", width: 92, textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-number)", fontSize: "var(--text-md)", fontWeight: 700, color: "var(--text-heading)" }}>
            {link.clicks.toLocaleString()}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>clicks</div>
        </div>

        {/* analytics badge / actions */}
        <div className="kd-link-row-cols" style={{ display: "flex", gap: 6 }}>
          {link.analytics ? (
            <IconButton label="View stats" variant="ghost" onClick={onOpen}>
              <Icon icon={BarChart3} size={17} color="var(--text-muted)" />
            </IconButton>
          ) : (
            <Badge tone="neutral" size="sm" style={{ alignSelf: "center" }}>301 · no stats</Badge>
          )}
          <IconButton label={copied ? "Copied!" : "Copy link"} variant="ghost" onClick={onCopy}>
            <Icon icon={copied ? Check : Copy} size={17} color={copied ? "var(--sage-500)" : "var(--text-muted)"} />
          </IconButton>
          <IconButton label="Delete link" variant="ghost" onClick={onDelete}>
            <Icon icon={Trash2} size={17} color="var(--text-muted)" />
          </IconButton>
        </div>
      </div>
    </Card>
  );
}

function SkeletonList() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} tone="default" padding="none" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div className="klipo-skeleton" style={{ height: 16, width: "40%", marginBottom: 8 }} />
              <div className="klipo-skeleton" style={{ height: 12, width: "65%" }} />
            </div>
            <div className="klipo-skeleton" style={{ height: 28, width: 60 }} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ hasLinks, query, onCreate }: { hasLinks: boolean; query: string; onCreate: () => void }) {
  if (hasLinks) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
        No links match {query ? `“${query}”` : "this filter"}.
      </div>
    );
  }
  return (
    <Card tone="lavender" padding="xl" style={{ textAlign: "center" }}>
      <div style={{ display: "inline-flex", width: 56, height: 56, alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-lg)", background: "var(--white)", boxShadow: "var(--shadow-sm)", marginBottom: 18 }}>
        <Icon icon={Sparkles} size={26} color="var(--lavender-600)" />
      </div>
      <h2 style={{ fontSize: "var(--text-2xl)", marginBottom: 10 }}>No links yet — let&apos;s plant your first one</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-base)", maxWidth: 420, margin: "0 auto 22px" }}>
        Shorten a link and it&apos;ll escape in-app browsers automatically. Your clicks and rescues show up here.
      </p>
      <Button variant="primary" onClick={onCreate} iconLeft={<Icon icon={Plus} size={16} color="#fff" />}>
        Create your first link
      </Button>
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card tone="default" padding="xl" style={{ textAlign: "center" }}>
      <div style={{ display: "inline-flex", width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "var(--blush-100)", marginBottom: 16 }}>
        <Icon icon={AlertCircle} size={24} color="var(--blush-700)" />
      </div>
      <h2 style={{ fontSize: "var(--text-xl)", marginBottom: 8 }}>We couldn&apos;t load your links</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-base)", marginBottom: 20 }}>{message}</p>
      <Button variant="ghost" onClick={onRetry}>Try again</Button>
    </Card>
  );
}
