"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Icon } from "@/components/ui/Icon";

/** Small ghost icon-button that copies `text` and flips to a check briefly. */
export function CopyButton({ text, label = "Copy code" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-default)",
        background: "var(--surface-card)",
        cursor: "pointer",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
    >
      <Icon icon={copied ? Check : Copy} size={15} color={copied ? "var(--sage-500)" : "var(--text-muted)"} />
    </button>
  );
}
