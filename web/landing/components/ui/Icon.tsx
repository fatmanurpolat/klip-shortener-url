import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

/**
 * Thin wrapper over a lucide-react icon that standardizes the brand defaults:
 * 2px stroke, currentColor, inline-flex box. Pass the icon component itself:
 *
 *   import { ShieldCheck } from "lucide-react";
 *   <Icon icon={ShieldCheck} size={18} color="var(--peri-500)" />
 */
export function Icon({
  icon: Glyph,
  size = 18,
  color = "currentColor",
  strokeWidth = 2,
  style,
}: {
  icon: LucideIcon;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <span style={{ display: "inline-flex", flex: "none", lineHeight: 0, ...style }}>
      <Glyph size={size} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth />
    </span>
  );
}
