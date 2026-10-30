// Penyaji statis untuk dist HASIL BUILD (bukan dev server) + proksi /api ke backend QA terisolasi — dipakai untuk smoke bundel produksi (minified) dengan skrip QA browser yang sama.
//   DIST=C:/tmp/mkt-tools/dist-check QA_API=http://127.0.0.1:4021 PORT=5193 node frontend/qa-harness/serve-dist.mjs
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const DIST = path.resolve(process.env.DIST || "dist"); const API = new URL(process.env.QA_API || "http://127.0.0.1:4021"); const PORT = Number(process.env.PORT || 5193);
const TIPE = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".map": "application/json" };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (/^\/(api|uploads|media)\//.test(u.pathname)) {
    const p = http.request({ host: API.hostname, port: API.port, path: req.url, method: req.method, headers: { ...req.headers, host: API.host } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on("error", () => { res.writeHead(502); res.end("proxy error"); }); req.pipe(p); return;
  }
  let f = path.join(DIST, decodeURIComponent(u.pathname));
  if (!f.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");   // fallback SPA (sama seperti nginx produksi)
  res.writeHead(200, { "content-type": TIPE[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`[serve-dist] ${DIST} → http://127.0.0.1:${PORT} (api → ${API.origin})`));
