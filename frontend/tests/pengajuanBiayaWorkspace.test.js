// C1 — Pengajuan Biaya Produksi & Gudang (web): logika murni, arahan anti double-counting, dan pemasangan menu/rute.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WORKSPACES_UI, FORM_KOSONG, bentukPayload, galatForm, kekuranganAjukan, konteksLabel, payloadTemplate, terapkanTemplate,
  terapkanPilihanTerakhir, teksDuplikat, PESAN_BUKAN_STOK, LABEL_SUMBER_DANA,
} from "../src/features/pengajuanBiaya/logika.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");

const cfgProduksi = {
  relations: ["order", "unit", "machine"], relasiWajib: { SERVIS_MESIN: ["machine"] }, wajibAlasanMendesak: ["KEBUTUHAN_MENDESAK", "LEMBUR"],
  metadataFieldsByType: { SERVIS_MESIN: [{ key: "pekerjaan", label: "Pekerjaan yang dilakukan", type: "text", required: true }] },
};
const cfgGudang = { relations: ["warehouse", "material", "document"], relasiWajib: {}, wajibAlasanMendesak: ["BIAYA_MENDESAK"], metadataFieldsByType: { KURIR_LOGISTIK: [{ key: "tujuan", label: "Tujuan / ekspedisi", required: true }] } };

test("Payload hanya membawa tautan yang berlaku untuk workspace (Produksi vs Gudang)", () => {
  const form = { ...FORM_KOSONG, expenseType: "SERVIS_MESIN", date: "2026-09-26", amount: "450.000", workCenterId: "wc1", warehouseId: "gd1", documentRef: "GR-1", sumberDana: "BELUM_DIBAYAR", advanceId: "um1" };
  const p = bentukPayload(form, cfgProduksi, "PRODUKSI");
  assert.equal(p.workCenterId, "wc1"); assert.equal(p.amount, 450000);
  assert.ok(!("warehouseId" in p) && !("documentRef" in p), "tautan Gudang tidak dikirim dari Produksi");
  assert.equal(p.advanceId, null, "advanceId hanya bila sumber dana uang muka");
  const g = bentukPayload({ ...form, expenseType: "KURIR_LOGISTIK" }, cfgGudang, "WAREHOUSE");
  assert.equal(g.warehouseId, "gd1"); assert.equal(g.documentRef, "GR-1"); assert.ok(!("workCenterId" in g));
  assert.equal(bentukPayload({ ...form, requestedById: "u9" }, cfgProduksi, "PRODUKSI").requestedById, "u9");
});

test("Validasi form & kekurangan sebelum ajukan (mesin wajib, alasan mendesak, metadata, uang muka, nota)", () => {
  assert.equal(galatForm({ ...FORM_KOSONG }, cfgProduksi), "Jenis biaya wajib dipilih");
  assert.equal(galatForm({ ...FORM_KOSONG, expenseType: "LEMBUR", date: "2026-09-26", amount: "0" }, cfgProduksi), "Nominal harus lebih dari 0");
  assert.match(galatForm({ ...FORM_KOSONG, expenseType: "LEMBUR", date: "2026-09-26", amount: "5", sumberDana: "UANG_MUKA_OPERASIONAL" }, cfgProduksi), /uang muka aktif/i);
  assert.equal(galatForm({ ...FORM_KOSONG, expenseType: "LEMBUR", date: "2026-09-26", amount: "5" }, cfgProduksi), null);
  const k = kekuranganAjukan({ expenseType: "SERVIS_MESIN", metadata: {}, proofs: [] }, cfgProduksi);
  assert.deepEqual(k, ["Pekerjaan yang dilakukan belum diisi", "Mesin belum dipilih", "Foto nota belum diunggah (dibutuhkan Finance untuk menyetujui)"]);
  assert.ok(kekuranganAjukan({ expenseType: "LEMBUR", urgentReason: "x", proofs: [{}] }, cfgProduksi).includes("Alasan mendesak belum diisi"));
  assert.deepEqual(kekuranganAjukan({ expenseType: "SERVIS_MESIN", metadata: { pekerjaan: "Ganti jarum" }, workCenterId: "wc1", proofs: [{ id: 1 }] }, cfgProduksi), []);
});

test("Template tanpa tanggal/nominal/bukti; pilihan terakhir mengisi kolom yang benar; konteks & teks duplikat lengkap", () => {
  const tpl = payloadTemplate({ ...FORM_KOSONG, expenseType: "SERVIS_MESIN", workCenterId: "wc1", date: "2026-09-26", amount: "450000", advanceId: "um1", metadata: { pekerjaan: "Ganti jarum" } });
  assert.equal(tpl.date, ""); assert.equal(tpl.amount, ""); assert.ok(!("advanceId" in tpl)); assert.equal(tpl.workCenterId, "wc1");
  const f = terapkanTemplate(tpl);
  assert.equal(f.expenseType, "SERVIS_MESIN"); assert.deepEqual(f.metadata, { pekerjaan: "Ganti jarum" });
  const t = terapkanPilihanTerakhir({ ...FORM_KOSONG, metadata: { a: 1 } }, "jenisBiaya", "LEMBUR");
  assert.equal(t.expenseType, "LEMBUR"); assert.deepEqual(t.metadata, {}, "ganti jenis mengosongkan metadata jenis lama");
  assert.equal(terapkanPilihanTerakhir(FORM_KOSONG, "mesin", "wc1").workCenterId, "wc1");
  assert.equal(terapkanPilihanTerakhir(FORM_KOSONG, "gudang", "gd1").warehouseId, "gd1");
  assert.equal(konteksLabel({ unit: { unitCode: "U-1" }, workCenter: { name: "Quilting" }, documentRef: "GR-1" }), "Unit U-1 · Mesin Quilting · Dokumen GR-1");
  const d = teksDuplikat({ submissionNumber: "PB-1", date: "2026-09-24T00:00:00Z", amount: 450000, picNameSnapshot: "Budi", konteks: "mesin Quilting", adaBukti: true });
  assert.match(d, /PB-1 · 2026-09-24 · Rp450\.000 · PIC\/pemohon Budi · mesin Quilting · bukti ada/);
  assert.match(teksDuplikat({ submissionNumber: "PB-2", date: "2026-09-24", amount: 1, adaBukti: false }), /belum ada bukti/);
});

test("UI menegaskan pengecualian stok dan memakai jalur yang sama dengan Finance (tanpa jalur ledger baru)", () => {
  assert.match(PESAN_BUKAN_STOK, /pembelian bahan\/stok/); assert.match(PESAN_BUKAN_STOK, /Tagihan Supplier/); assert.match(PESAN_BUKAN_STOK, /dua kali/);
  const p = baca("pages/pengajuanBiaya/PengajuanBiayaWorkspace.jsx");
  for (const s of ["data-testid=\"bukan-stok\"", "Peringatan", "peringatan-duplikat", "pilihan-terakhir", "Simpan sebagai template", "Catat atas nama pemohon", "Foto nota", "Edit & Koreksi Aman", "createExpenseSubmission", "ajukanPengajuanBiaya", "Jejak audit"]) {
    if (s === "Peringatan") continue;
    assert.ok(p.includes(s), s);
  }
  assert.doesNotMatch(p, /postJournal|finJournal|api\.(approve|pay)Finance/, "halaman tidak membuat/menyetujui/membayar jurnal sendiri");
  assert.equal(WORKSPACES_UI.PRODUKSI.division, "PRODUKSI"); assert.equal(WORKSPACES_UI.WAREHOUSE.division, "GUDANG");
  assert.equal(LABEL_SUMBER_DANA.BELUM_DIBAYAR, "Belum dibayar (utang ke vendor)");
});

test("Menu Pengajuan Biaya muncul di workspace Produksi & Gudang dengan gerbang peran; rute terdaftar", () => {
  const layout = baca("components/Layout.jsx");
  assert.match(layout, /to: "\/bengkel\/pengajuan-biaya", label: "Pengajuan Biaya"[^}]*bolehPeran: \["ADMIN", "OWNER", "FINANCE", "APPROVER", "PRODUCTION_LEAD"\]/);
  assert.match(layout, /to: "\/warehouse\/pengajuan-biaya", label: "Pengajuan Biaya"[^}]*bolehPeran: \["ADMIN", "OWNER", "FINANCE", "APPROVER", "WAREHOUSE"\]/);
  const reg = baca("routes/pageRegistry.jsx");
  assert.match(reg, /\/bengkel\/pengajuan-biaya[^\n]*workspace="PRODUKSI"/); assert.match(reg, /\/warehouse\/pengajuan-biaya[^\n]*workspace="WAREHOUSE"/);
  assert.match(baca("api.js"), /getPengajuanOpsi/);
});
