"use client";

import { Fragment, useEffect, useState } from "react";

type Labels = {
  heading: string;
  subheading: string;
  prophecy: string;
  years: string;
  months: string;
  days: string;
};

const TARGET_Y = 2077;
const TARGET_M = 2; // March (0-indexed)
const TARGET_D = 22;

type Parts = { years: number; months: number; days: number };

function diff(nowMs: number): Parts {
  const now = new Date(nowMs);
  let years = TARGET_Y - now.getUTCFullYear();
  let months = TARGET_M - now.getUTCMonth();
  let days = TARGET_D - now.getUTCDate();
  if (days < 0) {
    months -= 1;
    const lastMonth = new Date(Date.UTC(TARGET_Y, TARGET_M, 0));
    days += lastMonth.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return { years: 0, months: 0, days: 0 };
  return { years, months, days };
}

export default function DescentCountdown({ labels }: { labels: Labels }) {
  const [p, setP] = useState<Parts>(() => diff(Date.now()));

  useEffect(() => {
    const tick = () => setP(diff(Date.now()));
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const cells: Array<{ label: string; value: number }> = [
    { label: labels.years, value: p.years },
    { label: labels.months, value: p.months },
    { label: labels.days, value: p.days },
  ];

  return (
    <div
      className="relative w-full overflow-hidden border border-primary/40 bg-background/60 px-3 py-1.5"
      title={`${labels.subheading} · ${labels.prophecy}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0.5 top-0.5 h-1.5 w-1.5 border-l border-t border-primary/70"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 border-r border-t border-primary/70"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0.5 bottom-0.5 h-1.5 w-1.5 border-l border-b border-primary/70"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-0.5 bottom-0.5 h-1.5 w-1.5 border-r border-b border-primary/70"
      />

      <div
        className="relative z-10 flex items-center gap-2 leading-none text-primary"
        suppressHydrationWarning
      >
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true" className="text-primary/70 text-[10px] leading-none">
            ✠
          </span>
          <span className="font-headline italic text-[12px] sm:text-[13px] tracking-[0.06em] text-primary/90">
            {labels.heading}
          </span>
        </span>

        <span
          aria-hidden="true"
          className="flex flex-1 min-w-[20px] items-center justify-center gap-1.5"
        >
          <span className="block h-px flex-1 bg-gradient-to-r from-primary/0 via-primary/40 to-primary/40" />
          <span className="text-primary/55 text-[10px] leading-none select-none">❦</span>
          <span className="block h-px flex-1 bg-gradient-to-l from-primary/0 via-primary/40 to-primary/40" />
        </span>

        <span className="flex items-baseline gap-1 font-headline tabular-nums whitespace-nowrap">
          {cells.map((c, i) => (
            <Fragment key={i}>
              {i > 0 ? (
                <span aria-hidden="true" className="text-primary/30 text-[11px] leading-none px-0.5 select-none">
                  :
                </span>
              ) : null}
              <span className="text-[16px] sm:text-[18px] font-light sacred-glow tracking-[0.04em]">
                {String(c.value).padStart(2, "0")}
              </span>
              <span className="font-label text-[8px] uppercase tracking-[0.25em] text-primary/55">
                {c.label}
              </span>
            </Fragment>
          ))}
        </span>
      </div>
    </div>
  );
}
