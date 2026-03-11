"use client";

import { useEffect, useState } from "react";
import { creditsApi } from "@/lib/api-client";

interface Banner {
  image_url?: string;
  video_url?: string;
  link_url?: string;
  is_active: boolean;
  position: string;
  title?: string;
}

function getYouTubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) {
      return `https://www.youtube.com/embed/${u.searchParams.get("v")}`;
    }
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    if (u.pathname.includes("/embed/")) return url;
  } catch {}
  return null;
}

export function PromoBannerFloat() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [expandedVideo, setExpandedVideo] = useState<number | null>(null);

  useEffect(() => {
    creditsApi.getPromoBanners().then((r) => {
      const bottom = (r.data.banners || []).filter((b: Banner) => b.position === "bottom");
      setBanners(bottom);
    }).catch(() => {});
  }, []);

  const visibleBanners = banners.filter((_, i) => !dismissed.has(i));
  if (visibleBanners.length === 0) return null;

  // Show only the first non-dismissed banner
  const bannerIdx = banners.findIndex((_, i) => !dismissed.has(i));
  const banner = banners[bannerIdx];
  if (!banner) return null;

  const embedUrl = banner.video_url ? getYouTubeEmbedUrl(banner.video_url) : null;

  const content = (
    <div className="flex items-center gap-3 min-w-0">
      {banner.image_url && (
        <img
          src={banner.image_url}
          alt={banner.title || "Promo"}
          className="h-10 sm:h-12 rounded-lg object-contain shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        {banner.title && (
          <p className="text-sm font-semibold text-white truncate">{banner.title}</p>
        )}
        {banner.video_url && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedVideo(expandedVideo === bannerIdx ? null : bannerIdx); }}
            className="text-xs text-primary-400 hover:text-primary-300 transition mt-0.5"
          >
            {expandedVideo === bannerIdx ? "Hide video" : "Watch video"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 md:left-64 z-40 px-3 pb-3 pointer-events-none">
        <div className="pointer-events-auto max-w-2xl mx-auto rounded-xl bg-navy-800/95 backdrop-blur-lg border border-white/10 shadow-2xl p-3 relative">
          {/* Dismiss button */}
          <button
            onClick={() => { const s = new Set(Array.from(dismissed)); s.add(bannerIdx); setDismissed(s); }}
            className="absolute top-2 right-2 text-white/30 hover:text-white/70 transition"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {banner.link_url ? (
            <a href={banner.link_url} target="_blank" rel="noopener noreferrer" className="block">
              {content}
            </a>
          ) : (
            content
          )}

          {/* Expanded video */}
          {expandedVideo === bannerIdx && embedUrl && (
            <div className="mt-3 rounded-lg overflow-hidden aspect-video">
              <iframe
                src={embedUrl}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function PromoBannerProgress() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [expandedVideo, setExpandedVideo] = useState(false);

  useEffect(() => {
    creditsApi.getPromoBanners().then((r) => {
      const progress = (r.data.banners || []).filter((b: Banner) => b.position === "progress");
      setBanners(progress);
    }).catch(() => {});
  }, []);

  if (banners.length === 0) return null;
  const banner = banners[0];

  const embedUrl = banner.video_url ? getYouTubeEmbedUrl(banner.video_url) : null;

  const inner = (
    <div className="flex items-center gap-3">
      {banner.image_url && (
        <img
          src={banner.image_url}
          alt={banner.title || "Promo"}
          className="h-12 sm:h-14 rounded-lg object-contain shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        {banner.title && (
          <p className="text-sm font-semibold text-white truncate">{banner.title}</p>
        )}
        {banner.video_url && !banner.link_url && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedVideo(!expandedVideo); }}
            className="text-xs text-primary-400 hover:text-primary-300 transition mt-0.5"
          >
            {expandedVideo ? "Hide video" : "Watch video"}
          </button>
        )}
        {banner.link_url && (
          <span className="text-xs text-primary-400 mt-0.5 inline-block">Learn more &rarr;</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="rounded-xl bg-gradient-to-r from-amber-500/5 to-primary-500/5 border border-white/10 p-4 mt-4">
      {banner.link_url ? (
        <a href={banner.link_url} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      ) : (
        inner
      )}
      {expandedVideo && embedUrl && (
        <div className="mt-3 rounded-lg overflow-hidden aspect-video">
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
    </div>
  );
}
