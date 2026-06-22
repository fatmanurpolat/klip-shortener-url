import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

/**
 * Brand-default wrapper over a lucide-react icon: 2px stroke, currentColor,
 * inline-flex box. Pass the icon component itself.
 *   <Icon icon={Link2} size={18} color="var(--text-muted)" />
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
    <span style={{ display: "inline-flex", flex: "none", lineHeight: 0, ...style }} aria-hidden>
      <Glyph size={size} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth />
    </span>
  );
}
