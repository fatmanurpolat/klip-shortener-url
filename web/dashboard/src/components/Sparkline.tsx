/** Soft area sparkline (pure SVG). Decorative — aria-hidden. */
export function Sparkline({
  data,
  color = "var(--rose-400)",
  width = 96,
  height = 32,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return <svg width={width} height={height} aria-hidden style={{ display: "block" }} />;
  }
  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - (v / max) * (height - 4) - 2] as const);
  const d = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  const gid = `kd-spark-${color.replace(/[^a-z0-9]/gi, "")}-${data.length}-${Math.round(data[0])}-${Math.round(max)}`;

  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
