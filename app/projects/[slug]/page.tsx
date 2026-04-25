import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const p = await prisma.project.findUnique({ where: { slug } });
  if (!p) return { title: "Not found" };
  return { title: p.title, description: p.summary };
}

export default async function ProjectDetail({ params }: Params) {
  const { slug } = await params;
  const project = await prisma.project.findUnique({ where: { slug } });
  if (!project || !project.published) notFound();

  const tags = project.tags.split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col w-full bg-background text-on-surface">
      <header className="w-full flex justify-between items-center px-12 py-6 bg-[#121414]/90 backdrop-blur-xl border-b border-primary/10">
        <Link
          href="/"
          className="text-2xl font-headline italic text-primary drop-shadow-[0_0_8px_rgba(144,222,205,0.4)]"
        >
          Green Diva
        </Link>
        <Link
          href="/#chronicle"
          className="font-label text-[10px] tracking-[0.4em] uppercase text-primary/70 hover:text-primary transition-colors"
        >
          ← Return to Sanctuary
        </Link>
      </header>

      <main className="flex-1">
        <article className="mx-auto w-full max-w-3xl px-8 py-20">
          <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase block">
            Chronicle
          </span>
          <h1 className="mt-6 font-headline text-5xl md:text-6xl font-light text-primary sacred-glow leading-tight">
            {project.title}
          </h1>
          <p className="mt-6 text-lg font-light text-on-surface-variant leading-relaxed">
            {project.summary}
          </p>

          {tags.length > 0 ? (
            <ul className="mt-8 flex flex-wrap gap-2">
              {tags.map((t) => (
                <li
                  key={t}
                  className="border border-primary/20 px-3 py-1 text-[10px] font-label tracking-[0.2em] uppercase text-primary/70"
                >
                  {t}
                </li>
              ))}
            </ul>
          ) : null}

          {project.link || project.repoUrl ? (
            <div className="mt-8 flex flex-wrap gap-6 text-sm font-label uppercase tracking-[0.3em]">
              {project.link ? (
                <a
                  href={project.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-[6px] decoration-primary/30 hover:decoration-primary"
                >
                  Vessel ↗
                </a>
              ) : null}
              {project.repoUrl ? (
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-[6px] decoration-primary/30 hover:decoration-primary"
                >
                  Scrolls ↗
                </a>
              ) : null}
            </div>
          ) : null}

          <div className="mt-12 h-px bg-primary/10" />

          <div className="prose prose-invert mt-12 max-w-none font-body prose-headings:font-headline prose-headings:text-primary prose-headings:font-light prose-a:text-primary prose-strong:text-on-surface prose-code:text-secondary prose-code:bg-surface-container prose-pre:bg-surface-container-lowest prose-pre:border prose-pre:border-primary/10">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{project.description}</ReactMarkdown>
          </div>
        </article>
      </main>

      <footer className="w-full px-12 py-8 border-t border-primary/5">
        <div className="text-secondary font-bold font-label text-[9px] tracking-[0.4em] uppercase opacity-50 text-center">
          © MMXXIV GREEN DIVA COLLECTIVE • NEON MONASTERY
        </div>
      </footer>
    </div>
  );
}
