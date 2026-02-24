export function DashboardMockup({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 380"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Background */}
      <rect width="600" height="380" rx="16" fill="rgba(10,15,30,0.8)" />
      <rect width="600" height="380" rx="16" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

      {/* Sidebar */}
      <rect x="0" y="0" width="140" height="380" rx="16" fill="rgba(255,255,255,0.02)" />
      <rect x="140" y="0" width="1" height="380" fill="rgba(255,255,255,0.05)" />

      {/* Sidebar logo area */}
      <rect x="20" y="20" width="24" height="24" rx="6" fill="#00AAFF" opacity="0.3" />
      <rect x="52" y="24" width="60" height="8" rx="4" fill="rgba(255,255,255,0.1)" />
      <rect x="52" y="36" width="40" height="4" rx="2" fill="rgba(255,255,255,0.05)" />

      {/* Sidebar nav items */}
      {[70, 100, 130, 160, 190].map((y, i) => (
        <g key={y}>
          <rect
            x="16"
            y={y}
            width="108"
            height="24"
            rx="8"
            fill={i === 0 ? "rgba(0,170,255,0.1)" : "transparent"}
          />
          <rect x="26" y={y + 6} width="12" height="12" rx="3" fill={i === 0 ? "#00AAFF" : "rgba(255,255,255,0.08)"} opacity={i === 0 ? 0.6 : 0.4} />
          <rect x="46" y={y + 8} width={[50, 40, 56, 36, 44][i]} height="7" rx="3.5" fill={i === 0 ? "rgba(0,170,255,0.3)" : "rgba(255,255,255,0.06)"} />
        </g>
      ))}

      {/* Top bar */}
      <rect x="140" y="0" width="460" height="52" fill="rgba(255,255,255,0.01)" />
      <rect x="140" y="52" width="460" height="1" fill="rgba(255,255,255,0.05)" />
      <rect x="164" y="18" width="120" height="16" rx="8" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <circle cx="555" cy="26" r="14" fill="rgba(124,92,255,0.15)" />
      <circle cx="555" cy="26" r="5" fill="#7C5CFF" opacity="0.4" />

      {/* Stats cards */}
      {[
        { x: 164, color: "#00AAFF", label: "Total Jobs", value: "1,247" },
        { x: 278, color: "#7C5CFF", label: "Active Jobs", value: "23" },
        { x: 392, color: "#FF3366", label: "Credits Used", value: "58.4K" },
        { x: 506, color: "#FFAA00", label: "Profiles", value: "142K" },
      ].map((card) => (
        <g key={card.x}>
          <rect x={card.x} y="72" width="100" height="68" rx="10" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          <rect x={card.x + 12} y="82" width="24" height="3" rx="1.5" fill={card.color} opacity="0.6" />
          <text x={card.x + 12} y="102" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="system-ui">{card.label}</text>
          <text x={card.x + 12} y="124" fill="rgba(255,255,255,0.7)" fontSize="16" fontWeight="bold" fontFamily="system-ui">{card.value}</text>
        </g>
      ))}

      {/* Data table */}
      <rect x="164" y="160" width="412" height="200" rx="10" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

      {/* Table header */}
      <rect x="164" y="160" width="412" height="32" rx="10" fill="rgba(255,255,255,0.02)" />
      {["Profile", "Platform", "Status", "Credits", "Date"].map((h, i) => (
        <text key={h} x={[180, 270, 340, 415, 485][i]} y="181" fill="rgba(255,255,255,0.25)" fontSize="8" fontFamily="system-ui" textAnchor="start">{h}</text>
      ))}
      <rect x="164" y="192" width="412" height="1" fill="rgba(255,255,255,0.05)" />

      {/* Table rows */}
      {[0, 1, 2, 3, 4].map((row) => {
        const y = 200 + row * 32;
        const colors = ["#00AAFF", "#FF3366", "#7C5CFF", "#FFAA00", "#00AAFF"];
        const platforms = ["Facebook", "Instagram", "TikTok", "LinkedIn", "Facebook"];
        const statuses = ["completed", "running", "completed", "queued", "completed"];
        const statusColors: Record<string, string> = {
          completed: "#34D399",
          running: "#00AAFF",
          queued: "#FFAA00",
        };
        return (
          <g key={row}>
            {row > 0 && <rect x="176" y={y} width="388" height="1" fill="rgba(255,255,255,0.03)" />}
            {/* Avatar */}
            <circle cx="188" cy={y + 16} r="8" fill={colors[row]} opacity="0.15" />
            <circle cx="188" cy={y + 13} r="3" fill={colors[row]} opacity="0.3" />
            <ellipse cx="188" cy={y + 20} rx="5" ry="3" fill={colors[row]} opacity="0.2" />
            {/* Name placeholder */}
            <rect x="202" y={y + 10} width={[60, 52, 48, 56, 44][row]} height="7" rx="3.5" fill="rgba(255,255,255,0.1)" />
            <rect x="202" y={y + 20} width={[40, 35, 44, 38, 42][row]} height="5" rx="2.5" fill="rgba(255,255,255,0.04)" />
            {/* Platform */}
            <rect x="270" y={y + 12} width="44" height="14" rx="7" fill={colors[row]} opacity="0.08" />
            <text x="292" y={y + 23} fill={colors[row]} opacity="0.6" fontSize="7" fontFamily="system-ui" textAnchor="middle">{platforms[row]}</text>
            {/* Status */}
            <circle cx="344" cy={y + 16} r="3" fill={statusColors[statuses[row]]} opacity="0.5" />
            <text x="352" y={y + 20} fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="system-ui">{statuses[row]}</text>
            {/* Credits */}
            <text x="415" y={y + 20} fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="system-ui">{[42, 18, 156, 25, 87][row]}</text>
            {/* Date */}
            <text x="485" y={y + 20} fill="rgba(255,255,255,0.2)" fontSize="8" fontFamily="system-ui">{["Feb 22", "Feb 22", "Feb 21", "Feb 21", "Feb 20"][row]}</text>
          </g>
        );
      })}

      {/* Gloss effect */}
      <rect width="600" height="380" rx="16" fill="url(#gloss)" opacity="0.03" />
      <defs>
        <linearGradient id="gloss" x1="0" y1="0" x2="600" y2="380">
          <stop offset="0" stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
