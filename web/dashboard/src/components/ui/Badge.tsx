import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "neutral" | "live" | "warn" | "expired" | "info" | "rose" | "lavender";
type Size = "sm" | "md";

interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "style"> {
  tone?: BadgeTone;
  dot?: boolean;
  size?: Size;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Status pill with soft watercolor tints keyed by `tone` + optional status dot. */
export function Badge({ children, tone = "neutral", dot = false, size = "md", style, ...rest }: BadgeProps) {
  const tones: Record<BadgeTone, { bg: string; fg: string; dotc: string }> = {
    neutral: { bg: "var(--cream-200)", fg: "var(--plum-700)", dotc: "var(--plum-500)" },
    live: { bg: "var(--status-live-bg)", fg: "var(--status-live-fg)", dotc: "var(--sage-500)" },
    warn: { bg: "var(--status-warn-bg)", fg: "var(--status-warn-fg)", dotc: "var(--honey-500)" },
    expired: { bg: "var(--status-expired-bg)", fg: "var(--status-expired-fg)", dotc: "var(--blush-500)" },
    info: { bg: "var(--status-info-bg)", fg: "var(--status-info-fg)", dotc: "var(--peri-500)" },
    rose: { bg: "var(--rose-100)", fg: "var(--rose-700)", dotc: "var(--rose-500)" },
    lavender: { bg: "var(--lavender-100)", fg: "var(--lavender-700)", dotc: "var(--lavender-500)" },
  };
  const dims: Record<Size, { fontSize: string; padding: string; gap: string; dot: number }> = {
    sm: { fontSize: "var(--text-xs)", padding: "2px 8px", gap: "5px", dot: 5 },
    md: { fontSize: "var(--text-xs)", padding: "4px 10px", gap: "6px", dot: 6 },
  };
  const t = tones[tone];
  const d = dims[size];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: d.gap,
        background: t.bg,
        color: t.fg,
        padding: d.padding,
        borderRadius: "var(--radius-pill)",
        fontFamily: "var(--font-body)",
        fontSize: d.fontSize,
        fontWeight: 600,
        lineHeight: 1.4,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {dot && <span style={{ width: d.dot, height: d.dot, borderRadius: "50%", background: t.dotc, flex: "none" }} />}
      {children}
    </span>
  );
}
