"use client";

import type { SourceRef } from "../types";

export function InputFromEditor({
  value,
  sourceOptions,
  onChange,
}: {
  value: SourceRef;
  sourceOptions: string[];
  onChange: (v: SourceRef) => void;
}) {
  const isMerge = typeof value !== "string";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-secondary">
          Input From
        </div>
        <button
          type="button"
          onClick={() => onChange(isMerge ? "agent.input" : { merge: { input: "agent.input" } })}
          className="text-[10px] text-on-surface-variant hover:text-on-surface underline"
        >
          {isMerge ? "→ single" : "→ merge"}
        </button>
      </div>
      {!isMerge ? (
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-background/60 border border-secondary/30 px-2 py-1 text-[11px] text-on-surface"
        >
          {sourceOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-1.5">
          {Object.entries((value as { merge: Record<string, string> }).merge).map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <input
                value={k}
                onChange={(e) => {
                  const merge = { ...(value as { merge: Record<string, string> }).merge };
                  delete merge[k];
                  merge[e.target.value] = v;
                  onChange({ merge });
                }}
                className="w-24 bg-background/60 border border-secondary/30 px-1.5 py-0.5 text-[11px] text-on-surface"
              />
              <select
                value={v}
                onChange={(e) => {
                  const merge = { ...(value as { merge: Record<string, string> }).merge };
                  merge[k] = e.target.value;
                  onChange({ merge });
                }}
                className="flex-1 bg-background/60 border border-secondary/30 px-1.5 py-0.5 text-[11px] text-on-surface"
              >
                {sourceOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const merge = { ...(value as { merge: Record<string, string> }).merge };
                  delete merge[k];
                  onChange({ merge });
                }}
                className="text-error/80 hover:text-error text-[10px] px-1"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const merge = { ...(value as { merge: Record<string, string> }).merge };
              let i = 1;
              while (`key${i}` in merge) i++;
              merge[`key${i}`] = sourceOptions[0] ?? "agent.input";
              onChange({ merge });
            }}
            className="w-full px-2 py-1 border border-secondary/40 text-secondary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-secondary/10"
          >
            + Source
          </button>
        </div>
      )}
    </div>
  );
}
