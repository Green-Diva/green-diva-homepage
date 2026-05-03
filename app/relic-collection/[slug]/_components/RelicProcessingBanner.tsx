"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";

const POLL_MS = 3000;
type RelicStatus = "DRAFT" | "PROCESSING" | "READY" | "PARTIAL" | "FAILED";
type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type JobStep =
  | "ENQUEUED"
  | "EXTRACT_ZIP"
  | "REMOVE_BG"
  | "STRUCTURED_FIELDS"
  | "GEN_3D"
  | "WEB_RESEARCH"
  | "WRITE_LORE"
  | "PACK_DERIVED"
  | "FINALIZE";

type JobPayload = {
  hasJob: boolean;
  relicStatus: RelicStatus;
  job?: {
    id: string;
    status: JobStatus;
    step: JobStep;
    progress: number;
    errorMessage: string | null;
  };
};

const STEP_KEY: Record<JobStep, keyof ReturnType<typeof useT>["relicCollection"]> = {
  ENQUEUED: "jobStepEnqueued",
  EXTRACT_ZIP: "jobStepExtractZip",
  REMOVE_BG: "jobStepRemoveBg",
  STRUCTURED_FIELDS: "jobStepStructuredFields",
  GEN_3D: "jobStepGen3d",
  WEB_RESEARCH: "jobStepWebResearch",
  WRITE_LORE: "jobStepWriteLore",
  PACK_DERIVED: "jobStepPackDerived",
  FINALIZE: "jobStepFinalize",
};

type Props = {
  relicId: string;
  initialStatus: RelicStatus;
  isAdmin?: boolean;
};

export default function RelicProcessingBanner({ relicId, initialStatus, isAdmin }: Props) {
  const t = useT();
  const router = useRouter();
  const [payload, setPayload] = useState<JobPayload | null>(null);
  const [retrying, setRetrying] = useState(false);
  const refreshScheduled = useRef(false);

  const onRetry = async () => {
    if (!payload?.job || retrying) return;
    setRetrying(true);
    try {
      const r = await fetch(
        `/api/relics/${relicId}/jobs/${payload.job.id}/retry?fromStep=${payload.job.step}`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) {
        console.error("[RelicProcessingBanner] retry failed", r.status);
        setRetrying(false);
        return;
      }
      // Reset local state so the polling effect kicks back in.
      setPayload(null);
      refreshScheduled.current = false;
      router.refresh();
    } catch (e) {
      console.error("[RelicProcessingBanner] retry threw", e);
      setRetrying(false);
    }
  };

  useEffect(() => {
    if (initialStatus === "READY") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const r = await fetch(`/api/relics/${relicId}/job`, { credentials: "include" });
        if (!r.ok) return;
        const j = (await r.json()) as JobPayload;
        if (cancelled) return;
        setPayload(j);
        const done =
          j.relicStatus === "READY" ||
          j.job?.status === "SUCCEEDED" ||
          j.job?.status === "FAILED" ||
          j.job?.status === "CANCELLED";
        if (done) {
          if (!refreshScheduled.current) {
            refreshScheduled.current = true;
            // Give the user a beat to read the success/fail line, then refresh
            // server-rendered content (lore, photos, model viewer, log panel).
            setTimeout(() => router.refresh(), 800);
          }
          return;
        }
        timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        console.warn("[RelicProcessingBanner] poll failed", err);
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [relicId, initialStatus, router]);

  // Settle on whichever status is freshest.
  const status = payload?.relicStatus ?? initialStatus;
  if (status === "READY") return null;

  const job = payload?.job;
  const stepLabel = job ? t.relicCollection[STEP_KEY[job.step]] : t.relicCollection.jobStepEnqueued;
  const progress = job?.progress ?? 0;
  const failed = status === "FAILED" || job?.status === "FAILED";
  const succeeded = job?.status === "SUCCEEDED";

  let title: string;
  if (succeeded) {
    title = t.relicCollection.processingBannerCompleted;
  } else if (failed) {
    title = format(t.relicCollection.processingBannerFailed, { step: stepLabel });
  } else {
    title = format(t.relicCollection.processingBannerWorking, {
      progress: String(progress),
      step: stepLabel,
    });
  }

  const accent = failed
    ? "border-error/60 bg-error/10"
    : succeeded
      ? "border-primary/50 bg-primary/10"
      : "border-secondary/50 bg-secondary/10";

  const barAccent = failed ? "bg-error/70" : succeeded ? "bg-primary" : "bg-secondary";

  return (
    <div
      role="status"
      aria-live="polite"
      className={"mb-6 border px-4 py-3 " + accent}
      suppressHydrationWarning
    >
      <p className="font-label text-[11px] tracking-[0.25em] uppercase text-on-surface">
        {title}
      </p>
      {!succeeded ? (
        <div className="mt-2 h-1 w-full bg-on-surface-variant/20">
          <div
            className={"h-full transition-all duration-500 " + barAccent}
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      ) : null}
      {failed && job?.errorMessage ? (
        <p className="mt-2 text-[11px] text-on-surface-variant break-words">
          {job.errorMessage}
        </p>
      ) : null}
      {failed && isAdmin && job ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="px-4 py-1.5 font-label text-[10px] tracking-[0.25em] uppercase border border-error/60 text-error hover:bg-error/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {retrying ? t.relicCollection.processingBannerRetrying : t.relicCollection.processingBannerRetry}
          </button>
        </div>
      ) : null}
    </div>
  );
}
