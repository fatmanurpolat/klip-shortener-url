"use client";

import { ArrowRight } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { DASHBOARD_URL } from "@/lib/api";

export function FinalCta() {
  return (
    <Section background="petal" id="cta" width="var(--width-prose)" style={{ color: "var(--text-on-primary)", textAlign: "center" }} aria-labelledby="cta-h">
      <div className="klipo-eyebrow" style={{ color: "rgba(255,255,255,0.85)", marginBottom: "var(--space-3)" }}>
        Stop losing clicks to webviews
      </div>
      <h2 id="cta-h" className="lp-h2" style={{ color: "var(--text-on-accent)", marginBottom: "var(--space-4)" }}>
        Set your next link <em style={{ fontStyle: "italic", fontWeight: 500 }}>free</em> in seconds.
      </h2>
      <p style={{ fontSize: "var(--text-md)", color: "rgba(255,255,255,0.9)", maxWidth: 480, margin: "0 auto var(--space-8)" }}>
        Sign in or create your account in the app — a magic link, no password to remember, ever.
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
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-4)",
        }}
      >
        <p style={{ margin: 0, fontSize: "var(--text-base)", color: "var(--text-body)" }}>
          Sign-in happens in the Klipo app.
        </p>
        <a href={DASHBOARD_URL} style={{ display: "inline-block" }}>
          <Button variant="primary" size="lg" iconRight={<Icon icon={ArrowRight} size={18} color="#fff" />}>
            Go to the app to sign in
          </Button>
        </a>
      </div>

      <p style={{ fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.8)", marginTop: "var(--space-6)" }}>
        free to start · no credit card · links you make stay yours
      </p>
    </Section>
  );
}
