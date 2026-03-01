"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { platformsApi } from "@/lib/api-client";
import type { Platform } from "@/types";

interface EditValues {
  display_name?: string;
  credit_cost_per_profile?: number;
  credit_cost_per_comment_page?: number;
  credit_cost_per_post?: number;
}

export default function AdminPlatformsPage() {
  const { user } = useAuth(true);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<EditValues>({});
  const [newPlatform, setNewPlatform] = useState({
    name: "",
    display_name: "",
    credit_cost_per_profile: 1,
    credit_cost_per_comment_page: 1,
    credit_cost_per_post: 1,
  });

  const fetchPlatforms = () => {
    setLoading(true);
    platformsApi
      .adminList()
      .then((r) => setPlatforms(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (user?.role === "super_admin") fetchPlatforms();
  }, [user]);

  const handleCreate = async () => {
    try {
      await platformsApi.create(newPlatform);
      setShowCreate(false);
      setNewPlatform({ name: "", display_name: "", credit_cost_per_profile: 1, credit_cost_per_comment_page: 1, credit_cost_per_post: 1 });
      fetchPlatforms();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to create platform");
    }
  };

  const startEdit = (p: Platform) => {
    setEditingId(p.id);
    setEditValues({
      display_name: p.display_name,
      credit_cost_per_profile: p.credit_cost_per_profile,
      credit_cost_per_comment_page: p.credit_cost_per_comment_page,
      credit_cost_per_post: p.credit_cost_per_post ?? 1,
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await platformsApi.update(editingId, editValues);
      setEditingId(null);
      fetchPlatforms();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update");
    }
  };

  const handleToggleEnabled = async (p: Platform) => {
    try {
      await platformsApi.update(p.id, { is_enabled: !p.is_enabled });
      fetchPlatforms();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to toggle");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this platform? This cannot be undone.")) return;
    try {
      await platformsApi.delete(id);
      fetchPlatforms();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to delete");
    }
  };

  if (user?.role !== "super_admin") {
    return (
      <div className="text-center py-20 text-white/40">
        Access denied. Super admin only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/admin" className="text-white/40 hover:text-white transition">
              &larr;
            </Link>
            <h1 className="text-2xl md:text-3xl font-bold text-white">Platforms</h1>
          </div>
          <p className="text-white/50 mt-1 ml-7">
            Manage scraping platforms, enable/disable and set credit costs
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-glow text-sm shrink-0"
        >
          {showCreate ? "Cancel" : "+ Add Platform"}
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-sm font-medium text-white/60 uppercase tracking-wider">New Platform</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-white/40 mb-1">Name (slug)</label>
              <input
                type="text"
                value={newPlatform.name}
                onChange={(e) => setNewPlatform({ ...newPlatform, name: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                className="input-glass text-sm"
                placeholder="e.g. instagram"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Display Name</label>
              <input
                type="text"
                value={newPlatform.display_name}
                onChange={(e) => setNewPlatform({ ...newPlatform, display_name: e.target.value })}
                className="input-glass text-sm"
                placeholder="e.g. Instagram"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Credits / Profile</label>
              <input
                type="number"
                min={0}
                value={newPlatform.credit_cost_per_profile}
                onChange={(e) => setNewPlatform({ ...newPlatform, credit_cost_per_profile: parseInt(e.target.value) || 0 })}
                className="input-glass text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Credits / Comment Page</label>
              <input
                type="number"
                min={0}
                value={newPlatform.credit_cost_per_comment_page}
                onChange={(e) => setNewPlatform({ ...newPlatform, credit_cost_per_comment_page: parseInt(e.target.value) || 0 })}
                className="input-glass text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-1">Credits / Job Post</label>
              <input
                type="number"
                min={0}
                value={newPlatform.credit_cost_per_post}
                onChange={(e) => setNewPlatform({ ...newPlatform, credit_cost_per_post: parseInt(e.target.value) || 0 })}
                className="input-glass text-sm"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!newPlatform.name || !newPlatform.display_name}
            className="text-sm px-4 py-2 rounded-lg font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 hover:bg-emerald-400/20 transition disabled:opacity-40"
          >
            Create Platform
          </button>
        </div>
      )}

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : platforms.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-white/30">No platforms configured</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px]">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Display Name</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Credits / Profile</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Credits / Comment</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Credits / Post</th>
                  <th className="text-left text-xs font-medium text-white/40 uppercase tracking-wider px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {platforms.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition">
                    {editingId === p.id ? (
                      <>
                        <td className="px-6 py-3 text-sm text-white/50">{p.name}</td>
                        <td className="px-6 py-3">
                          <input
                            type="text"
                            value={editValues.display_name ?? ""}
                            onChange={(e) => setEditValues({ ...editValues, display_name: e.target.value })}
                            className="input-glass text-sm w-full"
                          />
                        </td>
                        <td className="px-6 py-3">
                          <span className="text-xs text-white/40">-</span>
                        </td>
                        <td className="px-6 py-3">
                          <input
                            type="number"
                            min={0}
                            value={editValues.credit_cost_per_profile ?? 0}
                            onChange={(e) => setEditValues({ ...editValues, credit_cost_per_profile: parseInt(e.target.value) || 0 })}
                            className="input-glass text-sm w-16"
                          />
                        </td>
                        <td className="px-6 py-3">
                          <input
                            type="number"
                            min={0}
                            value={editValues.credit_cost_per_comment_page ?? 0}
                            onChange={(e) => setEditValues({ ...editValues, credit_cost_per_comment_page: parseInt(e.target.value) || 0 })}
                            className="input-glass text-sm w-16"
                          />
                        </td>
                        <td className="px-6 py-3">
                          <input
                            type="number"
                            min={0}
                            value={editValues.credit_cost_per_post ?? 0}
                            onChange={(e) => setEditValues({ ...editValues, credit_cost_per_post: parseInt(e.target.value) || 0 })}
                            className="input-glass text-sm w-16"
                          />
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={saveEdit}
                              className="text-xs px-3 py-1.5 rounded-lg font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 hover:bg-emerald-400/20 transition"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs px-3 py-1.5 rounded-lg font-medium text-white/40 bg-white/5 border border-white/10 hover:text-white/80 transition"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 text-sm text-white/80 font-medium">{p.name}</td>
                        <td className="px-6 py-4 text-sm text-white/60">{p.display_name}</td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleToggleEnabled(p)}
                            className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${
                              p.is_enabled
                                ? "text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20"
                                : "text-gray-400 bg-gray-400/10 hover:bg-gray-400/20"
                            }`}
                          >
                            {p.is_enabled ? "Enabled" : "Disabled"}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-sm text-white/60">{p.credit_cost_per_profile}</td>
                        <td className="px-6 py-4 text-sm text-white/60">{p.credit_cost_per_comment_page}</td>
                        <td className="px-6 py-4 text-sm text-white/60">{p.credit_cost_per_post ?? 1}</td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => startEdit(p)}
                              className="text-xs px-3 py-1.5 rounded-lg font-medium text-blue-400 bg-blue-400/10 border border-blue-400/20 hover:bg-blue-400/20 transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(p.id)}
                              className="text-xs px-3 py-1.5 rounded-lg font-medium text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
