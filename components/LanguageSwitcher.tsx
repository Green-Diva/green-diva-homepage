"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/types";

export default function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setLocale(next: Locale) {
    if (next === locale || pending) return;
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      router.refresh();
    });
  }

  const base =
    "font-label text-[10px] tracking-[0.3em] uppercase transition-colors cursor-pointer disabled:cursor-default";
  const active = "text-primary";
  const inactive = "text-on-surface-variant hover:text-primary";

  return (
    <div
      role="group"
      aria-label={t.langSwitch.aria}
      className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity"
    >
      <span className="material-symbols-outlined text-primary text-sm">language</span>
      <button
        type="button"
        onClick={() => setLocale("en")}
        disabled={pending}
        className={`${base} ${locale === "en" ? active : inactive}`}
      >
        {t.langSwitch.en}
      </button>
      <span className="text-on-surface-variant/40">·</span>
      <button
        type="button"
        onClick={() => setLocale("zh")}
        disabled={pending}
        className={`${base} ${locale === "zh" ? active : inactive}`}
      >
        {t.langSwitch.zh}
      </button>
    </div>
  );
}
