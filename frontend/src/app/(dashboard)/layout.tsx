"use client";

import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "@/components/layout/Sidebar";
import { WhatsAppFloat } from "@/components/layout/WhatsAppFloat";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading } = useAuth(true);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-900">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-white/40 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-900">
      <Sidebar />
      <main className="md:pl-64">
        <div className="pt-16 px-4 pb-6 md:pt-8 md:px-6 lg:px-8">{children}</div>
      </main>
      <WhatsAppFloat />
    </div>
  );
}
