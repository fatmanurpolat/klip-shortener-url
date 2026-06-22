import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type Variant = "ghost" | "quiet" | "soft" | "solid";
type Size = "sm" | "md" | "lg";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  variant?: Variant;
  size?: Size;
  label: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Square icon-only button; mirrors Button sizing/states for a single glyph. */
export function IconButton({
  children,
  variant = "ghost",
  size = "md",
  disabled = false,
  label,
  style,
  ...rest
}: IconButtonProps) {
  const dim: Record<Size, number> = { sm: 34, md: 42, lg: 52 };
  const variants: Record<Variant, CSSProperties> = {
    ghost: { background: "transparent", color: "var(--text-body)", border: "1px solid var(--border-default)" },
    quiet: { background: "transparent", color: "var(--text-muted)", border: "1px solid transparent" },
    soft: { background: "var(--lavender-100)", color: "var(--lavender-700)", border: "1px solid var(--lavender-200)" },
    solid: { background: "var(--brand-primary)", color: "var(--white)", border: "1px solid transparent" },
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dim[size],
        height: dim[size],
        borderRadius: "var(--radius-md)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)",
        ...variants[variant],
        ...style,
      }}
      onMouseEnter={(e) => { if (!disabled && variant === "ghost") e.currentTarget.style.background = "var(--cream-200)"; }}
      onMouseLeave={(e) => { if (variant === "ghost") e.currentTarget.style.background = "transparent"; }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.92)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      {...rest}
    >
      {children}
    </button>
  );
}
