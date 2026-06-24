import { useState } from "react";
import { Mail, ArrowRight, MailCheck } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/auth/AuthContext";
import { requestLogin, ApiError } from "@/lib/api";

/**
 * Magic-link sign in (no passwords). Submitting calls the real
 * POST /api/v1/auth/request-login, which emails a one-time link. A session is
 * ONLY ever established by opening that emailed link — there is deliberately no
 * email-less sign-in path here.
 */
export function Login() {
  const { rememberEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus("sending");
    setErrorMsg("");
    try {
      await requestLogin(trimmed);
      rememberEmail(trimmed);
      setStatus("sent");
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError
          ? err.status === 400
            ? "That email looks a little off — mind checking it?"
            : err.message
          : "Couldn't send just now — give it another try in a moment.",
      );
      setStatus("error");
    }
  }

  return (
    <div className="kd-login">
      {/* Left — form */}
      <div className="kd-login-form">
        <Logo size={30} style={{ marginBottom: 48 }} />

        {status !== "sent" ? (
          <>
            <div className="klipo-eyebrow" style={{ marginBottom: 12 }}>Welcome back</div>
            <h1 style={{ fontSize: "var(--text-3xl)", marginBottom: 12 }}>Sign in to Klipo</h1>
            <p style={{ color: "var(--text-muted)", fontSize: "var(--text-md)", marginBottom: 32, maxWidth: 380 }}>
              No passwords here. Pop in your email and we&apos;ll send a magic link that drops you straight into your links.
            </p>
            <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 380 }}>
              <Input
                label="Email address"
                type="email"
                inputMode="email"
                placeholder="you@studio.co"
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
                fullWidth
                disabled={status === "sending"}
                iconRight={status === "sending" ? undefined : <Icon icon={ArrowRight} size={18} color="#fff" />}
              >
                {status === "sending" ? "sending…" : "Send magic link"}
              </Button>
            </form>
            <p style={{ color: "var(--text-faint)", fontSize: "var(--text-sm)", marginTop: 28 }}>
              New to Klipo? A magic link signs you up automatically.
            </p>
          </>
        ) : (
          <Card tone="rose" padding="xl" style={{ maxWidth: 420 }}>
            <div role="status" aria-live="polite">
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "var(--radius-lg)",
                  background: "var(--white)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 18,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <Icon icon={MailCheck} size={26} color="var(--rose-500)" />
              </div>
              <h2 style={{ fontSize: "var(--text-2xl)", marginBottom: 10 }}>Check your inbox</h2>
              <p style={{ color: "var(--text-body)", fontSize: "var(--text-base)", marginBottom: 22 }}>
                🌸 We sent a magic link to{" "}
                <strong style={{ color: "var(--rose-700)" }}>{email}</strong>. It expires soon and can only be used once.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setStatus("idle")}
              style={{
                display: "block",
                marginTop: 16,
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: "var(--text-sm)",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                padding: 0,
              }}
            >
              ← Use a different email
            </button>
          </Card>
        )}
      </div>

      {/* Right — floral panel */}
      <div className="kd-login-art">
        <div className="kd-login-art-glow" aria-hidden />
        <div style={{ position: "relative", color: "#fff" }}>
          <div className="kd-login-chip">
            <Icon icon={Mail} size={16} color="#fff" /> In-app browser escape, built in
          </div>
          <h2 style={{ color: "#fff", fontSize: "var(--text-4xl)", lineHeight: 1.05, maxWidth: 460 }}>
            Links that break <em style={{ fontStyle: "italic", fontWeight: 500 }}>free</em> of Instagram &amp; TikTok.
          </h2>
          <p style={{ color: "rgba(255,255,255,0.85)", fontSize: "var(--text-md)", marginTop: 18, maxWidth: 440 }}>
            Klipo detects in-app webviews and bounces visitors to Chrome or Safari — so logins, carts and pixels actually work.
          </p>
        </div>
      </div>
    </div>
  );
}
