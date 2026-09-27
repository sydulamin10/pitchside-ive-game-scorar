/**
 * International broadcast charts: the worm (cumulative runs, wickets as dots)
 * and the run-rate graph. Used on the live camera overlay and in the scorer deck.
 */

import { matchChartSeries, type ChartOverPoint, type MatchChartSeries } from "@/lib/broadcast/matchCharts";
import type { MatchSnapshot } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export function WormGraph({
  snapshot,
  className,
}: {
  snapshot: MatchSnapshot | null;
  className?: string;
}) {
  const series = matchChartSeries(snapshot);
  return (
    <BroadcastLineChart
      title="Worm"
      yLabel="Runs"
      series={series}
      valueOf={(p) => p.cumulative}
      markWickets
      className={className}
    />
  );
}

export function RunRateGraph({
  snapshot,
  className,
}: {
  snapshot: MatchSnapshot | null;
  className?: string;
}) {
  const series = matchChartSeries(snapshot);
  return (
    <BroadcastLineChart
      title="Run rate"
      yLabel="Run Rate"
      series={series}
      valueOf={(p) => p.runRate}
      className={className}
    />
  );
}

function BroadcastLineChart({
  title,
  yLabel,
  series,
  valueOf,
  markWickets = false,
  className,
}: {
  title: string;
  yLabel: string;
  series: MatchChartSeries[];
  valueOf: (p: ChartOverPoint) => number;
  markWickets?: boolean;
  className?: string;
}) {
  if (!series.length || series.every((s) => s.points.length === 0)) {
    return <p className={cn("py-6 text-center font-sans text-xs text-willow-soft", className)}>Overs will draw the {title.toLowerCase()} as they are bowled.</p>;
  }

  const width = 640;
  const height = 280;
  const pad = { t: 28, r: 18, b: 32, l: 38 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const maxOver = Math.max(10, ...series.flatMap((s) => s.points.map((p) => p.over)));
  const maxY = Math.max(1, ...series.flatMap((s) => s.points.map(valueOf)));
  const x = (over: number) => pad.l + (over / maxOver) * innerW;
  const y = (v: number) => pad.t + innerH - (v / maxY) * innerH;
  const ticks = 4;

  return (
    <div className={cn("rounded-[4px] bg-[#0b1a12]/80 p-2", className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="font-sans text-[0.62rem] font-bold tracking-[0.14em] text-willow-soft uppercase">{title}</p>
        <div className="flex flex-wrap gap-2 font-sans text-[0.62rem]">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1" style={{ color: s.color }}>
              <span className="inline-block h-1.5 w-3 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={title}>
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = (maxY / ticks) * i;
          const yy = y(v);
          return (
            <g key={i}>
              <line x1={pad.l} y1={yy} x2={pad.l + innerW} y2={yy} stroke="rgba(255,255,255,0.08)" />
              <text x={pad.l - 6} y={yy + 3} textAnchor="end" fill="#93a08e" fontSize={10}>
                {Math.round(v)}
              </text>
            </g>
          );
        })}
        <text x={10} y={pad.t + innerH / 2} fill="#93a08e" fontSize={10} transform={`rotate(-90 10 ${pad.t + innerH / 2})`}>
          {yLabel}
        </text>
        <line x1={pad.l} y1={pad.t + innerH} x2={pad.l + innerW} y2={pad.t + innerH} stroke="rgba(255,255,255,0.25)" />
        {series.map((s) => {
          const d = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.over)} ${y(valueOf(p))}`)
            .join(" ");
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2.4} />
              {s.points.map((p) => {
                const dots = [];
                if (markWickets && p.wickets > 0) {
                  for (let w = 0; w < p.wickets; w += 1) {
                    dots.push(
                      <circle
                        key={`${s.label}-w-${p.over}-${w}`}
                        cx={x(p.over)}
                        cy={y(valueOf(p)) - w * 5}
                        r={3.2}
                        fill="#e74c3c"
                        stroke="#fff"
                        strokeWidth={0.8}
                      />,
                    );
                  }
                } else {
                  dots.push(
                    <circle
                      key={`${s.label}-p-${p.over}`}
                      cx={x(p.over)}
                      cy={y(valueOf(p))}
                      r={2.4}
                      fill={s.color}
                    />,
                  );
                }
                return dots;
              })}
            </g>
          );
        })}
        <text x={pad.l} y={height - 8} fill="#93a08e" fontSize={10}>
          Overs
        </text>
        <text x={pad.l + innerW} y={height - 8} textAnchor="end" fill="#93a08e" fontSize={10}>
          {maxOver}
        </text>
      </svg>
    </div>
  );
}
