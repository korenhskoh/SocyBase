import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { WhatsAppFloat } from "@/components/layout/WhatsAppFloat";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "SocyBase - Social Media Data Extraction",
    template: "%s | SocyBase",
  },
  description:
    "Extract and enrich social media profile data at scale. Automated AI-Scraping, comment extraction, and profile enrichment for Facebook and more.",
  keywords: [
    "social media AI-Scraping",
    "data extraction",
    "profile enrichment",
    "Facebook AI-Scraping",
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
      "Extract and enrich social media profile data at scale. Automated AI-Scraping, comment extraction, and profile enrichment.",
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
  other: {
    "facebook-domain-verification": "a90r4e8a3iy6sfgubmipnjm8cbabtu",
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
        <WhatsAppFloat />
        {process.env.NEXT_PUBLIC_POSTHOG_KEY && (
          <Script
            id="posthog"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
                posthog.init('${process.env.NEXT_PUBLIC_POSTHOG_KEY}', {
                  api_host: '${process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com"}',
                  person_profiles: 'identified_only',
                });
              `,
            }}
          />
        )}
      </body>
    </html>
  );
}
