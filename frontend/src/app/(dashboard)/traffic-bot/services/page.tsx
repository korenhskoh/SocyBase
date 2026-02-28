"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { trafficBotApi } from "@/lib/api-client";
import type { TrafficBotService } from "@/types";

export default function TrafficBotServicesPage() {
  const router = useRouter();
  const [services, setServices] = useState<TrafficBotService[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      trafficBotApi.getServices().then((r) => setServices(r.data)),
      trafficBotApi.getCategories().then((r) => setCategories(r.data)),
    ]).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = services;
    if (selectedCategory !== "All") {
      list = list.filter((s) => s.category === selectedCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
      );
    }
    return list;
  }, [services, selectedCategory, search]);

  const grouped = useMemo(() => {
    const map: Record<string, TrafficBotService[]> = {};
    for (const s of filtered) {
      if (!map[s.category]) map[s.category] = [];
      map[s.category].push(s);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const categoryIcons: Record<string, string> = {
    Facebook: "M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z",
    Instagram: "M16 4H8a4 4 0 00-4 4v8a4 4 0 004 4h8a4 4 0 004-4V8a4 4 0 00-4-4zm-4 11a3 3 0 110-6 3 3 0 010 6zm4.5-7.5a1 1 0 110-2 1 1 0 010 2z",
    YouTube: "M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29 29 0 001 12a29 29 0 00.46 5.58A2.78 2.78 0 003.4 19.6C5.12 20 12 20 12 20s6.88 0 8.6-.46a2.78 2.78 0 001.94-2A29 29 0 0023 12a29 29 0 00-.46-5.58zM9.75 15.02V8.98L15.5 12l-5.75 3.02z",
    TikTok: "M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.11V9a6.33 6.33 0 00-.79-.05A6.34 6.34 0 003.15 15.3a6.34 6.34 0 0010.86 4.46V12.8a8.25 8.25 0 005.58 2.18V11.5a4.84 4.84 0 01-3.59-1.92z",
  };

  function getPrice(service: TrafficBotService) {
    const base = service.rate;
    const withFee = base * (1 + service.fee_pct / 100);
    return withFee.toFixed(2);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-400"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Traffic Bot Services</h1>
          <p className="text-sm text-white/50 mt-1">
            Browse {services.length} services across {categories.length} platforms
          </p>
        </div>
        <button
          onClick={() => router.push("/traffic-bot/order")}
          className="btn-glow px-5 py-2.5 rounded-xl text-sm font-semibold"
        >
          <svg className="h-4 w-4 mr-2 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Order
        </button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search services..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => setSelectedCategory("All")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              selectedCategory === "All"
                ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
                : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
            }`}
          >
            All ({services.length})
          </button>
          {categories.map((cat) => {
            const count = services.filter((s) => s.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  selectedCategory === cat
                    ? "bg-primary-500/20 text-primary-400 border border-primary-500/30"
                    : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Services by category */}
      {grouped.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <svg className="h-12 w-12 mx-auto text-white/20 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-white/40 text-sm">No services found matching your criteria</p>
        </div>
      ) : (
        grouped.map(([category, items]) => (
          <div key={category}>
            <div className="flex items-center gap-2 mb-3">
              <svg className="h-5 w-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={categoryIcons[category] || "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"} />
              </svg>
              <h2 className="text-lg font-semibold text-white">{category}</h2>
              <span className="text-xs text-white/30">({items.length})</span>
            </div>
            <div className="glass-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left py-3 px-4 text-white/40 font-medium">Service</th>
                    <th className="text-center py-3 px-4 text-white/40 font-medium hidden sm:table-cell">Type</th>
                    <th className="text-right py-3 px-4 text-white/40 font-medium">Rate/1K</th>
                    <th className="text-center py-3 px-4 text-white/40 font-medium hidden md:table-cell">Min</th>
                    <th className="text-center py-3 px-4 text-white/40 font-medium hidden md:table-cell">Max</th>
                    <th className="text-right py-3 px-4 text-white/40 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((svc) => (
                    <tr key={svc.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition">
                      <td className="py-3 px-4">
                        <div className="text-white font-medium text-sm leading-tight">{svc.name}</div>
                        <div className="text-white/30 text-xs mt-0.5">ID: {svc.external_service_id}</div>
                      </td>
                      <td className="py-3 px-4 text-center hidden sm:table-cell">
                        <span className="text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded">{svc.type}</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="text-primary-400 font-semibold">RM{getPrice(svc)}</span>
                      </td>
                      <td className="py-3 px-4 text-center text-white/50 hidden md:table-cell">{svc.min_quantity.toLocaleString()}</td>
                      <td className="py-3 px-4 text-center text-white/50 hidden md:table-cell">{svc.max_quantity.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => router.push(`/traffic-bot/order?service=${svc.id}`)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-primary-500/10 text-primary-400 hover:bg-primary-500/20 transition font-medium"
                        >
                          Order
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
