/* ─── SocyBase Logo ───
 *  4 organic blob shapes (blue, pink, purple, orange) with white dots,
 *  arranged in a 2×2 pinwheel pattern — representing social connection + data.
 */

/* ─── Size presets ─── */
const sizes = {
  xs: { icon: 24, text: "text-sm", gap: "gap-1.5" },
  sm: { icon: 28, text: "text-base", gap: "gap-2" },
  md: { icon: 32, text: "text-xl", gap: "gap-2.5" },
  lg: { icon: 40, text: "text-2xl", gap: "gap-3" },
} as const;

type LogoSize = keyof typeof sizes;

/* ─── Brand colors ─── */
const BLUE = "#00AAFF";
const PINK = "#FF3366";
const PURPLE = "#7C5CFF";
const ORANGE = "#FFAA00";

/* ─── Icon Mark (4 blobs) ─── */
export function LogoIcon({
  size = "md",
  className = "",
}: {
  size?: LogoSize;
  className?: string;
}) {
  const px = sizes[size].icon;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="SocyBase logo"
    >
      {/* Top-left: Blue blob */}
      <path
        d="M13.5 14.5C10 14 3 12 2.5 8C2 4 5.5 2 8.5 2C11.5 2 14 4.5 14 8.5C14 12 14 14 13.5 14.5Z"
        fill={BLUE}
      />
      <circle cx="7.5" cy="7" r="2" fill="white" />

      {/* Top-right: Pink blob */}
      <path
        d="M18.5 14.5C22 14 29 12 29.5 8C30 4 26.5 2 23.5 2C20.5 2 18 4.5 18 8.5C18 12 18 14 18.5 14.5Z"
        fill={PINK}
      />
      <circle cx="24.5" cy="7" r="2" fill="white" />

      {/* Bottom-left: Purple blob */}
      <path
        d="M13.5 17.5C10 18 3 20 2.5 24C2 28 5.5 30 8.5 30C11.5 30 14 27.5 14 23.5C14 20 14 18 13.5 17.5Z"
        fill={PURPLE}
      />
      <circle cx="7.5" cy="25" r="2" fill="white" />

      {/* Bottom-right: Orange blob */}
      <path
        d="M18.5 17.5C22 18 29 20 29.5 24C30 28 26.5 30 23.5 30C20.5 30 18 27.5 18 23.5C18 20 18 18 18.5 17.5Z"
        fill={ORANGE}
      />
      <circle cx="24.5" cy="25" r="2" fill="white" />
    </svg>
  );
}

/* ─── Full Logo (Icon + Text) ─── */
export function LogoFull({
  size = "md",
  className = "",
}: {
  size?: LogoSize;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center ${sizes[size].gap} ${className}`}>
      <LogoIcon size={size} />
      <span className={`${sizes[size].text} font-bold gradient-text`}>SocyBase</span>
    </span>
  );
}
