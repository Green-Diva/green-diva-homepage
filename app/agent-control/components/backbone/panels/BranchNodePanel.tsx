"use client";

import type { BranchCase, BranchNodeData } from "../types";
import { InputFromEditor } from "./InputFromEditor";

export function BranchNodePanel({
  data,
  sourceOptions,
  onPatch,
}: {
  data: BranchNodeData;
  sourceOptions: string[];
  onPatch: (patch: Partial<BranchNodeData>) => void;
}) {
  function patchCase(idx: number, patch: Partial<BranchCase>) {
    const next = data.cases.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onPatch({ cases: next });
  }
  function addCase() {
    onPatch({
      cases: [
        ...data.cases,
        { path: "", op: "eq", value: "", label: `case${data.cases.length + 1}` },
      ],
    });
  }
  function removeCase(idx: number) {
    onPatch({ cases: data.cases.filter((_, i) => i !== idx) });
  }

  return (
    <>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-tertiary mb-1">
          Cases
        </div>
        <div className="space-y-2">
          {data.cases.map((c, i) => (
            <div key={i} className="border border-tertiary/40 rounded p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  placeholder="path (e.g. kind)"
                  value={c.path}
                  onChange={(e) => patchCase(i, { path: e.target.value })}
                  className="flex-1 min-w-0 bg-background/60 border border-tertiary/30 px-1.5 py-0.5 text-[11px] text-on-surface"
                />
                <select
                  value={c.op}
                  onChange={(e) => patchCase(i, { op: e.target.value as BranchCase["op"] })}
                  className="bg-background/60 border border-tertiary/30 px-1 py-0.5 text-[11px] text-on-surface"
                >
                  <option value="eq">eq</option>
                  <option value="ne">ne</option>
                  <option value="in">in</option>
                  <option value="exists">exists</option>
                </select>
              </div>
              {c.op !== "exists" ? (
                <input
                  placeholder={c.op === "in" ? '["a","b"]' : '"value"'}
                  value={typeof c.value === "string" ? c.value : JSON.stringify(c.value ?? "")}
                  onChange={(e) => {
                    let v: unknown = e.target.value;
                    if (c.op === "in") {
                      try { v = JSON.parse(e.target.value); } catch { /* leave as string */ }
                    } else {
                      try { v = JSON.parse(e.target.value); } catch { /* leave as string */ }
                    }
                    patchCase(i, { value: v });
                  }}
                  className="w-full bg-background/60 border border-tertiary/30 px-1.5 py-0.5 text-[11px] font-mono text-on-surface"
                />
              ) : null}
              <div className="flex gap-1.5 items-center">
                <input
                  placeholder="label (matches edge.when)"
                  value={c.label}
                  onChange={(e) => patchCase(i, { label: e.target.value })}
                  className="flex-1 min-w-0 bg-background/60 border border-tertiary/30 px-1.5 py-0.5 text-[11px] text-on-surface"
                />
                <button
                  type="button"
                  onClick={() => removeCase(i)}
                  className="text-error/80 hover:text-error text-[10px]"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addCase}
            className="w-full px-2 py-1 border border-tertiary/40 text-tertiary font-label text-[10px] tracking-[0.25em] uppercase hover:bg-tertiary/10"
          >
            + Case
          </button>
        </div>
      </div>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase text-tertiary mb-1">
          Default Label (optional)
        </div>
        <input
          placeholder="(none — abort if no case matches)"
          value={data.defaultLabel ?? ""}
          onChange={(e) => onPatch({ defaultLabel: e.target.value || undefined })}
          className="w-full bg-background/60 border border-tertiary/30 px-2 py-1 text-[11px] text-on-surface"
        />
      </div>
    </>
  );
}
