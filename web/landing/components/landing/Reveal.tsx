"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * Gentle fade-up on scroll-into-view via a single IntersectionObserver per
 * instance. Content is rendered in the SSR'd HTML (good for SEO) and animates
 * in on the client. When prefers-reduced-motion is set (or IO is unavailable),
 * the content is revealed immediately with no transition — matching CountUp /
 * RescuedBar. (Without client JS the content stays hidden; scroll-reveal
 * degrading to hidden is an accepted no-JS tradeoff.)
 */
export function Reveal({
  children,
  delay = 0,
  y = 16,
  as: Tag = "div",
  style,
  ...rest
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li" | "span";
  style?: CSSProperties;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const prefersReduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const Comp = Tag as "div";
  return (
    <Comp
      ref={ref as React.Ref<HTMLDivElement>}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : `translateY(${y}px)`,
        transition: `opacity var(--dur-base) var(--ease-out) ${delay}ms, transform var(--dur-base) var(--ease-out) ${delay}ms`,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Comp>
  );
}
