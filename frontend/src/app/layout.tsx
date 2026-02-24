import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "SocyBase - Social Media Data Extraction",
    template: "%s | SocyBase",
  },
  description:
    "Extract and enrich social media profile data at scale. Automated scraping, comment extraction, and profile enrichment for Facebook and more.",
  keywords: [
    "social media scraping",
    "data extraction",
    "profile enrichment",
    "Facebook scraping",
    "lead generation",
    "SocyBase",
  ],
  authors: [{ name: "SocyBase" }],
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "SocyBase",
    title: "SocyBase - Social Media Data Extraction",
    description:
      "Extract and enrich social media profile data at scale. Automated scraping, comment extraction, and profile enrichment.",
  },
  twitter: {
    card: "summary_large_image",
    title: "SocyBase - Social Media Data Extraction",
    description:
      "Extract and enrich social media profile data at scale.",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
