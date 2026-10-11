export default function GoalRing({ value, target, size = 20 }: { value: number; target: number; size?: number }) {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  const p = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
      {target > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--acc)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(c * p).toFixed(2)} ${c.toFixed(2)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}
