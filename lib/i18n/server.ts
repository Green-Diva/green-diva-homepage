import "server-only";
import { cookies } from "next/headers";
import type { Dictionary, Locale } from "./types";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE } from "./types";
import { en } from "./dictionaries/en";
import { zh } from "./dictionaries/zh";

const DICTS: Record<Locale, Dictionary> = { en, zh };

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(LOCALE_COOKIE)?.value;
  return (LOCALES as string[]).includes(v ?? "") ? (v as Locale) : DEFAULT_LOCALE;
}

export async function getDictionary(): Promise<Dictionary> {
  return DICTS[await getLocale()];
}

export function dictFor(locale: Locale): Dictionary {
  return DICTS[locale];
}
