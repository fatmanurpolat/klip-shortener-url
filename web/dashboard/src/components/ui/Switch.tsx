import type { CSSProperties } from "react";

type Size = "sm" | "md";

/** Klipo toggle — rose-on when checked, soft cream track when off. Controlled. */
export function Switch({
  checked = false,
  onChange,
  disabled = false,
  size = "md",
  label,
  style,
}: {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  size?: Size;
  label?: string;
  style?: CSSProperties;
}) {
  const dims: Record<Size, { w: number; h: number; knob: number }> = {
    sm: { w: 36, h: 20, knob: 14 },
    md: { w: 46, h: 26, knob: 20 },
  };
  const d = dims[size];
  const pad = (d.h - d.knob) / 2;
  const toggle = () => { if (!disabled && onChange) onChange(!checked); };

  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={toggle}
      style={{
        position: "relative",
        width: d.w,
        height: d.h,
        flex: "none",
        borderRadius: "var(--radius-pill)",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        background: checked ? "var(--brand-primary)" : "var(--cream-300)",
        boxShadow: checked ? "var(--glow-rose)" : "var(--inset-soft)",
        transition: "background var(--dur-base) var(--ease-out)",
        padding: 0,
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: pad,
          left: checked ? d.w - d.knob - pad : pad,
          width: d.knob,
          height: d.knob,
          borderRadius: "50%",
          background: "var(--white)",
          boxShadow: "var(--shadow-sm)",
          transition: "left var(--dur-base) var(--ease-spring)",
        }}
      />
    </button>
  );

  if (!label) return control;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "10px", cursor: disabled ? "not-allowed" : "pointer" }}>
      {control}
      <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--text-base)", color: "var(--text-body)" }}>{label}</span>
    </label>
  );
}
