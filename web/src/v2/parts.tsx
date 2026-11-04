import { useLayoutEffect, useRef, useState } from "react"
import rough from "roughjs"
import gaugeImg from "@/assets/gauge.webp"
import gaugeMeta from "@/assets/gauge.json"
import { cn } from "@/lib/utils"

/** A box with a hand-drawn (rough.js) outline that redraws when it resizes. Seeded, so it doesn't jitter. */
export function Rough({ children, className, seed = 7, roughness = 1.3, strokeWidth = 1.8, as: Tag = "div", ...rest }:
  { children: React.ReactNode; className?: string; seed?: number; roughness?: number; strokeWidth?: number; as?: "div" | "section" | "button" } & React.HTMLAttributes<HTMLElement>) {
  const host = useRef<HTMLElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    const el = host.current, s = svg.current
    if (!el || !s) return
    const draw = () => {
      const w = el.offsetWidth, h = el.offsetHeight
      s.setAttribute("width", String(w)); s.setAttribute("height", String(h)); s.setAttribute("viewBox", `0 0 ${w} ${h}`)
      s.replaceChildren(rough.svg(s).rectangle(3, 3, w - 6, h - 6, { seed, roughness, bowing: 1.2, stroke: "currentColor", strokeWidth }))
    }
    draw()
    const ro = new ResizeObserver(draw); ro.observe(el)
    return () => ro.disconnect()
  }, [seed, roughness, strokeWidth])
  const T = Tag as "div"
  return (
    <T ref={host as React.Ref<HTMLDivElement>} className={cn("rough-host", className)} {...rest}>
      {children}
      <svg ref={svg} className="rough" aria-hidden="true" />
    </T>
  )
}

/** Hand-drawn underline squiggle under a word. */
export function Squiggle({ children, color = "var(--crit)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="relative inline-block">
      {children}
      <svg viewBox="0 0 200 12" preserveAspectRatio="none" className="absolute -bottom-2 left-0 h-3 w-full" aria-hidden="true">
        <path d="M2 7 C 30 1, 50 12, 80 6 S 130 1, 160 7 S 190 9, 198 4" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export const ZONES = [
  { key: "over", label: "Overachieving", hint: "Way more effort than usual" },
  { key: "trying", label: "Trying", hint: "Normal effort" },
  { key: "coasting", label: "Coasting", hint: "Less effort than usual" },
  { key: "slacking", label: "Slacking", hint: "Skipping steps, fibbing" },
] as const
export const zoneOf = (s: number) => ZONES[Math.min(3, Math.floor(s * 4))]

export interface Needle { key: string; label: string; color: string; score: number | null }

/** The Slackometer: the team's watercolour gauge with live needles. score 0 = far left (overachieving), 1 = far right (slacking). */
export function Gauge({ needles }: { needles: Needle[] }) {
  const { width: W, height: H, pivot: [cx, cy], radius: R } = gaugeMeta as { width: number; height: number; pivot: [number, number]; radius: number }
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => { const t = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(t) }, [])
  const live = needles.filter((n) => n.score != null)
  const labelPos = (deg: number, r: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)]
  return (
    <figure className="relative mx-auto w-full max-w-[560px]">
      <svg viewBox={`-20 -10 ${W + 40} ${H + 20}`} className="w-full overflow-visible" role="img"
        aria-label={"Slackometer: " + live.map((n) => `${n.label} is ${zoneOf(n.score!).label.toLowerCase()}`).join(", ")}>
        <image href={gaugeImg} x={0} y={0} width={W} height={H} />
        {ZONES.map((z, i) => {
          const [x, y] = labelPos(180 - (i * 45 + 22.5), R * 0.66)
          return <text key={z.key} x={x} y={y + 10} textAnchor="middle" className="font-heading" fontSize={30} fill="#2a2622" stroke="#fffaf0" strokeWidth={6} paintOrder="stroke" strokeLinejoin="round">{z.label}</text>
        })}
        {live.map((n, i) => {
          const len = R * (0.94 - i * 0.1)
          const angle = ready ? -(180 - n.score! * 180) : -90 // svg rotation: 0deg points right, -180 points left
          return (
            <g key={n.key} className="needle" style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
              <path d={`M ${cx - 14} ${cy} L ${cx + len} ${cy - 3} L ${cx + len + 10} ${cy} L ${cx + len} ${cy + 3} Z`} fill={n.color} stroke="#2a2622" strokeWidth={3} strokeLinejoin="round" />
              <g transform={`translate(${cx + len + 18} ${cy}) rotate(${-angle})`}>
                <rect x={-4} y={-17} width={n.label.length * 15 + 16} height={30} rx={8} fill="#fffaf0" stroke="#2a2622" strokeWidth={2.5} />
                <text x={4} y={6} fontSize={22} className="font-heading" fill="#2a2622">{n.label}</text>
              </g>
            </g>
          )
        })}
        <circle cx={cx} cy={cy} r={18} fill="#c9a96a" stroke="#2a2622" strokeWidth={3} />
      </svg>
    </figure>
  )
}

/** Tiny sparkline (no axes) for specimen cards. */
export function Spark({ values, color, lo, hi }: { values: number[]; color: string; lo?: number; hi?: number }) {
  const v = values.filter(isFinite)
  if (v.length < 2) return null
  const W = 160, H = 40, min = Math.min(...v, lo ?? Infinity), max = Math.max(...v, hi ?? -Infinity)
  const X = (i: number) => (i * W) / (v.length - 1), Y = (x: number) => H - 4 - ((x - min) / (max - min || 1)) * (H - 8)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full overflow-visible" aria-hidden="true">
      {lo != null && hi != null && isFinite(lo) && isFinite(hi) && <rect x={0} y={Y(hi)} width={W} height={Math.max(1, Y(lo) - Y(hi))} fill={color} opacity={0.12} />}
      <polyline points={v.map((x, i) => `${X(i)},${Y(x)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(v.length - 1)} cy={Y(v[v.length - 1])} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
    </svg>
  )
}

export function SectionTitle({ id, kicker, children, robot }: { id: string; kicker?: string; children: React.ReactNode; robot?: React.ReactNode }) {
  return (
    <div id={id} className="mb-5 flex scroll-mt-28 items-end gap-3">
      {robot}
      <div>
        {kicker && <div className="text-base text-muted-foreground">{kicker}</div>}
        <h2 className="poster-title text-4xl sm:text-5xl">{children}</h2>
      </div>
    </div>
  )
}
