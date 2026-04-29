"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  onClose: () => void;
};

const DESTINATION = "/vault";
export const SECRET_DOOR_LOCK_KEY = "gd_door_lock_until";
export const SECRET_DOOR_LOCK_MS = 60_000;

export default function SecretDoor({ onClose }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "denied" | "granted">("idle");
  const [unsealed, setUnsealed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setUnsealed(true);
      inputRef.current?.focus();
    }, 350);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "checking" || status === "granted") return;
    setStatus("checking");
    try {
      const res = await fetch("/api/vault/unseal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: value.trim() }),
      });
      if (res.ok) {
        setStatus("granted");
        setTimeout(() => {
          router.push(DESTINATION);
        }, 900);
        return;
      }
      setStatus("denied");
      try {
        sessionStorage.setItem(
          SECRET_DOOR_LOCK_KEY,
          String(Date.now() + SECRET_DOOR_LOCK_MS),
        );
      } catch {}
      setTimeout(() => {
        onClose();
      }, 1100);
    } catch {
      setStatus("denied");
      setTimeout(() => onClose(), 1100);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 secret-door-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="secret-door-frame relative w-full max-w-[420px] aspect-[3/4] max-h-[640px]">
        {/* Outer rivet frame */}
        <div className="absolute inset-0 rounded-md border border-primary/30 bg-[#0b1410] shadow-[0_0_60px_rgba(144,222,205,0.18),inset_0_0_40px_rgba(0,0,0,0.6)]" />
        <div aria-hidden className="absolute inset-2 rounded-sm border border-primary/15" />
        {/* corner rivets */}
        {[
          "top-3 left-3",
          "top-3 right-3",
          "bottom-3 left-3",
          "bottom-3 right-3",
        ].map((p) => (
          <span
            key={p}
            className={`absolute ${p} w-2.5 h-2.5 rounded-full bg-gradient-to-br from-primary/70 to-primary/20 shadow-[inset_0_0_3px_rgba(0,0,0,0.6),0_0_4px_rgba(144,222,205,0.5)]`}
          />
        ))}

        {/* Door halves */}
        <div className="absolute inset-6 overflow-hidden rounded-sm">
          {/* Inner content (revealed when door parts) */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#020807] to-[#04100c] flex flex-col items-center justify-center px-6 py-8">
            <div className="font-label text-[9px] tracking-[0.5em] text-primary/60 uppercase mb-2">
              VAULT · 7F
            </div>
            <div className="font-label text-[11px] tracking-[0.4em] text-primary/90 uppercase mb-6">
              Access Code
            </div>

            <form onSubmit={submit} className="w-full max-w-[240px]">
              <div
                className={`relative border ${
                  status === "denied"
                    ? "border-red-500/70 secret-door-shake"
                    : status === "granted"
                      ? "border-primary/80"
                      : "border-primary/40"
                } bg-black/60 px-3 py-2.5 transition-colors`}
              >
                <input
                  ref={inputRef}
                  type="password"
                  inputMode="text"
                  autoComplete="off"
                  value={value}
                  disabled={status === "checking" || status === "granted"}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full bg-transparent font-mono text-sm text-primary tracking-[0.3em] outline-none placeholder:text-primary/20"
                  placeholder="••••••"
                />
                <span className="absolute -top-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
              </div>

              <div className="mt-3 h-4 text-center font-label text-[10px] tracking-[0.4em] uppercase">
                {status === "idle" && (
                  <span className="text-primary/40">Awaiting · Input</span>
                )}
                {status === "checking" && (
                  <span className="text-primary/80 animate-pulse">Verifying...</span>
                )}
                {status === "denied" && (
                  <span className="text-red-400">Denied</span>
                )}
                {status === "granted" && (
                  <span className="text-primary">Granted · Routing</span>
                )}
              </div>

              <button
                type="submit"
                disabled={status === "checking" || status === "granted"}
                className="mt-4 w-full border border-primary/40 bg-primary/5 hover:bg-primary/15 disabled:opacity-50 transition-colors py-2 font-label text-[10px] tracking-[0.5em] uppercase text-primary"
              >
                Unseal
              </button>
            </form>

            <button
              type="button"
              onClick={onClose}
              className="mt-6 font-label text-[9px] tracking-[0.4em] uppercase text-primary/40 hover:text-primary/70 transition-colors"
            >
              [ Esc · Abort ]
            </button>
          </div>

          {/* Left half */}
          <div
            className={`absolute inset-y-0 left-0 w-1/2 secret-door-half secret-door-half-left ${
              unsealed ? "is-open" : ""
            }`}
          >
            <DoorPanel side="left" />
          </div>
          {/* Right half */}
          <div
            className={`absolute inset-y-0 right-0 w-1/2 secret-door-half secret-door-half-right ${
              unsealed ? "is-open" : ""
            }`}
          >
            <DoorPanel side="right" />
          </div>
        </div>

        {/* Top status bar */}
        <div className="absolute top-3 left-10 right-10 flex items-center gap-2 pointer-events-none">
          <span className="font-label text-[8px] tracking-[0.4em] uppercase text-primary/60">
            CH · 07
          </span>
          <span className="flex-1 h-px bg-primary/20" />
          <span className="font-label text-[8px] tracking-[0.4em] uppercase text-primary/40">
            SEC
          </span>
        </div>
      </div>
    </div>
  );
}

function DoorPanel({ side }: { side: "left" | "right" }) {
  return (
    <div
      className={`absolute inset-0 ${
        side === "left"
          ? "bg-gradient-to-r from-[#0d1a16] via-[#0a1612] to-[#06100d]"
          : "bg-gradient-to-l from-[#0d1a16] via-[#0a1612] to-[#06100d]"
      } border-y border-primary/20 ${
        side === "left" ? "border-l" : "border-r"
      } border-primary/20`}
    >
      {/* Vertical seam shadow */}
      <span
        className={`absolute inset-y-0 ${side === "left" ? "right-0" : "left-0"} w-px bg-primary/30`}
      />
      {/* Etched warning lines */}
      <div className="absolute inset-x-3 top-6 space-y-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-px bg-primary/15"
            style={{ width: `${60 + i * 10}%` }}
          />
        ))}
      </div>
      {/* Center sigil */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={`font-label text-[42px] leading-none tracking-[0.1em] text-primary/25 ${
            side === "left" ? "translate-x-1/3" : "-translate-x-1/3"
          }`}
          aria-hidden
        >
          {side === "left" ? "GD" : "07"}
        </div>
      </div>
      {/* Rivets */}
      <div className="absolute inset-3 flex flex-col justify-between pointer-events-none">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`w-1.5 h-1.5 rounded-full bg-primary/40 ${
              side === "left" ? "self-start" : "self-end"
            } shadow-[inset_0_0_2px_rgba(0,0,0,0.6)]`}
          />
        ))}
      </div>
    </div>
  );
}
