import { useId } from "react";
import type { CSSProperties } from "react";

/**
 * Klipo logo — interlocking petal-link mark, optionally with the wordmark.
 * Self-contained inline SVG.
 */
export function Logo({
  variant = "full",
  size = 32,
  onDark = false,
  style,
}: {
  variant?: "full" | "mark";
  size?: number;
  onDark?: boolean;
  style?: CSSProperties;
}) {
  const gradId = useId().replace(/:/g, "");
  const wordColor = onDark ? "#FFFFFF" : "var(--plum-800)";

  const Mark = (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true" style={{ flex: "none" }}>
      <defs>
        <linearGradient id={gradId} x1="18" y1="18" x2="102" y2="102" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E47E9C" />
          <stop offset="0.55" stopColor="#9269C6" />
          <stop offset="1" stopColor="#6678CE" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="108" height="108" rx="32" fill={`url(#${gradId})`} />
      <g stroke="#FFFFFF" strokeWidth="9" fill="none" strokeLinecap="round">
        <path d="M44 40c-13 0-22 9-22 22s9 22 22 22h6c13 0 22-9 22-22" />
        <path d="M76 80c13 0 22-9 22-22s-9-22-22-22h-6c-13 0-22 9-22 22" />
      </g>
    </svg>
  );

  if (variant === "mark") {
    return (
      <span style={{ display: "inline-flex", ...style }} aria-label="Klipo">
        {Mark}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3), ...style }} aria-label="Klipo">
      {Mark}
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: Math.round(size * 0.92),
          color: wordColor,
          letterSpacing: "-0.01em",
          lineHeight: 1,
        }}
      >
        Klipo
      </span>
    </span>
  );
}
