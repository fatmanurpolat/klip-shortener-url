"use client";

import { useId } from "react";
import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";

type Size = "sm" | "md" | "lg";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix" | "style"> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: string;
  iconLeft?: ReactNode;
  size?: Size;
  style?: CSSProperties;
  wrapStyle?: CSSProperties;
}

/**
 * Klipo text field. Optional label, leading addon (e.g. "klipo.to/"), leading
 * icon, helper / error text. Rose focus bloom on the wrapping shell.
 */
export function Input({
  label,
  hint,
  error,
  prefix,
  iconLeft,
  size = "md",
  id,
  style,
  wrapStyle,
  ...rest
}: InputProps) {
  const autoId = useId();
  const fieldId = id || autoId;
  const heights: Record<Size, string> = {
    sm: "var(--control-sm)",
    md: "var(--control-md)",
    lg: "var(--control-lg)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", ...wrapStyle }}>
      {label && (
        <label
          htmlFor={fieldId}
          style={{ fontFamily: "var(--font-body)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-heading)" }}
        >
          {label}
        </label>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: heights[size],
          background: "var(--white)",
          border: `1px solid ${error ? "var(--blush-500)" : "var(--border-strong)"}`,
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--inset-soft)",
          overflow: "hidden",
          transition: "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
        }}
        onFocusCapture={(e) => {
          e.currentTarget.style.borderColor = "var(--border-focus)";
          e.currentTarget.style.boxShadow = "var(--focus-ring)";
        }}
        onBlurCapture={(e) => {
          e.currentTarget.style.borderColor = error ? "var(--blush-500)" : "var(--border-strong)";
          e.currentTarget.style.boxShadow = "var(--inset-soft)";
        }}
      >
        {prefix && (
          <span
            style={{
              paddingLeft: "14px",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)",
              whiteSpace: "nowrap",
            }}
          >
            {prefix}
          </span>
        )}
        {iconLeft && <span style={{ display: "inline-flex", paddingLeft: "12px", color: "var(--text-muted)" }}>{iconLeft}</span>}
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? `${fieldId}-msg` : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            padding: prefix ? "0 14px 0 4px" : "0 14px",
            fontFamily: "var(--font-body)",
            fontSize: "var(--text-base)",
            color: "var(--text-body)",
            ...style,
          }}
          {...rest}
        />
      </div>
      {(hint || error) && (
        <span
          id={`${fieldId}-msg`}
          role={error ? "alert" : undefined}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "var(--text-xs)",
            color: error ? "var(--blush-700)" : "var(--text-muted)",
          }}
        >
          {error || hint}
        </span>
      )}
    </div>
  );
}
