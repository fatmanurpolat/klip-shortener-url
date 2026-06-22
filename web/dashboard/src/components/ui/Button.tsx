import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  style?: CSSProperties;
}

/** Klipo action button: rose primary, lavender secondary, soft ghost, quiet, danger. */
export function Button({
  children,
  variant = "primary",
  size = "md",
  iconLeft = null,
  iconRight = null,
  fullWidth = false,
  disabled = false,
  type = "button",
  style,
  ...rest
}: ButtonProps) {
  const sizes: Record<Size, CSSProperties & { radius: string; gap: string }> = {
    sm: { height: "var(--control-sm)", padding: "0 14px", fontSize: "var(--text-sm)", gap: "6px", radius: "var(--radius-sm)" },
    md: { height: "var(--control-md)", padding: "0 20px", fontSize: "var(--text-base)", gap: "8px", radius: "var(--radius-md)" },
    lg: { height: "var(--control-lg)", padding: "0 28px", fontSize: "var(--text-md)", gap: "10px", radius: "var(--radius-lg)" },
  };
  const s = sizes[size];

  const variants: Record<Variant, CSSProperties> = {
    primary: { background: "var(--brand-primary)", color: "var(--text-on-primary)", border: "1px solid transparent", boxShadow: "var(--glow-rose)" },
    secondary: { background: "var(--lavender-100)", color: "var(--lavender-700)", border: "1px solid var(--lavender-200)", boxShadow: "none" },
    ghost: { background: "transparent", color: "var(--text-body)", border: "1px solid var(--border-default)", boxShadow: "none" },
    quiet: { background: "transparent", color: "var(--text-body)", border: "1px solid transparent", boxShadow: "none" },
    danger: { background: "var(--blush-500)", color: "var(--white)", border: "1px solid transparent", boxShadow: "none" },
  };

  return (
    <button
      type={type}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        height: s.height,
        padding: s.padding,
        width: fullWidth ? "100%" : "auto",
        fontFamily: "var(--font-body)",
        fontSize: s.fontSize,
        fontWeight: 600,
        lineHeight: 1,
        borderRadius: s.radius,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition:
          "transform var(--dur-fast) var(--ease-out), filter var(--dur-fast) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)",
        whiteSpace: "nowrap",
        ...variants[variant],
        ...style,
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.97)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.filter = "none"; }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = "brightness(1.04)"; }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
