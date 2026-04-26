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
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-8">
      <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
        Sanctum Entrance
      </span>
      <h1 className="mt-3 font-headline text-4xl font-light text-primary sacred-glow">
        Priestess Sign-in
      </h1>
      <p className="mt-4 text-sm text-on-surface-variant font-light">
        Offer your <code className="text-secondary font-label">ADMIN_TOKEN</code> to the
        vault. It will be sealed in an httpOnly session cookie, not stored elsewhere.
      </p>
      <LoginForm from={from} />
    </main>
  );
}
