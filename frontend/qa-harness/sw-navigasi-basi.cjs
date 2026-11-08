// Bukti keluhan "UI kadang balik ke gaya lama setelah refresh": service worker menampilkan cangkang HTML basi saat jaringan lambat / untuk "/".
// Memakai bundel ASLI (hasil build, termasuk sw.js) di server uji sendiri; "rilis baru" ditiru dengan menyuntik penanda ke index.html dan mengubah sw.js.
//   DIST=C:/path/dist [EXPECT=baru|basi] node frontend/qa-harness/sw-navigasi-basi.cjs
//   EXPECT=baru (bawaan) = perilaku yang DIHARAPKAN setelah perbaikan; EXPECT=basi dipakai untuk membuktikan bundel LAMA memang memiliki cacatnya.
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core"); const http = require("http"); const fs = require("fs"); const os = require("os"); const path = require("path");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe"; const DIST = path.resolve(process.env.DIST || "dist"); const EXPECT = process.env.EXPECT || "baru";
const TIPE = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const keadaan = { marker: "", tunda: 0 }; let gagal = 0;
const ok = (n, c, d = "") => { if (!c) gagal++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"); if (/^\/(api|uploads|media)\//.test(u.pathname)) { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return; }
  let f = path.join(DIST, decodeURIComponent(u.pathname)); const navigasi = !path.extname(u.pathname) || u.pathname === "/index.html";
  if (!f.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  let isi = fs.readFileSync(f); const ext = path.extname(f); const kepala = { "content-type": TIPE[ext] || "application/octet-stream" };
  if (path.basename(f) === "index.html") {
    kepala["cache-control"] = "no-cache"; if (keadaan.marker) isi = Buffer.from(String(isi).replace("<head>", `<head><meta name="qa-marker" content="${keadaan.marker}">`));
    if (keadaan.tunda && navigasi) await tidur(keadaan.tunda);
  } else if (path.basename(f) === "sw.js") { kepala["cache-control"] = "no-cache"; if (keadaan.marker) isi = Buffer.concat([isi, Buffer.from(`\n// qa-rilis-${keadaan.marker}\n`)]); }
  res.writeHead(200, kepala); res.end(isi);
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r)); const BASE = `http://127.0.0.1:${server.address().port}`;
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), "sw-qa-"));
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", userDataDir: profil, args: ["--no-sandbox", "--disable-gpu"] });
  const p = await b.newPage(); await p.evaluateOnNewDocument(() => { try { localStorage.setItem("pwa-install-dismissed", "1"); } catch {} });
  const marker = () => p.evaluate(() => document.querySelector('meta[name="qa-marker"]')?.content || "");
  // ── persiapan: pengguna sudah memakai versi A (SW terpasang & mengendalikan halaman, html-shell tersimpan)
  await p.goto(BASE + "/portal", { waitUntil: "load", timeout: 30000 }); await p.evaluate(() => navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready)); await tidur(1500); // pendaftaran sama seperti registerSW (vite-plugin-pwa); aplikasi baru mendaftar setelah login, harness tidak perlu sesi
  await p.reload({ waitUntil: "load" }); await tidur(1500);
  ok("persiapan: SW mengendalikan halaman", await p.evaluate(() => !!navigator.serviceWorker.controller));
  ok("persiapan: versi A (tanpa penanda)", (await marker()) === "");
  // ── "deploy" versi B
  keadaan.marker = "B";
  // S1: jaringan lambat (5 detik) untuk navigasi — dulu batas 3 dtk → cangkang A basi
  keadaan.tunda = 5000; const t0 = Date.now(); await p.goto(BASE + "/portal", { waitUntil: "load", timeout: 60000 }); const m1 = await marker(); const dt = Date.now() - t0;
  console.log(`      S1 jaringan lambat: penanda=${m1 || "(A basi)"} dalam ${dt} ms`);
  if (EXPECT === "baru") ok("S1: jaringan lambat 5 dtk tetap menampilkan versi BARU", m1 === "B", `penanda=${m1}`); else ok("S1 (bundel lama): memang jatuh ke versi basi", m1 === "", `penanda=${m1}`);
  keadaan.tunda = 0; await tidur(2500); // beri SW kesempatan mengambil versi B (pembaruan)
  // S2: "/" pada jaringan cepat — dulu dilayani dari precache (basi)
  keadaan.marker = "C"; await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update().catch(() => {}); }); await tidur(2500);
  await p.goto(BASE + "/", { waitUntil: "load", timeout: 30000 }); const m2 = await marker(); console.log(`      S2 "/" jaringan cepat: penanda=${m2 || "(basi)"}`);
  if (EXPECT === "baru") ok('S2: "/" pada jaringan cepat memuat versi terbaru', m2 === "C", `penanda=${m2}`); else ok('S2 (bundel lama): "/" memang basi', m2 !== "C", `penanda=${m2}`);
  // S3: offline sungguhan → jatuh cepat ke salinan tersimpan (bukan layar galat)
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); const t3 = Date.now();
  let galatNav = ""; try { await p.goto(BASE + "/portal", { waitUntil: "load", timeout: 25000 }); } catch (e) { galatNav = e.message.slice(0, 80); }
  const adaApp = await p.evaluate(() => !!document.getElementById("root") && !/ERR_|This site can.t be reached/i.test(document.body?.innerText || "")).catch(() => false);
  ok("S3: offline tetap memuat cangkang aplikasi dari salinan tersimpan", adaApp && !galatNav, galatNav || `${Date.now() - t3} ms`);
  ok("S3: offline tidak menunggu batas waktu penuh", Date.now() - t3 < 8000, `${Date.now() - t3} ms`);
  await b.close(); try { fs.rmSync(profil, { recursive: true, force: true }); } catch {}
  console.log(`\n${gagal ? gagal + " GAGAL" : "semua lulus"}`); process.exit(gagal ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
