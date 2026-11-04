// Headless Chrome checks for UI tasks, driven over the DevTools Protocol with Node's built-in WebSocket.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { killTree } from "./proc.ts"

export function findChrome(): string | null {
  const c = process.platform === "win32"
    ? [[process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"], [process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"], [process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"], [process.env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"], [process.env.PROGRAMFILES, "Microsoft/Edge/Application/msedge.exe"]].filter(([b]) => b).map(([b, p]) => join(b!, p))
    : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  return c.find((p) => p && existsSync(p)) ?? null
}

export interface UiCheckResult { renders: boolean; console_errors: number; missing: string[]; missing_states: string[]; states_present: number; mobile_overflow: boolean; screenshots: string[]; errors: string[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  ws: WebSocket; id = 0; pending = new Map<number, (v: any) => void>(); listeners: ((m: any) => void)[] = []
  constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data))
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)!(m); this.pending.delete(m.id) } else this.listeners.forEach((l) => l(m))
    })
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.id
    return new Promise((res, rej) => {
      this.pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)))
      this.ws.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }
}

export async function uiCheck(htmlPath: string, checks: { selectors: string[]; states: string[] }, outDir: string): Promise<UiCheckResult> {
  const chrome = findChrome()
  if (!chrome) throw new Error("No Chrome or Edge found for UI checks")
  const profile = mkdtempSync(join(tmpdir(), "slk-chrome-"))
  const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", windowsHide: true })
  try {
    let port = ""
    for (let i = 0; i < 100 && !port; i++) { await sleep(100); const f = join(profile, "DevToolsActivePort"); try { if (existsSync(f)) port = readFileSync(f, "utf8").split("\n")[0].trim() } catch { /* EBUSY while Chrome writes it */ } }
    if (!port) throw new Error("Chrome did not start (no DevToolsActivePort)")
    const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string }
    const ws = new WebSocket(ver.webSocketDebuggerUrl)
    await new Promise<void>((res, rej) => { ws.addEventListener("open", () => res()); ws.addEventListener("error", () => rej(new Error("CDP connect failed"))) })
    const cdp = new Cdp(ws)
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true })
    const s = (m: string, p: object = {}) => cdp.send(m, p, sessionId)
    const errors: string[] = []
    let loaded = false
    cdp.listeners.push((m) => {
      if (m.sessionId !== sessionId) return
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map((a: any) => a.value ?? a.description).join(" "))
      if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text))
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("log: " + m.params.entry.text)
      if (m.method === "Page.loadEventFired") loaded = true
    })
    await Promise.all([s("Page.enable"), s("Runtime.enable"), s("Log.enable")])
    const url = pathToFileURL(htmlPath).href
    const load = async (w: number, h: number, mobile: boolean) => {
      await s("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile })
      loaded = false; await s("Page.navigate", { url })
      for (let i = 0; i < 100 && !loaded; i++) await sleep(50)
      await sleep(300)
    }
    const evalJson = async (expr: string) => JSON.parse((await s("Runtime.evaluate", { expression: `JSON.stringify(${expr})`, returnByValue: true })).result.value)
    const shot = async (name: string) => { const p = join(outDir, name); writeFileSync(p, Buffer.from((await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64")); return p }

    await load(1280, 800, false)
    const renders: boolean = await evalJson(`(() => { const b = document.body; return !!b && b.innerText.trim().length > 0 && b.getBoundingClientRect().height > 0 })()`)
    const found: boolean[] = await evalJson(`${JSON.stringify(checks.selectors)}.map((q) => { try { return !!document.querySelector(q) } catch { return false } })`)
    const states: boolean[] = await evalJson(`${JSON.stringify(checks.states)}.map((q) => { try { return !!document.querySelector(q) } catch { return false } })`)
    const desktop = await shot("desktop.png")
    await load(390, 844, true)
    // compare with the phone's real width: without a viewport tag Chrome widens the layout to fit the content
    const overflow: boolean = await evalJson(`Math.max(document.documentElement.scrollWidth, window.innerWidth) > 391`)
    const mobile = await shot("mobile.png")
    ws.close()
    const unique = [...new Set(errors)]
    return { renders, console_errors: unique.length, missing: checks.selectors.filter((_, i) => !found[i]), missing_states: checks.states.filter((_, i) => !states[i]), states_present: states.filter(Boolean).length, mobile_overflow: overflow, screenshots: [desktop, mobile], errors: unique }
  } finally {
    killTree(proc.pid)
    await sleep(200)
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5 }) } catch { /* chrome still releasing files */ }
  }
}
