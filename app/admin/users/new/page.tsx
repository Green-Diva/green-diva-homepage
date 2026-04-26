import { redirect } from "next/navigation";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";
import { UserForm } from "@/components/admin/UserForm";

export default async function NewUserPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login?from=/admin/users/new");
  if (me.level < ADMIN_LEVEL) redirect("/admin");
  return <UserForm mode="create" />;
}
