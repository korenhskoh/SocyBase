import { useEffect, useState, useRef, useCallback } from "react";
import { liveSellApi } from "@/lib/api-client";
import type { LiveComment } from "@/types";

/**
 * React hook that connects to the SSE stream for real-time live comments.
 *
 * Listens for `new_comment`, `session_ended` events.
 * Tracks comments-per-minute and provides an `onNewOrder` callback for
 * notification sounds / toasts.
 */
export function useLiveComments(
  sessionId: string,
  enabled: boolean = true,
  onNewOrder?: (comment: LiveComment) => void,
) {
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [connected, setConnected] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onNewOrderRef = useRef(onNewOrder);
  onNewOrderRef.current = onNewOrder;

  // Derived
  const orderCount = comments.filter((c) => c.is_order).length;

  // Comments-per-minute (rolling 60s window)
  const [cpm, setCpm] = useState(0);
  const timestampsRef = useRef<number[]>([]);
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      timestampsRef.current = timestampsRef.current.filter((t) => now - t < 60_000);
      setCpm(timestampsRef.current.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Reset when session changes
  useEffect(() => {
    setComments([]);
    setSessionEnded(false);
    timestampsRef.current = [];
    setCpm(0);
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const token = localStorage.getItem("access_token");
    if (!token) return;

    const url =
      liveSellApi.getCommentStreamUrl(sessionId) +
      `?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("session_info", () => {
      setConnected(true);
    });

    es.addEventListener("new_comment", (e: MessageEvent) => {
      try {
        const comment: LiveComment = JSON.parse(e.data);
        setComments((prev) => [...prev, comment]);
        timestampsRef.current.push(Date.now());
        if (comment.is_order && onNewOrderRef.current) {
          onNewOrderRef.current(comment);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    es.addEventListener("session_ended", () => {
      setSessionEnded(true);
      es.close();
      setConnected(false);
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [sessionId, enabled]);

  const clearComments = useCallback(() => {
    setComments([]);
    timestampsRef.current = [];
    setCpm(0);
  }, []);

  return { comments, connected, sessionEnded, orderCount, cpm, clearComments };
}

/**
 * Play a short notification sound using Web Audio API.
 * `type`: "order" = cash-register chime, "comment" = soft blip.
 */
export function playNotificationSound(type: "order" | "comment" = "order") {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "order") {
      // Two-tone chime: pleasant cha-ching
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1108, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } else {
      // Soft blip
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    }
  } catch {
    // Audio not supported — silent fallback
  }
}
