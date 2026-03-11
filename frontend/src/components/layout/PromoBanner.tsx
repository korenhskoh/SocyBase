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

function isYouTubeShorts(url: string): boolean {
  try {
    return new URL(url).pathname.includes("/shorts/");
  } catch {}
  return false;
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
  const isShorts = banner.video_url ? isYouTubeShorts(banner.video_url) : false;

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
            className="sm:hidden text-[11px] text-primary-400 hover:text-primary-300 transition mt-0.5 flex items-center gap-1"
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
              {expandedVideo === bannerIdx
                ? <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                : <path d="M8 5v14l11-7z" />
              }
            </svg>
            {expandedVideo === bannerIdx ? "Hide video" : "Watch video"}
          </button>
        )}
      </div>
      {banner.link_url && (
        <span className="shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-gradient-to-r from-primary-500 to-primary-400 hover:from-primary-400 hover:to-primary-300 text-white text-[11px] sm:text-xs font-semibold transition-all shadow-[0_0_12px_rgba(99,102,241,0.4)] hover:shadow-[0_0_20px_rgba(99,102,241,0.6)] whitespace-nowrap">
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
        <div className={`pointer-events-auto ${hasVideo ? "max-w-3xl" : "max-w-2xl"} mx-auto rounded-xl bg-navy-800/95 backdrop-blur-lg border border-primary-500/30 shadow-[0_0_30px_rgba(99,102,241,0.15),0_4px_20px_rgba(0,0,0,0.3)] p-2.5 sm:p-3.5 relative`}>
          {/* Subtle top accent line */}
          <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-primary-400/50 to-transparent" />

          {/* Dismiss button */}
          <button
            onClick={() => { const s = new Set(Array.from(dismissed)); s.add(bannerIdx); setDismissed(s); setVisible(false); }}
            className="absolute -top-2 left-1 sm:-left-2 h-6 w-6 flex items-center justify-center rounded-full bg-navy-700 border border-white/10 text-white/50 hover:text-white hover:bg-navy-600 transition shadow-lg z-10"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Desktop layout: text + inline video side-by-side */}
          <div className="hidden sm:flex items-center gap-4">
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
              <div className={`shrink-0 rounded-lg overflow-hidden border border-white/10 ${
                isShorts ? "w-[70px] h-[124px]" : "w-56 aspect-video"
              }`}>
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
              <div className={`mt-2 rounded-lg overflow-hidden border border-white/10 ${
                isShorts ? "aspect-[9/16] max-w-[200px] mx-auto" : "aspect-video"
              }`}>
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
  const isShorts = banner.video_url ? isYouTubeShorts(banner.video_url) : false;

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
            className="text-xs text-primary-400 hover:text-primary-300 transition mt-0.5 flex items-center gap-1"
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
              {expandedVideo
                ? <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                : <path d="M8 5v14l11-7z" />
              }
            </svg>
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
        <div className={`mt-3 rounded-lg overflow-hidden ${
          isShorts ? "aspect-[9/16] max-w-[280px] mx-auto" : "aspect-video"
        }`}>
          <VideoPlayer url={banner.video_url} className="w-full h-full" />
        </div>
      )}
    </div>
  );
}
