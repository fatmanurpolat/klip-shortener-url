import { Github, Twitter, Instagram } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "product",
    links: [
      { label: "how it works", href: "#how" },
      { label: "the rescued metric", href: "#rescued" },
      { label: "analytics", href: "#analytics" },
      { label: "pricing", href: "#" },
      { label: "status", href: "#" },
    ],
  },
  {
    title: "developers",
    links: [
      { label: "API docs", href: "#" },
      { label: "custom domains", href: "#" },
      { label: "self-hosting", href: "#" },
      { label: "changelog", href: "#" },
      { label: "github", href: "#" },
    ],
  },
  {
    title: "company",
    links: [
      { label: "about", href: "#" },
      { label: "privacy", href: "#" },
      { label: "terms", href: "#" },
      { label: "contact", href: "#" },
    ],
  },
];

export function Footer() {
  return (
    <footer style={{ background: "var(--plum-900)", color: "rgba(255,255,255,0.7)" }}>
      <div style={{ maxWidth: "var(--width-content)", marginInline: "auto", paddingInline: "var(--space-6)", paddingBlock: "var(--space-16)" }}>
        <div className="lp-footer-grid">
          {/* Brand */}
          <div>
            <Logo size={26} onDark style={{ marginBottom: "var(--space-4)" }} />
            <p style={{ fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.7)", maxWidth: 260, marginBottom: "var(--space-4)" }}>
              The link that sets your visitors free from in-app browsers.
            </p>
            <p style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-5)" }}>
              <span style={{ fontFamily: "var(--font-number)", fontWeight: 700, color: "var(--peri-300)" }}>8,661</span>{" "}
              <span style={{ color: "rgba(255,255,255,0.6)" }}>visitors set free this month</span>
            </p>
            <a href="#hero">
              <Button variant="secondary" size="sm">shorten a link</Button>
            </a>
          </div>

          {/* Link columns */}
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "var(--text-xs)",
                  fontWeight: 700,
                  letterSpacing: "var(--ls-caps)",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.5)",
                  marginBottom: "var(--space-4)",
                }}
              >
                {col.title}
              </div>
              {col.links.map((l) => (
                <a key={l.label} href={l.href} className="lp-footer-link">
                  {l.label}
                </a>
              ))}
            </nav>
          ))}
        </div>

        {/* Bottom row */}
        <div
          className="lp-footer-bottom"
          style={{ marginTop: "var(--space-12)", paddingTop: "var(--space-6)", borderTop: "1px solid rgba(255,255,255,0.08)" }}
        >
          <span style={{ fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.5)" }}>
            © 2026 Klipo · made with soft petals and stubborn redirects.
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
            <Badge tone="info" dot style={{ background: "rgba(255,255,255,0.1)", color: "var(--peri-300)" }}>
              escape on
            </Badge>
            <div style={{ display: "flex", gap: "var(--space-3)" }}>
              {[
                { icon: Github, label: "Klipo on GitHub" },
                { icon: Twitter, label: "Klipo on X" },
                { icon: Instagram, label: "Klipo on Instagram" },
              ].map(({ icon, label }) => (
                <a key={label} href="#" aria-label={label} style={{ display: "inline-flex" }}>
                  <Icon icon={icon} size={18} color="var(--plum-300)" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
