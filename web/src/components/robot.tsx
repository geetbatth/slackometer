import { cn } from "@/lib/utils"
import mascot from "@/assets/robots/mascot.webp"
import normal from "@/assets/robots/normal.webp"
import slacking from "@/assets/robots/slacking.webp"
import unusual from "@/assets/robots/unusual.webp"
import baseline from "@/assets/robots/baseline.webp"
import leaner from "@/assets/robots/leaner.webp"
import falsedone from "@/assets/robots/falsedone.webp"
import empty from "@/assets/robots/empty.webp"
import budget from "@/assets/robots/budget.webp"
import paused from "@/assets/robots/paused.webp"
import compare from "@/assets/robots/compare.webp"
import plunger from "@/assets/robots/plunger.webp"
import fib from "@/assets/robots/fib.webp"
import asleep from "@/assets/robots/asleep.webp"
import hammock from "@/assets/robots/hammock.webp"
import hustle from "@/assets/robots/hustle.webp"
import inspect from "@/assets/robots/inspect.webp"
import skiptests from "@/assets/robots/skiptests.webp"
import overachiever from "@/assets/robots/overachiever.webp"
import shrug from "@/assets/robots/shrug.webp"
import hiding from "@/assets/robots/hiding.webp"
import scroll from "@/assets/robots/scroll.webp"
import rug from "@/assets/robots/rug.webp"
import trophy from "@/assets/robots/trophy.webp"
import measure from "@/assets/robots/measure.webp"
import whiteboard from "@/assets/robots/whiteboard.webp"
import piggy from "@/assets/robots/piggy.webp"
import giveup from "@/assets/robots/giveup.webp"

// Robots cut from the team's own AI-generated "100 dumb robots" poster (tools/cut-robots.py).
export const ROBOTS = { mascot, normal, slacking, unusual, baseline, leaner, falsedone, empty, budget, paused, compare, plunger, fib, asleep, hammock, hustle, inspect, skiptests, overachiever, shrug, hiding, scroll, rug, trophy, measure, whiteboard, piggy, giveup }
export type RobotName = keyof typeof ROBOTS

const ALT: Record<RobotName, string> = {
  mascot: "Robot with a gauge on its chest",
  normal: "Robot waving happily",
  slacking: "Robot eating a shoe",
  unusual: "Confused robot wearing a colander",
  baseline: "Robot climbing a ladder",
  leaner: "Toaster on a skateboard",
  falsedone: "Robot with a cardboard box on its head",
  empty: "Robot talking to a bin",
  budget: "Clock robot",
  paused: "Robot holding an umbrella over a bucket",
  compare: "Two robots tangled in a cable",
  plunger: "Robot on a unicycle holding a plunger",
  fib: "Robot holding a DONE! sign while on fire",
  asleep: "Robot asleep on a laptop",
  hammock: "Robot relaxing in a hammock with a drink",
  hustle: "Sweating robot running with a stack of papers",
  inspect: "Robot inspecting a page with a magnifying glass",
  skiptests: "Robot tossing a test tube over its shoulder",
  overachiever: "Eight-armed robot juggling wrenches",
  shrug: "Robot shrugging with a puff of smoke",
  hiding: "Robot hiding behind a plant",
  scroll: "Robot writing a very long scroll",
  rug: "Robot sweeping dust under a rug",
  trophy: "Smug robot holding a trophy",
  measure: "Robot measuring itself with a tape measure",
  whiteboard: "Robot pointing at a scribbled whiteboard",
  piggy: "Robot dropping coins in a piggy bank",
  giveup: "Robot waving a white flag",
}

export function Robot({ name, className, decorative = false }: { name: RobotName; className?: string; decorative?: boolean }) {
  return (
    <span className={cn("robot-sticker inline-flex shrink-0 items-center justify-center", className)}>
      <img src={ROBOTS[name]} alt={decorative ? "" : ALT[name]} className="robot wiggle h-full w-full object-contain" draggable={false} />
    </span>
  )
}
