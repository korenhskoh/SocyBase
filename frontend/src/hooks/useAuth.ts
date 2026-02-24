"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/authStore";

export function useAuth(requireAuth = true) {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, setUser, setLoading, logout } =
    useAuthStore();

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        setUser(null);
        if (requireAuth) router.push("/login");
        return;
      }

      try {
        const res = await authApi.me();
        setUser(res.data);
      } catch {
        setUser(null);
        if (requireAuth) router.push("/login");
      }
    };

    checkAuth();
  }, [requireAuth, router, setUser]);

  return { user, isAuthenticated, isLoading, logout };
}
