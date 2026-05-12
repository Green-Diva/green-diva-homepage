"use client";

import type { PersistNodeData } from "../types";
import { InputFromEditor } from "./InputFromEditor";

export function PersistNodePanel({
  data,
  sourceOptions,
  onPatch,
}: {
  data: PersistNodeData;
  sourceOptions: string[];
  onPatch: (patch: Partial<PersistNodeData>) => void;
}) {
  return (
    <>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
      <div
        className="text-[10px] text-on-surface-variant mt-1.5 leading-relaxed border border-amber-400/30 bg-amber-400/[0.06] p-2 rounded"
      >
        <div
          className="font-label text-[9px] tracking-[0.3em] uppercase mb-1"
          style={{ color: "rgb(251 191 36)" }}
        >
          Persist Contract
        </div>
        <div>
          Input must resolve to{" "}
          <code className="text-on-surface">
            {`{ relicSlug, kind, base64, contentType?, ext? }`}
          </code>
          . Typically wired via a merge ref pulling{" "}
          <code className="text-on-surface">relicSlug</code> +{" "}
          <code className="text-on-surface">kind</code> from{" "}
          <code className="text-on-surface">agent.input</code> and{" "}
          <code className="text-on-surface">base64</code> /{" "}
          <code className="text-on-surface">contentType</code> from an upstream
          download skill.
        </div>
        <div className="mt-1.5">
          Output:{" "}
          <code className="text-on-surface">
            {`{ savedPath, absPath, bytes, contentType }`}
          </code>
          . A downstream <code className="text-on-surface">transform</code> typically
          composes <code className="text-on-surface">_relicWriteback</code> from{" "}
          <code className="text-on-surface">savedPath</code> so runner writes the
          Relic column.
        </div>
      </div>
    </>
  );
}
