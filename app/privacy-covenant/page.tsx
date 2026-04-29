import PlaceholderPage from "@/components/PlaceholderPage";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function PrivacyCovenantPage() {
  const t = await getDictionary();
  const locale = await getLocale();
  return (
    <PlaceholderPage
      title={t.footer.privacyCovenant}
      eyebrow={locale === "zh" ? "圣契" : "Covenant"}
    />
  );
}
