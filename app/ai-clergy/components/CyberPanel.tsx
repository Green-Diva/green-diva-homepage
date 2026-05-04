import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  accent?: boolean;
  markers?: Array<"tl" | "tr" | "bl" | "br">;
  as?: "div" | "section" | "aside";
};

export default function CyberPanel({
  children,
  className = "",
  accent = false,
  markers = ["tl", "br"],
  as: Tag = "div",
}: Props) {
  const cls = [
    "cyber-panel rounded-lg",
    accent ? "cyber-panel--accent" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={cls}>
      {markers.includes("tl") ? <span aria-hidden className="tech-marker-tl" /> : null}
      {markers.includes("tr") ? <span aria-hidden className="tech-marker-tr" /> : null}
      {markers.includes("bl") ? <span aria-hidden className="tech-marker-bl" /> : null}
      {markers.includes("br") ? <span aria-hidden className="tech-marker-br" /> : null}
      <div className="relative z-10 h-full">{children}</div>
    </Tag>
  );
}
