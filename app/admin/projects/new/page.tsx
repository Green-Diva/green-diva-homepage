import { redirect } from "next/navigation";
import { ProjectForm } from "@/components/admin/ProjectForm";
import { ADMIN_LEVEL, getCurrentUser } from "@/lib/auth";

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/admin/projects/new");
  if (user.level < ADMIN_LEVEL) redirect("/admin");
  return <ProjectForm mode="create" />;
}
