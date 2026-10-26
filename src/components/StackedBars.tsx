import { useState } from "react";

/** Stacked bars of parts that add to a total, one axis, a legend, and a hover readout per bar. */
export function StackedBars({
  labels,
  series,
  format,
  title,
  highlight,
}: {
  labels: string[];
  series: { label: string; color: string; values: number[] }[];
  format: (v: number) => string;
  title: string;
  highlight?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const pad = { l: 56, r: 8, t: 10, b: 28 };
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i]), 0));
  const max = Math.max(1, ...totals);
  const raw = max / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = (raw / p <= 1 ? 1 : raw / p <= 2 ? 2 : raw / p <= 5 ? 5 : 10) * p;
  const top = Math.ceil((max * 1.05) / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const cw = (W - pad.l - pad.r) / labels.length;
  const bw = Math.max(8, Math.min(48, cw * 0.6));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" opacity={t === 0 ? 1 : 0.6} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((lab, i) => {
          const x = pad.l + i * cw + (cw - bw) / 2;
          let acc = 0;
          const segs = series.map((s) => {
            const v = Math.max(0, s.values[i]);
            const y0 = y(acc);
            acc += v;
            return { s, v, y0, y1: y(acc) };
          });
          const visible = segs.filter((g) => g.y0 - g.y1 > 0.5);
          return (
            <g key={i} tabIndex={0} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} aria-label={`${lab}: ${series.map((s) => `${s.label} ${format(s.values[i])}`).join(", ")}`}>
              <rect x={pad.l + i * cw} y={pad.t} width={cw} height={H - pad.t - pad.b} fill="transparent" />
              {visible.map((g, k) => {
                const isTop = k === visible.length - 1;
                const h = Math.max(0, g.y0 - g.y1 - (isTop ? 0 : 2));
                const r = isTop ? Math.min(4, h / 2) : 0;
                return (
                  <path
                    key={g.s.label}
                    d={`M${x},${g.y0} V${g.y0 - h + r} Q${x},${g.y0 - h} ${x + r},${g.y0 - h} H${x + bw - r} Q${x + bw},${g.y0 - h} ${x + bw},${g.y0 - h + r} V${g.y0} Z`}
                    fill={g.s.color}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                );
              })}
              <text x={pad.l + i * cw + cw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={highlight === i ? "var(--text)" : "var(--muted)"} fontWeight={highlight === i ? 700 : 400}>
                {lab}
              </text>
            </g>
          );
        })}
        {hover !== null &&
          (() => {
            const bx = Math.min(W - pad.r - 190, Math.max(pad.l, pad.l + hover * cw + cw / 2 - 95));
            return (
              <g pointerEvents="none">
                <rect x={bx} y={pad.t} width={190} height={30 + series.length * 15} rx={6} fill="var(--surface)" stroke="var(--line)" />
                <text x={bx + 10} y={pad.t + 17} fontSize={12} fontWeight={700} fill="var(--text)">
                  {labels[hover]}: {format(totals[hover])}
                </text>
                {series.map((s, k) => (
                  <text key={s.label} x={bx + 10} y={pad.t + 33 + k * 15} fontSize={12} fill="var(--muted)">
                    {s.label}: {format(s.values[hover])}
                  </text>
                ))}
              </g>
            );
          })()}
      </svg>
      <figcaption className="legend" style={{ marginTop: 6 }}>
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color, borderRadius: 2 }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
