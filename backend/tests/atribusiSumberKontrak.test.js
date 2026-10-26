// KONTRAK /api/atribusi/iklan/sumber + PEMAKAINYA (audit review 3abce860). Mengunci: (1) siapa saja yang memakai kontrak; (2) kunci yang sengaja DIPINDAH/DITAMBAH; (3) laporan lain (/iklan, /d7, spend, KPI biaya campaign)
// tidak ikut berubah; (4) pemakai di frontend tidak membaca kunci yang sudah dipindah. Perubahan kontrak berikutnya harus mengubah tes ini secara sadar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hitungSumber, susunSumber } from "../src/services/attribution/sumber.js";
import { hitungCakupan } from "../src/services/attribution/biayaSumber.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_LIVE = "8e5437b6";
const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const adaBase = git(["cat-file", "-e", `${BASE_LIVE}^{commit}`]).status === 0;
function semuaBerkas(dir, ext, keluar = []) {
  if (!fs.existsSync(dir)) return keluar;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) semuaBerkas(p, ext, keluar); else if (ext.some((x) => e.name.endsWith(x))) keluar.push(p);
  }
  return keluar;
}
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");
const baca = (p) => fs.readFileSync(p, "utf8");

test("pemakai kontrak /sumber: hanya route (attributionAds.js), klien API (api.js) dan tab Akuisisi; TIDAK ada MCP/skrip operasional/pemakai lain", () => {
  const POLA = /atribusi\/iklan\/sumber|getAtribusiSumber|hitungSumberPerforma|services\/attribution\/sumber\.js/;
  const pemakai = [...semuaBerkas(path.join(root, "backend/src"), [".js"]), ...semuaBerkas(path.join(root, "frontend/src"), [".js", ".jsx"])]
    .filter((p) => POLA.test(baca(p))).map(rel).sort();
  assert.deepEqual(pemakai, [
    "backend/src/routes/attributionAds.js", "backend/src/services/attribution/sumber.js",
    "frontend/src/api.js", "frontend/src/features/laporan/akuisisiLogic.js", "frontend/src/features/laporan/components/AkuisisiTab.jsx", "frontend/src/pages/Laporan.jsx",
  ]);
  for (const dir of ["backend/src/mcp", "backend/src/mcpHub"]) for (const p of semuaBerkas(path.join(root, dir), [".js"])) assert.ok(!POLA.test(baca(p)), `${rel(p)} tidak boleh memakai /sumber`);
  // skrip operasional: hanya smoke skrip rilis (historis + kandidat) yang memanggilnya (baca-saja)
  const skrip = semuaBerkas(path.join(root, "scripts"), [".sh", ".cjs", ".mjs", ".js"]).filter((p) => /\/sumber\?|iklan\/sumber/.test(baca(p))).map(rel).sort();
  assert.deepEqual(skrip.filter((p) => !/^scripts\/(release-akuisisi-sumber\.sh|lib\/(smoke|rehearsal|hash-live)-akuisisi-biaya\.mjs|release-akuisisi-biaya\.sh)$/.test(p)), [], "pemakai /sumber tak dikenal di scripts/");
});

test("kontrak berubah SENGAJA: 5 kunci campaign-saja pindah dari sumber[].biaya ke biayaCampaignTerbukti; kunci baru lengkap; tidak ada pemakai yang membaca kunci lama", () => {
  const cust = (src, i) => ({ id: `c${i}`, createdAt: new Date("2026-08-05T03:00:00Z"), pipelineStage: "NEW", leadSource: src, isInternalStaff: false, staffUserId: null });
  const h = hitungSumber({ customers: [cust("META_ADS", 1), cust("TIKTOK_ADS", 2)], orders: [], kontribusi: [], refunds: [] });
  const cak = (sumber) => ({ cakupan: hitungCakupan({ dari: "2026-08-01", sampai: "2026-08-01", hariIni: "2026-10-26", entries: [] }), entries: [] });
  const r = susunSumber({ parameter: { dari: "2026-08-01", sampai: "2026-08-01", hariIni: "2026-10-26", termasukHariBerjalan: false, bawaan: false }, hasil: h, biayaMeta: { status: "SEBELUM_ATRIBUSI", spend: 10, cpa: null, cpl: null, bookedRoas: null, cashRoas: null, alasanNull: {} }, provenMeta: { akuisisiTerbukti: 1 },
    biayaSumber: new Map([["META", cak()], ["TIKTOK", cak()], ["LAINNYA", cak()]]), asOf: new Date("2026-10-26T03:00:00Z"), hariIni: "2026-10-26" });
  for (const k of ["periode", "status", "total", "pengecualianTotal", "sumber", "sorotan", "metrik", "peringatan", "definisi", "batasan", "cutoffEvaluasi"]) assert.ok(k in r, `kunci tingkat atas hilang: ${k}`);
  for (const k of ["berbayar", "uangBersih", "uangLedger", "nilaiOrderSaatIni"]) assert.ok(k in r.total, `total.${k}`);
  for (const k of ["sumber", "lengkap", "belumLengkap", "spend", "sementara", "lead", "lunas", "nilaiOrderSaatIni", "uangBersih", "cpa", "bookedRoas", "cashRoas", "alasanNull", "catatan"]) assert.ok(k in r.total.berbayar, `total.berbayar.${k}`);
  assert.deepEqual(r.sumber.map((s) => s.id), ["META", "TIKTOK", "WHATSAPP", "INSTAGRAM", "WEBSITE", "LAINNYA"]);
  for (const s of r.sumber) {
    for (const k of ["dasar", "status", "spend", "spendLengkap", "sementara", "alasanSementara", "cpl", "cpa", "bookedRoas", "cashRoas", "alasanNull"]) assert.ok(k in s.biaya, `${s.id}.biaya.${k}`);
    for (const k of ["costPerQualifiedLead", "costPerCustomerOrder", "cpaClosing", "costPerPlatformConversation"]) assert.ok(!(k in s.biaya) && !(k in s.biaya.alasanNull), `${s.id}.biaya.${k} sudah dipindah ke biayaCampaignTerbukti`);
    assert.equal(s.biaya.dasar, "ATRIBUSI_LABEL_CRM");
  }
  assert.deepEqual(r.sumber.filter((s) => s.biayaCampaignTerbukti).map((s) => s.id), ["META"]);
  assert.equal(r.sumber[0].biayaCampaignTerbukti.dasar, "ATRIBUSI_TERBUKTI");
  assert.deepEqual(r.sumber[2].biaya.alasanNull.cpa, "TIDAK_ADA_BIAYA_DIALOKASIKAN");
  // pemakai frontend tidak membaca kunci yang sudah dipindah / tidak ada
  for (const f of ["akuisisiLogic.js", "biayaIklanLogic.js", "components/AkuisisiTab.jsx", "components/DetailSumberAkuisisi.jsx", "components/KelolaBiayaIklan.jsx"]) {
    const t = baca(path.join(root, "frontend/src/features/laporan", f));
    assert.ok(!/costPerQualifiedLead|costPerCustomerOrder|cpaClosing|costPerPlatformConversation/.test(t), `${f} membaca kunci campaign-saja`);
  }
});

test("laporan LAIN tidak ikut berubah: /iklan, /d7, importer spend, KPI biaya campaign, kohort, webhook utuh terhadap baseline live", { skip: adaBase ? false : `commit ${BASE_LIVE} tidak ada di klon ini` }, () => {
  for (const f of ["backend/src/services/attribution/iklanReport.js", "backend/src/services/attribution/d7.js", "backend/src/services/attribution/biayaKpi.js", "backend/src/services/attribution/spend.js", "backend/src/services/attribution/cohort.js",
    "backend/src/services/attribution/cohortLoader.js", "backend/src/services/attribution/cohortDefinitions.js", "backend/src/routes/settings.js", "backend/src/routes/analytics.js", "backend/src/index.js"]) {
    assert.equal(git(["diff", "--name-only", BASE_LIVE, "--", f]).stdout.trim(), "", `${f} berubah terhadap baseline live`);
  }
  const p = (x) => git(["show", `${BASE_LIVE}:${x}`]).stdout; // router: hanya penambahan pemasangan rute biaya sumber
  const lama = p("backend/src/routes/attributionAds.js").replace(/\r\n/g, "\n"), baru = baca(path.join(root, "backend/src/routes/attributionAds.js")).replace(/\r\n/g, "\n");
  const tambah = baru.split("\n").filter((l) => !lama.split("\n").includes(l));
  assert.deepEqual(tambah.map((l) => l.split("//")[0].trim()).filter(Boolean), ['import { pasangRuteBiayaSumber } from "./attributionBiayaSumber.js";', "pasangRuteBiayaSumber(attributionAdsRouter);"], "perubahan router hanya memasang rute biaya sumber");
  assert.equal(lama.split("\n").filter((l) => !baru.split("\n").includes(l)).length, 0, "tidak ada baris router lama yang dihapus/diubah");
});

test("keterbacaan sumber biaya: setiap hari yang dihitung punya alasan pemilihan; tidak ada angka biaya tanpa penjelasan", () => {
  const c = hitungCakupan({ dari: "2026-10-20", sampai: "2026-10-23", hariIni: "2026-10-26", adHarian: new Map([["2026-10-20", 5], ["2026-10-21", 5]]), adSumber: new Map([["2026-10-20", ["WINDSOR_API"]], ["2026-10-21", ["META_MARKETING_API"]]]),
    entries: [{ id: "e1", sourceId: "META", kind: "HARIAN", dateFrom: "2026-10-22", dateTo: "2026-10-22", accountId: "", amount: 7, override: false, status: "AKTIF" }] });
  const hariTerhitung = c.hari.adDetail + c.hari.manualHarian + c.hari.manualBlok + c.hari.override;
  const dijelaskan = c.pemilihan.filter((p) => ["AD_DETAIL", "MANUAL_HARIAN", "MANUAL_BLOK", "MANUAL_OVERRIDE"].includes(p.kode)).reduce((a, p) => a + p.hari, 0);
  assert.equal(dijelaskan, hariTerhitung); assert.equal(c.hariHilang.length, 1);
  assert.deepEqual(c.pemilihan.map((p) => p.kode), ["AD_DETAIL", "MANUAL_HARIAN", "HILANG"]);
  assert.ok(c.pemilihan.every((p) => typeof p.alasan === "string" && p.alasan.length > 20));
});
