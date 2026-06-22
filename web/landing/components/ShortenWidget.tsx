"use client";

import { useState } from "react";
import { Link2, Sparkles, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { shorten, ShortenError, type ShortenResult } from "@/lib/api";

/**
 * The hero's primary interactive CTA: paste a long URL, get a Klipo short link.
 * Wired to POST /api/v1/shorten (analytics on, public). Glass card so it can
 * sit over the petal art panel.
 */
export function ShortenWidget() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ShortenResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const r = await shorten({ url: trimmed });
      setResult(r);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof ShortenError ? err.message : "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — link stays visible to select manually */
    }
  }

  function reset() {
    setStatus("idle");
    setResult(null);
    setUrl("");
    setErrorMsg("");
  }

  return (
    <div
      style={{
        width: "100%",
        background: "var(--surface-glass)",
        backdropFilter: "blur(var(--blur-glass))",
        WebkitBackdropFilter: "blur(var(--blur-glass))",
        border: "1px solid rgba(255,255,255,0.7)",
        borderRadius: "var(--radius-xl)",
        boxShadow: "var(--shadow-lg)",
        padding: "var(--space-5)",
      }}
    >
      {status === "done" && result ? (
        <div role="status" aria-live="polite" style={{ animation: "klipPop 240ms var(--ease-spring)" }}>
          <div
            style={{
              background: "var(--rose-50)",
              border: "1px solid var(--rose-100)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-4) var(--space-5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: 10 }}>
              <a
                href={result.shortUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-lg)",
                  fontWeight: 700,
                  color: "var(--rose-600)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {result.shortUrl.replace(/^https?:\/\//, "")}
              </a>
              <Badge tone="info" dot>escape on</Badge>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <Button variant="secondary" size="sm" onClick={copyLink} iconLeft={<Icon icon={copied ? Check : Copy} size={15} color="var(--lavender-700)" />}>
                {copied ? "copied 🌸" : "copy the link"}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                onClick={() => window.open(result.shortUrl, "_blank", "noopener")}
                iconLeft={<Icon icon={ExternalLink} size={15} color="var(--text-muted)" />}
              >
                open
              </Button>
              <button
                type="button"
                onClick={reset}
                style={{
                  marginLeft: "auto",
                  background: "none",
                  border: "none",
                  padding: "0 4px",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-body)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                }}
              >
                shorten another
              </button>
            </div>
          </div>
          <p style={{ margin: "12px 4px 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            Nice — this link now escapes in-app browsers on its own.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <Input
              type="url"
              inputMode="url"
              aria-label="Paste a long link"
              placeholder="paste a long link to set it free…"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (status === "error") setStatus("idle");
              }}
              size="lg"
              required
              error={status === "error" ? errorMsg : undefined}
              iconLeft={<Icon icon={Link2} size={18} color="var(--text-muted)" />}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={status === "loading"}
            iconRight={status === "loading" ? undefined : <Icon icon={Sparkles} size={18} color="#fff" />}
            style={{ flex: "0 0 auto" }}
            className="klipo-widget-cta"
          >
            {status === "loading" ? "shortening…" : "shorten a link"}
          </Button>
        </form>
      )}
    </div>
  );
}
