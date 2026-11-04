// Serve the results page from a local clone (no GitHub Pages needed).
//   node tools/serve.mjs                 -> http://localhost:8787
//   node tools/serve.mjs --host 0.0.0.0  -> reachable on your LAN / Tailscale
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : d; };
const host = opt("host", "127.0.0.1");
const port = +opt("port", 8787);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = normalize(join(root, path === "/" ? "index.html" : path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-cache" }).end(body);
  } catch { res.writeHead(404).end("not found"); }
}).listen(port, host, () => console.log(`Slackometer page: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`));
