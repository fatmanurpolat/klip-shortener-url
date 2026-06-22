import { Instagram, Music2, Facebook, Linkedin, MessageCircle } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { Section } from "@/components/ui/Section";

const GLYPHS = [Instagram, Music2, Facebook, Linkedin, MessageCircle];

export function CredibilityStrip() {
  return (
    <Section background="sunken" padBlock="var(--space-12)" aria-label="Where Klipo rescues visitors">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-8)",
          flexWrap: "wrap",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", fontWeight: 500, maxWidth: 260 }}>
          rescuing visitors out of in-app browsers across
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexWrap: "wrap", justifyContent: "center", opacity: 0.55 }}>
          {GLYPHS.map((G, i) => (
            <Icon key={i} icon={G} size={26} color="var(--plum-300)" />
          ))}
        </div>

        <div>
          <div style={{ fontFamily: "var(--font-number)", fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--peri-600)", lineHeight: 1 }}>
            8,661
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 4 }}>
            visitors rescued this month
          </div>
        </div>
      </div>
    </Section>
  );
}
