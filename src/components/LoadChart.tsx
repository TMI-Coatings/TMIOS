import { useState } from "react";

/**
 * Bars for what's needed each week, a dashed stepped line for what's available, one axis.
 * Over-capacity bars turn red and say so in the tooltip and the table, never by color alone.
 */
export function LoadChart({
  labels,
  bars,
  line,
  barLabel,
  lineLabel,
  format,
  title,
}: {
  labels: string[];
  bars: number[];
  line: number[];
  barLabel: string;
  lineLabel: string;
  format: (v: number) => string;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 240;
  const pad = { l: 44, r: 8, t: 10, b: 28 };
  const max = Math.max(1, ...bars, ...line);
  const step = niceStep(max / 4);
  const top = Math.ceil((max * 1.05) / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const cw = (W - pad.l - pad.r) / labels.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const bw = Math.max(6, cw * 0.56);
  const linePath = line
    .map((v, i) => {
      const x0 = pad.l + i * cw;
      return `${i === 0 ? "M" : "L"}${x0},${y(v)} L${x0 + cw},${y(v)}`;
    })
    .join(" ");

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} opacity={t === 0 ? 1 : 0.6} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {format(t)}
            </text>
          </g>
        ))}
        {bars.map((v, i) => {
          const x = pad.l + i * cw + (cw - bw) / 2;
          const over = v > line[i];
          const h = Math.max(0, y(0) - y(v));
          const r = Math.min(4, h / 2, bw / 2);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${labels[i]}: ${barLabel} ${format(v)}, ${lineLabel} ${format(line[i])}${over ? ", over" : ""}`}>
              <rect x={pad.l + i * cw} y={pad.t} width={cw} height={H - pad.t - pad.b} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${y(0)} Z`}
                  fill={over ? "var(--red)" : "var(--blue)"}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % (labels.length > 8 ? 2 : 1) === 0 && (
                <text x={pad.l + i * cw + cw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
        <path d={linePath} fill="none" stroke="var(--text)" strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />
        {hover !== null && (
          <g pointerEvents="none">
            {(() => {
              const x = Math.min(W - pad.r - 150, Math.max(pad.l, pad.l + hover * cw + cw / 2 - 75));
              const over = bars[hover] > line[hover];
              return (
                <>
                  <rect x={x} y={pad.t} width={150} height={over ? 66 : 52} rx={6} fill="var(--surface)" stroke="var(--line)" />
                  <text x={x + 10} y={pad.t + 17} fontSize={12} fontWeight={700} fill="var(--text)">
                    Week ending {labels[hover]}
                  </text>
                  <text x={x + 10} y={pad.t + 33} fontSize={12} fill="var(--text)">
                    {barLabel}: {format(bars[hover])}
                  </text>
                  <text x={x + 10} y={pad.t + 47} fontSize={12} fill="var(--muted)">
                    {lineLabel}: {format(line[hover])}
                  </text>
                  {over && (
                    <text x={x + 10} y={pad.t + 61} fontSize={12} fontWeight={700} fill="var(--red)">
                      Over by {format(bars[hover] - line[hover])}
                    </text>
                  )}
                </>
              );
            })()}
          </g>
        )}
      </svg>
      <figcaption className="legend" style={{ marginTop: 6 }}>
        <span>
          <i style={{ background: "var(--blue)", borderRadius: 2 }} />
          {barLabel}
        </span>
        <span>
          <i style={{ background: "var(--red)", borderRadius: 2 }} />
          Over what’s available
        </span>
        <span>
          <i style={{ borderTop: "2px dashed var(--text)", height: 0 }} />
          {lineLabel}
        </span>
      </figcaption>
    </figure>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
