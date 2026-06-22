"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * Counts a number up once when it scrolls into view. Renders the final value in
 * SSR'd HTML, then animates from 0 on the client. Reduced-motion users see the
 * final value immediately (no rAF loop).
 */
export function CountUp({
  to,
  duration = 1100,
  suffix = "",
  format = true,
  style,
}: {
  to: number;
  duration?: number;
  suffix?: string;
  format?: boolean;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      setValue(to);
      setDone(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || done) return;
        io.disconnect();
        setDone(true);
        let start: number | null = null;
        const step = (ts: number) => {
          if (start === null) start = ts;
          const t = Math.min(1, (ts - start) / duration);
          // easeOutCubic
          const eased = 1 - Math.pow(1 - t, 3);
          setValue(Math.round(eased * to));
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [to, duration, done]);

  const display = format ? value.toLocaleString("en-US") : String(value);
  return (
    <span ref={ref} style={style}>
      {display}
      {suffix}
    </span>
  );
}
