import PlaceholderPage from "@/components/PlaceholderPage";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function SacredTermsPage() {
  const t = await getDictionary();
  const locale = await getLocale();
  return (
    <PlaceholderPage
      title={t.footer.sacredTerms}
      eyebrow={locale === "zh" ? "圣约" : "Covenant"}
    />
  );
}
