"use client";

import { useState } from "react";
import { Mail, Send } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/components/ui/Icon";
import { requestLogin, ShortenError } from "@/lib/api";

export function FinalCta() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      await requestLogin(trimmed);
      setStatus("sent");
    } catch (err) {
      setErrorMsg(err instanceof ShortenError ? err.message : "Couldn't send just now — give it another try in a moment.");
      setStatus("error");
    }
  }

  return (
    <Section background="petal" id="cta" width="var(--width-prose)" style={{ color: "var(--text-on-primary)", textAlign: "center" }} aria-labelledby="cta-h">
      <div className="klipo-eyebrow" style={{ color: "rgba(255,255,255,0.85)", marginBottom: "var(--space-3)" }}>
        Stop losing clicks to webviews
      </div>
      <h2 id="cta-h" className="lp-h2" style={{ color: "var(--text-on-accent)", marginBottom: "var(--space-4)" }}>
        Set your next link <em style={{ fontStyle: "italic", fontWeight: 500 }}>free</em> in seconds.
      </h2>
      <p style={{ fontSize: "var(--text-md)", color: "rgba(255,255,255,0.9)", maxWidth: 480, margin: "0 auto var(--space-8)" }}>
        Create your account with a magic link — no password to remember, ever. We&apos;ll email you a link to sign in.
      </p>

      <div
        style={{
          maxWidth: 520,
          marginInline: "auto",
          background: "var(--surface-glass)",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
          border: "1px solid rgba(255,255,255,0.7)",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-xl)",
          padding: "var(--space-6)",
          textAlign: "left",
        }}
      >
        {status === "sent" ? (
          <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", alignItems: "flex-start", animation: "klipoPop 240ms var(--ease-spring)" }}>
            <Badge tone="live" dot>sent</Badge>
            <p style={{ margin: 0, fontSize: "var(--text-base)", color: "var(--text-body)" }}>
              🌸 Check your email — your magic link is on its way. It expires soon and can only be used once.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="lp-cta-row">
            <Input
              type="email"
              inputMode="email"
              aria-label="Your email address"
              placeholder="you@studio.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status === "error") setStatus("idle");
              }}
              size="lg"
              required
              error={status === "error" ? errorMsg : undefined}
              iconLeft={<Icon icon={Mail} size={18} color="var(--text-muted)" />}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={status === "loading"}
              iconRight={status === "loading" ? undefined : <Icon icon={Send} size={17} color="#fff" />}
            >
              {status === "loading" ? "sending…" : "send magic link"}
            </Button>
          </form>
        )}
      </div>

      <p style={{ fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.8)", marginTop: "var(--space-6)" }}>
        free to start · no credit card · links you make stay yours
      </p>
    </Section>
  );
}
