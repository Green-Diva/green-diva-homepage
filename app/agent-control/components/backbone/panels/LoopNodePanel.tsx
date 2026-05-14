"use client";

import type { EquipRow } from "../../../types";
import type { BranchCase, LoopNodeData } from "../types";
import { InputFromEditor } from "./InputFromEditor";
import { BodySkillsList } from "./BodySkillsList";

export function LoopNodePanel({
  data,
  equipBySlot,
  sourceOptions,
  onPatch,
  onOpenBody,
}: {
  data: LoopNodeData;
  equipBySlot: Map<number, EquipRow>;
  sourceOptions: string[];
  onPatch: (patch: Partial<LoopNodeData>) => void;
  onOpenBody: (() => void) | null;
}) {
  function patchExitWhen(idx: number, patch: Partial<BranchCase>) {
    const next = data.exitWhen.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onPatch({ exitWhen: next });
  }
  function addExitCase() {
    onPatch({
      exitWhen: [
        ...data.exitWhen,
        { path: "", op: "exists", value: undefined, label: `exit${data.exitWhen.length + 1}` },
      ],
    });
  }
  function removeExitCase(idx: number) {
    onPatch({ exitWhen: data.exitWhen.filter((_, i) => i !== idx) });
  }
  return (
    <>
      <BodySkillsList
        bodyNodes={data.body.nodes}
        equipBySlot={equipBySlot}
        accent="rgb(196 181 253)"
      />
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(196 181 253)" }}>
            Max Iter
          </div>
          <input
            type="number"
            min={1}
            max={10}
            value={data.maxIterations}
            onChange={(e) => {
              const n = Math.max(1, Math.min(10, Number(e.target.value) || 1));
              onPatch({ maxIterations: n });
            }}
            className="w-full bg-background/60 border border-violet-300/30 px-2 py-1 text-[12px] text-on-surface"
          />
        </div>
        <div>
          <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(196 181 253)" }}>
            Aggregate
          </div>
          <select
            value={data.aggregate}
            onChange={(e) => onPatch({ aggregate: e.target.value as LoopNodeData["aggregate"] })}
            className="w-full bg-background/60 border border-violet-300/30 px-2 py-1 text-[12px] text-on-surface"
          >
            <option value="last">last</option>
            <option value="concat-array">concat-array</option>
          </select>
        </div>
      </div>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(196 181 253)" }}>
          Exit When (optional — match against iteration leaf output)
        </div>
        <div className="space-y-2">
          {data.exitWhen.map((c, i) => (
            <div key={i} className="border border-violet-300/40 rounded p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  placeholder="path (e.g. status)"
                  value={c.path}
                  onChange={(e) => patchExitWhen(i, { path: e.target.value })}
                  className="flex-1 min-w-0 bg-background/60 border border-violet-300/30 px-1.5 py-0.5 text-[11px] text-on-surface"
                />
                <select
                  value={c.op}
                  onChange={(e) => patchExitWhen(i, { op: e.target.value as BranchCase["op"] })}
                  className="bg-background/60 border border-violet-300/30 px-1 py-0.5 text-[11px] text-on-surface"
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
                    try { v = JSON.parse(e.target.value); } catch { /* keep string */ }
                    patchExitWhen(i, { value: v });
                  }}
                  className="w-full bg-background/60 border border-violet-300/30 px-1.5 py-0.5 text-[11px] font-mono text-on-surface"
                />
              ) : null}
              <div className="flex gap-1.5 items-center">
                <input
                  placeholder="label (cosmetic — for trace)"
                  value={c.label}
                  onChange={(e) => patchExitWhen(i, { label: e.target.value })}
                  className="flex-1 min-w-0 bg-background/60 border border-violet-300/30 px-1.5 py-0.5 text-[11px] text-on-surface"
                />
                <button
                  type="button"
                  onClick={() => removeExitCase(i)}
                  className="text-error/80 hover:text-error text-[10px]"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addExitCase}
            className="w-full px-2 py-1 border border-violet-300/40 font-label text-[10px] tracking-[0.25em] uppercase hover:bg-violet-300/10"
            style={{ color: "rgb(196 181 253)" }}
          >
            + Exit Case
          </button>
        </div>
      </div>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(196 181 253)" }}>
          Body ({data.body.nodes.length} nodes / {data.body.edges.length} edges)
        </div>
        <button
          type="button"
          onClick={onOpenBody ?? undefined}
          disabled={!onOpenBody}
          className="w-full px-3 py-2 font-label text-[10px] tracking-[0.25em] uppercase border-2 border-double disabled:opacity-40"
          style={{ borderColor: "rgb(196 181 253 / 0.6)", color: "rgb(196 181 253)" }}
        >
          ▷ Edit Loop Body
        </button>
        <div className="text-[10px] text-on-surface-variant mt-1.5 leading-relaxed">
          Body is a self-contained sub-DAG. Inside, <code>agent.input</code> resolves to the current
          iteration state (loop input on first pass, prior leaf output on subsequent passes).
          Nesting loops further requires the Advanced raw-JSON editor.
        </div>
      </div>
    </>
  );
}
