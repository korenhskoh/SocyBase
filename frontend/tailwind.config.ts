import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // CSS variable-based colors (shadcn/ui pattern)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        // SocyBase brand colors
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",  // Electric blue
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        accent: {
          purple: "#7C5CFF",
          pink: "#FF3366",
          cyan: "#00AAFF",
          orange: "#FFAA00",
        },
        // SocyBase brand colors (matching logo)
        brand: {
          blue: "#00AAFF",
          pink: "#FF3366",
          purple: "#7C5CFF",
          orange: "#FFAA00",
        },
        // Social media platform colors (for platform badges)
        social: {
          facebook: "#1877F2",
          instagram: "#E4405F",
          "instagram-orange": "#F77737",
          "instagram-yellow": "#FCAF45",
          "instagram-purple": "#833AB4",
          tiktok: "#00F2EA",
          "tiktok-red": "#EE1D52",
          twitter: "#1DA1F2",
          linkedin: "#0A66C2",
          youtube: "#FF0000",
        },
        navy: {
          950: "#080d1a",
          900: "#0f172a",
          800: "#1e293b",
          700: "#334155",
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-mesh": "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        "gradient-social": "linear-gradient(135deg, #00AAFF 0%, #7C5CFF 30%, #FF3366 65%, #FFAA00 100%)",
      },
      animation: {
        "float": "float 6s ease-in-out infinite",
        "glow": "glow 2s ease-in-out infinite alternate",
        "slide-up": "slideUp 0.5s ease-out",
        "slide-up-delay": "slideUp 0.5s ease-out 0.1s both",
        "slide-up-delay-2": "slideUp 0.5s ease-out 0.2s both",
        "slide-up-delay-3": "slideUp 0.5s ease-out 0.3s both",
        "gradient-x": "gradientX 6s ease infinite",
        "pulse-glow": "pulseGlow 3s ease-in-out infinite",
        "orbit": "orbit 20s linear infinite",
        "orbit-reverse": "orbit 25s linear infinite reverse",
        "toast-in": "toastSlideIn 0.35s cubic-bezier(0.21, 1.02, 0.73, 1) forwards",
        "toast-out": "toastFadeOut 0.25s ease-in forwards",
        "mesh-float": "meshFloat 20s ease-in-out infinite",
        "fade-in-up": "fadeInUp 0.6s ease-out both",
        "draw-line": "drawLine 1.5s ease-out both",
        "data-flow": "dataFlow 3s ease-in-out infinite",
        "card-reveal": "cardReveal 0.5s ease-out both",
        "ticker": "ticker 0.4s ease-out both",
        "shimmer": "shimmer 2s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        glow: {
          from: { boxShadow: "0 0 10px #00AAFF, 0 0 20px #00AAFF" },
          to: { boxShadow: "0 0 20px #7C5CFF, 0 0 40px #7C5CFF" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        gradientX: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        pulseGlow: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
        orbit: {
          from: { transform: "rotate(0deg) translateX(150px) rotate(0deg)" },
          to: { transform: "rotate(360deg) translateX(150px) rotate(-360deg)" },
        },
        toastSlideIn: {
          from: { opacity: "0", transform: "translateX(100%)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        toastFadeOut: {
          from: { opacity: "1", transform: "translateX(0)" },
          to: { opacity: "0", transform: "translateX(100%)" },
        },
        meshFloat: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(30px, -20px) scale(1.05)" },
          "66%": { transform: "translate(-20px, 15px) scale(0.95)" },
        },
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(30px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        drawLine: {
          from: { strokeDashoffset: "100%" },
          to: { strokeDashoffset: "0%" },
        },
        dataFlow: {
          "0%": { transform: "translateX(0) scale(0)", opacity: "0" },
          "10%": { transform: "translateX(10%) scale(1)", opacity: "1" },
          "90%": { transform: "translateX(90%) scale(1)", opacity: "1" },
          "100%": { transform: "translateX(100%) scale(0)", opacity: "0" },
        },
        cardReveal: {
          from: { opacity: "0", transform: "translateY(10px) scale(0.95)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        ticker: {
          from: { transform: "translateY(100%)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
