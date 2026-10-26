import { useState } from "react";

/**
 * One measure over time. Illustrative weeks draw as a muted dashed line with no points;
 * real closed weeks draw solid with points, so the board can tell them apart at a glance.
 */
export function TrendChart({ labels, values, illustrative, format, title }: { labels: string[]; values: (number | null)[]; illustrative: boolean[]; format: (v: number) => string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 360;
  const H = 130;
  const pad = { l: 40, r: 10, t: 8, b: 20 };
  const vals = values.filter((v): v is number => v != null);
  if (!vals.length) return <p className="note">No data yet.</p>;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || Math.abs(hi) || 1;
  const min = lo - span * 0.15;
  const max = hi + span * 0.15;
  const x = (i: number) => pad.l + (labels.length === 1 ? 0 : (i * (W - pad.l - pad.r)) / (labels.length - 1));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / (max - min));
  const segs: { d: string; illus: boolean }[] = [];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if (a == null || b == null) continue;
    segs.push({ d: `M${x(i - 1)},${y(a)} L${x(i)},${y(b)}`, illus: illustrative[i] });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHover(null)}>
      {[lo, hi].map((t, k) => (
        <g key={k}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" opacity={0.6} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
            {format(t)}
          </text>
        </g>
      ))}
      {segs.map((s, i) => (
        <path key={i} d={s.d} fill="none" stroke={s.illus ? "var(--muted)" : "var(--blue)"} strokeWidth={2} strokeDasharray={s.illus ? "4 3" : undefined} />
      ))}
      {values.map((v, i) =>
        v == null ? null : (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={x(i) - 8} y={pad.t} width={16} height={H - pad.t - pad.b} fill="transparent" />
            {!illustrative[i] && <circle cx={x(i)} cy={y(v)} r={4} fill="var(--blue)" stroke="var(--surface)" strokeWidth={2} />}
          </g>
        ),
      )}
      {[0, labels.length - 1].map((i) => (
        <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : "end"} fontSize={10} fill="var(--muted)">
          {labels[i]}
        </text>
      ))}
      {hover !== null && values[hover] != null && (
        <g pointerEvents="none">
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" />
          <rect x={Math.min(W - 130, Math.max(0, x(hover) - 60))} y={pad.t} width={120} height={34} rx={5} fill="var(--surface)" stroke="var(--line)" />
          <text x={Math.min(W - 130, Math.max(0, x(hover) - 60)) + 8} y={pad.t + 14} fontSize={11} fontWeight={700} fill="var(--text)">
            {format(values[hover]!)}
          </text>
          <text x={Math.min(W - 130, Math.max(0, x(hover) - 60)) + 8} y={pad.t + 27} fontSize={10} fill="var(--muted)">
            {labels[hover]}
            {illustrative[hover] ? ", illustrative" : ""}
          </text>
        </g>
      )}
    </svg>
  );
}
