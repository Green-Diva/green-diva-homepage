"use client";

import type { ForEachNodeData } from "../types";
import { InputFromEditor } from "./InputFromEditor";

export function ForEachNodePanel({
  data,
  sourceOptions,
  onPatch,
  onOpenBody,
}: {
  data: ForEachNodeData;
  sourceOptions: string[];
  onPatch: (patch: Partial<ForEachNodeData>) => void;
  onOpenBody: (() => void) | null;
}) {
  return (
    <>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(56 189 248)" }}>
            Max Items
          </div>
          <input
            type="number"
            min={1}
            max={50}
            value={data.maxItems}
            onChange={(e) => {
              const n = Math.max(1, Math.min(50, Number(e.target.value) || 1));
              onPatch({ maxItems: n });
            }}
            className="w-full bg-background/60 border border-sky-400/30 px-2 py-1 text-[12px] text-on-surface"
          />
        </div>
        <div>
          <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(56 189 248)" }}>
            Aggregate
          </div>
          <select
            value={data.aggregate}
            onChange={(e) => onPatch({ aggregate: e.target.value as ForEachNodeData["aggregate"] })}
            className="w-full bg-background/60 border border-sky-400/30 px-2 py-1 text-[12px] text-on-surface"
          >
            <option value="concat-array">concat-array</option>
            <option value="last">last</option>
          </select>
        </div>
      </div>
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(56 189 248)" }}>
          Body ({data.body.nodes.length} nodes / {data.body.edges.length} edges)
        </div>
        <button
          type="button"
          onClick={onOpenBody ?? undefined}
          disabled={!onOpenBody}
          className="w-full px-3 py-2 font-label text-[10px] tracking-[0.25em] uppercase border-2 disabled:opacity-40"
          style={{ borderColor: "rgb(56 189 248 / 0.6)", color: "rgb(56 189 248)" }}
        >
          ▷ Edit forEach Body
        </button>
        <div className="text-[10px] text-on-surface-variant mt-1.5 leading-relaxed">
          Body runs once per item. Inside, <code>agent.input</code> ={" "}
          <code>{`{ item, index, total }`}</code> — read{" "}
          <code>agent.input.item</code> to get the current array element. Aggregate{" "}
          <code>concat-array</code> collects all leaf outputs into one array; <code>last</code> returns
          only the final iteration&apos;s output.
        </div>
      </div>
    </>
  );
}
