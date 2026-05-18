import type { SkillRow } from "@/app/agent-control/types";

export type SkillBookChapter = {
  level: number;
  indexInLevel: number; // 1-based
  totalInLevel: number;
};

export type SkillBookEntry =
  | { kind: "skill"; skill: SkillRow; chapter: SkillBookChapter }
  | { kind: "create" }
  | { kind: "blank" };

export type SkillBookLayout = {
  sortedSkills: SkillRow[];
  /** Flat page sequence: sorted skills + (admin) trailing create entry. */
  entries: SkillBookEntry[];
  /** Maps Skill.id → that skill's index in `entries`. */
  entryIndexBySkillId: Map<string, number>;
  /** Entry index for the create-entry, if admin. */
  createEntryIndex: number | null;
};

// Pure layout calculation. The book renders spreads dynamically based on
// a `leftPageIndex` controlled by the parent — pairs are NOT fixed
// (entry 0 + 1), they're whatever (leftPageIndex, leftPageIndex+1) lands
// on. This lets the TOC always place the clicked skill on the left page.
export function buildSkillBookLayout(
  skills: SkillRow[],
  isAdmin: boolean,
): SkillBookLayout {
  const sortedSkills = [...skills].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    const sa = a.slug ?? a.nameEn ?? "";
    const sb = b.slug ?? b.nameEn ?? "";
    return sa.localeCompare(sb);
  });

  const counts: Record<number, number> = {};
  for (const s of sortedSkills) counts[s.level] = (counts[s.level] ?? 0) + 1;

  const seen: Record<number, number> = {};
  const entries: SkillBookEntry[] = sortedSkills.map((skill) => {
    seen[skill.level] = (seen[skill.level] ?? 0) + 1;
    return {
      kind: "skill",
      skill,
      chapter: {
        level: skill.level,
        indexInLevel: seen[skill.level],
        totalInLevel: counts[skill.level],
      },
    };
  });

  let createEntryIndex: number | null = null;
  if (isAdmin) {
    createEntryIndex = entries.length;
    entries.push({ kind: "create" });
  }
  if (entries.length === 0) entries.push({ kind: "blank" });

  const entryIndexBySkillId = new Map<string, number>();
  entries.forEach((entry, idx) => {
    if (entry.kind === "skill") entryIndexBySkillId.set(entry.skill.id, idx);
  });

  return { sortedSkills, entries, entryIndexBySkillId, createEntryIndex };
}
