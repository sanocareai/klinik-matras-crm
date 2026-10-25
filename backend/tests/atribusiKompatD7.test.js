// Kompatibilitas kontrak D7 setelah penggantian nama field (bookedValue → nilaiOrderSaatIni, bookedRoas → roasNilaiOrderSaatIni, kategoriEksklusif + tidakDiketahui):
// tidak boleh ada pemakai /d7 di frontend, MCP, atau skrip lain yang masih membaca kunci lama. Pemakai yang diizinkan hanya smoke rilis (membaca status/rekonsiliasi/batasan, bukan kunci bernama lama).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function semuaBerkas(dir, ext, keluar = []) {
  if (!fs.existsSync(dir)) return keluar;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) semuaBerkas(p, ext, keluar); else if (ext.some((x) => e.name.endsWith(x))) keluar.push(p);
  }
  return keluar;
}
const baca = (p) => fs.readFileSync(p, "utf8");
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

test("tidak ada pemakai endpoint /d7 di frontend/src maupun backend/src/mcp(+mcpHub); skrip rilis hanya membaca status/rekonsiliasi/batasan/RBAC", () => {
  const pemakai = [];
  for (const p of [...semuaBerkas(path.join(root, "frontend/src"), [".js", ".jsx"]), ...semuaBerkas(path.join(root, "backend/src/mcp"), [".js"]), ...semuaBerkas(path.join(root, "backend/src/mcpHub"), [".js"])]) {
    const t = baca(p); if (/atribusi\/iklan\/d7|\/d7\?|getAtribusiD7|hitungD7/.test(t)) pemakai.push(rel(p));
  }
  assert.deepEqual(pemakai, [], "frontend/MCP memakai D7?");
  const skrip = semuaBerkas(path.join(root, "scripts"), [".sh", ".cjs", ".mjs", ".js"]).filter((p) => /\/d7|d7\.js|hitungD7/.test(baca(p)));
  for (const p of skrip) {
    const t = baca(p);
    // baris yang memakai hasil D7 hanya boleh membaca kunci stabil
    const baris = t.split("\n").filter((l) => /jd\.|D7_/.test(l));
    for (const l of baris) assert.ok(!/bookedValue|bookedRoas|kategoriEksklusif/.test(l), `${rel(p)} membaca kunci D7 lama/berubah: ${l.trim().slice(0, 120)}`);
  }
});

test("rute /d7 hanya dipakai backend sendiri: satu-satunya impor hitungD7 adalah routes/attributionAds.js", () => {
  const impor = semuaBerkas(path.join(root, "backend/src"), [".js"]).filter((p) => /from "[^"]*attribution\/d7\.js"/.test(baca(p))).map(rel);
  assert.deepEqual(impor, ["backend/src/routes/attributionAds.js"]);
});

test("laporan utama /api/atribusi/iklan TIDAK berubah kontrak: tetap memuat bookedValue/bookedRoas (perubahan nama hanya di D7)", () => {
  const t = baca(path.join(root, "backend/src/services/attribution/iklanReport.js")) + baca(path.join(root, "backend/src/services/attribution/biayaKpi.js"));
  assert.match(t, /bookedValue/); assert.match(t, /bookedRoas/);
  const d7 = baca(path.join(root, "backend/src/services/attribution/d7.js"));
  assert.ok(!/bookedValue|bookedRoas/.test(d7.replace(/\/\/.*$/gm, "").replace(/"[^"\n]*(bookedValue|bookedRoas)[^"\n]*"/g, "")), "d7.js tidak lagi memakai kunci booked* (selain di teks catatan)");
});
