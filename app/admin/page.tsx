import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import AdminProjectsTable from "./AdminProjectsTable";
import LogoutButton from "./LogoutButton";

export default async function AdminHome() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/admin");

  const projects = await prisma.project.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    select: { id: true, slug: true, title: true, summary: true, published: true, order: true },
  });

  const isPriestess = user.level >= ADMIN_LEVEL;

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-12">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
            Archive 01 · {user.name}
          </span>
          <h1 className="mt-2 font-headline text-4xl font-light text-primary sacred-glow">
            Chronicles
          </h1>
        </div>
        <div className="flex items-center gap-5 text-sm">
          {isPriestess ? (
            <>
              <Link
                href="/admin/projects/new"
                className="bg-primary/10 border border-primary/30 text-primary px-5 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg"
              >
                + Inscribe
              </Link>
              <Link
                href="/admin/users"
                className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/70 hover:text-primary transition-colors"
              >
                Acolytes
              </Link>
            </>
          ) : null}
          <Link
            href="/"
            className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/70 hover:text-primary transition-colors"
          >
            Sanctuary
          </Link>
          <LogoutButton />
        </div>
      </div>

      <AdminProjectsTable projects={projects} canEdit={isPriestess} />
    </main>
  );
}
