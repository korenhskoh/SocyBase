export function DataFlowDiagram({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Source: Social Profile */}
      <g>
        <rect x="0" y="20" width="120" height="80" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        <circle cx="36" cy="50" r="14" fill="#00AAFF" opacity="0.1" />
        <circle cx="36" cy="46" r="5" fill="#00AAFF" opacity="0.25" />
        <ellipse cx="36" cy="56" rx="8" ry="4.5" fill="#00AAFF" opacity="0.15" />
        <rect x="58" y="42" width="50" height="6" rx="3" fill="rgba(255,255,255,0.1)" />
        <rect x="58" y="52" width="36" height="4" rx="2" fill="rgba(255,255,255,0.05)" />
        <rect x="16" y="68" width="44" height="4" rx="2" fill="rgba(255,255,255,0.04)" />
        <rect x="66" y="68" width="38" height="4" rx="2" fill="rgba(255,255,255,0.04)" />
        <rect x="16" y="76" width="32" height="4" rx="2" fill="rgba(255,255,255,0.04)" />
        <rect x="54" y="76" width="50" height="4" rx="2" fill="rgba(255,255,255,0.04)" />
        <text x="60" y="92" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8" fontFamily="system-ui">Social Profile</text>
      </g>

      {/* Arrow 1 */}
      <g>
        <line x1="130" y1="60" x2="170" y2="60" stroke="#00AAFF" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3">
          <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.5s" repeatCount="indefinite" />
        </line>
        <polygon points="170,55 180,60 170,65" fill="#00AAFF" opacity="0.4" />
      </g>

      {/* Center: SocyBase */}
      <g>
        <rect x="180" y="16" width="120" height="88" rx="14" fill="rgba(124,92,255,0.06)" stroke="rgba(124,92,255,0.15)" strokeWidth="1" />
        {/* 4-blob mini logo */}
        <circle cx="224" cy="46" r="8" fill="#00AAFF" opacity="0.2" />
        <circle cx="240" cy="46" r="8" fill="#FF3366" opacity="0.2" />
        <circle cx="224" cy="62" r="8" fill="#7C5CFF" opacity="0.2" />
        <circle cx="240" cy="62" r="8" fill="#FFAA00" opacity="0.2" />
        <circle cx="224" cy="46" r="2" fill="white" opacity="0.4" />
        <circle cx="240" cy="46" r="2" fill="white" opacity="0.4" />
        <circle cx="224" cy="62" r="2" fill="white" opacity="0.4" />
        <circle cx="240" cy="62" r="2" fill="white" opacity="0.4" />
        <text x="270" y="50" fill="rgba(255,255,255,0.4)" fontSize="10" fontWeight="bold" fontFamily="system-ui">Socy</text>
        <text x="270" y="64" fill="rgba(255,255,255,0.4)" fontSize="10" fontWeight="bold" fontFamily="system-ui">Base</text>
        <text x="240" y="92" textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="7" fontFamily="system-ui">Extract &amp; Normalize</text>
      </g>

      {/* Arrow 2 */}
      <g>
        <line x1="310" y1="60" x2="350" y2="60" stroke="#FF3366" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.3">
          <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="1.5s" repeatCount="indefinite" />
        </line>
        <polygon points="350,55 360,60 350,65" fill="#FF3366" opacity="0.4" />
      </g>

      {/* Output: Structured Data */}
      <g>
        <rect x="360" y="20" width="120" height="80" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        {/* Mini table */}
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const y = 32 + i * 10;
          const colors = ["#00AAFF", "#FF3366", "#7C5CFF", "#FFAA00", "#00AAFF", "#FF3366"];
          return (
            <g key={i}>
              <circle cx="376" cy={y} r="2" fill={colors[i]} opacity="0.35" />
              <rect x="384" y={y - 2.5} width="30" height="5" rx="2.5" fill="rgba(255,255,255,0.06)" />
              <rect x="418" y={y - 2.5} width={[50, 42, 36, 48, 44, 38][i]} height="5" rx="2.5" fill="rgba(255,255,255,0.1)" />
            </g>
          );
        })}
        <text x="420" y="100" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8" fontFamily="system-ui">Structured Data</text>
      </g>
    </svg>
  );
}
