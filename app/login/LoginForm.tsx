"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";

const REVEAL_MS = 600;
const MAX_CHARS = 12;
const GROUPS = 3;

// Auto-format alphanumeric input into XXXX-XXXX-XXXX-XXXX (max 16 chars).
// Non-conforming input (e.g. legacy base64url tokens with '_' or lowercase)
// is passed through, capped at the same total length.
function formatTokenInput(raw: string): string {
  const strippedAll = raw.replace(/-/g, "");
  const stripped = strippedAll.slice(0, MAX_CHARS).toUpperCase();
  if (/^[A-Z0-9]*$/.test(stripped)) {
    return stripped.match(/.{1,4}/g)?.join("-") ?? stripped;
  }
  return raw.slice(0, MAX_CHARS + (GROUPS - 1));
}

export default function LoginForm({ from }: { from?: string }) {
  const t = useT();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [show, setShow] = useState(false);
  const [revealIdx, setRevealIdx] = useState<number | null>(null);
  const [caretIdx, setCaretIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const prevLenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function syncCaret() {
    const el = inputRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    const before = el.value.slice(0, pos).replace(/-/g, "");
    setCaretIdx(Math.min(before.length, MAX_CHARS));
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function onTokenChange(raw: string) {
    const next = formatTokenInput(raw);
    const nextLen = next.replace(/-/g, "").length;
    if (nextLen > prevLenRef.current) {
      const idx = nextLen - 1;
      setRevealIdx(idx);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setRevealIdx(null), REVEAL_MS);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      setRevealIdx(null);
    }
    prevLenRef.current = nextLen;
    setToken(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setPending(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? t.auth.invalidToken);
      }
      const target = from && from.startsWith("/") ? from : "/";
      router.replace(target);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-10 flex w-full flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={token}
            onChange={(e) => {
              onTokenChange(e.target.value);
              requestAnimationFrame(syncCaret);
            }}
            onSelect={syncCaret}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onFocus={() => {
              setFocused(true);
              syncCaret();
            }}
            onBlur={() => setFocused(false)}
            maxLength={MAX_CHARS + (GROUPS - 1)}
            aria-label={t.auth.tokenPlaceholder}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="h-16 w-full rounded-lg border border-primary/20 bg-surface-container pl-5 pr-14 text-base text-transparent caret-transparent selection:bg-primary/20 selection:text-transparent focus:border-primary/50 focus:outline-none"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 right-14 flex items-center pl-5 font-mono text-base"
          >
            {(() => {
              const filled = token.replace(/-/g, "").length;
              const groupsToShow = Math.max(
                1,
                Math.min(GROUPS, Math.ceil(filled / 4) || 1),
              );
              const lastIdx = groupsToShow * 4 - 1;
              return Array.from({ length: groupsToShow }, (_, groupIdx) => {
                const groupChars = (token.split("-")[groupIdx] ?? "").slice(0, 4);
                return (
                  <div
                    key={groupIdx}
                    className={`flex gap-[0.45em] ${groupIdx > 0 ? "ml-[1.1em] border-l border-primary/15 pl-[1.1em]" : ""}`}
                  >
                    {Array.from({ length: 4 }, (_, i) => {
                      const ch = groupChars[i];
                      const idx = groupIdx * 4 + i;
                      const reveal = ch && (show || revealIdx === idx);
                      const showCaretLeft = focused && caretIdx === idx;
                      const showCaretRight =
                        focused && caretIdx === lastIdx + 1 && idx === lastIdx;
                      return (
                        <span
                          key={i}
                          className={`relative inline-block w-[0.9ch] text-center ${ch ? "text-on-surface" : "text-primary/15"}`}
                        >
                          {showCaretLeft ? (
                            <span
                              aria-hidden
                              className="absolute top-1/2 h-[1.4em] w-[2px] -translate-y-1/2 rounded-sm bg-primary shadow-[0_0_8px_var(--color-primary)]"
                              style={{
                                left: "-0.225em",
                                animation:
                                  "login-caret-blink 1.06s steps(2, end) infinite",
                              }}
                            />
                          ) : null}
                          {showCaretRight ? (
                            <span
                              aria-hidden
                              className="absolute top-1/2 h-[1.4em] w-[2px] -translate-y-1/2 rounded-sm bg-primary shadow-[0_0_8px_var(--color-primary)]"
                              style={{
                                right: "-0.225em",
                                animation:
                                  "login-caret-blink 1.06s steps(2, end) infinite",
                              }}
                            />
                          ) : null}
                          {ch ? (reveal ? ch : "•") : "•"}
                        </span>
                      );
                    })}
                  </div>
                );
              });
            })()}
          </div>
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide token" : "Show token"}
            tabIndex={-1}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-md text-on-surface-variant/70 hover:text-primary transition-colors cursor-pointer"
          >
            {show ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-3.17 4.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            )}
          </button>
        </div>
        <button
          type="submit"
          disabled={pending || !token}
          className="h-16 rounded-lg border border-primary/30 bg-primary/10 px-6 font-label text-[11px] tracking-[0.28em] uppercase text-primary transition-all hover:bg-primary/20 disabled:opacity-50 sm:min-w-[11rem]"
        >
          {pending ? t.auth.pending : t.auth.enterSanctuary}
        </button>
      </div>
      {err ? <p className="text-sm leading-6 text-red-400">{err}</p> : null}
    </form>
  );
}
