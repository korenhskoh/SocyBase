"use client";

import { motion } from "framer-motion";

/* Profile Extraction — data fields highlighting one by one */
export function MockupProfileExtraction() {
  const fields = [
    { label: "Full Name", w: "70%", color: "#00AAFF" },
    { label: "Education", w: "55%", color: "#7C5CFF" },
    { label: "Work", w: "60%", color: "#FF3366" },
    { label: "Location", w: "50%", color: "#FFAA00" },
    { label: "Gender", w: "30%", color: "#00AAFF" },
  ];

  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#00AAFF]/30 to-[#7C5CFF]/30" />
        <div>
          <div className="h-2.5 w-20 rounded bg-white/10 mb-1.5" />
          <div className="h-2 w-14 rounded bg-white/5" />
        </div>
      </div>
      {fields.map((f, i) => (
        <motion.div
          key={f.label}
          className="flex items-center gap-2 py-1.5"
          initial={{ opacity: 0.3 }}
          whileInView={{ opacity: 1 }}
          transition={{ delay: i * 0.2, duration: 0.4 }}
          viewport={{ once: true }}
        >
          <div className="h-1.5 w-1.5 rounded-full" style={{ background: f.color }} />
          <span className="text-[10px] text-white/30 w-16">{f.label}</span>
          <motion.div
            className="h-2 rounded"
            style={{ width: f.w, background: `${f.color}15` }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            transition={{ delay: i * 0.2 + 0.1, duration: 0.5 }}
            viewport={{ once: true }}
          />
        </motion.div>
      ))}
    </div>
  );
}

/* Comment Scraping — scrolling comment feed */
export function MockupCommentScraping() {
  const comments = [
    { name: "Sarah K.", color: "#00AAFF", w: "80%" },
    { name: "Mike R.", color: "#FF3366", w: "65%" },
    { name: "Lisa P.", color: "#7C5CFF", w: "75%" },
    { name: "Alex T.", color: "#FFAA00", w: "55%" },
  ];

  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px] overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-[#7C5CFF]" />
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Live Feed</span>
      </div>
      {comments.map((c, i) => (
        <motion.div
          key={c.name}
          className="flex items-start gap-2 py-2 border-t border-white/[0.04]"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.15, duration: 0.4 }}
          viewport={{ once: true }}
        >
          <div className="h-5 w-5 rounded-full shrink-0 mt-0.5" style={{ background: `${c.color}20` }} />
          <div className="flex-1">
            <div className="h-2 w-12 rounded bg-white/10 mb-1.5" />
            <div className="h-1.5 rounded bg-white/5" style={{ width: c.w }} />
          </div>
          <motion.div
            className="shrink-0 mt-1"
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            transition={{ delay: i * 0.15 + 0.3, duration: 0.3 }}
            viewport={{ once: true }}
          >
            <svg className="h-3 w-3 text-[#7C5CFF]/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </motion.div>
        </motion.div>
      ))}
    </div>
  );
}

/* Bulk Processing — progress bar + counter */
export function MockupBulkProcessing() {
  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Batch Job</span>
        <span className="text-[10px] text-[#FF3366]/60">Processing</span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.05] mb-3 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: "linear-gradient(90deg, #FF3366, #FFAA00)" }}
          initial={{ width: "0%" }}
          whileInView={{ width: "73%" }}
          transition={{ duration: 2, ease: "easeOut" }}
          viewport={{ once: true }}
        />
      </div>
      <div className="flex items-center justify-between">
        <motion.span
          className="text-lg font-bold text-white/80"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          viewport={{ once: true }}
        >
          7,342
        </motion.span>
        <span className="text-[10px] text-white/30">/ 10,000 profiles</span>
      </div>
      <div className="mt-3 space-y-1.5">
        {[70, 45, 60].map((w, i) => (
          <motion.div
            key={i}
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ delay: 0.8 + i * 0.1 }}
            viewport={{ once: true }}
          >
            <div className="h-1 w-1 rounded-full bg-[#FF3366]/40" />
            <div className="h-1.5 rounded bg-white/5" style={{ width: `${w}%` }} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* Export Anywhere — file format cards fanning out */
export function MockupExportAnywhere() {
  const formats = [
    { name: "CSV", color: "#00AAFF", delay: 0 },
    { name: "Excel", color: "#7C5CFF", delay: 0.15 },
    { name: "FB Ads", color: "#FF3366", delay: 0.3 },
  ];

  return (
    <div className="glass-card-soft p-4 w-full max-w-[280px]">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-2 w-2 rounded-full bg-[#FFAA00]" />
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Export Ready</span>
      </div>
      <div className="flex gap-2 justify-center">
        {formats.map((f) => (
          <motion.div
            key={f.name}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]"
            initial={{ opacity: 0, y: 15, rotate: -5 }}
            whileInView={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: f.delay, duration: 0.5, ease: "easeOut" }}
            viewport={{ once: true }}
          >
            <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: `${f.color}10` }}>
              <svg className="h-4 w-4" style={{ color: f.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <span className="text-[10px] font-medium" style={{ color: `${f.color}99` }}>{f.name}</span>
          </motion.div>
        ))}
      </div>
      <motion.div
        className="mt-3 mx-auto h-1 w-16 rounded-full"
        style={{ background: "linear-gradient(90deg, #00AAFF, #FFAA00)" }}
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        transition={{ delay: 0.6, duration: 0.8 }}
        viewport={{ once: true }}
      />
    </div>
  );
}
