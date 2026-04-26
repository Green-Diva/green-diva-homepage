import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import BioEditor from "./BioEditor";
import ActivityList from "./ActivityList";
import SkillsRadar from "@/components/SkillsRadar";
import TokenField from "./TokenField";

const GENDER_LABEL: Record<string, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
};

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/profile");

  const tier = user.level >= 100 ? "High Lord" : `Acolyte · L${user.level}`;
  const initial = user.name.trim().charAt(0).toUpperCase() || "·";

  const activities = await prisma.activity.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const activitiesSerialized = activities.map((a) => ({
    id: a.id,
    content: a.content,
    createdAt: a.createdAt.toISOString(),
  }));

  const specials = (user.specialAttributes ?? "")
    .split(/[,·;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-14">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
            Vessel · Identity
          </span>
          <h1 className="mt-2 font-headline text-4xl font-light text-primary sacred-glow">
            Inner Records
          </h1>
        </div>
        <Link
          href="/"
          className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/70 hover:text-primary transition-colors"
        >
          Sanctuary
        </Link>
      </div>

      {/* MODULE 1: Identity (left) + Avatar (right) */}
      <section className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-primary/15 bg-surface-container/40 p-6">
          <span className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
            Vessel · Basics
          </span>
          <div className="mt-4">
            <div className="font-headline text-3xl text-primary">{user.name}</div>
            <div className="mt-1 font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
              {tier}
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-primary/10 pt-5">
            <Field label="Name" value={user.name} />
            <Field
              label="Gender"
              value={user.gender ? GENDER_LABEL[user.gender] ?? user.gender : "—"}
            />
            <Field label="Tier" value={`${tier} (Lv ${user.level})`} />
            <TokenField token={user.token} />
          </dl>
        </div>

        <div className="relative rounded-xl border border-dashed border-primary/25 bg-gradient-to-br from-surface-container/60 via-background to-surface-container/40 overflow-hidden flex flex-col items-center justify-center p-6 min-h-[320px]">
          <div className="absolute inset-0 pointer-events-none opacity-30 bg-[linear-gradient(rgba(144,222,205,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(144,222,205,0.06)_1px,transparent_1px)] bg-[size:14px_14px]" />
          <div className="absolute top-4 left-5 font-label text-[10px] tracking-[0.3em] uppercase text-secondary/80">
            Sigil
          </div>
          <div className="absolute top-4 right-5 font-label text-[9px] tracking-[0.3em] uppercase text-primary/40 border border-primary/15 px-2 py-0.5 rounded-full">
            3D Mosaic · Awakening
          </div>
          <div className="relative w-40 h-40 rounded-full border border-primary/30 bg-surface-container flex items-center justify-center text-primary font-headline text-6xl select-none">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={user.name} src={user.avatarUrl} className="w-full h-full object-cover rounded-full" />
            ) : (
              <span>{initial}</span>
            )}
            <span className="absolute -inset-2 rounded-full border border-primary/15 animate-pulse" />
          </div>
          <p className="mt-5 text-xs text-on-surface-variant font-light text-center max-w-xs leading-[1.6]">
            A 3D mosaic-style sigil will animate here once the sanctum&rsquo;s
            generative ritual awakens.
          </p>
        </div>
      </section>

      {/* MODULE 2: Skills */}
      <section className="mt-6 rounded-xl border border-primary/15 bg-surface-container/40 p-6">
        <div className="flex items-center justify-between">
          <span className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
            Aptitudes · Pentagram
          </span>
          <span className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary/60">
            Stewarded by High Lord
          </span>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-8 items-center">
          <SkillsRadar
            stats={{
              attack: user.attack,
              defense: user.defense,
              hp: user.hp,
              agility: user.agility,
              luck: user.luck,
            }}
          />
          <div>
            <h3 className="font-headline text-xl text-secondary italic">
              Special Attributes
            </h3>
            {specials.length === 0 ? (
              <p className="mt-3 text-sm text-on-surface-variant font-light italic">
                None inscribed yet.
              </p>
            ) : (
              <ul className="mt-4 flex flex-wrap gap-2">
                {specials.map((s) => (
                  <li
                    key={s}
                    className="font-label text-[10px] tracking-[0.3em] uppercase text-primary border border-primary/30 bg-primary/5 px-3 py-1 rounded-full"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-6 text-xs text-on-surface-variant font-light leading-[1.7]">
              Aptitudes range 0–100. They are tuned by the priesthood and reflect
              your standing within the sanctum.
            </p>
          </div>
        </div>
      </section>

      {/* MODULE 3: Autobiography */}
      <section className="mt-6">
        <BioEditor initialBio={user.bio} />
      </section>

      {/* MODULE 4: Current Activity */}
      <section className="mt-6">
        <ActivityList initial={activitiesSerialized} />
      </section>

      <p className="mt-12 text-xs text-on-surface-variant font-light">
        Identity facts, tier, and aptitudes are stewarded by the High Lord. You may
        inscribe or revise your autobiography and dispatches at any time.
      </p>
    </main>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
        {label}
      </dt>
      <dd
        className={`mt-1.5 text-sm text-on-surface ${mono ? "font-mono text-on-surface-variant" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
