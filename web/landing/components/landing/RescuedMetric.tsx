import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RescuedBar } from "./RescuedBar";
import { Sparkline } from "./Sparkline";
import { CountUp } from "./CountUp";
import { Reveal } from "./Reveal";

const DAILY = [120, 160, 138, 210, 188, 262, 240, 305, 286, 344, 368, 420];

export function RescuedMetric() {
  return (
    <Section background="petal" id="rescued" style={{ color: "var(--text-on-primary)" }} aria-labelledby="rescued-h">
      <div className="lp-rescued-grid">
        {/* Left — the claim + giant numeral */}
        <div>
          <div className="klipo-eyebrow" style={{ color: "rgba(255,255,255,0.85)", marginBottom: "var(--space-3)" }}>
            The metric only Klipo has
          </div>
          <h2 id="rescued-h" className="lp-h2" style={{ color: "var(--text-on-accent)", marginBottom: "var(--space-4)" }}>
            See exactly how many visitors you{" "}
            <em style={{ fontStyle: "italic", fontWeight: 500 }}>rescued</em>.
          </h2>
          <p style={{ fontSize: "var(--text-md)", color: "rgba(255,255,255,0.88)", maxWidth: 460, marginBottom: "var(--space-8)" }}>
            Every other shortener tells you clicks. Klipo tells you which clicks were trapped in a webview and which
            made it to a real browser — because that&apos;s the gap between a bounce and a sale.
          </p>

          <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-5)", flexWrap: "wrap" }}>
            <span className="lp-numeral-giant" style={{ fontFamily: "var(--font-number)", fontWeight: 700, color: "var(--text-on-accent)" }}>
              <CountUp to={64} suffix="%" format={false} />
            </span>
            <p
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "var(--text-lg)",
                color: "rgba(255,255,255,0.92)",
                maxWidth: 280,
                margin: 0,
              }}
            >
              of clicks arrived inside an in-app browser — and Klipo set them free.
            </p>
          </div>
        </div>

        {/* Right — glass rescue chart */}
        <Reveal delay={60}>
          <Card tone="glass" padding="lg">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: "var(--space-5)" }}>
              <h3 style={{ fontSize: "var(--text-lg)" }}>Webview vs real browser</h3>
              <Badge tone="info" dot>last 30 days</Badge>
            </div>

            <RescuedBar pct={64} />

            <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
              <LegendStat color="var(--peri-500)" value="5,544" label="set free" />
              <LegendStat color="var(--sage-500)" value="3,117" label="already in a real browser" align="right" />
            </div>

            <div style={{ marginTop: "var(--space-6)", paddingTop: "var(--space-5)", borderTop: "1px solid var(--border-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", fontWeight: 500 }}>rescues, daily</span>
                <Badge tone="info">+18% vs last month</Badge>
              </div>
              <Sparkline data={DAILY} color="var(--peri-500)" height={52} />
            </div>
          </Card>
        </Reveal>
      </div>
    </Section>
  );
}

function LegendStat({
  color,
  value,
  label,
  align = "left",
}: {
  color: string;
  value: string;
  label: string;
  align?: "left" | "right";
}) {
  return (
    <div style={{ textAlign: align, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flex: "none" }} />
        <span style={{ fontFamily: "var(--font-number)", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-heading)" }}>{value}</span>
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-body)", marginTop: 2 }}>{label}</div>
    </div>
  );
}
