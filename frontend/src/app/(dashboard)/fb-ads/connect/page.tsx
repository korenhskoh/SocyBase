"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fbAdsApi } from "@/lib/api-client";
import type { FBConnectionStatus, FBAdAccount, FBPageItem, FBPixelItem } from "@/types";

export default function FBConnectionPage() {
  const searchParams = useSearchParams();
  const [connection, setConnection] = useState<FBConnectionStatus | null>(null);
  const [adAccounts, setAdAccounts] = useState<FBAdAccount[]>([]);
  const [pages, setPages] = useState<FBPageItem[]>([]);
  const [pixels, setPixels] = useState<FBPixelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const loadData = async () => {
    try {
      const connRes = await fbAdsApi.getConnection();
      setConnection(connRes.data);

      if (connRes.data.connected) {
        const [accRes, pgRes, pxRes] = await Promise.all([
          fbAdsApi.listAdAccounts(),
          fbAdsApi.listPages(),
          fbAdsApi.listPixels(),
        ]);
        setAdAccounts(accRes.data);
        setPages(pgRes.data);
        setPixels(pxRes.data);
      }
    } catch {
      // Not connected or error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (searchParams.get("connected") === "true") {
      setSuccessMessage("Facebook account connected successfully!");
      setTimeout(() => setSuccessMessage(""), 5000);
    }
    loadData();
  }, [searchParams]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fbAdsApi.getConnectUrl();
      window.location.href = res.data.url;
    } catch {
      alert("Failed to get Facebook connect URL. Make sure META_APP_ID is configured.");
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect your Facebook account?")) return;
    setDisconnecting(true);
    try {
      await fbAdsApi.disconnect();
      setConnection({ connected: false, fb_user_name: null, fb_user_id: null, connected_at: null, last_synced_at: null });
      setAdAccounts([]);
      setPages([]);
      setPixels([]);
    } catch {
      alert("Failed to disconnect.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSelectAccount = async (id: string) => {
    try {
      await fbAdsApi.selectAdAccount(id);
      const [accRes, pxRes] = await Promise.all([
        fbAdsApi.listAdAccounts(),
        fbAdsApi.listPixels(),
      ]);
      setAdAccounts(accRes.data);
      setPixels(pxRes.data);
    } catch {
      alert("Failed to select ad account.");
    }
  };

  const handleSelectPage = async (id: string) => {
    try {
      await fbAdsApi.selectPage(id);
      const pgRes = await fbAdsApi.listPages();
      setPages(pgRes.data);
    } catch {
      alert("Failed to select page.");
    }
  };

  const handleSelectPixel = async (id: string) => {
    try {
      await fbAdsApi.selectPixel(id);
      const pxRes = await fbAdsApi.listPixels();
      setPixels(pxRes.data);
    } catch {
      alert("Failed to select pixel.");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Facebook Ads Connection</h1>
        <p className="text-white/50 mt-1">Connect your Facebook Ad Account to manage campaigns, view performance, and launch AI-powered ads</p>
      </div>

      {successMessage && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
          {successMessage}
        </div>
      )}

      {/* Connection Status */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-blue-500/10 border border-blue-500/20">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">
              {connection?.connected ? "Connected" : "Not Connected"}
            </h2>
            {connection?.connected ? (
              <p className="text-sm text-white/40">
                Signed in as <span className="text-white/70 font-medium">{connection.fb_user_name}</span>
                {connection.connected_at && (
                  <> &middot; Connected {new Date(connection.connected_at).toLocaleDateString()}</>
                )}
              </p>
            ) : (
              <p className="text-sm text-white/40">Connect your Facebook account to get started</p>
            )}
          </div>
          <div className="h-3 w-3 rounded-full shrink-0" style={{ background: connection?.connected ? "#10b981" : "#6b7280" }} />
        </div>

        {connection?.connected ? (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-sm px-4 py-2 rounded-lg font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition disabled:opacity-50"
          >
            {disconnecting ? "Disconnecting..." : "Disconnect Account"}
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="btn-glow disabled:opacity-50 flex items-center gap-2"
          >
            {connecting ? (
              <>
                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                Connect Facebook Account
              </>
            )}
          </button>
        )}
      </div>

      {/* Only show selectors if connected */}
      {connection?.connected && (
        <>
          {/* Ad Account Selector */}
          <div className="glass-card p-6 space-y-3">
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Ad Account</h3>
            {adAccounts.length === 0 ? (
              <p className="text-sm text-white/40">No ad accounts found. Make sure your Facebook account has access to at least one ad account.</p>
            ) : (
              <div className="space-y-2">
                {adAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => handleSelectAccount(acc.id)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      acc.is_selected
                        ? "bg-blue-500/10 border-blue-500/30 text-white"
                        : "bg-white/[0.02] border-white/10 text-white/60 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{acc.name}</p>
                        <p className="text-xs text-white/40 mt-0.5">{acc.account_id} &middot; {acc.currency} &middot; {acc.timezone_name}</p>
                      </div>
                      {acc.is_selected && (
                        <div className="h-5 w-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                          <svg className="h-3 w-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Page Selector */}
          <div className="glass-card p-6 space-y-3">
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Facebook Page</h3>
            {pages.length === 0 ? (
              <p className="text-sm text-white/40">No pages found.</p>
            ) : (
              <div className="space-y-2">
                {pages.map((pg) => (
                  <button
                    key={pg.id}
                    onClick={() => handleSelectPage(pg.id)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      pg.is_selected
                        ? "bg-purple-500/10 border-purple-500/30 text-white"
                        : "bg-white/[0.02] border-white/10 text-white/60 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {pg.picture_url ? (
                        <img src={pg.picture_url} alt="" className="h-8 w-8 rounded-full shrink-0" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-white/10 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{pg.name}</p>
                        {pg.category && <p className="text-xs text-white/40">{pg.category}</p>}
                      </div>
                      {pg.is_selected && (
                        <div className="h-5 w-5 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                          <svg className="h-3 w-3 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pixel Selector */}
          <div className="glass-card p-6 space-y-3">
            <h3 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Meta Pixel</h3>
            {pixels.length === 0 ? (
              <p className="text-sm text-white/40">No pixels found. Select an ad account first.</p>
            ) : (
              <div className="space-y-2">
                {pixels.map((px) => (
                  <button
                    key={px.id}
                    onClick={() => handleSelectPixel(px.id)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      px.is_selected
                        ? "bg-orange-500/10 border-orange-500/30 text-white"
                        : "bg-white/[0.02] border-white/10 text-white/60 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{px.name}</p>
                        <p className="text-xs text-white/40 mt-0.5">ID: {px.pixel_id}</p>
                      </div>
                      {px.is_selected && (
                        <div className="h-5 w-5 rounded-full bg-orange-500/20 flex items-center justify-center">
                          <svg className="h-3 w-3 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
