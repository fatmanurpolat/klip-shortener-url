import "./landing.css";
import { NavBar } from "@/components/landing/NavBar";
import { Hero } from "@/components/landing/Hero";
import { CredibilityStrip } from "@/components/landing/CredibilityStrip";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { RescuedMetric } from "@/components/landing/RescuedMetric";
import { AnalyticsTeaser } from "@/components/landing/AnalyticsTeaser";
import { BuiltForBoth } from "@/components/landing/BuiltForBoth";
import { FinalCta } from "@/components/landing/FinalCta";
import { Footer } from "@/components/landing/Footer";

export default function Home() {
  return (
    <>
      <a href="#hero" className="lp-skip">
        Skip to content
      </a>
      <NavBar />
      <main>
        <Hero />
        <CredibilityStrip />
        <HowItWorks />
        <RescuedMetric />
        <AnalyticsTeaser />
        <BuiltForBoth />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
