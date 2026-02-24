"use client";

import { useEffect, useState } from "react";
import { useToastStore, type Toast } from "@/stores/toastStore";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  X,
} from "lucide-react";

/* ── Type-based style config ── */
const toastConfig: Record<
  Toast["type"],
  { icon: typeof CheckCircle2; borderColor: string; iconColor: string; bgTint: string }
> = {
  success: {
    icon: CheckCircle2,
    borderColor: "border-emerald-500/30",
    iconColor: "text-emerald-400",
    bgTint: "bg-emerald-500/10",
  },
  error: {
    icon: XCircle,
    borderColor: "border-red-500/30",
    iconColor: "text-red-400",
    bgTint: "bg-red-500/10",
  },
  warning: {
    icon: AlertTriangle,
    borderColor: "border-amber-500/30",
    iconColor: "text-amber-400",
    bgTint: "bg-amber-500/10",
  },
  info: {
    icon: Info,
    borderColor: "border-blue-500/30",
    iconColor: "text-blue-400",
    bgTint: "bg-blue-500/10",
  },
};

/* ── Single Toast Item ── */
function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [dismissing, setDismissing] = useState(false);

  const config = toastConfig[toast.type];
  const Icon = config.icon;

  const handleDismiss = () => {
    setDismissing(true);
    // Wait for the fade-out animation to finish, then remove from store
    setTimeout(() => removeToast(toast.id), 250);
  };

  // Auto-dismiss visual: start the exit animation slightly before the store removes it
  const duration = toast.duration ?? 5000;
  useEffect(() => {
    if (duration <= 0) return;
    const earlyExit = Math.max(duration - 300, 0);
    const timer = setTimeout(() => setDismissing(true), earlyExit);
    return () => clearTimeout(timer);
  }, [duration]);

  return (
    <div
      role="alert"
      className={`
        relative flex w-full items-start gap-3 rounded-xl border p-4
        backdrop-blur-xl shadow-2xl
        bg-white/[0.06] ${config.borderColor}
        ${dismissing ? "animate-toast-out" : "animate-toast-in"}
      `}
    >
      {/* Colored left accent bar */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${config.bgTint}`}
        style={{ background: `linear-gradient(180deg, ${accentGradient(toast.type)})` }}
      />

      {/* Icon */}
      <div className={`mt-0.5 shrink-0 ${config.iconColor}`}>
        <Icon size={20} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white/90 leading-snug">
          {toast.title}
        </p>
        {toast.message && (
          <p className="mt-1 text-xs text-white/50 leading-relaxed">
            {toast.message}
          </p>
        )}
      </div>

      {/* Close button */}
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-lg p-1 text-white/30 transition-colors
                   hover:bg-white/10 hover:text-white/70"
        aria-label="Dismiss notification"
      >
        <X size={16} />
      </button>
    </div>
  );
}

/* ── Container (fixed bottom-right) ── */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-3
                 w-[380px] max-w-[calc(100vw-2rem)]
                 sm:bottom-6 sm:right-6"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

/* ── Helper: accent gradient per type ── */
function accentGradient(type: Toast["type"]): string {
  switch (type) {
    case "success":
      return "#10b981, #059669";
    case "error":
      return "#ef4444, #dc2626";
    case "warning":
      return "#f59e0b, #d97706";
    case "info":
      return "#3b82f6, #2563eb";
  }
}
