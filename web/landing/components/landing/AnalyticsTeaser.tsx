import { Check, ArrowRight } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Sparkline } from "./Sparkline";
import { Reveal } from "./Reveal";

const BULLETS = [
  { label: "Clicks over time", body: "a soft daily curve, not a spreadsheet." },
  { label: "Top sources & countries", body: "see where your audience actually is." },
  { label: "Link health at a glance", body: "live, expiring, expired at a look." },
  { label: "Webview vs real browser", body: "the rescue breakdown, on every link." },
];

const TILES = [
  { value: "12,408", label: "clicks", color: "var(--text-heading)" },
  { value: "64%", label: "rescued", color: "var(--peri-600)" },
  { value: "41", label: "countries", color: "var(--text-heading)" },
];

const PREVIEW_LINKS = [
  { alias: "spring-drop", clicks: "4,821", badge: null as null | { tone: "warn"; label: string } },
  { alias: "rsvp", clicks: "932", badge: { tone: "warn" as const, label: "expiring" } },
];

export function AnalyticsTeaser() {
  return (
    <Section background="white" id="analytics" aria-labelledby="analytics-h">
      <div className="lp-analytics-grid">
        {/* Tilted dashboard preview */}
        <Reveal className="lp-analytics-preview-col">
          <Card tone="default" padding="md" className="lp-analytics-preview" style={{ boxShadow: "var(--shadow-xl)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-heading)", fontSize: "var(--text-sm)" }}>
                klipo.to/<span style={{ color: "var(--rose-600)" }}>spring-drop</span>
              </span>
              <Badge tone="live" dot size="sm">live</Badge>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
              {TILES.map((t) => (
                <div key={t.label} style={{ background: "var(--surface-sunken)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
                  <div style={{ fontFamily: "var(--font-number)", fontSize: "var(--text-lg)", fontWeight: 700, color: t.color, lineHeight: 1 }}>{t.value}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 3 }}>{t.label}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: "var(--space-4)" }}>
              <Sparkline data={[200, 268, 240, 326, 300, 384, 362, 444, 472, 520]} color="var(--rose-400)" height={48} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {PREVIEW_LINKS.map((l) => (
                <div key={l.alias} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-body)" }}>
                    klipo.to/<span style={{ color: "var(--rose-600)" }}>{l.alias}</span>
                  </span>
                  {l.badge && <Badge tone={l.badge.tone} dot size="sm">{l.badge.label}</Badge>}
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font-number)", color: "var(--text-muted)" }}>{l.clicks}</span>
                </div>
              ))}
            </div>
          </Card>
        </Reveal>

        {/* Copy + bullets */}
        <div className="lp-analytics-copy">
          <div className="klip-eyebrow" style={{ marginBottom: "var(--space-3)" }}>Clean, calm analytics</div>
          <h2 id="analytics-h" className="lp-h2" style={{ marginBottom: "var(--space-4)" }}>
            All your clicks,{" "}
            <em style={{ fontStyle: "italic", fontWeight: 500, color: "var(--rose-600)" }}>in bloom</em>{" "}
            — none of the clutter.
          </h2>
          <p style={{ fontSize: "var(--text-md)", color: "var(--text-muted)", maxWidth: 460, marginBottom: "var(--space-6)" }}>
            A dashboard that&apos;s actually nice to look at, with privacy-respecting numbers you&apos;ll read. See
            where clicks come from, when they peak, and which links are thriving — no data-science degree required.
          </p>

          <div className="lp-analytics-bullets" style={{ marginBottom: "var(--space-6)" }}>
            {BULLETS.map((b) => (
              <div key={b.label} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
                <span style={{ display: "inline-flex", width: 22, height: 22, flex: "none", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "var(--lavender-100)", marginTop: 1 }}>
                  <Icon icon={Check} size={13} color="var(--lavender-600)" />
                </span>
                <span style={{ fontSize: "var(--text-base)", color: "var(--text-body)" }}>
                  <strong style={{ color: "var(--text-heading)" }}>{b.label}</strong> — {b.body}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-6)" }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>link health:</span>
            <Badge tone="live" dot>live</Badge>
            <Badge tone="warn" dot>expiring</Badge>
            <Badge tone="expired" dot>expired</Badge>
          </div>

          <a href="#cta">
            <Button variant="secondary" iconRight={<Icon icon={ArrowRight} size={16} color="var(--lavender-700)" />}>
              peek at a live dashboard
            </Button>
          </a>
        </div>
      </div>
    </Section>
  );
}
