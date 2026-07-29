import { useMemo } from "react";

interface Props {
  values: number[];
  height?: number;
  up: boolean;
}

/** Larger area price chart with gradient fill, baseline and end dot. */
export default function PriceChart({ values, height = 180, up }: Props) {
  const width = 360;
  const geom = useMemo(() => {
    if (!values || values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 6;
    const innerH = height - pad * 2;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = pad + innerH - ((v - min) / span) * innerH;
      return [x, y] as const;
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area, last: pts[pts.length - 1] };
  }, [values, height]);

  if (!geom) return <div style={{ height }} className="grid place-items-center text-sm text-slate-500">No chart data</div>;

  const color = up ? "#059669" : "#e11d48";

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.3" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={geom.area} fill="url(#price-fill)" />
      <path d={geom.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={geom.last[0]} cy={geom.last[1]} r={3.5} fill={color} />
      <circle cx={geom.last[0]} cy={geom.last[1]} r={7} fill={color} opacity={0.25} />
    </svg>
  );
}
