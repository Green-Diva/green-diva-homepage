import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";
import LoginForm from "./LoginForm";

type SearchParams = Promise<{ from?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const u = await getCurrentUser();
  if (u) {
    const sp = await searchParams;
    redirect(sp.from && sp.from.startsWith("/") ? sp.from : "/");
  }
  const { from } = await searchParams;
  const t = await getDictionary();
  return (
    <main className="mx-auto flex flex-1 w-full max-w-2xl flex-col justify-center px-8 md:px-10">
      <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
        {t.auth.sanctumEntrance}
      </span>
      <h1 className="mt-3 max-w-[42rem] font-headline text-4xl leading-[0.96] font-light text-primary sacred-glow md:text-5xl">
        {t.auth.pageTitle}
      </h1>
      <div className="mt-5 w-full max-w-[42rem]">
        <p className="text-[15px] leading-[1.9] text-on-surface-variant/90 [text-align:justify] [text-justify:inter-word] md:text-base">
          {t.auth.descBefore}
          <span className="font-label tracking-[0.18em] text-secondary">{t.auth.descTokenName}</span>
          {t.auth.descMiddle}
          <span className="font-semibold text-primary">{t.auth.descDiva}</span>
          {t.auth.descSeparator}
          <span className="font-semibold text-primary">{t.auth.descGoddess}</span>
          {t.auth.descAfter}
        </p>
        <LoginForm from={from} />
      </div>
    </main>
  );
}
