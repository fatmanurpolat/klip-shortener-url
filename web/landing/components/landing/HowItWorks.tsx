import { Scissors, Radar, DoorOpen } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Reveal } from "./Reveal";

const STEPS = [
  {
    n: "01",
    icon: Scissors,
    label: "You shorten.",
    body: "Paste any link; we give you a tidy klipo.to link with escape switched on by default.",
    chip: "klipo.to/spring-drop",
  },
  {
    n: "02",
    icon: Radar,
    label: "We detect the cage.",
    body: "When it opens inside an in-app browser, Klipo spots the webview in milliseconds from signals like Instagram, FBAN/FBAV and TikTok in the request.",
    chip: "User-Agent: …Instagram 309.1.0…",
  },
  {
    n: "03",
    icon: DoorOpen,
    label: "They break free.",
    body: "The visitor lands in their real browser — logged in, cookies intact, pixels firing. Can’t escape? We show a gentle “tap to open in your browser” nudge, so nobody hits a dead end.",
    chip: "intent://…#Intent;scheme=https;end",
    live: true,
  },
];

export function HowItWorks() {
  return (
    <section
      id="how"
      aria-labelledby="how-h"
      style={{ position: "relative", paddingBlock: "var(--space-24)", background: "var(--surface-app)" }}
    >
      <div style={{ maxWidth: "var(--width-content)", marginInline: "auto", width: "100%", paddingInline: "var(--space-6)" }}>
        <div className="lp-how-grid">
          {/* Sticky header */}
          <div className="lp-how-header">
            <div className="klip-eyebrow" style={{ color: "var(--lavender-600)", marginBottom: "var(--space-3)" }}>
              The Klipo escape
            </div>
            <h2 className="lp-h2" style={{ marginBottom: "var(--space-4)" }}>
              We hand your visitor back to their{" "}
              <em style={{ fontStyle: "italic", fontWeight: 500, color: "var(--lavender-600)" }}>real browser</em>{" "}
              — automatically.
            </h2>
            <p style={{ fontSize: "var(--text-md)", color: "var(--text-muted)", maxWidth: 360 }}>
              No app to install, nothing for your visitor to tap. The moment your Klipo link opens inside a webview,
              we detect it and bounce them to Chrome or Safari, carrying the destination with them.
            </p>
          </div>

          {/* Timeline */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "var(--space-5)", paddingLeft: 8 }}>
            <div
              aria-hidden
              style={{ position: "absolute", left: 19, top: 12, bottom: 12, width: 2, backgroundImage: "var(--wash-petal)", opacity: 0.45, borderRadius: 2 }}
            />
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: 15,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--rose-400)",
                boxShadow: "var(--glow-rose)",
                animation: "lpTravel 4.5s var(--ease-in-out) infinite",
              }}
            />

            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 90} style={{ marginLeft: 40 }}>
                <Card tone="lavender" interactive padding="md">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: 10 }}>
                    <Badge tone="lavender" style={{ fontFamily: "var(--font-number)" }}>{s.n}</Badge>
                    <span style={{ display: "inline-flex", width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-sm)", background: "var(--lavender-100)" }}>
                      <Icon icon={s.icon} size={17} color="var(--lavender-600)" />
                    </span>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-md)", fontWeight: 700, color: "var(--text-heading)" }}>
                      {s.label}
                    </span>
                    {s.live && (
                      <span style={{ marginLeft: "auto" }}>
                        <Badge tone="live" dot>live</Badge>
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-body)", margin: "0 0 12px" }}>{s.body}</p>
                  <span className="lp-step-chip">{s.chip}</span>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
