interface Props {
  /** Percent; values above 100 draw a full circle. */
  value: number;
}

const R = 8;
const C = 10;

/** Harvey-ball style allocation marker: an outlined circle filled to `value`%. */
export function Pie({ value }: Props) {
  const frac = Math.max(0, Math.min(value, 100)) / 100;
  let fill = null;
  if (frac >= 0.999) {
    fill = <circle cx={C} cy={C} r={R} className="pie-fill" />;
  } else if (frac > 0) {
    const angle = frac * 2 * Math.PI;
    const x = C + R * Math.sin(angle);
    const y = C - R * Math.cos(angle);
    const large = frac > 0.5 ? 1 : 0;
    fill = <path d={`M${C},${C} L${C},${C - R} A${R},${R} 0 ${large} 1 ${x},${y} Z`} className="pie-fill" />;
  }
  return (
    <svg className="pie" viewBox="0 0 20 20" width="20" height="20" aria-hidden>
      <circle cx={C} cy={C} r={R} className="pie-ring" />
      {fill}
    </svg>
  );
}
