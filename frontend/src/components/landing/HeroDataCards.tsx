"use client";

import { motion } from "framer-motion";

const dataFields = [
  { name: "Full Name", value: "John Doe", color: "#00AAFF" },
  { name: "Location", value: "New York, US", color: "#7C5CFF" },
  { name: "Education", value: "MIT '18", color: "#FF3366" },
  { name: "Work", value: "Google Inc.", color: "#FFAA00" },
  { name: "Position", value: "Sr. Engineer", color: "#00AAFF" },
  { name: "Gender", value: "Male", color: "#7C5CFF" },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15, delayChildren: 0.5 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, x: 20, scale: 0.9 },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.5, ease: "easeOut" },
  },
};

export function HeroDataCards() {
  return (
    <motion.div
      className="flex flex-col gap-2"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {dataFields.map((field) => (
        <motion.div
          key={field.name}
          variants={cardVariants}
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm"
        >
          <div
            className="h-2 w-2 rounded-full shrink-0"
            style={{ background: field.color, boxShadow: `0 0 8px ${field.color}40` }}
          />
          <span className="text-xs text-white/40 w-20 shrink-0">{field.name}</span>
          <span className="text-sm text-white/80 font-medium">{field.value}</span>
        </motion.div>
      ))}
    </motion.div>
  );
}
