import PlaceholderPage from "@/components/PlaceholderPage";
import { getLocale } from "@/lib/i18n/server";

export default async function SanctuaryPage() {
  const locale = await getLocale();
  const isZh = locale === "zh";
  return (
    <PlaceholderPage
      eyebrow={isZh ? "神殿 · 圣所" : "Temple · Sanctuary"}
      title={isZh ? "进入圣所" : "Enter Sanctuary"}
    />
  );
}
