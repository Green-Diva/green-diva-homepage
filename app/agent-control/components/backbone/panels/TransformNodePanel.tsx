"use client";

import type { TransformNodeData } from "../types";
import { InputFromEditor } from "./InputFromEditor";

export function TransformNodePanel({
  data,
  sourceOptions,
  onPatch,
}: {
  data: TransformNodeData;
  sourceOptions: string[];
  onPatch: (patch: Partial<TransformNodeData>) => void;
}) {
  return (
    <>
      <InputFromEditor
        value={data.inputFrom}
        sourceOptions={sourceOptions}
        onChange={(inputFrom) => onPatch({ inputFrom })}
      />
      <div>
        <div className="font-label text-[9px] tracking-[0.3em] uppercase mb-1" style={{ color: "rgb(52 211 153)" }}>
          JSONata Expression
        </div>
        <textarea
          value={data.expression}
          onChange={(e) => onPatch({ expression: e.target.value })}
          rows={6}
          spellCheck={false}
          placeholder={"$    /* identity */\n\n/* zip + apply verdict */\n$map(verdicts, function($v, $i) {\n  candidates[$i] ~> $merge({ score: score + ($v.match ? 50 : -30) })\n})"}
          className="w-full bg-background/60 border border-emerald-400/30 px-2 py-1 text-[11px] font-mono text-on-surface focus:outline-none focus:border-emerald-400 resize-y"
        />
        <div className="text-[10px] text-on-surface-variant mt-1.5 leading-relaxed">
          Pure JSON-in JSON-out — no FS, no network, no side effects. Use for
          zip / map / filter / reduce on arrays + objects without writing a
          dedicated handler. <code>$</code> = whole input.{" "}
          <a
            href="https://docs.jsonata.org/overview"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-on-surface"
          >
            JSONata reference
          </a>
        </div>
      </div>
    </>
  );
}
