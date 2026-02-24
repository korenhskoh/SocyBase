"use client";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-navy-950">
      {/* Social media colored ambient glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full blur-[160px] opacity-20" style={{ background: "#00AAFF" }} />
        <div className="absolute top-1/4 -right-20 w-[400px] h-[400px] rounded-full blur-[140px] opacity-15" style={{ background: "#7C5CFF" }} />
        <div className="absolute -bottom-20 left-1/3 w-[450px] h-[450px] rounded-full blur-[150px] opacity-15" style={{ background: "#FF3366" }} />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] rounded-full blur-[120px] opacity-10" style={{ background: "#FFAA00" }} />
      </div>

      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Content */}
      <div className="relative z-10 w-full max-w-md px-4">
        {children}
      </div>
    </div>
  );
}
