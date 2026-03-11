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

function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.searchParams.get("v")) return u.searchParams.get("v");
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    if (u.pathname.includes("/shorts/")) return u.pathname.split("/shorts/")[1]?.split(/[?/]/)[0] || null;
    if (u.pathname.includes("/embed/")) return u.pathname.split("/embed/")[1]?.split(/[?/]/)[0] || null;
  } catch {}
  return null;
}

function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg)(\?|$)/i.test(url);
}

function VideoPlayer({ url, autoplay = false, className = "" }: { url: string; autoplay?: boolean; className?: string }) {
  const ytId = getYouTubeVideoId(url);

  if (ytId) {
    const src = autoplay
      ? `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&loop=1&playlist=${ytId}&controls=0&showinfo=0&rel=0`
      : `https://www.youtube.com/embed/${ytId}`;
    return (
      <iframe
        src={src}
        className={className}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  if (isDirectVideoUrl(url)) {
    return (
      <video
        src={url}
        className={className}
        autoPlay={autoplay}
        muted
        loop
        playsInline
        controls={!autoplay}
      />
    );
  }

  // Fallback: treat as embeddable iframe URL
  const iframeSrc = autoplay && url.includes("?") ? `${url}&autoplay=1&mute=1` : autoplay ? `${url}?autoplay=1&mute=1` : url;
  return (
    <iframe
      src={iframeSrc}
      className={className}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}

export function PromoBannerFloat() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [expandedVideo, setExpandedVideo] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    creditsApi.getPromoBanners().then((r) => {
      const bottom = (r.data.banners || []).filter((b: Banner) => b.position === "bottom");
      setBanners(bottom);
      if (bottom.length > 0) {
        // Trigger slide-up animation after mount
        setTimeout(() => setVisible(true), 100);
      }
    }).catch(() => {});
  }, []);

  const visibleBanners = banners.filter((_, i) => !dismissed.has(i));
  if (visibleBanners.length === 0) return null;

  // Show only the first non-dismissed banner
  const bannerIdx = banners.findIndex((_, i) => !dismissed.has(i));
  const banner = banners[bannerIdx];
  if (!banner) return null;

  const hasVideo = !!banner.video_url;

  const textContent = (
    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
      {banner.image_url && (
        <img
          src={banner.image_url}
          alt={banner.title || "Promo"}
          className="h-10 sm:h-14 rounded-lg object-contain shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        {banner.title && (
          <p className="text-xs sm:text-sm font-semibold text-white leading-snug line-clamp-2">{banner.title}</p>
        )}
        {/* Mobile only: Watch video toggle */}
        {banner.video_url && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedVideo(expandedVideo === bannerIdx ? null : bannerIdx); }}
            className="sm:hidden text-[11px] text-primary-400 hover:text-primary-300 transition mt-0.5"
          >
            {expandedVideo === bannerIdx ? "Hide video" : "Watch video"}
          </button>
        )}
      </div>
      {banner.link_url && (
        <span className="shrink-0 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-primary-500 hover:bg-primary-400 text-white text-[11px] sm:text-xs font-medium transition whitespace-nowrap">
          Learn More
        </span>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile: bottom-[5rem] sits above WhatsApp FAB; Desktop: bottom-0 */}
      <div
        className={`fixed bottom-[5rem] sm:bottom-0 left-0 right-0 md:left-64 z-40 px-2 sm:px-3 pb-1 sm:pb-3 pointer-events-none transition-all duration-500 ease-out ${
          visible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0"
        }`}
      >
        <div className={`pointer-events-auto ${hasVideo ? "max-w-3xl" : "max-w-2xl"} mx-auto rounded-xl bg-navy-800/95 backdrop-blur-lg border border-primary-500/20 shadow-[0_0_20px_rgba(99,102,241,0.1)] p-2.5 sm:p-3.5 relative`}>
          {/* Dismiss button — top-left, inset on mobile so it doesn't clip */}
          <button
            onClick={() => { const s = new Set(Array.from(dismissed)); s.add(bannerIdx); setDismissed(s); setVisible(false); }}
            className="absolute -top-2 left-1 sm:-left-2 h-6 w-6 flex items-center justify-center rounded-full bg-navy-700 border border-white/10 text-white/50 hover:text-white hover:bg-navy-600 transition shadow-lg z-10"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Desktop layout: text + inline video side-by-side */}
          <div className="hidden sm:flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {banner.link_url ? (
                <a href={banner.link_url} target="_blank" rel="noopener noreferrer" className="block">
                  {textContent}
                </a>
              ) : (
                textContent
              )}
            </div>
            {hasVideo && banner.video_url && (
              <div className="shrink-0 w-48 aspect-video rounded-lg overflow-hidden">
                <VideoPlayer url={banner.video_url} autoplay className="w-full h-full object-cover" />
              </div>
            )}
          </div>

          {/* Mobile layout: text + expandable video below */}
          <div className="sm:hidden">
            {banner.link_url ? (
              <a href={banner.link_url} target="_blank" rel="noopener noreferrer" className="block">
                {textContent}
              </a>
            ) : (
              textContent
            )}

            {/* Mobile expanded video */}
            {expandedVideo === bannerIdx && banner.video_url && (
              <div className="mt-2 rounded-lg overflow-hidden aspect-video">
                <VideoPlayer url={banner.video_url} className="w-full h-full" />
              </div>
            )}
          </div>
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
      {expandedVideo && banner.video_url && (
        <div className="mt-3 rounded-lg overflow-hidden aspect-video">
          <VideoPlayer url={banner.video_url} className="w-full h-full" />
        </div>
      )}
    </div>
  );
}
