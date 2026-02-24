export function StepSignUp({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Card frame */}
      <rect x="20" y="10" width="160" height="140" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

      {/* Google button */}
      <rect x="40" y="28" width="120" height="32" rx="8" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <circle cx="62" cy="44" r="8" fill="rgba(255,255,255,0.06)" />
      <path d="M62 40a4 4 0 100 8 4 4 0 000-8z" fill="none" />
      <text x="62" y="47" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="system-ui" fontWeight="bold">G</text>
      <text x="100" y="48" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="system-ui">Continue with Google</text>

      {/* Divider */}
      <line x1="40" y1="72" x2="160" y2="72" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <rect x="88" y="67" width="24" height="10" rx="5" fill="rgba(10,15,30,0.9)" />
      <text x="100" y="75" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="system-ui">or</text>

      {/* Email field */}
      <rect x="40" y="86" width="120" height="28" rx="8" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <text x="52" y="104" fill="rgba(255,255,255,0.15)" fontSize="8" fontFamily="system-ui">you@company.com</text>
      <rect x="134" y="94" width="16" height="12" rx="3" fill="#00AAFF" opacity="0.15" />
      <path d="M139 100l3 3 5-5" stroke="#00AAFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />

      {/* Sign up button */}
      <rect x="40" y="122" width="120" height="20" rx="6" fill="#00AAFF" opacity="0.15" />
      <text x="100" y="136" textAnchor="middle" fill="#00AAFF" opacity="0.5" fontSize="8" fontWeight="bold" fontFamily="system-ui">Create Account</text>
    </svg>
  );
}

export function StepConfigure({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Card frame */}
      <rect x="20" y="10" width="160" height="140" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

      {/* Platform selector */}
      <text x="40" y="34" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="system-ui">Select Platform</text>
      <g>
        {[
          { x: 40, color: "#1877F2", label: "FB" },
          { x: 72, color: "#E4405F", label: "IG" },
          { x: 104, color: "#00F2EA", label: "TT" },
          { x: 136, color: "#0A66C2", label: "LI" },
        ].map((p) => (
          <g key={p.x}>
            <rect
              x={p.x}
              y="40"
              width="26"
              height="26"
              rx="7"
              fill={p.x === 40 ? p.color : "rgba(255,255,255,0.03)"}
              opacity={p.x === 40 ? 0.2 : 1}
              stroke={p.x === 40 ? p.color : "rgba(255,255,255,0.06)"}
              strokeWidth="1"
            />
            <text x={p.x + 13} y="57" textAnchor="middle" fill={p.x === 40 ? p.color : "rgba(255,255,255,0.2)"} fontSize="8" fontWeight="bold" fontFamily="system-ui">{p.label}</text>
          </g>
        ))}
      </g>

      {/* URL input */}
      <text x="40" y="84" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="system-ui">Post URL</text>
      <rect x="40" y="90" width="120" height="28" rx="8" fill="rgba(255,255,255,0.03)" stroke="rgba(124,92,255,0.3)" strokeWidth="1" />
      <text x="50" y="108" fill="rgba(255,255,255,0.2)" fontSize="7" fontFamily="system-ui">facebook.com/post/12345...</text>
      <rect x="134" y="96" width="18" height="16" rx="4" fill="#7C5CFF" opacity="0.2" />
      <path d="M140 101l3 3m0 0l3-3m-3 3v-6" stroke="#7C5CFF" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" transform="rotate(90 143 104)" />

      {/* Run button */}
      <rect x="40" y="126" width="120" height="20" rx="6" fill="#7C5CFF" opacity="0.15" />
      <text x="100" y="140" textAnchor="middle" fill="#7C5CFF" opacity="0.6" fontSize="8" fontWeight="bold" fontFamily="system-ui">Start Extraction</text>
    </svg>
  );
}

export function StepDownload({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Card frame */}
      <rect x="20" y="10" width="160" height="140" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

      {/* CSV file icon */}
      <rect x="70" y="20" width="60" height="70" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <path d="M118 20h-6l12 12v-6a6 6 0 00-6-6z" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

      {/* CSV rows */}
      {[0, 1, 2, 3, 4].map((i) => {
        const y = 38 + i * 10;
        const colors = ["#00AAFF", "#FF3366", "#7C5CFF", "#FFAA00", "#00AAFF"];
        return (
          <g key={i}>
            <circle cx="82" cy={y} r="2" fill={colors[i]} opacity="0.3" />
            <rect x="88" y={y - 2} width={[28, 22, 32, 18, 26][i]} height="4" rx="2" fill="rgba(255,255,255,0.08)" />
          </g>
        );
      })}

      {/* CSV label */}
      <rect x="84" y="70" width="32" height="14" rx="4" fill="#FF3366" opacity="0.1" />
      <text x="100" y="80" textAnchor="middle" fill="#FF3366" opacity="0.5" fontSize="7" fontWeight="bold" fontFamily="system-ui">CSV</text>

      {/* Download arrow */}
      <circle cx="100" cy="116" r="16" fill="#FF3366" fillOpacity="0.08" stroke="#FF3366" strokeWidth="1" opacity="0.15" />
      <path d="M100 108v12m0 0l-4-4m4 4l4-4" stroke="#FF3366" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />

      {/* Export options */}
      <rect x="44" y="138" width="48" height="8" rx="4" fill="rgba(255,255,255,0.04)" />
      <text x="68" y="145" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="6" fontFamily="system-ui">CSV Export</text>
      <rect x="108" y="138" width="48" height="8" rx="4" fill="rgba(255,255,255,0.04)" />
      <text x="132" y="145" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="6" fontFamily="system-ui">FB Ads</text>
    </svg>
  );
}
