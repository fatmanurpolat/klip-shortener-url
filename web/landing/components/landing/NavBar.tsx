"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Sparkles } from "lucide-react";
import { DASHBOARD_URL } from "@/lib/api";

const LINKS: { label: string; href: string }[] = [
  { label: "how it works", href: "#how" },
  { label: "the rescued metric", href: "#rescued" },
  { label: "analytics", href: "#analytics" },
  { label: "for developers", href: "#credibility" },
];

/** Sticky glass top bar — transparent over the hero, frosts in once scrolled. */
export function NavBar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`lp-nav${scrolled ? " scrolled" : ""}`}>
      <nav className="lp-nav-inner" aria-label="Primary">
        <a href="#hero" aria-label="Klipo home" style={{ display: "inline-flex" }}>
          <Logo size={26} />
        </a>

        <div className="lp-nav-links">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="lp-nav-link">
              {l.label}
            </a>
          ))}
        </div>

        <div className="lp-nav-ctas">
          <a href={DASHBOARD_URL} className="lp-nav-signin">
            <Button variant="ghost" size="sm">
              sign in
            </Button>
          </a>
          <a href="#hero">
            <Button variant="primary" size="sm" iconRight={<Icon icon={Sparkles} size={15} color="#fff" />}>
              shorten a link
            </Button>
          </a>
        </div>
      </nav>
    </header>
  );
}
