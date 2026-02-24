"use client";

import { useEffect, useCallback } from "react";

/* ── Props ── */
interface ConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: "red" | "yellow" | "blue";
  loading?: boolean;
}

/* ── Confirm-button gradient map ── */
const colorMap: Record<
  NonNullable<ConfirmModalProps["confirmColor"]>,
  string
> = {
  red: "from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 shadow-red-500/25",
  yellow:
    "from-yellow-500 to-amber-600 hover:from-yellow-600 hover:to-amber-700 shadow-yellow-500/25",
  blue: "from-primary-500 to-blue-600 hover:from-primary-600 hover:to-blue-700 shadow-primary-500/25",
};

/* ── Component ── */
export default function ConfirmModal({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = "Confirm",
  confirmColor = "red",
  loading = false,
}: ConfirmModalProps) {
  /* Close on Escape key */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      {/* Glass card */}
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl border border-white/10
                   bg-navy-900/95 backdrop-blur-xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Warning icon */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15">
          <svg
            className="h-7 w-7 text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>

        {/* Title */}
        <h2 className="text-center text-lg font-semibold text-white">
          {title}
        </h2>

        {/* Message */}
        <p className="mt-2 text-center text-sm leading-relaxed text-white/60">
          {message}
        </p>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          {/* Cancel (ghost) */}
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-xl px-5 py-2.5 text-sm font-medium text-white/70
                       transition-colors hover:bg-white/10 hover:text-white
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>

          {/* Confirm (gradient) */}
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex items-center gap-2 rounded-xl bg-gradient-to-r px-5 py-2.5
                        text-sm font-semibold text-white shadow-lg transition-all
                        disabled:opacity-60 disabled:cursor-not-allowed
                        ${colorMap[confirmColor]}`}
          >
            {loading && (
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
