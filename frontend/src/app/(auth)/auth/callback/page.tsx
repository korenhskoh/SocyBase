"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/authStore";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser } = useAuthStore();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    // Legacy support: direct token params
    const accessToken = searchParams.get("access_token");
    const refreshToken = searchParams.get("refresh_token");

    if (errorParam) {
      setError(errorParam);
      return;
    }

    if (code) {
      // Exchange the short-lived code for tokens
      authApi
        .exchangeOAuthCode(code)
        .then((res) => {
          localStorage.setItem("access_token", res.data.access_token);
          localStorage.setItem("refresh_token", res.data.refresh_token);
          return authApi.me();
        })
        .then((res) => {
          setUser(res.data);
          router.push("/dashboard");
        })
        .catch(() => {
          setError("Failed to complete sign in. Please try again.");
        });
    } else if (accessToken && refreshToken) {
      localStorage.setItem("access_token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);

      authApi
        .me()
        .then((res) => {
          setUser(res.data);
          router.push("/dashboard");
        })
        .catch(() => {
          setError("Failed to load user profile. Please try again.");
        });
    } else {
      setError("Invalid callback parameters. Please try again.");
    }
  }, [searchParams, setUser, router]);

  if (error) {
    return (
      <div className="glass-card p-8 animate-slide-up text-center">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-red-500/20 flex items-center justify-center mb-4">
          <svg className="h-7 w-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Authentication Failed</h2>
        <p className="text-sm text-white/50 mb-6">{error}</p>
        <a
          href="/login"
          className="inline-flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300 transition"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <div className="glass-card p-8 animate-slide-up text-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-white/50 text-sm">Completing sign in...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="glass-card p-8 animate-slide-up text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="h-10 w-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-white/50 text-sm">Loading...</p>
          </div>
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
