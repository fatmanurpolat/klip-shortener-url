"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Single stacked pill bar: periwinkle "set free" segment over a sage "already
 * free" track. The periwinkle fill animates 0 -> pct on scroll-in. role=img
 * with a descriptive label; reduced-motion users see the final fill at once.
 */
export function RescuedBar({ pct = 64 }: { pct?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const prefersReduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      setW(pct);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setW(pct);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [pct]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={`${pct}% of clicks rescued from in-app browsers`}
      style={{
        position: "relative",
        height: 28,
        borderRadius: "var(--radius-pill)",
        overflow: "hidden",
        background: "var(--sage-500)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: `${w}%`,
          background: "var(--peri-500)",
          transition: "width 800ms var(--ease-out)",
        }}
      />
    </div>
  );
}
