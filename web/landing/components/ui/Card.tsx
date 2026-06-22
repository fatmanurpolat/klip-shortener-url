"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type Tone = "default" | "sunken" | "rose" | "lavender" | "peri" | "glass";
type Padding = "none" | "sm" | "md" | "lg" | "xl";

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "style"> {
  tone?: Tone;
  padding?: Padding;
  interactive?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Klipo surface card — white, soft plum-tinted shadow, generous radius.
 * `tone` washes the card in a 50-level brand tint; `interactive` lifts 2px.
 */
export function Card({
  children,
  tone = "default",
  padding = "lg",
  interactive = false,
  style,
  ...rest
}: CardProps) {
  const pad: Record<Padding, string | number> = {
    none: 0,
    sm: "var(--space-4)",
    md: "var(--space-5)",
    lg: "var(--space-6)",
    xl: "var(--space-8)",
  };
  const tones: Record<Tone, CSSProperties> = {
    default: { background: "var(--surface-card)", border: "1px solid var(--border-default)" },
    sunken: { background: "var(--surface-sunken)", border: "1px solid var(--border-soft)" },
    rose: { background: "var(--rose-50)", border: "1px solid var(--rose-100)" },
    lavender: { background: "var(--lavender-50)", border: "1px solid var(--lavender-100)" },
    peri: { background: "var(--peri-50)", border: "1px solid var(--peri-100)" },
    glass: { background: "var(--surface-glass)", border: "1px solid rgba(255,255,255,0.6)", backdropFilter: "blur(var(--blur-glass))" },
  };

  return (
    <div
      style={{
        borderRadius: "var(--radius-xl)",
        padding: pad[padding],
        boxShadow: "var(--shadow-sm)",
        transition: "box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
        cursor: interactive ? "pointer" : "default",
        ...tones[tone],
        ...style,
      }}
      onMouseEnter={(e) => {
        if (interactive) {
          e.currentTarget.style.boxShadow = "var(--shadow-md)";
          e.currentTarget.style.transform = "translateY(-2px)";
        }
      }}
      onMouseLeave={(e) => {
        if (interactive) {
          e.currentTarget.style.boxShadow = "var(--shadow-sm)";
          e.currentTarget.style.transform = "translateY(0)";
        }
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
