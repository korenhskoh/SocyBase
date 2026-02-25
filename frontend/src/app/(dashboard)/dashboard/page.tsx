"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { creditsApi, jobsApi } from "@/lib/api-client";
import { formatCredits, getStatusColor, formatDate } from "@/lib/utils";
import type { CreditBalance, ScrapingJob } from "@/types";

export default function DashboardPage() {
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [recentJobs, setRecentJobs] = useState<ScrapingJob[]>([]);

  useEffect(() => {
    creditsApi.getBalance().then((r) => setBalance(r.data)).catch(() => {});
    jobsApi.list({ page: 1, page_size: 5 }).then((r) => {
      const data = r.data;
      setRecentJobs(data?.items || (Array.isArray(data) ? data : []));
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Dashboard</h1>
        <p className="text-white/50 mt-1">Welcome to SocyBase</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Credit Balance */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary-500/20 flex items-center justify-center">
              <svg className="h-6 w-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-white/50">Credit Balance</p>
              <p className="text-2xl font-bold text-white">
                {balance ? formatCredits(balance.balance) : "---"}
              </p>
            </div>
          </div>
        </div>

        {/* Total Used */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-accent-purple/20 flex items-center justify-center">
              <svg className="h-6 w-6 text-accent-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-white/50">Credits Used</p>
              <p className="text-2xl font-bold text-white">
                {balance ? formatCredits(balance.lifetime_used) : "---"}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Action */}
        <Link href="/jobs/new" className="glass-card p-6 hover:border-primary-500/30 transition-all group">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-accent-pink/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="h-6 w-6 text-accent-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-white/50">Quick Start</p>
              <p className="text-lg font-semibold text-white">New Scraping Job</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Recent Jobs */}
      <div className="glass-card">
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <h2 className="text-lg font-semibold text-white">Recent Jobs</h2>
          <Link href="/jobs" className="text-sm text-primary-400 hover:text-primary-300 transition">
            View all
          </Link>
        </div>
        <div className="divide-y divide-white/5">
          {recentJobs.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-white/30">No jobs yet. Create your first scraping job!</p>
            </div>
          ) : (
            recentJobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-4 hover:bg-white/[0.02] transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-2 w-2 rounded-full bg-primary-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium truncate">
                      {job.input_value}
                    </p>
                    <p className="text-xs text-white/40">{formatDate(job.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-5 sm:ml-0 shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStatusColor(job.status)}`}>
                    {job.status}
                  </span>
                  <span className="text-sm text-white/40">{job.result_row_count} profiles</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
