"use client";

import { useT } from "@/lib/i18n/client";

export default function TokenField() {
    const t = useT();
    return (
        <div>
            <dt className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
                {t.token.label}
            </dt>
            <dd className="mt-1.5 font-mono text-sm text-on-surface-variant select-none">
                ••••
            </dd>
        </div>
    );
}
