import type { Metadata, Viewport } from "next";
import { Playfair_Display, Inter, Space_Mono, Geist_Mono } from "next/font/google";
import "./globals.css";

// Headings / display numerals — warm editorial serif.
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-display-src",
  display: "swap",
});

// Body / UI — clean neutral sans.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body-src",
  display: "swap",
});

// Short links / code.
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono-src",
  display: "swap",
});

// Tabular numbers in stats.
const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-number-src",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Klipo — links that break free of in-app browsers",
  description:
    "Klipo shortens your links and escapes Instagram, TikTok and Facebook webviews — so logins, carts and tracking pixels actually work. Clean click analytics, including how many visitors were rescued.",
  applicationName: "Klipo",
  openGraph: {
    title: "Klipo — links that break free of in-app browsers",
    description:
      "Shorten links. Escape the webview. Bloom anywhere. Plus a signature Webview vs Real Browser breakdown.",
    siteName: "Klipo",
    type: "website",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#FDF6EE",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${inter.variable} ${spaceMono.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
