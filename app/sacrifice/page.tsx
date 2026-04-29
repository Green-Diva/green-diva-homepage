import PlaceholderPage from "@/components/PlaceholderPage";
import { getLocale } from "@/lib/i18n/server";

export default async function SacrificePage() {
  const locale = await getLocale();
  const isZh = locale === "zh";
  return (
    <PlaceholderPage
      eyebrow={isZh ? "祭坛 · 献祭" : "Altar · Sacrifice"}
      title={isZh ? "开始献祭" : "Begin Sacrifice"}
    />
  );
}
