"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { LogoFull } from "@/components/ui/Logo";
import { HeroDataCards } from "@/components/landing/HeroDataCards";
import {
  MockupProfileExtraction,
  MockupCommentScraping,
  MockupBulkProcessing,
  MockupExportAnywhere,
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
    title: "Profile Extraction",
    description:
      "Extract 18+ structured fields — name, education, work, location, and more from public profiles automatically.",
    icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
    color: "#00AAFF",
    mockup: <MockupProfileExtraction />,
  },
  {
    title: "Comment Scraping",
    description:
      "Collect comments with commenter details, timestamps, and full text. Perfect for audience research and sentiment analysis.",
    icon: "M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z",
    color: "#7C5CFF",
    mockup: <MockupCommentScraping />,
  },
  {
    title: "Bulk Processing",
    description:
      "Upload thousands of profile URLs or user IDs. Process them all in a single job with live progress tracking.",
    icon: "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z",
    color: "#FF3366",
    mockup: <MockupBulkProcessing />,
  },
  {
    title: "Export Anywhere",
    description:
      "Download as CSV or Facebook Ads custom audience format. Ready for your CRM, ad platform, or analytics pipeline.",
    icon: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3",
    color: "#FFAA00",
    mockup: <MockupExportAnywhere />,
  },
];

const plans = [
  { name: "Starter", credits: "100", price: "$9.99", bonus: 0, popular: false },
  { name: "Growth", credits: "500", price: "$39.99", bonus: 50, popular: true },
  {
    name: "Professional",
    credits: "2,000",
    price: "$129.99",
    bonus: 300,
    popular: false,
  },
  {
    name: "Enterprise",
    credits: "10,000",
    price: "$499.99",
    bonus: 2000,
    popular: false,
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

  useEffect(() => {
    if (localStorage.getItem("access_token")) setIsAuth(true);
  }, []);

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
                Features
              </a>
              <a href="#how-it-works" className="text-sm text-white/50 hover:text-white transition">
                How it Works
              </a>
              <a href="#pricing" className="text-sm text-white/50 hover:text-white transition">
                Pricing
              </a>
            </div>

            <div className="hidden md:flex items-center gap-3">
              {isAuth ? (
                <Link href="/dashboard" className="btn-glow-refined !px-5 !py-2 text-sm">
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link href="/login" className="btn-ghost !px-5 !py-2 text-sm">
                    Sign In
                  </Link>
                  <Link href="/register" className="btn-glow-refined !px-5 !py-2 text-sm">
                    Get Started
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
                Features
              </a>
              <a href="#how-it-works" className="block text-sm text-white/60 py-2">
                How it Works
              </a>
              <a href="#pricing" className="block text-sm text-white/60 py-2">
                Pricing
              </a>
              <div className="pt-3 border-t border-white/5 flex gap-3">
                <Link href="/login" className="flex-1 text-center btn-ghost !py-2 text-sm">
                  Sign In
                </Link>
                <Link href="/register" className="flex-1 text-center btn-glow-refined !py-2 text-sm">
                  Get Started
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
                Social Data Intelligence Platform
              </motion.p>

              <motion.h1
                className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                Turn Social Profiles Into
                <br />
                <span className="gradient-text">Structured Data</span>
              </motion.h1>

              <motion.p
                className="mt-6 text-lg text-white/40 max-w-lg leading-relaxed"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                Paste a Facebook post URL and extract structured profile data for every commenter
                — names, demographics, education, work history, and 18+ fields. Export as CSV or
                Facebook Ads custom audience format.
              </motion.p>

              <motion.div
                className="mt-10 flex flex-col sm:flex-row items-start gap-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <Link href="/register" className="btn-glow-refined !px-8 !py-4 text-base group">
                  <span className="flex items-center gap-2">
                    Start Free
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
                  See How it Works
                </a>
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
              { value: "18+", label: "Data Fields", color: "#00AAFF" },
              { value: "10K+", label: "Profiles / Job", color: "#7C5CFF" },
              { value: "99.9%", label: "Uptime", color: "#FF3366" },
              { value: "<2s", label: "Per Profile", color: "#FFAA00" },
            ].map((s) => (
              <motion.div
                key={s.label}
                variants={fadeInUp}
                className="glass-card-soft p-4 text-center"
              >
                <p className="text-2xl md:text-3xl font-bold" style={{ color: s.color }}>
                  {s.value}
                </p>
                <p className="text-xs text-white/35 mt-1">{s.label}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ══════════════════ TRUSTED PLATFORMS ══════════════════ */}
      <section className="py-12 border-b border-white/[0.03]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs uppercase tracking-widest text-white/20 mb-6">
            Extract data from
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
              Features
            </p>
            <h2 className="text-3xl md:text-5xl font-bold">
              Everything you need to{" "}
              <span className="gradient-text">extract & enrich</span>
            </h2>
            <p className="mt-4 text-white/40 max-w-xl mx-auto">
              Powerful tools for marketers, researchers, and data teams who need social media data
              at scale.
            </p>
          </motion.div>

          {/* Alternating feature rows */}
          <div className="space-y-20 md:space-y-28">
            {features.map((f, i) => {
              const isEven = i % 2 === 1;
              return (
                <motion.div
                  key={f.title}
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
                    <h3 className="text-2xl font-semibold text-white mb-3">{f.title}</h3>
                    <p className="text-white/40 leading-relaxed max-w-md">{f.description}</p>
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
              How it Works
            </p>
            <h2 className="text-3xl md:text-5xl font-bold">
              Three steps to <span className="gradient-text">your data</span>
            </h2>
          </motion.div>

          {/* Horizontal steps layout */}
          <div className="relative">
            {/* SVG connecting line (desktop only) — draws itself */}
            <div className="hidden md:block absolute top-16 left-[16.67%] right-[16.67%] h-[2px] z-0">
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
                    <stop offset="0%" stopColor="#00AAFF" />
                    <stop offset="50%" stopColor="#7C5CFF" />
                    <stop offset="100%" stopColor="#FF3366" />
                  </linearGradient>
                </defs>
              </motion.svg>
            </div>

            <motion.div
              className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10"
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-50px" }}
            >
              {[
                {
                  step: "01",
                  title: "Create an account",
                  desc: "Sign up in seconds with email or Google. Get a workspace with credit balance tracking, job history, and team access. No credit card required.",
                  color: "#00AAFF",
                  icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z",
                },
                {
                  step: "02",
                  title: "Configure your job",
                  desc: "Paste a Facebook post URL or upload a list of profile IDs. Choose your target platform and click extract. Track progress in real-time.",
                  color: "#7C5CFF",
                  icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
                },
                {
                  step: "03",
                  title: "Download results",
                  desc: "Get a structured CSV with 18 normalized fields per profile. Or export as Facebook Ads custom audience format for instant retargeting.",
                  color: "#FF3366",
                  icon: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3",
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

                  <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-white/40 text-sm leading-relaxed">{item.desc}</p>
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
                  Structured Output
                </p>
                <h2 className="text-3xl md:text-4xl font-bold mb-4">
                  <span className="gradient-text">18 fields</span> per profile, every time
                </h2>
                <p className="text-white/40 mb-8 leading-relaxed">
                  Every profile comes back with the same 18 normalized fields: full name, gender,
                  birthday, relationship status, education, work, position, hometown, current city,
                  website, languages, username, profile link, and more. No manual parsing or cleanup
                  needed.
                </p>
                <Link href="/register" className="btn-glow-refined !w-fit !px-6 !py-3 text-sm">
                  Try it Free
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
              Pricing
            </p>
            <h2 className="text-3xl md:text-5xl font-bold">
              Simple, credit-based <span className="gradient-text">pricing</span>
            </h2>
            <p className="mt-4 text-white/40 max-w-xl mx-auto">
              Buy credits, use when you need. No subscriptions, no recurring charges.
              <span className="block mt-1 text-white/50 font-medium">
                1 credit = 1 profile extracted with all 18 data fields.
              </span>
            </p>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-50px" }}
          >
            {plans.map((p) => (
              <motion.div
                key={p.name}
                variants={fadeInUp}
                className="glass-card-soft p-8 relative flex flex-col transition-all duration-300 hover:border-white/15"
              >
                {/* Popular card soft radial glow */}
                {p.popular && (
                  <div className="absolute inset-0 rounded-2xl bg-[#7C5CFF]/[0.06] blur-xl pointer-events-none" />
                )}

                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <span
                      className="px-3 py-1 text-xs font-semibold rounded-full text-white"
                      style={{
                        background: "linear-gradient(135deg, #00AAFF, #7C5CFF, #FF3366)",
                      }}
                    >
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="relative">
                  <h3 className="text-lg font-semibold text-white">{p.name}</h3>
                  <div className="mt-4 mb-1">
                    <span className="text-4xl font-bold text-white">
                      {p.price.split(".")[0]}
                    </span>
                    <span className="text-white/40">.{p.price.split(".")[1]}</span>
                  </div>
                  <p className="text-sm text-white/30 mb-6">one-time purchase</p>

                  <div className="space-y-3 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckIcon color="#00AAFF" />
                      <span className="text-white/60">{p.credits} credits</span>
                    </div>
                    {p.bonus > 0 && (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckIcon color="#7C5CFF" />
                        <span style={{ color: "#7C5CFF" }}>+{p.bonus} bonus</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm">
                      <CheckIcon color="#FF3366" />
                      <span className="text-white/60">CSV + FB Ads export</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckIcon color="#FFAA00" />
                      <span className="text-white/60">Never expires</span>
                    </div>
                  </div>

                  <Link
                    href="/register"
                    className={`mt-6 block text-center py-2.5 rounded-xl text-sm font-medium transition-all ${
                      p.popular ? "btn-glow-refined !py-2.5" : "btn-ghost !py-2.5"
                    }`}
                  >
                    Get Started
                  </Link>
                </div>
              </motion.div>
            ))}
          </motion.div>
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
              Ready to extract{" "}
              <span className="gradient-text">your first profiles</span>?
            </h2>
            <p className="text-white/40 max-w-lg mx-auto mb-8 text-lg">
              Join marketers and researchers using SocyBase to turn social media into actionable
              data.
            </p>
            <Link
              href="/register"
              className="btn-glow-refined !px-10 !py-4 text-base inline-block"
            >
              Create Free Account
            </Link>
            <p className="mt-4 text-xs text-white/20">No credit card required</p>
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
                Features
              </a>
              <a href="#pricing" className="hover:text-white/60 transition">
                Pricing
              </a>
              <Link href="/login" className="hover:text-white/60 transition">
                Sign In
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
