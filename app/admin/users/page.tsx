import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import UsersTable from "./UsersTable";

export default async function AdminUsersPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login?from=/admin/users");
  if (me.level < ADMIN_LEVEL) redirect("/admin");

  const users = await prisma.user.findMany({
    orderBy: [{ level: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      gender: true,
      level: true,
      avatarUrl: true,
      createdAt: true,
      token: true,
    },
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-12">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
            Roster · Acolytes
          </span>
          <h1 className="mt-2 font-headline text-4xl font-light text-primary sacred-glow">
            Disciples
          </h1>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <Link
            href="/admin/users/new"
            className="bg-primary/10 border border-primary/30 text-primary px-5 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg"
          >
            + Anoint
          </Link>
          <Link
            href="/admin"
            className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/70 hover:text-primary transition-colors"
          >
            Chronicles
          </Link>
        </div>
      </div>

      <UsersTable
        users={users.map((u) => ({
          ...u,
          token: u.token.length > 8 ? `${u.token.slice(0, 4)}…${u.token.slice(-4)}` : "••••",
          createdAt: u.createdAt.toISOString(),
        }))}
        meId={me.id}
      />
    </main>
  );
}
