"use client";

import { motion } from "framer-motion";

/* AI Competitor Discovery — shows AI suggesting competitor pages */
export function MockupCompetitorDiscovery() {
  const competitors = [
    { name: "FashionBrand Pro", match: "92%", color: "#7C5CFF" },
    { name: "StyleHouse MY", match: "87%", color: "#00AAFF" },
    { name: "TrendSetters Co", match: "81%", color: "#FF3366" },
  ];

  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-[#7C5CFF] animate-pulse" />
        <span className="text-[10px] text-white/30 uppercase tracking-wider">AI Discovery</span>
      </div>
      <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-lg bg-[#7C5CFF]/5 border border-[#7C5CFF]/10">
        <svg className="h-3 w-3 text-[#7C5CFF]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        <span className="text-[9px] text-[#7C5CFF]/60">Analyzing your industry...</span>
      </div>
      {competitors.map((c, i) => (
        <motion.div
          key={c.name}
          className="flex items-center gap-2 py-2.5 border-t border-white/[0.04]"
          initial={{ opacity: 0, x: -10 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 + i * 0.2, duration: 0.4 }}
          viewport={{ once: true }}
        >
          <div
            className="h-6 w-6 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold"
            style={{ background: `${c.color}15`, color: `${c.color}99` }}
          >
            {c.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-white/60 truncate">{c.name}</div>
          </div>
          <span className="text-[10px] font-bold shrink-0" style={{ color: c.color }}>{c.match}</span>
          <motion.div
            className="text-[9px] px-2 py-0.5 rounded bg-white/5 text-white/40 shrink-0 cursor-default"
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            transition={{ delay: 0.5 + i * 0.2, duration: 0.3 }}
            viewport={{ once: true }}
          >
            Scrape
          </motion.div>
        </motion.div>
      ))}
    </div>
  );
}

/* Precision Audience Extraction — profile data being populated */
export function MockupAudienceExtraction() {
  const profiles = [
    { name: "Sarah K.", fields: ["New York", "Marketing"], color: "#00AAFF" },
    { name: "Mike R.", fields: ["London", "Finance"], color: "#7C5CFF" },
    { name: "Lisa P.", fields: ["KL", "Design"], color: "#FF3366" },
    { name: "Alex T.", fields: ["Sydney", "Tech"], color: "#FFAA00" },
  ];

  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-[#00AAFF] animate-pulse" />
          <span className="text-[10px] text-white/30 uppercase tracking-wider">Extracting...</span>
        </div>
        <span className="text-[9px] text-[#00AAFF]/50">18 fields</span>
      </div>
      {profiles.map((p, i) => (
        <motion.div
          key={p.name}
          className="flex items-center gap-2 py-2 border-t border-white/[0.04]"
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.15, duration: 0.4 }}
          viewport={{ once: true }}
        >
          <div className="h-5 w-5 rounded-full shrink-0" style={{ background: `${p.color}20` }} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-white/50 mb-1">{p.name}</div>
            <div className="flex gap-1">
              {p.fields.map((f, fi) => (
                <motion.span
                  key={f}
                  className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/[0.04] text-white/30"
                  initial={{ opacity: 0, scale: 0.8 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.15 + fi * 0.1 + 0.2, duration: 0.3 }}
                  viewport={{ once: true }}
                >
                  {f}
                </motion.span>
              ))}
            </div>
          </div>
          <motion.svg
            className="h-3 w-3 text-[#00AAFF]/40 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            transition={{ delay: i * 0.15 + 0.3, duration: 0.3 }}
            viewport={{ once: true }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </motion.svg>
        </motion.div>
      ))}
      <motion.div
        className="mt-2 pt-2 border-t border-white/[0.04] flex items-center justify-between"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        viewport={{ once: true }}
      >
        <span className="text-sm font-bold text-white/70">2,847</span>
        <span className="text-[10px] text-white/30">/ 5,000 profiles</span>
      </motion.div>
    </div>
  );
}

/* Engagement & Intent Scoring — AI scoring fans with bot detection */
export function MockupEngagementScoring() {
  const fans = [
    { name: "Sarah K.", score: 92, label: "High", barColor: "#10b981", isBot: false },
    { name: "Bot_2847", score: 12, label: "Bot", barColor: "#ef4444", isBot: true },
    { name: "Mike R.", score: 78, label: "Med", barColor: "#f59e0b", isBot: false },
    { name: "Lisa P.", score: 95, label: "High", barColor: "#10b981", isBot: false },
  ];

  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-[#FF3366] animate-pulse" />
        <span className="text-[10px] text-white/30 uppercase tracking-wider">AI Scoring</span>
      </div>
      {fans.map((f, i) => (
        <motion.div
          key={f.name}
          className={`flex items-center gap-2 py-2 border-t border-white/[0.04] ${f.isBot ? "opacity-40" : ""}`}
          initial={{ opacity: 0, x: -8 }}
          whileInView={{ opacity: f.isBot ? 0.4 : 1, x: 0 }}
          transition={{ delay: i * 0.15, duration: 0.4 }}
          viewport={{ once: true }}
        >
          <div className="h-5 w-5 rounded-full shrink-0 bg-white/5" />
          <div className="flex-1 min-w-0">
            <div className={`text-[10px] mb-1 ${f.isBot ? "text-red-400/60 line-through" : "text-white/50"}`}>
              {f.name}
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: f.barColor }}
                initial={{ width: "0%" }}
                whileInView={{ width: `${f.score}%` }}
                transition={{ delay: i * 0.15 + 0.2, duration: 0.6, ease: "easeOut" }}
                viewport={{ once: true }}
              />
            </div>
          </div>
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
            style={{
              color: f.barColor,
              background: `${f.barColor}15`,
            }}
          >
            {f.label}
          </span>
        </motion.div>
      ))}
      <motion.div
        className="mt-2 pt-2 border-t border-white/[0.04] text-center"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.5 }}
        viewport={{ once: true }}
      >
        <span className="text-[10px] text-white/30">3 high-intent / </span>
        <span className="text-[10px] text-red-400/40">1 bot filtered</span>
      </motion.div>
    </div>
  );
}

/* One-Click FB Ads Export — export pipeline visualization */
export function MockupFBAdsExport() {
  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-[#FFAA00]" />
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Export Ready</span>
      </div>

      <motion.div
        className="text-center mb-4 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        viewport={{ once: true }}
      >
        <span className="text-lg font-bold text-white/70">1,247</span>
        <span className="text-[10px] text-white/30 ml-1">high-intent profiles</span>
      </motion.div>

      <motion.div
        className="flex items-center justify-center mb-3"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.3 }}
        viewport={{ once: true }}
      >
        <svg className="h-4 w-4 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
        </svg>
      </motion.div>

      <div className="flex gap-2">
        <motion.div
          className="flex-1 p-3 rounded-xl border border-[#1877F2]/20 bg-[#1877F2]/5 text-center"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          viewport={{ once: true }}
        >
          <div className="h-7 w-7 rounded-lg bg-[#1877F2]/10 mx-auto mb-1.5 flex items-center justify-center">
            <svg className="h-3.5 w-3.5 text-[#1877F2]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </div>
          <span className="text-[9px] text-[#1877F2]/70 font-medium">FB Ads</span>
          <div className="flex items-center justify-center gap-1 mt-1">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[8px] text-emerald-400/60">Ready</span>
          </div>
        </motion.div>
        <motion.div
          className="flex-1 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] text-center"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          viewport={{ once: true }}
        >
          <div className="h-7 w-7 rounded-lg bg-white/5 mx-auto mb-1.5 flex items-center justify-center">
            <svg className="h-3.5 w-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <span className="text-[9px] text-white/40 font-medium">CSV</span>
          <div className="flex items-center justify-center gap-1 mt-1">
            <div className="h-1.5 w-1.5 rounded-full bg-white/20" />
            <span className="text-[8px] text-white/30">Ready</span>
          </div>
        </motion.div>
      </div>

      <motion.div
        className="mt-3 mx-auto h-1 w-16 rounded-full"
        style={{ background: "linear-gradient(90deg, #1877F2, #FFAA00)" }}
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        transition={{ delay: 0.7, duration: 0.8 }}
        viewport={{ once: true }}
      />
    </div>
  );
}
