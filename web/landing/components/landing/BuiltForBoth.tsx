import { Check, Sparkles, ArrowUpRight } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { CopyButton } from "./CopyButton";
import { Reveal } from "./Reveal";

const CREATOR_BULLETS = [
  ["Custom alias links", "klipo.to/your-name, not a jumble of characters."],
  ["Your own domain", "brand every link as go.studio.co."],
  ["Expiring links", "perfect for launches and limited drops."],
  ["Screenshot-ready stats", "numbers you'll actually want to share."],
];

const DEV_BULLETS = [
  ["One POST to shorten", "a tiny, predictable JSON contract."],
  ["Magic-link auth", "no passwords to store or leak."],
  ["Self-hostable", "your own Fastify + Postgres + Redis."],
  ["Rescue data on every link", "the webview breakdown, via the API."],
];

const DEV_CHIPS = ["private links", "expiring links", "API keys", "OpenAPI"];

const CURL = `curl -X POST https://klipo.to/api/v1/shorten \\
  -H 'Content-Type: application/json' \\
  -d '{"url":"https://your-shop.com/spring-sale","analytics":true}'`;

export function BuiltForBoth() {
  return (
    <Section background="app" id="credibility" aria-labelledby="both-h">
      <div style={{ textAlign: "center", marginBottom: "var(--space-10)" }}>
        <div className="klip-eyebrow" style={{ marginBottom: "var(--space-3)" }}>Made for both hands on the link</div>
        <h2 id="both-h" className="lp-h2">
          For creators{" "}
          <em style={{ fontStyle: "italic", fontWeight: 500, color: "var(--rose-600)" }}>and</em>{" "}
          the folks who ship.
        </h2>
      </div>

      <div className="lp-both-grid">
        {/* Creators */}
        <Reveal>
          <Card tone="rose" padding="lg" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <Badge tone="rose" style={{ alignSelf: "flex-start", marginBottom: "var(--space-4)" }}>for creators</Badge>
            <h3 style={{ fontSize: "var(--text-xl)", marginBottom: "var(--space-5)" }}>
              Drop one link in your bio — and stop losing followers to broken browsers.
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 var(--space-6)", display: "grid", gap: "var(--space-3)" }}>
              {CREATOR_BULLETS.map(([label, body]) => (
                <BulletRow key={label} label={label} body={body} tone="rose" />
              ))}
            </ul>
            <a href="#hero" style={{ marginTop: "auto" }}>
              <Button variant="primary" iconRight={<Icon icon={Sparkles} size={16} color="#fff" />}>
                shorten your first link
              </Button>
            </a>
          </Card>
        </Reveal>

        {/* Developers */}
        <Reveal delay={80}>
          <Card tone="lavender" padding="lg" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <Badge tone="lavender" style={{ alignSelf: "flex-start", marginBottom: "var(--space-4)" }}>for developers</Badge>
            <h3 style={{ fontSize: "var(--text-xl)", marginBottom: "var(--space-5)" }}>A tiny, honest REST API.</h3>

            <Card tone="sunken" padding="md" style={{ position: "relative", marginBottom: "var(--space-5)", boxShadow: "none", border: "1px solid var(--border-soft)" }}>
              <div style={{ position: "absolute", top: 12, right: 12 }}>
                <CopyButton text={CURL} label="Copy the curl command" />
              </div>
              <pre className="lp-code" style={{ color: "var(--text-body)", paddingRight: 36 }}>
{`curl -X POST `}<span style={{ color: "var(--text-heading)", fontWeight: 700 }}>https://klipo.to/api/v1/shorten</span>{` \\
  -H 'Content-Type: application/json' \\
  -d '{`}<span style={{ color: "var(--text-heading)", fontWeight: 700 }}>&quot;url&quot;</span>{`:`}<span style={{ color: "var(--text-muted)" }}>&quot;https://your-shop.com/spring-sale&quot;</span>{`,`}<span style={{ color: "var(--text-heading)", fontWeight: 700 }}>&quot;analytics&quot;</span>{`:true}'`}
              </pre>
              <pre className="lp-code" style={{ color: "var(--text-body)", marginTop: 10 }}>
<span style={{ color: "var(--sage-700)", fontWeight: 700 }}>{`→ 201`}</span>{` { `}<span style={{ color: "var(--text-heading)", fontWeight: 700 }}>&quot;shortUrl&quot;</span>{`: `}<span style={{ color: "var(--text-muted)" }}>&quot;https://klipo.to/spring-drop&quot;</span>{` }`}
              </pre>
            </Card>

            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 var(--space-5)", display: "grid", gap: "var(--space-3)" }}>
              {DEV_BULLETS.map(([label, body]) => (
                <BulletRow key={label} label={label} body={body} tone="lavender" />
              ))}
            </ul>

            <div className="lp-chips" style={{ marginBottom: "var(--space-6)" }}>
              {DEV_CHIPS.map((c) => (
                <span
                  key={c}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-xs)",
                    color: "var(--lavender-700)",
                    background: "var(--lavender-100)",
                    borderRadius: "var(--radius-pill)",
                    padding: "3px 10px",
                  }}
                >
                  {c}
                </span>
              ))}
            </div>

            <a href="#cta" style={{ marginTop: "auto" }}>
              <Button variant="secondary" iconRight={<Icon icon={ArrowUpRight} size={16} color="var(--lavender-700)" />}>
                read the API docs
              </Button>
            </a>
          </Card>
        </Reveal>
      </div>
    </Section>
  );
}

function BulletRow({ label, body, tone }: { label: string; body: string; tone: "rose" | "lavender" }) {
  const ring = tone === "rose" ? "var(--rose-100)" : "var(--lavender-100)";
  const fg = tone === "rose" ? "var(--rose-600)" : "var(--lavender-600)";
  return (
    <li style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
      <span style={{ display: "inline-flex", width: 22, height: 22, flex: "none", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: ring, marginTop: 1 }}>
        <Icon icon={Check} size={13} color={fg} />
      </span>
      <span style={{ fontSize: "var(--text-base)", color: "var(--text-body)" }}>
        <strong style={{ color: "var(--text-heading)" }}>{label}</strong> — {body}
      </span>
    </li>
  );
}
