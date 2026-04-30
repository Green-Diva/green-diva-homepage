import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, formatSerial, getCurrentUser } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/server";
import { format } from "@/lib/i18n/format";
import UsersTable, { type SortField, type SortOrder } from "./UsersTable";

const PAGE_SIZE = 20;
const ALLOWED_SORT: SortField[] = ["serial", "name", "level", "createdAt"];

function parseSearchParams(sp: { [k: string]: string | string[] | undefined }) {
  const sortRaw = typeof sp.sort === "string" ? sp.sort : "serial";
  const sort: SortField = (ALLOWED_SORT as string[]).includes(sortRaw)
    ? (sortRaw as SortField)
    : "serial";
  const orderRaw = typeof sp.order === "string" ? sp.order : "asc";
  const order: SortOrder = orderRaw === "desc" ? "desc" : "asc";
  const pageRaw = typeof sp.page === "string" ? Number(sp.page) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  return { sort, order, page };
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login?from=/admin/users");
  if (me.level < ADMIN_LEVEL) redirect("/");
  const t = await getDictionary();
  const sp = await searchParams;
  const { sort, order, page } = parseSearchParams(sp);

  const total = await prisma.user.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const users = await prisma.user.findMany({
    orderBy: [{ [sort]: order }],
    skip: (safePage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      serial: true,
      name: true,
      gender: true,
      level: true,
      avatarUrl: true,
      createdAt: true,
      token: true,
    },
  });

  const buildHref = (overrides: Partial<{ sort: SortField; order: SortOrder; page: number }>) => {
    const params = new URLSearchParams();
    const next = { sort, order, page: safePage, ...overrides };
    if (next.sort !== "serial") params.set("sort", next.sort);
    if (next.order !== "asc") params.set("order", next.order);
    if (next.page !== 1) params.set("page", String(next.page));
    const qs = params.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-12">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
            {t.adminUsers.rosterAcolytes}
          </span>
          <h1 className="mt-2 font-headline text-4xl font-light text-primary sacred-glow">
            {t.adminUsers.disciples}
          </h1>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <Link
            href="/admin/users/new"
            className="bg-primary/10 border border-primary/30 text-primary px-5 py-2 font-label tracking-widest uppercase text-[10px] hover:bg-primary/20 transition-all rounded-lg"
          >
            {t.adminUsers.anoint}
          </Link>
          <Link
            href="/"
            className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/70 hover:text-primary transition-colors"
          >
            {t.adminUsers.backToSanctuary}
          </Link>
        </div>
      </div>

      <UsersTable
        users={users.map((u) => ({
          ...u,
          serialLabel: formatSerial(u.serial),
          token: u.token.length > 8 ? `${u.token.slice(0, 4)}…${u.token.slice(-4)}` : "••••",
          createdAt: u.createdAt.toISOString(),
        }))}
        meId={me.id}
        sort={sort}
        order={order}
        sortHrefs={{
          serial: buildHref({ sort: "serial", order: sort === "serial" && order === "asc" ? "desc" : "asc", page: 1 }),
          name: buildHref({ sort: "name", order: sort === "name" && order === "asc" ? "desc" : "asc", page: 1 }),
          level: buildHref({ sort: "level", order: sort === "level" && order === "asc" ? "desc" : "asc", page: 1 }),
          createdAt: buildHref({ sort: "createdAt", order: sort === "createdAt" && order === "asc" ? "desc" : "asc", page: 1 }),
        }}
      />

      <nav className="mt-6 flex items-center justify-between font-label text-[10px] tracking-[0.3em] uppercase text-primary/70">
        <span>{format(t.adminUsers.totalCount, { count: total })}</span>
        <div className="flex items-center gap-4">
          {safePage > 1 ? (
            <Link
              href={buildHref({ page: safePage - 1 })}
              className="border border-primary/20 px-4 py-2 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
            >
              {t.adminUsers.prevPage}
            </Link>
          ) : (
            <span className="border border-primary/10 px-4 py-2 rounded-lg opacity-30">
              {t.adminUsers.prevPage}
            </span>
          )}
          <span className="text-secondary tabular-nums">
            {format(t.adminUsers.pageInfo, { page: safePage, total: totalPages })}
          </span>
          {safePage < totalPages ? (
            <Link
              href={buildHref({ page: safePage + 1 })}
              className="border border-primary/20 px-4 py-2 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
            >
              {t.adminUsers.nextPage}
            </Link>
          ) : (
            <span className="border border-primary/10 px-4 py-2 rounded-lg opacity-30">
              {t.adminUsers.nextPage}
            </span>
          )}
        </div>
      </nav>
    </main>
  );
}
