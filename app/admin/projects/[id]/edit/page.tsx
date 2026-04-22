import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/admin/ProjectForm";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export default async function EditProjectPage({ params }: Params) {
  const { id } = await params;
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) notFound();

  return (
    <ProjectForm
      mode="edit"
      initial={{
        id: p.id,
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        description: p.description,
        coverUrl: p.coverUrl ?? "",
        tags: p.tags,
        link: p.link ?? "",
        repoUrl: p.repoUrl ?? "",
        order: p.order,
        published: p.published,
      }}
    />
  );
}
