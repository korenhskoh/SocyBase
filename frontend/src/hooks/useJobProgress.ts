import { useEffect, useState, useRef } from "react";
import { jobsApi } from "@/lib/api-client";

interface JobProgress {
  status: string;
  progress_pct: number;
  processed_items: number;
  total_items: number;
  failed_items: number;
  result_row_count: number;
}

/**
 * React hook that connects to the SSE stream for real-time job progress.
 *
 * Usage:
 * ```tsx
 * const { progress, connected } = useJobProgress(jobId, isActive);
 * ```
 *
 * The hook automatically closes the connection when the job reaches a terminal
 * state ("completed", "failed", "cancelled") or when the component unmounts.
 *
 * Because the browser `EventSource` API cannot send custom headers, the JWT
 * access token is passed as a `?token=` query parameter.
 */
export function useJobProgress(jobId: string, enabled: boolean = true) {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !jobId) return;

    const token = localStorage.getItem("access_token");
    if (!token) return;

    const url = jobsApi.getProgressStreamUrl(jobId) + `?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("progress", (e: MessageEvent) => {
      try {
        setProgress(JSON.parse(e.data));
        setConnected(true);
      } catch {
        // Ignore malformed messages
      }
    });

    es.addEventListener("done", (e: MessageEvent) => {
      try {
        setProgress(JSON.parse(e.data));
      } catch {
        // Ignore malformed messages
      }
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
  }, [jobId, enabled]);

  return { progress, connected };
}
