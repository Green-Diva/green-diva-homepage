"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

function maskToken(token: string) {
    if (token.length <= 8) return token;
    return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export default function TokenField({ token }: { token: string }) {
    const t = useT();
    const [revealed, setRevealed] = useState(false);
    const displayValue = revealed ? token : maskToken(token);

    return (
        <div>
            <dt className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
                {t.token.label}
            </dt>
            <dd className="mt-1.5">
                <button
                    type="button"
                    onClick={() => setRevealed((value) => !value)}
                    className="font-mono text-sm text-on-surface-variant transition-colors hover:text-primary break-all text-left"
                    aria-label={revealed ? t.token.hideAria : t.token.showAria}
                    title={revealed ? t.token.hideTitle : t.token.showTitle}
                >
                    {displayValue}
                </button>
            </dd>
        </div>
    );
}