// The Team activity chart's geometry (round 3, 2026-09-22). Hand-drawn SVG rather than a
// charting library, for the reason the round-11 ring gave: a couple of lines and a grid are not
// worth a dependency that arrives with its own colours, fonts and tooltip.

type Point = readonly [number, number]

// A smooth line through the points that never overshoots them (Fritsch-Carlson monotone cubic,
// the curve d3 calls curveMonotoneX). The reference dashboards draw soft curves, and a plain
// Catmull-Rom spline would get there by bulging past every peak and under every trough: on a
// count chart that reads as a day busier than it was, or as a negative number of tasks.
export function monotonePath(points: Point[]): string {
  const n = points.length
  if (n < 2) return ''
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i] as Point
    const [x1, y1] = points[i + 1] as Point
    dx.push(x1 - x0)
    slope.push((y1 - y0) / (x1 - x0))
  }

  // Tangents: the mean of the neighbouring slopes, flattened wherever the line turns so a
  // peak or a trough is a true extreme, then clamped so no segment can overshoot.
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0] as number
    if (i === n - 1) return slope[n - 2] as number
    const before = slope[i - 1] as number
    const after = slope[i] as number
    return before * after <= 0 ? 0 : (before + after) / 2
  })
  for (let i = 0; i < n - 1; i++) {
    const m = slope[i] as number
    if (m === 0) {
      tangent[i] = 0
      tangent[i + 1] = 0
      continue
    }
    const a = (tangent[i] as number) / m
    const b = (tangent[i + 1] as number) / m
    const length = a * a + b * b
    if (length > 9) {
      const scale = 3 / Math.sqrt(length)
      tangent[i] = scale * a * m
      tangent[i + 1] = scale * b * m
    }
  }

  const round = (value: number) => Math.round(value * 100) / 100
  const [firstX, firstY] = points[0] as Point
  let path = `M${round(firstX)},${round(firstY)}`
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i] as Point
    const [x1, y1] = points[i + 1] as Point
    const third = (dx[i] as number) / 3
    path += ` C${round(x0 + third)},${round(y0 + (tangent[i] as number) * third)} ${round(x1 - third)},${round(y1 - (tangent[i + 1] as number) * third)} ${round(x1)},${round(y1)}`
  }
  return path
}

const NICE_STEPS = [4, 8, 12, 16, 20, 40, 60, 80, 100]

// The top of the value axis. The grid draws four steps, so the top has to split into four round
// numbers (0, 4, 8, 12, 16; past 100 a multiple of 40), and it is never below 4 so an empty or
// near-empty chart still has an axis that means something.
export function niceMax(value: number): number {
  const step = NICE_STEPS.find((candidate) => candidate >= value)
  return step ?? Math.ceil(value / 40) * 40
}
