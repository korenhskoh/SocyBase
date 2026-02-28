"use client";

import { useEffect, useState, useMemo } from "react";
import { trafficBotApi } from "@/lib/api-client";
import type { TrafficBotService, TrafficBotOrderList, TrafficBotWalletDeposit } from "@/types";

export default function AdminTrafficBotPage() {
  const [tab, setTab] = useState<"services" | "orders" | "deposits">("services");
  const [services, setServices] = useState<TrafficBotService[]>([]);
  const [orders, setOrders] = useState<TrafficBotOrderList | null>(null);
  const [depositRequests, setDepositRequests] = useState<TrafficBotWalletDeposit[]>([]);
  const [depositStatusFilter, setDepositStatusFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [apiBalance, setApiBalance] = useState<{ balance: string; currency: string } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  // Deposit modal
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositTenantId, setDepositTenantId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositDesc, setDepositDesc] = useState("Admin deposit");
  const [depositing, setDepositing] = useState(false);

  // Bulk fee
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkFee, setBulkFee] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [svcRes, balRes] = await Promise.all([
        trafficBotApi.getAllServices(),
        trafficBotApi.getApiBalance().catch(() => ({ data: null })),
      ]);
      setServices(svcRes.data);
      if (balRes.data) setApiBalance(balRes.data);
    } finally {
      setLoading(false);
    }
  }

  async function loadOrders() {
    const r = await trafficBotApi.getAllOrders({ limit: 50 });
    setOrders(r.data);
  }

  async function loadDeposits(status?: string) {
    const r = await trafficBotApi.getDepositRequests(status || depositStatusFilter);
    setDepositRequests(r.data);
  }

  useEffect(() => {
    if (tab === "orders" && !orders) loadOrders();
    if (tab === "deposits") loadDeposits();
  }, [tab]);

  useEffect(() => {
    if (tab === "deposits") loadDeposits(depositStatusFilter);
  }, [depositStatusFilter]);

  async function handleApproveDeposit(id: string) {
    const notes = prompt("Admin notes (optional):");
    try {
      await trafficBotApi.approveDeposit(id, notes || undefined);
      loadDeposits();
    } catch (err: unknown) {
      alert("Failed: " + ((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Unknown error"));
    }
  }

  async function handleRejectDeposit(id: string) {
    const notes = prompt("Rejection reason:");
    if (!notes) return;
    try {
      await trafficBotApi.rejectDeposit(id, notes);
      loadDeposits();
    } catch (err: unknown) {
      alert("Failed: " + ((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Unknown error"));
    }
  }

  const categories = useMemo(() => {
    const cats = new Set(services.map((s) => s.category));
    return Array.from(cats).sort();
  }, [services]);

  const filtered = useMemo(() => {
    let list = services;
    if (categoryFilter !== "All") list = list.filter((s) => s.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    return list;
  }, [services, categoryFilter, search]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [categoryFilter, search]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await trafficBotApi.syncServices();
      alert(`Synced ${r.data.synced} services from API`);
      loadData();
    } catch (err: unknown) {
      alert("Sync failed: " + ((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Unknown error"));
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggleEnabled(svc: TrafficBotService) {
    await trafficBotApi.updateService(svc.id, { is_enabled: !svc.is_enabled });
    setServices((prev) => prev.map((s) => (s.id === svc.id ? { ...s, is_enabled: !s.is_enabled } : s)));
  }

  async function handleUpdateFee(svc: TrafficBotService, newFee: number) {
    await trafficBotApi.updateService(svc.id, { fee_pct: newFee });
    setServices((prev) => prev.map((s) => (s.id === svc.id ? { ...s, fee_pct: newFee } : s)));
  }

  async function handleBulkFee() {
    if (!bulkCategory || !bulkFee) return;
    await trafficBotApi.bulkUpdateFee({ category: bulkCategory, fee_pct: parseFloat(bulkFee) });
    alert(`Updated fee for all ${bulkCategory} services`);
    loadData();
  }

  async function handleDeposit() {
    if (!depositTenantId || !depositAmount) return;
    setDepositing(true);
    try {
      await trafficBotApi.depositWallet({
        tenant_id: depositTenantId,
        amount: parseFloat(depositAmount),
        description: depositDesc,
      });
      alert("Deposit successful");
      setShowDeposit(false);
      setDepositTenantId("");
      setDepositAmount("");
    } catch (err: unknown) {
      alert("Deposit failed: " + ((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Unknown error"));
    } finally {
      setDepositing(false);
    }
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Traffic Bot Admin</h1>
          <p className="text-sm text-white/50 mt-1">
            Manage services, fees, and orders
          </p>
        </div>
        <div className="flex gap-2">
          {apiBalance && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
              <span className="text-xs text-white/40">API Balance:</span>
              <span className="text-sm font-semibold text-primary-400">RM{apiBalance.balance}</span>
            </div>
          )}
          <button
            onClick={() => setShowDeposit(true)}
            className="text-xs px-4 py-2 rounded-xl bg-green-500/10 text-green-400 hover:bg-green-500/20 transition border border-green-500/20 font-medium"
          >
            Deposit to Wallet
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-0">
        {(["services", "orders", "deposits"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-[1px] ${
              tab === t
                ? "text-primary-400 border-primary-500"
                : "text-white/40 border-transparent hover:text-white/60"
            }`}
          >
            {t === "services" ? "Services" : t === "orders" ? "All Orders" : "Deposit Requests"}
          </button>
        ))}
      </div>

      {/* Services Tab */}
      {tab === "services" && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn-glow px-5 py-2.5 rounded-xl text-sm font-semibold"
            >
              {syncing ? "Syncing..." : "Sync from API"}
            </button>
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Search services..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              />
            </div>
          </div>

          {/* Category filter */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCategoryFilter("All")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                categoryFilter === "All"
                  ? "bg-primary-500/20 text-primary-400 border-primary-500/30"
                  : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  categoryFilter === cat
                    ? "bg-primary-500/20 text-primary-400 border-primary-500/30"
                    : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Bulk fee update */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Bulk Fee Update</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              >
                <option value="" className="bg-navy-900">Select category...</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat} className="bg-navy-900">{cat}</option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Fee %"
                value={bulkFee}
                onChange={(e) => setBulkFee(e.target.value)}
                className="w-32 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              />
              <button
                onClick={handleBulkFee}
                disabled={!bulkCategory || !bulkFee}
                className="text-xs px-4 py-2.5 rounded-xl bg-primary-500/10 text-primary-400 hover:bg-primary-500/20 transition border border-primary-500/20 font-medium disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </div>

          {/* Services Table */}
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left py-3 px-4 text-white/40 font-medium">ID</th>
                    <th className="text-left py-3 px-4 text-white/40 font-medium">Service</th>
                    <th className="text-left py-3 px-4 text-white/40 font-medium hidden lg:table-cell">Category</th>
                    <th className="text-right py-3 px-4 text-white/40 font-medium">Base Rate</th>
                    <th className="text-center py-3 px-4 text-white/40 font-medium">Fee %</th>
                    <th className="text-right py-3 px-4 text-white/40 font-medium">Final Rate</th>
                    <th className="text-center py-3 px-4 text-white/40 font-medium">Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((svc) => (
                    <tr key={svc.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="py-2 px-4 text-white/30 text-xs">{svc.external_service_id}</td>
                      <td className="py-2 px-4">
                        <div className="text-white text-xs font-medium truncate max-w-[250px]">{svc.name}</div>
                      </td>
                      <td className="py-2 px-4 text-white/40 text-xs hidden lg:table-cell">{svc.category}</td>
                      <td className="py-2 px-4 text-right text-white/50 text-xs">RM{svc.rate.toFixed(4)}</td>
                      <td className="py-2 px-4 text-center">
                        <input
                          type="number"
                          value={svc.fee_pct}
                          onChange={(e) => handleUpdateFee(svc, parseFloat(e.target.value) || 0)}
                          className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-primary-500/50"
                        />
                      </td>
                      <td className="py-2 px-4 text-right text-primary-400 text-xs font-medium">
                        RM{(svc.rate * (1 + svc.fee_pct / 100)).toFixed(4)}
                      </td>
                      <td className="py-2 px-4 text-center">
                        <button
                          onClick={() => handleToggleEnabled(svc)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                            svc.is_enabled ? "bg-primary-500" : "bg-white/10"
                          }`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition transform ${
                            svc.is_enabled ? "translate-x-4" : "translate-x-1"
                          }`} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
                <span className="text-xs text-white/30">
                  Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length} services
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium transition border border-white/10 bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce<(number | string)[]>((acc, p, idx, arr) => {
                      if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("...");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((item, idx) =>
                      item === "..." ? (
                        <span key={`dots-${idx}`} className="px-1 text-xs text-white/20">...</span>
                      ) : (
                        <button
                          key={item}
                          onClick={() => setPage(item as number)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition border ${
                            page === item
                              ? "bg-primary-500/20 text-primary-400 border-primary-500/30"
                              : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
                          }`}
                        >
                          {item}
                        </button>
                      )
                    )}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium transition border border-white/10 bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Orders Tab */}
      {tab === "orders" && (
        <div>
          {!orders ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-400"></div>
            </div>
          ) : orders.items.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <p className="text-white/40 text-sm">No orders yet</p>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left py-3 px-4 text-white/40 font-medium">Ext ID</th>
                      <th className="text-left py-3 px-4 text-white/40 font-medium">Service</th>
                      <th className="text-left py-3 px-4 text-white/40 font-medium hidden md:table-cell">Link</th>
                      <th className="text-right py-3 px-4 text-white/40 font-medium">Qty</th>
                      <th className="text-right py-3 px-4 text-white/40 font-medium">Total</th>
                      <th className="text-center py-3 px-4 text-white/40 font-medium">Status</th>
                      <th className="text-right py-3 px-4 text-white/40 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.items.map((o) => (
                      <tr key={o.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 px-4 text-white/40 text-xs">{o.external_order_id || "—"}</td>
                        <td className="py-2 px-4 text-white text-xs font-medium truncate max-w-[200px]">{o.service_name || "—"}</td>
                        <td className="py-2 px-4 text-white/40 text-xs truncate max-w-[150px] hidden md:table-cell">{o.link}</td>
                        <td className="py-2 px-4 text-right text-white/60 text-xs">{o.quantity.toLocaleString()}</td>
                        <td className="py-2 px-4 text-right text-primary-400 text-xs font-medium">RM{o.total_cost.toFixed(2)}</td>
                        <td className="py-2 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            o.status === "completed" ? "text-green-400 bg-green-400/10" :
                            o.status === "cancelled" || o.status === "failed" ? "text-red-400 bg-red-400/10" :
                            "text-blue-400 bg-blue-400/10"
                          }`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current"></span>
                            {o.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-right text-white/30 text-xs">
                          {new Date(o.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deposits Tab */}
      {tab === "deposits" && (
        <div className="space-y-4">
          {/* Status filter */}
          <div className="flex gap-2">
            {["pending", "approved", "rejected", ""].map((s) => (
              <button
                key={s}
                onClick={() => setDepositStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  depositStatusFilter === s
                    ? "bg-primary-500/20 text-primary-400 border-primary-500/30"
                    : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"
                }`}
              >
                {s || "All"}
              </button>
            ))}
          </div>

          {depositRequests.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <p className="text-white/40 text-sm">No deposit requests</p>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left py-3 px-4 text-white/40 font-medium">Amount</th>
                      <th className="text-left py-3 px-4 text-white/40 font-medium">Reference</th>
                      <th className="text-left py-3 px-4 text-white/40 font-medium">Proof</th>
                      <th className="text-center py-3 px-4 text-white/40 font-medium">Status</th>
                      <th className="text-left py-3 px-4 text-white/40 font-medium">Tenant</th>
                      <th className="text-right py-3 px-4 text-white/40 font-medium">Date</th>
                      <th className="text-right py-3 px-4 text-white/40 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depositRequests.map((d) => (
                      <tr key={d.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 px-4 text-white font-medium">RM{d.amount.toFixed(2)}</td>
                        <td className="py-2 px-4 text-white/60 text-xs">{d.bank_reference}</td>
                        <td className="py-2 px-4">
                          {d.proof_url ? (
                            <a
                              href={d.proof_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary-400 hover:text-primary-300"
                            >
                              View Proof
                            </a>
                          ) : (
                            <span className="text-xs text-white/20">None</span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            d.status === "approved" ? "text-green-400 bg-green-400/10" :
                            d.status === "rejected" ? "text-red-400 bg-red-400/10" :
                            "text-amber-400 bg-amber-400/10"
                          }`}>
                            {d.status}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-white/30 text-xs truncate max-w-[120px]">{d.tenant_id.slice(0, 8)}...</td>
                        <td className="py-2 px-4 text-right text-white/30 text-xs">
                          {new Date(d.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-4 text-right">
                          {d.status === "pending" && (
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => handleApproveDeposit(d.id)}
                                className="text-xs px-3 py-1.5 rounded-lg font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 hover:bg-emerald-400/20 transition"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleRejectDeposit(d.id)}
                                className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                          {d.admin_notes && (
                            <p className="text-xs text-white/20 mt-1">{d.admin_notes}</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deposit Modal */}
      {showDeposit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">Deposit to Wallet</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Tenant ID</label>
                <input
                  type="text"
                  value={depositTenantId}
                  onChange={(e) => setDepositTenantId(e.target.value)}
                  placeholder="UUID of tenant"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Amount (RM)</label>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Description</label>
                <input
                  type="text"
                  value={depositDesc}
                  onChange={(e) => setDepositDesc(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setShowDeposit(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/5 text-white/60 hover:bg-white/10 transition border border-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleDeposit}
                disabled={depositing || !depositTenantId || !depositAmount}
                className="flex-1 btn-glow px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {depositing ? "Depositing..." : "Deposit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
