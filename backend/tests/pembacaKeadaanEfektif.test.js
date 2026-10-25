// Gerbang statis: PEMBACA tidak boleh membaca keadaan catatan pemakaian historis TERSIMPAN secara langsung (bisa basi setelah GR/pengeluaran biasa mengubah saldo).
// Setiap berkas di src yang menyentuh `unitUsageNote` / `unit_usage_notes` harus (a) termasuk penulis/evaluator yang memang memegang kunci evaluasi, atau (b) memakai keadaan efektif
// (`terapkanKeadaanEfektif` / `keadaanEfektif`), atau (c) terdaftar sebagai pembaca non-state (hanya id/relasi) lengkap dengan alasannya. Berkas baru yang menyentuh tabel ini membuat tes gagal sampai ditinjau.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []));
const rel = (f) => path.relative(src, f).replace(/\\/g, "/");

const PENULIS_EVALUATOR = {
  "services/catatanPemakaianHistoris.js": "evaluator/penyegar dan sumber keadaan efektif",
  "services/koreksiPemakaian.js": "penulis: evaluasi di transaksi yang sama (kunci evaluasi)",
  "services/postingPemakaianHistoris.js": "penulis: posting + evaluasi di transaksi yang sama; rencana memakai keadaan efektif",
  "services/postingBatchLatar.js": "pekerja batch: memakai postingSatuUnit + rencanakanPosting (efektif); membaca catatan hanya untuk hitung DIPOSTING",
};
const NON_STATE = {
  "services/asalKoreksiSaldo.js": "hanya id/unit/bahan catatan sebagai asal koreksi saldo — tidak membaca state",
};

test("setiap berkas yang menyentuh catatan pemakaian historis: penulis/evaluator, atau memakai keadaan efektif, atau pembaca non-state terdaftar", () => {
  const menyentuh = walk(src).filter((f) => /unitUsageNote|unit_usage_notes/.test(fs.readFileSync(f, "utf8")));
  assert.ok(menyentuh.length >= 8, "pencarian berkas bekerja");
  const bermasalah = [];
  for (const f of menyentuh) {
    const r = rel(f); const t = fs.readFileSync(f, "utf8");
    if (PENULIS_EVALUATOR[r] || NON_STATE[r]) continue;
    if (!/terapkanKeadaanEfektif|keadaanEfektif/.test(t)) bermasalah.push(r);
  }
  assert.deepEqual(bermasalah, [], `pembaca langsung state tersimpan (harus lewat terapkanKeadaanEfektif): ${bermasalah.join(", ")}`);
});

test("pembaca yang memakai keadaan efektif benar-benar memanggilnya pada hasil findMany (bukan sekadar mengimpor)", () => {
  for (const [f, pola] of [
    ["services/finance/biayaBahan.js", /terapkanKeadaanEfektif\(db, await db\.unitUsageNote\.findMany/],
    ["services/productionOrderExport.js", /unitUsageNote\.findMany\([\s\S]*?\)\.then\(\(rows\) => terapkanKeadaanEfektif\(prisma, rows\)\)/],
    ["services/laporanRekonsiliasiPemakaian.js", /terapkanKeadaanEfektif\(db, await db\.unitUsageNote\.findMany/],
    ["services/postingPratinjau.js", /terapkanKeadaanEfektif\(db, await db\.unitUsageNote\.findMany/],
  ]) assert.match(fs.readFileSync(path.join(src, f), "utf8"), pola, f);
  const cat = fs.readFileSync(path.join(src, "services/catatanPemakaianHistoris.js"), "utf8");
  assert.match(cat, /export async function ambilCatatanHistoris[\s\S]*?terapkanKeadaanEfektif/); assert.match(cat, /export async function ringkasCatatanUnits[\s\S]*?terapkanKeadaanEfektif/);
  assert.match(fs.readFileSync(path.join(src, "services/postingPemakaianHistoris.js"), "utf8"), /export async function rencanakanPosting[\s\S]*?keadaanEfektif\(db\)/);
});

test("rute tulis posting/batch: izin persetujuan + gerbang hash; rute baca: izin baca; semua di belakang requireAuth", () => {
  const r = fs.readFileSync(path.join(src, "routes/pemakaianKoreksi.js"), "utf8");
  assert.match(r, /pemakaianKoreksiRouter\.use\(requireAuth\)/);
  for (const rute of ["/posting-historis/jalankan", "/posting-historis/batch\"", "/posting-historis/batch/:id/lanjut", "/posting-historis/batch/:id/hentikan"]) {
    const i = r.indexOf(`.post("${rute.replace(/"$/, "")}"`); assert.ok(i > 0, rute);
    assert.match(r.slice(i, i + 220), /requirePermission\(P\.INVENTORY_ADJUSTMENT_APPROVE\)/, `${rute} butuh izin persetujuan`);
  }
  for (const rute of ["/posting-historis/rencana", "/posting-historis/pratinjau", "/posting-historis/batch\"", "/posting-historis/batch/:id\""]) {
    const i = r.indexOf(`.get("${rute.replace(/"$/, "")}"`); assert.ok(i > 0, rute);
    assert.match(r.slice(i, i + 220), /requireAnyPermission\(P\.INVENTORY_ADJUSTMENT_APPROVE, P\.INVENTORY_READ\)/, `${rute} butuh izin baca`);
  }
  const b = fs.readFileSync(path.join(src, "services/postingBatchLatar.js"), "utf8");
  assert.match(b, /export async function ajukanBatch[\s\S]*?wajibOwnerMemulai[\s\S]*?PERSETUJUAN_WAJIB[\s\S]*?wajibAdaKonfirmasi[\s\S]*?RENCANA_BERUBAH[\s\S]*?wajibKonfirmasiManifest[\s\S]*?prisma\.\$transaction/, "ajukan batch: pagar Owner + konfirmasi manifest + hash dicocokkan dengan rencana efektif SEBELUM transaksi pembuat batch");
  const j = fs.readFileSync(path.join(src, "services/postingPemakaianHistoris.js"), "utf8");
  assert.match(j, /export async function jalankanPosting[\s\S]*?RENCANA_BERUBAH[\s\S]*?wajibKonfirmasiManifest[\s\S]*?postingSatuUnit/, "jalankan sinkron: persetujuan terikat diperiksa SEBELUM movement pertama");
});
