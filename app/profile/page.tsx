import Link from "next/link";
import { redirect } from "next/navigation";
import { formatSerial, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import BioEditor from "./BioEditor";
import ActivityList from "./ActivityList";
import SkillsRadar from "@/components/SkillsRadar";
import TokenField from "./TokenField";
import { getDictionary } from "@/lib/i18n/server";
import { format } from "@/lib/i18n/format";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/profile");

  const t = await getDictionary();
  const GENDER_LABEL: Record<string, string> = {
    female: t.gender.female,
    male: t.gender.male,
    other: t.gender.other,
  };

  const tier =
    user.level >= 100
      ? t.tier.highLord
      : format(t.tier.acolyte, { level: user.level });
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

  const serialLabel = formatSerial(user.serial);

  return (
    <main className="relative mx-auto w-full max-w-5xl px-8 py-14">
      {/* atmospheric backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-32 -left-24 w-[420px] h-[420px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute top-40 -right-32 w-[520px] h-[520px] rounded-full bg-secondary/[0.04] blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      </div>

      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <span className="font-label text-secondary tracking-[0.4em] text-[10px] uppercase">
            {t.profile.vesselIdentity}
          </span>
          <h1 className="mt-2 font-headline text-5xl md:text-6xl font-light text-primary sacred-glow leading-[0.95] tracking-[-0.02em]">
            {t.profile.innerRecord}
            <span className="ml-3 align-middle font-mono text-2xl md:text-3xl text-secondary tracking-[0.18em]">
              · {serialLabel}
            </span>
          </h1>
          <div className="mt-3 flex items-center gap-3 font-label text-[10px] tracking-[0.3em] uppercase text-primary/50">
            <span className="block w-10 h-px bg-primary/30" />
            <span>{user.name}</span>
            <span className="text-primary/30">/</span>
            <span>{tier}</span>
          </div>
        </div>
        <Link
          href="/"
          className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/70 hover:text-primary transition-colors"
        >
          {t.profile.backToSanctuary}
        </Link>
      </div>

      {/* MODULE 1: Identity (left) + Avatar (right) */}
      <section className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-primary/15 bg-surface-container/40 p-6">
          <span className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
            {t.profile.vesselBasics}
          </span>
          <div className="mt-4">
            <div className="font-headline text-3xl text-primary">{user.name}</div>
            <div className="mt-1 font-label text-[10px] tracking-[0.3em] uppercase text-secondary">
              {tier}
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-primary/10 pt-5">
            <Field label={t.profile.fieldName} value={user.name} />
            <Field
              label={t.profile.fieldGender}
              value={user.gender ? GENDER_LABEL[user.gender] ?? user.gender : t.gender.none}
            />
            <Field label={t.profile.fieldTier} value={`${tier} (Lv ${user.level})`} />
            <TokenField token={user.token} />
          </dl>
        </div>

        <div className="relative rounded-xl border border-dashed border-primary/25 bg-gradient-to-br from-surface-container/60 via-background to-surface-container/40 overflow-hidden flex flex-col items-center justify-center p-6 min-h-[320px]">
          <div className="absolute inset-0 pointer-events-none opacity-30 bg-[linear-gradient(rgba(144,222,205,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(144,222,205,0.06)_1px,transparent_1px)] bg-[size:14px_14px]" />
          <div className="absolute top-4 left-5 font-label text-[10px] tracking-[0.3em] uppercase text-secondary/80">
            {t.profile.sigil}
          </div>
          <div className="absolute top-4 right-5 font-label text-[9px] tracking-[0.3em] uppercase text-primary/40 border border-primary/15 px-2 py-0.5 rounded-full">
            {t.profile.mosaicAwakening}
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
            {t.profile.mosaicDescription}
          </p>
        </div>
      </section>

      {/* MODULE 2: Skills */}
      <section className="mt-6 rounded-xl border border-primary/15 bg-surface-container/40 p-6">
        <div className="flex items-center justify-between">
          <span className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
            {t.profile.aptitudesPentagram}
          </span>
          <span className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary/60">
            {t.profile.stewardedByHighLord}
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
              {t.profile.specialAttributes}
            </h3>
            {specials.length === 0 ? (
              <p className="mt-3 text-sm text-on-surface-variant font-light italic">
                {t.profile.noneInscribed}
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
              {t.profile.aptitudesHelp}
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
        {t.profile.footerNote}
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
