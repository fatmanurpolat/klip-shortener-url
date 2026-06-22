import { useId } from "react";
import type { CSSProperties, ReactNode, SelectHTMLAttributes } from "react";

type Size = "sm" | "md" | "lg";
type Option = string | { value: string; label: string };

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "style"> {
  label?: string;
  hint?: string;
  options?: Option[];
  size?: Size;
  style?: CSSProperties;
  wrapStyle?: CSSProperties;
  children?: ReactNode;
}

/** Klipo select — styled native <select> with a chevron, matching Input. */
export function Select({ label, hint, options = [], size = "md", id, style, wrapStyle, children, ...rest }: SelectProps) {
  const autoId = useId();
  const fieldId = id || autoId;
  const heights: Record<Size, string> = { sm: "var(--control-sm)", md: "var(--control-md)", lg: "var(--control-lg)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", ...wrapStyle }}>
      {label && (
        <label htmlFor={fieldId} style={{ fontFamily: "var(--font-body)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-heading)" }}>
          {label}
        </label>
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <select
          id={fieldId}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            width: "100%",
            height: heights[size],
            padding: "0 38px 0 14px",
            background: "var(--white)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--inset-soft)",
            fontFamily: "var(--font-body)",
            fontSize: "var(--text-base)",
            color: "var(--text-body)",
            cursor: "pointer",
            outline: "none",
            ...style,
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--border-focus)"; e.currentTarget.style.boxShadow = "var(--focus-ring)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "var(--inset-soft)"; }}
          {...rest}
        >
          {children ||
            options.map((o) => {
              const val = typeof o === "string" ? o : o.value;
              const lbl = typeof o === "string" ? o : o.label;
              return (
                <option key={val} value={val}>
                  {lbl}
                </option>
              );
            })}
        </select>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          style={{ position: "absolute", right: 12, pointerEvents: "none" }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {hint && <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{hint}</span>}
    </div>
  );
}
