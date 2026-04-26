type Stats = {
  attack: number;
  defense: number;
  hp: number;
  agility: number;
  luck: number;
};

const AXES: { key: keyof Stats; label: string }[] = [
  { key: "attack", label: "Attack" },
  { key: "defense", label: "Defense" },
  { key: "hp", label: "HP" },
  { key: "agility", label: "Agility" },
  { key: "luck", label: "Luck" },
];

const SIZE = 280;
const CENTER = SIZE / 2;
const R = 100;
const RINGS = 4;

function pointAt(angleDeg: number, radius: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(a), CENTER + radius * Math.sin(a)] as const;
}

export default function SkillsRadar({ stats }: { stats: Stats }) {
  const angleStep = 360 / AXES.length;

  const ringPolys = Array.from({ length: RINGS }, (_, i) => {
    const r = (R * (i + 1)) / RINGS;
    return AXES.map((_, idx) => pointAt(idx * angleStep, r))
      .map((p) => p.join(","))
      .join(" ");
  });

  const dataPoints = AXES.map((ax, idx) => {
    const v = Math.max(0, Math.min(100, stats[ax.key]));
    return pointAt(idx * angleStep, (R * v) / 100);
  });
  const dataPoly = dataPoints.map((p) => p.join(",")).join(" ");

  return (
    <div className="flex flex-col items-center">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="overflow-visible"
        aria-label="Skills radar"
      >
        {/* rings */}
        {ringPolys.map((pts, i) => (
          <polygon
            key={i}
            points={pts}
            fill="none"
            stroke="rgba(144,222,205,0.18)"
            strokeWidth={1}
          />
        ))}
        {/* axes */}
        {AXES.map((_, idx) => {
          const [x, y] = pointAt(idx * angleStep, R);
          return (
            <line
              key={idx}
              x1={CENTER}
              y1={CENTER}
              x2={x}
              y2={y}
              stroke="rgba(144,222,205,0.18)"
              strokeWidth={1}
            />
          );
        })}
        {/* data area */}
        <polygon
          points={dataPoly}
          fill="rgba(144,222,205,0.18)"
          stroke="rgba(144,222,205,0.85)"
          strokeWidth={1.5}
        />
        {/* data dots */}
        {dataPoints.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3} fill="#90decd" />
        ))}
        {/* labels */}
        {AXES.map((ax, idx) => {
          const [lx, ly] = pointAt(idx * angleStep, R + 22);
          const stat = stats[ax.key];
          return (
            <g key={ax.key}>
              <text
                x={lx}
                y={ly - 6}
                textAnchor="middle"
                className="fill-secondary"
                style={{
                  font: "10px var(--font-label, monospace)",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                }}
              >
                {ax.label}
              </text>
              <text
                x={lx}
                y={ly + 8}
                textAnchor="middle"
                className="fill-primary"
                style={{ font: "11px var(--font-headline, serif)" }}
              >
                {stat}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
