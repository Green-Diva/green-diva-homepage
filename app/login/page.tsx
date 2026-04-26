import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

type SearchParams = Promise<{ from?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const u = await getCurrentUser();
  if (u) {
    const sp = await searchParams;
    redirect(sp.from && sp.from.startsWith("/") ? sp.from : "/");
  }
  const { from } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-8 md:px-10">
      <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
        Sanctum Entrance
      </span>
      <h1 className="mt-3 max-w-[42rem] font-headline text-4xl leading-[0.96] font-light text-primary sacred-glow md:text-5xl">
        The Faithful Sign-in
      </h1>
      <div className="mt-5 w-full max-w-[42rem]">
        <p className="text-[15px] leading-[1.9] text-on-surface-variant/90 [text-align:justify] [text-justify:inter-word] md:text-base">
          Present the <span className="font-label tracking-[0.18em] text-secondary">XinHan&apos;s Token</span>{" "}
          to <span className="font-semibold text-primary">Green Diva</span>, <span className="font-semibold text-primary">the Goddess</span>,
          that she might unseal the Sanctuary for you. This sacred token shall
          remain enshrined in your cookies for 7 days only.
        </p>
        <LoginForm from={from} />
      </div>
    </main>
  );
}
