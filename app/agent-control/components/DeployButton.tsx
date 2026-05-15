"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { AgentRow, SceneBindingRow } from "../types";
import type { SerializableSceneDef } from "@/lib/agent-service/serialize";
import { themeAccent, themeClass } from "@/lib/agentControl/theme";

// Deploy flow (2026-05-15):
//   click Deploy → modal confirm step → POST deploy → modal success/error.
//   The post-confirm step is a fast bindings-only commit (txn: delete
//   orphans, upsert intent, stamp deployedAt, flip status=DEPLOYED).
//   Smoke testing has moved to the explicit "Test Run" button on the
//   detail header so admin chooses when to burn external-API budget.

type Stage = "idle" | "confirm" | "running" | "success" | "failure";

export default function DeployButton({
  agent,
  isAdmin,
  sceneDefs,
  sceneBindings,
  autoOpenNonce,
}: {
  agent: AgentRow;
  isAdmin: boolean;
  sceneDefs: SerializableSceneDef[];
  sceneBindings: SceneBindingRow[];
  // Increments each time AgentEditor's "save with STATUS=DEPLOYED"
  // shortcut wants the confirm modal opened. Null when no request.
  autoOpenNonce: number | null;
}) {
  const t = useT();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const accent = themeAccent(agent.mode);
  const accentText = themeClass(agent.mode, "text");
  const accentBorder = themeClass(agent.mode, "border");
  const accentBg = themeClass(agent.mode, "bgSoft");
  const accentHover = themeClass(agent.mode, "hover");
  const accentGlow = themeClass(agent.mode, "glow");

  const dirty = agent.deployedAt
    ? new Date(agent.updatedAt).getTime() > new Date(agent.deployedAt).getTime()
    : false;
  const synced = !!agent.deployedAt && !dirty;
  const busy = stage === "running";

  const plan = useMemo(() => {
    const sceneByKey = new Map(sceneDefs.map((s) => [s.key, s]));
    const bindingByKey = new Map(sceneBindings.map((b) => [b.sceneKey, b]));

    const intent = agent.intentSceneKeys.map((key) => ({
      key,
      def: sceneByKey.get(key) ?? null,
      currentBinding: bindingByKey.get(key) ?? null,
    }));
    const takeovers = intent
      .filter((i) => i.currentBinding && i.currentBinding.agentId !== agent.id)
      .map((i) => ({
        sceneKey: i.key,
        previousAgentCodename: i.currentBinding?.agentCodename ?? "?",
        previouslyEnabled: i.currentBinding?.enabled ?? false,
      }));
    const orphans = sceneBindings
      .filter(
        (b) =>
          b.agentId === agent.id && !agent.intentSceneKeys.includes(b.sceneKey),
      )
      .map((b) => b.sceneKey);
    return { intent, takeovers, orphans };
  }, [agent, sceneDefs, sceneBindings]);

  const label = busy
    ? t.agentControl.deploying
    : agent.status === "OFFLINE"
      ? t.agentControl.offlined
      : !agent.deployedAt
        ? t.agentControl.deploy
        : dirty
          ? t.agentControl.redeploy
          : t.agentControl.deployed;

  function openConfirm() {
    if (synced) return;
    setErrMsg(null);
    setStage("confirm");
  }

  // When AgentEditor saved with STATUS=DEPLOYED, parent bumps a nonce.
  // We watch the change, not the value, so the same agent can be deployed
  // via this shortcut repeatedly.
  const lastNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (autoOpenNonce == null) return;
    if (lastNonceRef.current === autoOpenNonce) return;
    lastNonceRef.current = autoOpenNonce;
    openConfirm();
    // openConfirm closes over current `synced`, which is fine — if the
    // user lands on a synced agent the nonce fires no modal (matches the
    // disabled-button behavior).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenNonce]);

  async function runDeploy() {
    setStage("running");
    setErrMsg(null);
    try {
      const r = await fetch(`/api/agents/${agent.id}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmTakeovers: true }),
      });
      const data: { errorCode?: string; errorMessage?: string } = await r
        .json()
        .catch(() => ({}));
      if (r.ok) {
        setStage("success");
        router.refresh();
        return;
      }
      setErrMsg(data.errorMessage ?? `deploy failed (${r.status})`);
      setStage("failure");
    } catch (e) {
      console.error("[DeployButton] failed", e);
      setErrMsg(`network error: ${(e as Error).message}`);
      setStage("failure");
    }
  }

  function close() {
    setStage("idle");
    setErrMsg(null);
  }

  if (typeof document === "undefined") {
    // Render the button server-side too (no portal) so it doesn't flicker
    return (
      <div className="shrink-0 relative">
        <button type="button" disabled className="min-h-[44px] px-6 opacity-40">
          {label}
        </button>
      </div>
    );
  }

  const isOffline = agent.status === "OFFLINE";

  return (
    <div className="shrink-0 relative">
      <button
        type="button"
        disabled={!isAdmin || busy || synced || isOffline}
        onClick={openConfirm}
        className={[
          "min-h-[44px] px-6 rounded-md border-2 font-label text-[11px] tracking-[0.35em] uppercase transition-all flex items-center gap-2",
          // Lifecycle-driven colors:
          // - OFFLINE → rose (kill-switch indicator, button non-clickable)
          // - DEPLOYED + synced → emerald (matches DetailHeader status pill)
          // - otherwise → mode accent (gold for MECHANICAL / cyan for AUTONOMOUS)
          isOffline
            ? "border-rose-400/60 text-rose-300 bg-rose-400/[0.08]"
            : synced
              ? "border-emerald-400/60 text-emerald-300 bg-emerald-400/[0.08]"
              : accentBorder,
          isOffline || synced ? "" : accentText,
          isOffline || synced ? "" : accentBg,
          isOffline || synced ? "" : accentHover,
          isOffline || synced ? "" : accentGlow,
          "disabled:cursor-not-allowed",
          // Keep DEPLOYED (emerald) and OFFLINE (rose) at full opacity even
          // when disabled — their color IS the lifecycle signal. Other
          // disabled states dim normally.
          synced || isOffline ? "disabled:opacity-100" : "disabled:opacity-40",
        ].join(" ")}
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden>
          {isOffline
            ? "block"
            : synced
              ? "check_circle"
              : agent.deployedAt
                ? "rocket_launch"
                : "rocket"}
        </span>
        {label}
      </button>
      <span aria-hidden className="sr-only">{accent}</span>
      {stage !== "idle"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget && stage !== "running") close();
              }}
            >
              <div className="w-full max-w-xl rounded-lg border border-outline-variant/40 bg-surface-container p-6 shadow-2xl max-h-[85vh] flex flex-col">
                <h2 className={`font-label text-[12px] tracking-[0.3em] uppercase mb-3 ${accentText}`}>
                  {stage === "running"
                    ? t.agentControl.deployRunningTitle
                    : stage === "success"
                      ? t.agentControl.deploySuccessTitle
                      : stage === "failure"
                        ? t.agentControl.deployFailureTitle
                        : t.agentControl.deployConfirmTitle}
                </h2>

                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  {stage === "confirm" ? (
                    <ConfirmBody agent={agent} plan={plan} t={t} />
                  ) : stage === "running" ? (
                    <RunningBody t={t} />
                  ) : stage === "success" ? (
                    <SuccessBody plan={plan} t={t} />
                  ) : (
                    <FailureBody errMsg={errMsg} t={t} />
                  )}
                </div>

                <div className="mt-5 flex justify-end gap-3 shrink-0">
                  {stage === "confirm" ? (
                    <>
                      <button
                        type="button"
                        onClick={close}
                        className="min-h-[40px] px-5 py-1.5 border border-outline-variant text-on-surface-variant font-label text-[10px] tracking-[0.3em] uppercase rounded-md hover:bg-surface-container/70 transition-colors"
                      >
                        {t.agentControl.cancel}
                      </button>
                      <button
                        type="button"
                        onClick={runDeploy}
                        className={`min-h-[40px] px-5 py-1.5 border-2 font-label text-[10px] tracking-[0.3em] uppercase rounded-md transition-colors ${accentBorder} ${accentText} ${accentBg} hover:opacity-90`}
                      >
                        {t.agentControl.deployConfirmAction}
                      </button>
                    </>
                  ) : stage === "running" ? null : (
                    <button
                      type="button"
                      onClick={close}
                      className={`min-h-[40px] px-5 py-1.5 border-2 font-label text-[10px] tracking-[0.3em] uppercase rounded-md transition-colors ${accentBorder} ${accentText} ${accentBg} hover:opacity-90`}
                    >
                      {t.agentControl.close}
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ConfirmBody({
  agent,
  plan,
  t,
}: {
  agent: AgentRow;
  plan: {
    intent: { key: string; def: SerializableSceneDef | null }[];
    takeovers: { sceneKey: string; previousAgentCodename: string; previouslyEnabled: boolean }[];
    orphans: string[];
  };
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-on-surface-variant">
        {t.agentControl.deployConfirmBody.replace("{codename}", agent.codename)}
      </p>

      <Section title={`${t.agentControl.deployConfirmIntent} (${plan.intent.length})`}>
        {plan.intent.length === 0 ? (
          <p className="text-xs text-on-surface-variant/60">
            {t.agentControl.deployConfirmIntentEmpty}
          </p>
        ) : (
          <ul className="space-y-0.5 text-[12px] font-mono text-on-surface">
            {plan.intent.map((i) => (
              <li key={i.key}>{i.key}</li>
            ))}
          </ul>
        )}
      </Section>

      {plan.takeovers.length > 0 ? (
        <Section title={`${t.agentControl.deployConfirmTakeovers} (${plan.takeovers.length})`}>
          <ul className="space-y-1.5">
            {plan.takeovers.map((tk) => (
              <li
                key={tk.sceneKey}
                className="rounded-md border border-amber-300/30 bg-amber-300/5 px-3 py-2"
              >
                <div className="font-mono text-[12px] text-on-surface">{tk.sceneKey}</div>
                <div className="text-[11px] text-amber-300/90 mt-0.5">
                  {t.agentControl.deployTakeoverFromPrefix}{" "}
                  <span className="font-mono">{tk.previousAgentCodename}</span>
                  {tk.previouslyEnabled ? (
                    <span className="ml-1.5 text-[10px] tracking-[0.2em] uppercase text-rose-300/90 border border-rose-300/40 px-1 rounded">
                      {t.agentControl.deployTakeoverLiveBadge}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {plan.orphans.length > 0 ? (
        <Section title={`${t.agentControl.deployConfirmOrphans} (${plan.orphans.length})`}>
          <ul className="space-y-0.5 text-[12px] font-mono text-on-surface-variant/80">
            {plan.orphans.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function RunningBody({ t }: { t: ReturnType<typeof useT> }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="material-symbols-outlined animate-spin text-primary text-2xl" aria-hidden>
        progress_activity
      </span>
      <p className="text-on-surface-variant">{t.agentControl.deployRunningBody}</p>
    </div>
  );
}

function SuccessBody({
  plan,
  t,
}: {
  plan: {
    intent: { key: string }[];
    orphans: string[];
  };
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-emerald-300 text-2xl" aria-hidden>
          check_circle
        </span>
        <p className="text-on-surface">{t.agentControl.deploySuccessBody}</p>
      </div>
      {plan.intent.length > 0 ? (
        <Section title={t.agentControl.deployConfirmIntent}>
          <ul className="space-y-0.5 text-[12px] font-mono text-on-surface">
            {plan.intent.map((i) => (
              <li key={i.key} className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-300 text-[14px]" aria-hidden>
                  check
                </span>
                {i.key}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {plan.orphans.length > 0 ? (
        <Section title={t.agentControl.deployConfirmOrphans}>
          <ul className="space-y-0.5 text-[12px] font-mono text-on-surface-variant/70">
            {plan.orphans.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function FailureBody({ errMsg, t }: { errMsg: string | null; t: ReturnType<typeof useT> }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-rose-300 text-2xl" aria-hidden>
          error
        </span>
        <p className="text-on-surface">{t.agentControl.deployFailureBody}</p>
      </div>
      {errMsg ? (
        <pre className="text-[11px] font-mono text-rose-200/90 whitespace-pre-wrap break-words bg-rose-950/30 border border-rose-400/20 rounded p-2">
          {errMsg}
        </pre>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-label text-[10px] tracking-[0.25em] uppercase text-on-surface-variant/70 mb-1.5">
        {title}
      </h3>
      {children}
    </div>
  );
}
