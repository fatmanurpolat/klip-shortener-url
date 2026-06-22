import type { CSSProperties } from "react";

/** Klipo avatar — initials on a soft floral wash (deterministic tint from name), or an image. */
export function Avatar({
  name = "",
  src = null,
  size = 40,
  tone = null,
  style,
}: {
  name?: string;
  src?: string | null;
  size?: number;
  tone?: string | null;
  style?: CSSProperties;
}) {
  const palette = [
    { bg: "var(--rose-100)", fg: "var(--rose-700)" },
    { bg: "var(--lavender-100)", fg: "var(--lavender-700)" },
    { bg: "var(--peri-100)", fg: "var(--peri-700)" },
    { bg: "var(--sage-100)", fg: "var(--sage-700)" },
    { bg: "var(--honey-100)", fg: "var(--honey-700)" },
  ];
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const c = tone ? { bg: `var(--${tone}-100)`, fg: `var(--${tone}-700)` } : palette[hash % palette.length];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: src ? "transparent" : c.bg,
        color: c.fg,
        fontFamily: "var(--font-body)",
        fontWeight: 600,
        fontSize: Math.round(size * 0.4),
        overflow: "hidden",
        flex: "none",
        userSelect: "none",
        ...style,
      }}
    >
      {src ? <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials}
    </span>
  );
}
