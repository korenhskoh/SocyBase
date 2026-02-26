"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "@/stores/authStore";

type Translations = Record<string, unknown>;

const translationCache: Record<string, Translations> = {};

function getNestedValue(obj: Translations, path: string): string {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return path; // fallback to key
    }
  }
  return typeof current === "string" ? current : path;
}

async function loadTranslations(lang: string): Promise<Translations> {
  if (translationCache[lang]) return translationCache[lang];
  try {
    const res = await fetch(`/locales/${lang}/common.json`);
    const data = await res.json();
    translationCache[lang] = data;
    return data;
  } catch {
    return {};
  }
}

export function useTranslation() {
  const user = useAuthStore((s) => s.user);

  const getInitialLang = (): string => {
    if (user?.language) return user.language;
    if (typeof window !== "undefined") {
      return localStorage.getItem("socybase_lang") || "en";
    }
    return "en";
  };

  const [lang, setLangState] = useState(getInitialLang);
  const [translations, setTranslations] = useState<Translations>({});

  // Sync lang when user changes
  useEffect(() => {
    if (user?.language) {
      setLangState(user.language);
    }
  }, [user?.language]);

  // Load translations when lang changes
  useEffect(() => {
    loadTranslations(lang).then(setTranslations);
  }, [lang]);

  const t = useCallback(
    (key: string): string => getNestedValue(translations, key),
    [translations]
  );

  const setLang = useCallback((newLang: string) => {
    setLangState(newLang);
    if (typeof window !== "undefined") {
      localStorage.setItem("socybase_lang", newLang);
    }
  }, []);

  return { t, lang, setLang };
}
