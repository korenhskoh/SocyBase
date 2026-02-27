"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { LogoFull } from "@/components/ui/Logo";
import { HeroDataCards } from "@/components/landing/HeroDataCards";
import { creditsApi } from "@/lib/api-client";
import { formatCurrency } from "@/lib/utils";
import type { CreditPackage } from "@/types";
import { useTranslation } from "@/hooks/useTranslation";
import {
  MockupCompetitorDiscovery,
  MockupAudienceExtraction,
  MockupEngagementScoring,
  MockupFBAdsExport,
} from "@/components/landing/FeatureMockups";

/* ─── Dynamic 3D imports (SSR disabled — Three.js is browser-only) ─── */
const DynamicScene = dynamic(
  () => import("@/components/3d/Scene").then((mod) => ({ default: mod.Scene })),
  { ssr: false }
);
const DynamicDataGlobe = dynamic(
  () =>
    import("@/components/3d/DataGlobe").then((mod) => ({
      default: mod.DataGlobe,
    })),
  { ssr: false }
);

/* ─── Social Platform Icon Components ─── */
const FacebookIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const InstagramIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
  </svg>
);

const TikTokIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
  </svg>
);

const LinkedInIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);

/* ─── Data ─── */
const features = [
  {
    titleKey: "landing.feature_1_title",
    descKey: "landing.feature_1_desc",
    icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z",
    color: "#7C5CFF",
    mockup: <MockupCompetitorDiscovery />,
  },
  {
    titleKey: "landing.feature_2_title",
    descKey: "landing.feature_2_desc",
    icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
    color: "#00AAFF",
    mockup: <MockupAudienceExtraction />,
  },
  {
    titleKey: "landing.feature_3_title",
    descKey: "landing.feature_3_desc",
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
    color: "#FF3366",
    mockup: <MockupEngagementScoring />,
  },
  {
    titleKey: "landing.feature_4_title",
    descKey: "landing.feature_4_desc",
    icon: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3",
    color: "#FFAA00",
    mockup: <MockupFBAdsExport />,
  },
];

/* ─── Framer Motion animation variants ─── */
const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15 } },
};

/* ─── Check icon for pricing ─── */
const CheckIcon = ({ color }: { color: string }) => (
  <svg
    className="h-4 w-4 shrink-0"
    style={{ color }}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

export default function LandingPage() {
  const [isAuth, setIsAuth] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [paymentModel, setPaymentModel] = useState("one_time");
  const { t, lang, setLang } = useTranslation();

  useEffect(() => {
    if (localStorage.getItem("access_token")) setIsAuth(true);
    creditsApi.getPackages()
      .then((res) => setPackages(res.data.packages || res.data || []))
      .catch(() => {})
      .finally(() => setPackagesLoading(false));
    creditsApi.getPublicConfig()
      .then((res) => setPaymentModel(res.data.payment_model || "one_time"))
      .catch(() => {});
  }, []);

  // Filter packages based on admin payment model
  const visiblePackages = packages.filter((pkg) => {
    if (paymentModel === "one_time") return pkg.billing_interval === "one_time";
    if (paymentModel === "subscription") return pkg.billing_interval !== "one_time";
    return true;
  });

  return (
    <div className="min-h-screen bg-navy-950 text-white overflow-x-hidden">
      {/* ══════════════════ NAVBAR ══════════════════ */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.04] bg-navy-950/80 backdrop-blur-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center">
              <LogoFull size="sm" />
            </Link>

            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-sm text-white/50 hover:text-white transition">
                {t("landing.features")}
              </a>
              <a href="#how-it-works" className="text-sm text-white/50 hover:text-white transition">
                {t("landing.how_it_works")}
              </a>
              <a href="#pricing" className="text-sm text-white/50 hover:text-white transition">
                {t("landing.pricing")}
              </a>
            </div>

            <div className="hidden md:flex items-center gap-3">
              <button
                onClick={() => setLang(lang === "en" ? "zh" : "en")}
                className="px-3 py-1.5 text-xs font-medium text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition"
              >
                {lang === "en" ? "中文" : "EN"}
              </button>
              {isAuth ? (
                <Link href="/dashboard" className="btn-glow-refined !px-5 !py-2 text-sm">
                  {t("nav.dashboard")}
                </Link>
              ) : (
                <>
                  <Link href="/login" className="btn-ghost !px-5 !py-2 text-sm">
                    {t("auth.sign_in")}
                  </Link>
                  <Link href="/register" className="btn-glow-refined !px-5 !py-2 text-sm">
                    {t("landing.get_started")}
                  </Link>
                </>
              )}
            </div>

            <button
              className="md:hidden text-white/60"
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                {mobileMenu ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                )}
              </svg>
            </button>
          </div>

          {mobileMenu && (
            <div className="md:hidden border-t border-white/5 py-4 space-y-3">
              <a href="#features" className="block text-sm text-white/60 py-2">
                {t("landing.features")}
              </a>
              <a href="#how-it-works" className="block text-sm text-white/60 py-2">
                {t("landing.how_it_works")}
              </a>
              <a href="#pricing" className="block text-sm text-white/60 py-2">
                {t("landing.pricing")}
              </a>
              <button
                onClick={() => setLang(lang === "en" ? "zh" : "en")}
                className="block text-sm text-white/60 py-2"
              >
                {lang === "en" ? "中文" : "English"}
              </button>
              <div className="pt-3 border-t border-white/5 flex gap-3">
                <Link href="/login" className="flex-1 text-center btn-ghost !py-2 text-sm">
                  {t("auth.sign_in")}
                </Link>
                <Link href="/register" className="flex-1 text-center btn-glow-refined !py-2 text-sm">
                  {t("landing.get_started")}
                </Link>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* ══════════════════ HERO ══════════════════ */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 gradient-mesh-bg" />
        <div className="absolute inset-0 dot-grid opacity-50" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-20 md:py-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left column — text + CTAs */}
            <div>
              <motion.p
                className="text-xs uppercase tracking-widest text-white/40 mb-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                {t("landing.subtitle")}
              </motion.p>

              <motion.h1
                className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                {t("landing.hero_title_1")}
                <br />
                <span className="gradient-text">{t("landing.hero_title_2")}</span>
              </motion.h1>

              <motion.p
                className="mt-6 text-lg text-white/40 max-w-lg leading-relaxed"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                {t("landing.hero_desc")}
              </motion.p>

              <motion.div
                className="mt-10 flex flex-col sm:flex-row items-start gap-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <Link href="/register" className="btn-glow-refined !px-8 !py-4 text-base group">
                  <span className="flex items-center gap-2">
                    {t("landing.start_free")}
                    <svg
                      className="h-4 w-4 group-hover:translate-x-1 transition-transform"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                      />
                    </svg>
                  </span>
                </Link>
                <a href="#how-it-works" className="btn-ghost !px-8 !py-4 text-base flex items-center gap-2">
                  <svg
                    className="h-5 w-5 text-white/40"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z"
                    />
                  </svg>
                  {t("landing.see_how")}
                </a>
              </motion.div>

              {/* Social proof */}
              <motion.div
                className="mt-8 flex items-center gap-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.6 }}
              >
                <div className="flex -space-x-2">
                  {["#00AAFF", "#7C5CFF", "#FF3366", "#FFAA00"].map((c, i) => (
                    <div
                      key={i}
                      className="h-8 w-8 rounded-full border-2 border-navy-950 flex items-center justify-center text-[10px] font-bold text-white/60"
                      style={{ background: `${c}20` }}
                    >
                      {["S", "M", "L", "A"][i]}
                    </div>
                  ))}
                </div>
                <p className="text-sm text-white/30">
                  <span className="text-white/60 font-medium">500+</span> {t("landing.social_proof")}
                </p>
              </motion.div>
            </div>

            {/* Right column — 3D Globe + HeroDataCards (desktop only) */}
            <motion.div
              className="relative hidden lg:block"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              <div className="h-[400px] lg:h-[500px]">
                <DynamicScene className="w-full h-full">
                  <DynamicDataGlobe />
                </DynamicScene>
              </div>

              {/* Data cards overlapping the bottom-right of the globe */}
              <div className="absolute bottom-0 right-0 z-10">
                <HeroDataCards />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ══════════════════ STATS STRIP ══════════════════ */}
      <section className="py-12 border-y border-white/[0.04] bg-navy-950">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="grid grid-cols-2 md:grid-cols-4 gap-6"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
          >
            {[
              { value: "50K+", labelKey: "landing.stat_audiences", color: "#00AAFF" },
              { value: "2M+", labelKey: "landing.stat_profiles", color: "#7C5CFF" },
              { value: "94%", labelKey: "landing.stat_intent_accuracy", color: "#FF3366" },
              { value: "<60s", labelKey: "landing.stat_export_speed", color: "#FFAA00" },
            ].map((s) => (
              <motion.div
                key={s.labelKey}
                variants={fadeInUp}
                className="glass-card-soft p-4 text-center"
              >
                <p className="text-2xl md:text-3xl font-bold" style={{ color: s.color }}>
                  {s.value}
                </p>
                <p className="text-xs text-white/35 mt-1">{t(s.labelKey)}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ══════════════════ TRUSTED PLATFORMS ══════════════════ */}
      <section className="py-12 border-b border-white/[0.03]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs uppercase tracking-widest text-white/20 mb-6">
            {t("landing.extract_from")}
          </p>
          <div className="flex items-center justify-center gap-6 sm:gap-10 md:gap-16 opacity-30">
            <FacebookIcon className="h-7 w-7 text-[#1877F2]" />
            <InstagramIcon className="h-7 w-7 text-[#E4405F]" />
            <TikTokIcon className="h-7 w-7 text-[#00F2EA]" />
            <LinkedInIcon className="h-7 w-7 text-[#0A66C2]" />
            <svg className="h-7 w-7 text-[#FF0000]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
          </div>
        </div>
      </section>

      {/* ══════════════════ PIPELINE FLOW ══════════════════ */}
      <section className="py-16 relative overflow-hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="hidden md:flex items-center justify-between gap-2"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
          >
            {[
              { labelKey: "landing.pipeline_find", color: "#7C5CFF", icon: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" },
              { labelKey: "landing.pipeline_extract", color: "#00AAFF", icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" },
              { labelKey: "landing.pipeline_score", color: "#FF3366", icon: "M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" },
              { labelKey: "landing.pipeline_export", color: "#FFAA00", icon: "M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" },
            ].map((step, i) => (
              <motion.div key={step.labelKey} className="contents" variants={fadeInUp}>
                <div className="glass-card-soft p-4 text-center flex-1 group hover:border-white/10 transition-all">
                  <div
                    className="h-10 w-10 rounded-xl mx-auto mb-2 flex items-center justify-center transition-all group-hover:scale-110"
                    style={{ background: `${step.color}10` }}
                  >
                    <svg className="h-5 w-5" style={{ color: step.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={step.icon} />
                    </svg>
                  </div>
                  <p className="text-[11px] font-medium text-white/50">{t(step.labelKey)}</p>
                </div>
                {i < 3 && (
                  <div className="flex-shrink-0 px-1">
                    <svg className="h-4 w-8" viewBox="0 0 32 16" fill="none">
                      <line x1="0" y1="8" x2="24" y2="8" stroke={`${step.color}40`} strokeWidth="1.5" strokeDasharray="3 3" />
                      <path d="M22 4l6 4-6 4" stroke={`${step.color}40`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  </div>
                )}
              </motion.div>
            ))}
          </motion.div>

          {/* Mobile: vertical pipeline */}
          <motion.div
            className="md:hidden flex flex-col items-center gap-3"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-30px" }}
          >
            {[
              { labelKey: "landing.pipeline_find", color: "#7C5CFF" },
              { labelKey: "landing.pipeline_extract", color: "#00AAFF" },
              { labelKey: "landing.pipeline_score", color: "#FF3366" },
              { labelKey: "landing.pipeline_export", color: "#FFAA00" },
            ].map((step, i) => (
              <motion.div key={step.labelKey} variants={fadeInUp} className="w-full">
                <div className="glass-card-soft px-4 py-3 flex items-center gap-3">
                  <div
                    className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold"
                    style={{ background: `${step.color}15`, color: step.color }}
                  >
                    {i + 1}
                  </div>
                  <span className="text-sm text-white/60">{t(step.labelKey)}</span>
                </div>
                {i < 3 && (
                  <div className="flex justify-center py-1">
                    <svg className="h-4 w-4 text-white/10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
                    </svg>
                  </div>
                )}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ══════════════════ FEATURES ══════════════════ */}
      <section id="features" className="py-24 md:py-32 relative bg-navy-950">
        {/* Faint dot grid at low opacity */}
        <div className="absolute inset-0 dot-grid opacity-30 pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section header */}
          <motion.div
            className="text-center mb-20"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <p className="text-sm font-semibold uppercase tracking-widest mb-3" style={{ color: "#7C5CFF" }}>
              {t("landing.features")}
            </p>
            <h2 className="text-3xl md:text-5xl font-bold">
              {t("landing.features_heading")}{" "}
              <span className="gradient-text">{t("landing.features_heading_2")}</span>
            </h2>
            <p className="mt-4 text-white/40 max-w-xl mx-auto">
              {t("landing.features_desc")}
            </p>
          </motion.div>

          {/* Alternating feature rows */}
          <div className="space-y-20 md:space-y-28">
            {features.map((f, i) => {
              const isEven = i % 2 === 1;
              return (
                <motion.div
                  key={f.titleKey}
                  className={`grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center ${
                    isEven ? "md:direction-rtl" : ""
                  }`}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  viewport={{ once: true, margin: "-80px" }}
                >
                  {/* Text side */}
                  <div className={`${isEven ? "md:order-2" : "md:order-1"}`}>
                    <div className="accent-line mb-6" style={{ background: f.color }} />
                    <h3 className="text-2xl font-semibold text-white mb-3">{t(f.titleKey)}</h3>
                    <p className="text-white/40 leading-relaxed max-w-md">{t(f.descKey)}</p>
                  </div>

                  {/* Mockup side */}
                  <div
                    className={`flex ${
                      isEven ? "md:order-1 md:justify-start" : "md:order-2 md:justify-end"
                    } justify-center`}
                  >
                    {f.mockup}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════ HOW IT WORKS ══════════════════ */}
      <section id="how-it-works" className="py-24 md:py-32 relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-0 top-1/2 w-80 h-80 bg-[#00AAFF]/5 rounded-full blur-[100px]" />
          <div className="absolute right-0 bottom-0 w-60 h-60 bg-[#FF3366]/5 rounded-full blur-[80px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <p className="text-sm font-semibold uppercase tracking-widest mb-3" style={{ color: "#FF3366" }}>
              {t("landing.how_it_works")}
            </p>
            <h2 className="text-3xl md:text-5xl font-bold">
              {t("landing.workflow_heading")} <span className="gradient-text">{t("landing.workflow_heading_2")}</span>
            </h2>
          </motion.div>

          {/* Horizontal steps layout */}
          <div className="relative">
            {/* SVG connecting line (desktop only) — draws itself */}
            <div className="hidden lg:block absolute top-16 left-[12.5%] right-[12.5%] h-[2px] z-0">
              <motion.svg
                className="w-full h-full"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
              >
                <motion.line
                  x1="0"
                  y1="1"
                  x2="100%"
                  y2="1"
                  stroke="url(#lineGrad)"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                  variants={{
                    hidden: { pathLength: 0, opacity: 0 },
                    visible: {
                      pathLength: 1,
                      opacity: 0.3,
                      transition: { duration: 1.5, ease: "easeInOut" },
                    },
                  }}
                />
                <defs>
                  <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#7C5CFF" />
                    <stop offset="33%" stopColor="#00AAFF" />
                    <stop offset="67%" stopColor="#FF3366" />
                    <stop offset="100%" stopColor="#FFAA00" />
                  </linearGradient>
                </defs>
              </motion.svg>
            </div>

            <motion.div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 relative z-10"
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-50px" }}
            >
              {[
                {
                  step: "01",
                  titleKey: "landing.workflow_step_1_title",
                  descKey: "landing.workflow_step_1_desc",
                  color: "#7C5CFF",
                  icon: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z",
                },
                {
                  step: "02",
                  titleKey: "landing.workflow_step_2_title",
                  descKey: "landing.workflow_step_2_desc",
                  color: "#00AAFF",
                  icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
                },
                {
                  step: "03",
                  titleKey: "landing.workflow_step_3_title",
                  descKey: "landing.workflow_step_3_desc",
                  color: "#FF3366",
                  icon: "M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z",
                },
                {
                  step: "04",
                  titleKey: "landing.workflow_step_4_title",
                  descKey: "landing.workflow_step_4_desc",
                  color: "#FFAA00",
                  icon: "M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z",
                },
              ].map((item) => (
                <motion.div
                  key={item.step}
                  variants={fadeInUp}
                  className="glass-card-soft p-8 text-center relative group"
                >
                  {/* Numbered gradient ring */}
                  <div className="mx-auto mb-6 relative">
                    <div
                      className="h-14 w-14 rounded-full mx-auto flex items-center justify-center"
                      style={{
                        background: `${item.color}10`,
                        boxShadow: `0 0 0 2px ${item.color}30`,
                      }}
                    >
                      <svg
                        className="h-6 w-6"
                        style={{ color: item.color }}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                    </div>
                    <span
                      className="absolute -top-1 -right-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: item.color, color: "#0a0f1e" }}
                    >
                      {item.step}
                    </span>
                  </div>

                  <h3 className="text-lg font-semibold text-white mb-2">{t(item.titleKey)}</h3>
                  <p className="text-white/40 text-sm leading-relaxed">{t(item.descKey)}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ══════════════════ DATA FIELDS PREVIEW ══════════════════ */}
      <section className="py-24 md:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              border: "1px solid rgba(255,255,255,0.04)",
              background:
                "linear-gradient(135deg, rgba(0,170,255,0.04) 0%, rgba(124,92,255,0.04) 50%, rgba(255,51,102,0.04) 100%)",
            }}
          >
            <div className="grid md:grid-cols-2">
              <div className="p-8 md:p-12 flex flex-col justify-center">
                <p
                  className="text-sm font-semibold uppercase tracking-widest mb-3"
                  style={{ color: "#FFAA00" }}
                >
                  {t("landing.structured_output")}
                </p>
                <h2 className="text-3xl md:text-4xl font-bold mb-4">
                  <span className="gradient-text">{t("landing.fields_per_profile")}</span> {t("landing.fields_desc")}
                </h2>
                <p className="text-white/40 mb-8 leading-relaxed">
                  {t("landing.fields_body")}
                </p>
                <Link href="/register" className="btn-glow-refined !w-fit !px-6 !py-3 text-sm">
                  {t("landing.try_free")}
                </Link>
              </div>

              <div className="p-8 md:p-12 border-t md:border-t-0 md:border-l border-white/[0.04]">
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { name: "Full Name", c: "#00AAFF" },
                    { name: "First Name", c: "#00AAFF" },
                    { name: "Last Name", c: "#00AAFF" },
                    { name: "Gender", c: "#7C5CFF" },
                    { name: "Birthday", c: "#7C5CFF" },
                    { name: "Relationship", c: "#7C5CFF" },
                    { name: "Education", c: "#FF3366" },
                    { name: "Work", c: "#FF3366" },
                    { name: "Position", c: "#FF3366" },
                    { name: "Hometown", c: "#FFAA00" },
                    { name: "Location", c: "#FFAA00" },
                    { name: "Website", c: "#FFAA00" },
                    { name: "Languages", c: "#00AAFF" },
                    { name: "Username", c: "#00AAFF" },
                    { name: "Profile Link", c: "#7C5CFF" },
                    { name: "About", c: "#FF3366" },
                  ].map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.04] text-sm group hover:border-white/10 transition-all"
                    >
                      <div
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ background: f.c }}
                      />
                      <span className="text-white/60 group-hover:text-white/80 transition">
                        {f.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════ PRICING ══════════════════ */}
      <section id="pricing" className="py-24 md:py-32 relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-[#7C5CFF]/5 rounded-full blur-[120px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-16"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <p
              className="text-sm font-semibold uppercase tracking-widest mb-3"
              style={{ color: "#FFAA00" }}
            >
              {t("landing.pricing")}
            </p>
            <h2 className="text-3xl md:text-5xl font-bold">
              {t("landing.pricing_heading")} <span className="gradient-text">{t("landing.pricing_heading_2")}</span>
            </h2>
            <p className="mt-4 text-white/40 max-w-xl mx-auto">
              {t("landing.pricing_desc")}
              <span className="block mt-1 text-white/50 font-medium">
                {t("landing.pricing_note")}
              </span>
            </p>
          </motion.div>

          {packagesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="glass-card-soft p-8 animate-pulse">
                  <div className="h-5 w-24 bg-white/5 rounded mb-4" />
                  <div className="h-10 w-32 bg-white/5 rounded mb-2" />
                  <div className="h-4 w-20 bg-white/5 rounded mb-6" />
                  <div className="space-y-3">
                    <div className="h-4 w-full bg-white/5 rounded" />
                    <div className="h-4 w-full bg-white/5 rounded" />
                    <div className="h-4 w-full bg-white/5 rounded" />
                  </div>
                  <div className="h-10 w-full bg-white/5 rounded-xl mt-6" />
                </div>
              ))}
            </div>
          ) : (
            <motion.div
              className={`grid grid-cols-1 sm:grid-cols-2 ${visiblePackages.length >= 4 ? "lg:grid-cols-4" : visiblePackages.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"} gap-5`}
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-50px" }}
            >
              {visiblePackages.map((pkg, idx) => {
                const isPopular = idx === 1;
                const priceStr = formatCurrency(pkg.price_cents, pkg.currency);
                const [whole, decimal] = priceStr.split(".");
                const isSubscription = pkg.billing_interval !== "one_time";
                const intervalLabel = pkg.billing_interval === "monthly" ? "/mo" : pkg.billing_interval === "annual" ? "/yr" : "";
                return (
                  <motion.div
                    key={pkg.id}
                    variants={fadeInUp}
                    className="glass-card-soft p-8 relative flex flex-col transition-all duration-300 hover:border-white/15"
                  >
                    {isPopular && (
                      <div className="absolute inset-0 rounded-2xl bg-[#7C5CFF]/[0.06] blur-xl pointer-events-none" />
                    )}

                    {isPopular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                        <span
                          className="px-3 py-1 text-xs font-semibold rounded-full text-white"
                          style={{
                            background: "linear-gradient(135deg, #00AAFF, #7C5CFF, #FF3366)",
                          }}
                        >
                          {t("landing.most_popular")}
                        </span>
                      </div>
                    )}

                    <div className="relative">
                      <h3 className="text-lg font-semibold text-white">{pkg.name}</h3>
                      <div className="mt-4 mb-1">
                        <span className="text-4xl font-bold text-white">{whole}</span>
                        {decimal && <span className="text-white/40">.{decimal}</span>}
                        {intervalLabel && <span className="text-lg text-white/30">{intervalLabel}</span>}
                      </div>
                      <p className="text-sm text-white/30 mb-6">
                        {isSubscription
                          ? pkg.billing_interval === "monthly" ? t("landing.billed_monthly") : t("landing.billed_annually")
                          : t("landing.one_time")}
                      </p>

                      <div className="space-y-3 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <CheckIcon color="#00AAFF" />
                          <span className="text-white/60">
                            {pkg.credits.toLocaleString()} {t("landing.credits_label")}
                            {isSubscription ? `/${pkg.billing_interval === "monthly" ? "mo" : "yr"}` : ""}
                          </span>
                        </div>
                        {pkg.bonus_credits > 0 && (
                          <div className="flex items-center gap-2 text-sm">
                            <CheckIcon color="#7C5CFF" />
                            <span style={{ color: "#7C5CFF" }}>+{pkg.bonus_credits.toLocaleString()} bonus</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 text-sm">
                          <CheckIcon color="#FF3366" />
                          <span className="text-white/60">{t("landing.csv_fb_export")}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <CheckIcon color="#FFAA00" />
                          <span className="text-white/60">
                            {isSubscription ? t("landing.auto_renew") : t("landing.never_expires")}
                          </span>
                        </div>
                      </div>

                      <Link
                        href="/register"
                        className={`mt-6 block text-center py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isPopular ? "btn-glow-refined !py-2.5" : "btn-ghost !py-2.5"
                        }`}
                      >
                        {isSubscription ? t("landing.subscribe") : t("landing.get_started")}
                      </Link>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      </section>

      {/* ══════════════════ FINAL CTA ══════════════════ */}
      <section className="py-24 md:py-32 relative overflow-hidden">
        {/* Full-width gradient mesh background echoing hero */}
        <div className="absolute inset-0 gradient-mesh-bg" />
        <div className="absolute inset-0 dot-grid opacity-40" />

        {/* Subtle animated glow (softer) */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div
            className="w-[500px] h-[500px] rounded-full blur-[120px] opacity-20 animate-pulse"
            style={{
              background: "linear-gradient(135deg, #00AAFF, #7C5CFF)",
            }}
          />
        </div>

        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              {t("landing.cta_heading")}{" "}
              <span className="gradient-text">{t("landing.cta_heading_2")}</span>?
            </h2>
            <p className="text-white/40 max-w-lg mx-auto mb-8 text-lg">
              {t("landing.cta_desc")}
            </p>
            <Link
              href="/register"
              className="btn-glow-refined !px-10 !py-4 text-base inline-block"
            >
              {t("landing.create_free")}
            </Link>
            <p className="mt-4 text-xs text-white/20">{t("landing.no_cc")}</p>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════ FOOTER ══════════════════ */}
      <footer className="border-t border-white/[0.03] py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <LogoFull size="xs" />
            <div className="flex items-center gap-6 text-sm text-white/30">
              <a href="#features" className="hover:text-white/60 transition">
                {t("landing.features")}
              </a>
              <a href="#pricing" className="hover:text-white/60 transition">
                {t("landing.pricing")}
              </a>
              <Link href="/login" className="hover:text-white/60 transition">
                {t("auth.sign_in")}
              </Link>
            </div>
            <p className="text-xs text-white/20">
              &copy; {new Date().getFullYear()} SocyBase
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
