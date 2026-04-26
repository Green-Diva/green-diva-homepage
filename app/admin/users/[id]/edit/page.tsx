import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { UserForm } from "@/components/admin/UserForm";

type Params = { params: Promise<{ id: string }> };

export default async function EditUserPage({ params }: Params) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.level < ADMIN_LEVEL) redirect("/admin");

  const { id } = await params;
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) notFound();

  const masked = u.token.length > 8 ? `${u.token.slice(0, 4)}…${u.token.slice(-4)}` : "••••";

  return (
    <UserForm
      mode="edit"
      initialMaskedToken={masked}
      initial={{
        id: u.id,
        name: u.name,
        gender: (u.gender as "female" | "male" | "other" | null) ?? "",
        level: u.level,
        avatarUrl: u.avatarUrl ?? "",
      }}
    />
  );
}
