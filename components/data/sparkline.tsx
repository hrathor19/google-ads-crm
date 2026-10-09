'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * A twelve-month shape in the width of a table cell.
 *
 * Deliberately axis-less and label-less. At this size a scale is unreadable,
 * so the only question it answers is the one worth answering in a list —
 * which keywords are seasonal and which are flat. The exact figures are in
 * the columns beside it and in the detail row.
 */
export function Sparkline({
  points,
  width = 96,
  height = 28,
  className,
  title,
}: {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Read out instead of the drawing. An SVG of a line is nothing to a screen reader. */
  title?: string;
}) {
  const gradientId = useId();

  if (points.length < 2) {
    return <span className="text-xs text-muted-foreground">{'—'}</span>;
  }

  const max = Math.max(...points);
  const min = Math.min(...points);
  // A flat series has no range to normalise against; draw it down the middle
  // rather than dividing by zero and producing NaN for every point.
  const span = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const line = points.map((v, i) => `${pad + i * stepX},${y(v)}`).join(' ');
  const area = `${pad},${height} ${line} ${pad + (points.length - 1) * stepX},${height}`;
  const lastIsPeak = points[points.length - 1] === max;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={title ?? 'Twelve-month search trend'}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The latest month, so the eye lands on where the line ends up. */}
      <circle
        cx={pad + (points.length - 1) * stepX}
        cy={y(points[points.length - 1])}
        r={2}
        fill={lastIsPeak ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
      />
    </svg>
  );
}
