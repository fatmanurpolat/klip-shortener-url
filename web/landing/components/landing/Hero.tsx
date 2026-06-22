import { KeyRound, Lock, Server, Instagram, Chrome, ArrowDown } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { ShortenWidget } from "@/components/ShortenWidget";
import { CountUp } from "./CountUp";
import { Reveal } from "./Reveal";

const BULLETS = [
  { icon: KeyRound, label: "no passwords, ever" },
  { icon: Lock, label: "private links" },
  { icon: Server, label: "self-hostable" },
];

export function Hero() {
  return (
    <section id="hero" className="lp-hero klip-bloom-bg" aria-labelledby="hero-h">
      <div style={{ maxWidth: "var(--width-content)", marginInline: "auto", width: "100%", paddingInline: "var(--space-6)" }}>
        <div className="lp-hero-grid">
          {/* Left — pitch + working widget */}
          <div>
            <div className="klip-eyebrow" style={{ marginBottom: "var(--space-3)" }}>
              The link that breaks free
            </div>
            <h1 id="hero-h" className="lp-h1" style={{ marginBottom: "var(--space-4)" }}>
              Your links,{" "}
              <em style={{ fontStyle: "italic", fontWeight: 500, color: "var(--rose-600)" }}>set free</em>{" "}
              from in-app browsers.
            </h1>
            <p className="lp-hero-intro" style={{ fontSize: "var(--text-md)", color: "var(--text-body)", maxWidth: 540, marginBottom: "var(--space-6)" }}>
              When someone taps your link inside Instagram or TikTok, it opens in that app&apos;s cramped little
              browser — where logins fail, carts forget you, and your tracking pixels go blind. Klipo quietly hands
              the visitor back to their real Chrome or Safari, so everything just works.
            </p>

            <ShortenWidget />

            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "var(--space-4) 4px 0" }}>
              no account needed to try · free links never expire
            </p>

            <div className="lp-hero-bullets" style={{ marginTop: "var(--space-5)" }}>
              {BULLETS.map((b) => (
                <span key={b.label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--text-sm)", color: "var(--text-body)", fontWeight: 500 }}>
                  <Icon icon={b.icon} size={15} color="var(--lavender-500)" />
                  {b.label}
                </span>
              ))}
            </div>
          </div>

          {/* Right — petal proof panel: the escape, shown not told */}
          <Reveal delay={80}>
            <ProofPanel />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function ProofPanel() {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: "var(--radius-2xl)",
        backgroundImage: "var(--wash-petal)",
        boxShadow: "var(--shadow-xl), var(--glow-rose)",
        padding: "var(--space-8) var(--space-6) var(--space-10)",
        overflow: "hidden",
        minHeight: 380,
      }}
    >
      {/* soft light blooms */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(60% 50% at 80% 12%, rgba(255,255,255,0.35), transparent 60%), radial-gradient(50% 40% at 8% 85%, rgba(255,255,255,0.18), transparent 60%)",
        }}
      />

      {/* Phone with two stacked mini-browsers */}
      <div
        style={{
          position: "relative",
          width: "min(280px, 100%)",
          marginInline: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          animation: "klipFloat 7s var(--ease-in-out) infinite",
        }}
      >
        <MiniBrowser
          appLabel="Instagram browser"
          appIcon={Instagram}
          dim
          chip={{ label: "login failed", tone: "blush" }}
        />
        <div style={{ display: "flex", justifyContent: "center" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.22)",
              border: "1px solid rgba(255,255,255,0.35)",
              backdropFilter: "blur(6px)",
              animation: "klipBounceUp 1.6s var(--ease-in-out) infinite",
            }}
          >
            <Icon icon={ArrowDown} size={18} color="#fff" strokeWidth={2.4} />
          </span>
        </div>
        <MiniBrowser
          appLabel="Chrome"
          appIcon={Chrome}
          chip={{ label: "signed in", tone: "sage" }}
        />
      </div>

      {/* Overlaid rescued stat */}
      <div style={{ position: "relative", marginTop: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-number)", fontSize: "var(--text-4xl)", fontWeight: 700, color: "var(--text-on-accent)", lineHeight: 1 }}>
            <CountUp to={8661} />
          </span>
          <Badge tone="info" dot style={{ background: "rgba(255,255,255,0.22)", color: "#fff" }}>
            rescued
          </Badge>
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.85)", marginTop: 4 }}>
          visitors rescued this month
        </div>
      </div>
    </div>
  );
}

function MiniBrowser({
  appLabel,
  appIcon,
  chip,
  dim = false,
}: {
  appLabel: string;
  appIcon: typeof Instagram;
  chip: { label: string; tone: "blush" | "sage" };
  dim?: boolean;
}) {
  const chipColors =
    chip.tone === "blush"
      ? { bg: "var(--blush-100)", fg: "var(--blush-700)", dot: "var(--blush-500)" }
      : { bg: "var(--sage-100)", fg: "var(--sage-700)", dot: "var(--sage-500)" };

  return (
    <div
      style={{
        background: "var(--white)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-md)",
        padding: 12,
        opacity: dim ? 0.82 : 1,
        filter: dim ? "saturate(0.7)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon icon={appIcon} size={15} color={dim ? "var(--plum-500)" : "var(--rose-500)"} />
        <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)" }}>{appLabel}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--cream-300)" }} />
          ))}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ height: 8, width: "70%", borderRadius: 4, background: "var(--cream-200)" }} />
        <span style={{ height: 8, width: "45%", borderRadius: 4, background: "var(--cream-200)" }} />
      </div>
      <div style={{ marginTop: 12 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: chipColors.bg,
            color: chipColors.fg,
            borderRadius: "var(--radius-pill)",
            padding: "3px 10px",
            fontSize: "var(--text-xs)",
            fontWeight: 600,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: chipColors.dot }} />
          {chip.label}
        </span>
      </div>
    </div>
  );
}
