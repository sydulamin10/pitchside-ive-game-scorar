/**
 * SVG bar + line charts for runs scored per over (both innings).
 */

import { cn } from "@/lib/utils";

export interface OverPoint {
  over_number: number;
  runs: number;
  wickets?: number;
}

export interface InningsChartSeries {
  label: string;
  color?: string;
  overs: OverPoint[];
}

export function RunsPerOverCharts({
  series,
  className,
}: {
  series: InningsChartSeries[];
  className?: string;
}) {
  if (!series.length || series.every((s) => s.overs.length === 0)) {
    return (
      <p className={cn("font-sans text-sm text-willow", className)}>No overs to chart yet.</p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <ChartBlock title="Runs per over (bar)" series={series} mode="bar" />
      <ChartBlock title="Cumulative runs (line)" series={series} mode="line" />
    </div>
  );
}

function ChartBlock({
  title,
  series,
  mode,
}: {
  title: string;
  series: InningsChartSeries[];
  mode: "bar" | "line";
}) {
  const width = 360;
  const height = 140;
  const pad = { t: 12, r: 12, b: 24, l: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const maxOver = Math.max(1, ...series.flatMap((s) => s.overs.map((o) => o.over_number)));
  const values =
    mode === "bar"
      ? series.flatMap((s) => s.overs.map((o) => o.runs))
      : series.flatMap((s) => {
          let sum = 0;
          return s.overs.map((o) => {
            sum += o.runs;
            return sum;
          });
        });
  const maxY = Math.max(1, ...values);

  const x = (over: number) => pad.l + ((over - 0.5) / maxOver) * innerW;
  const y = (v: number) => pad.t + innerH - (v / maxY) * innerH;
  const barW = Math.max(4, (innerW / maxOver) * 0.35);

  const colors = ["var(--color-flip)", "var(--color-willow)"];

  return (
    <div>
      <p className="mb-2 font-sans text-[10px] tracking-wide text-willow uppercase">{title}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-lg" role="img">
        <line
          x1={pad.l}
          y1={pad.t + innerH}
          x2={pad.l + innerW}
          y2={pad.t + innerH}
          stroke="currentColor"
          className="text-willow/40"
        />
        {series.map((s, si) => {
          const color = s.color ?? colors[si % colors.length];
          if (mode === "bar") {
            return s.overs.map((o) => {
              const cx = x(o.over_number) + (si === 0 ? -barW / 2 - 1 : barW / 2 + 1);
              const top = y(o.runs);
              const h = pad.t + innerH - top;
              return (
                <rect
                  key={`${si}-${o.over_number}`}
                  x={cx - barW / 2}
                  y={top}
                  width={barW}
                  height={Math.max(1, h)}
                  fill={color}
                  opacity={0.85}
                />
              );
            });
          }
          let sum = 0;
          const pts = s.overs.map((o) => {
            sum += o.runs;
            return `${x(o.over_number)},${y(sum)}`;
          });
          return (
            <polyline
              key={si}
              fill="none"
              stroke={color}
              strokeWidth={2}
              points={pts.join(" ")}
            />
          );
        })}
        <text x={pad.l} y={height - 6} className="fill-willow" fontSize={9}>
          Over 1
        </text>
        <text x={pad.l + innerW - 20} y={height - 6} className="fill-willow" fontSize={9}>
          {maxOver}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 font-sans text-[10px] text-willow">
        {series.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-[1px]"
              style={{ background: s.color ?? colors[i % colors.length] }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
