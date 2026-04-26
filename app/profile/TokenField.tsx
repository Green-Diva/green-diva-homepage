"use client";

import { useState } from "react";

function maskToken(token: string) {
    if (token.length <= 8) return token;
    return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export default function TokenField({ token }: { token: string }) {
    const [revealed, setRevealed] = useState(false);
    const displayValue = revealed ? token : maskToken(token);

    return (
        <div>
            <dt className="font-label text-[10px] tracking-[0.3em] uppercase text-primary/60">
                Token
            </dt>
            <dd className="mt-1.5">
                <button
                    type="button"
                    onClick={() => setRevealed((value) => !value)}
                    className="font-mono text-sm text-on-surface-variant transition-colors hover:text-primary break-all text-left"
                    aria-label={revealed ? "Hide full token" : "Show full token"}
                    title={revealed ? "Click to hide token" : "Click to reveal full token"}
                >
                    {displayValue}
                </button>
            </dd>
        </div>
    );
}