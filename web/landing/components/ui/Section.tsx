import type { CSSProperties, ReactNode } from "react";

type Background = "app" | "white" | "cream" | "sunken" | "bloom" | "petal";

const BACKGROUNDS: Record<Background, CSSProperties> = {
  app: { background: "var(--surface-app)" },
  white: { background: "var(--surface-card)" },
  cream: { background: "var(--wash-cream)" },
  sunken: { background: "var(--surface-sunken)" },
  bloom: { backgroundColor: "var(--surface-app)", backgroundImage: "var(--wash-bloom)" },
  petal: { backgroundImage: "var(--wash-petal)" },
};

/**
 * Consistent vertical-rhythm section wrapper: full-bleed background band with a
 * centered, max-width content column. Keeps the landing page's spacing coherent
 * across independently-authored sections.
 */
interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  children: ReactNode;
  background?: Background;
  width?: string;
  padBlock?: string;
  innerStyle?: CSSProperties;
}

export function Section({
  children,
  background = "app",
  width = "var(--width-content)",
  padBlock = "var(--space-24)",
  id,
  style,
  innerStyle,
  ...rest
}: SectionProps) {
  return (
    <section
      id={id}
      style={{
        position: "relative",
        paddingBlock: padBlock,
        paddingInline: "var(--space-6)",
        ...BACKGROUNDS[background],
        ...style,
      }}
      {...rest}
    >
      <div style={{ maxWidth: width, marginInline: "auto", width: "100%", ...innerStyle }}>{children}</div>
    </section>
  );
}

/** Uppercase lavender eyebrow label used above section headings. */
export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="klip-eyebrow" style={style}>
      {children}
    </div>
  );
}
