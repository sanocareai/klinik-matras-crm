// PROFIL UNIT — satu profil unit untuk seluruh workspace Produksi (permintaan Owner 13 Nov 2026). Model murni + pengawatan halaman.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aksiLangkah, barisBahan, barisFoto, isoTarget, normalBagian, segmenKerja, statusUtama, tabProfil, tanggalWib } from "../src/features/production/workspace/profilModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("tab profil: Ringkasan · Bahan · Foto · Riwayat; Meja & QC hanya untuk unit di alur Meja atau bila dibuka langsung (QC); tab lama 'pekerjaan' → Ringkasan", () => {
  assert.deepEqual(tabProfil(null, "ringkasan").map((t) => t.label), ["Ringkasan", "Bahan", "Foto", "Riwayat"]);
  assert.deepEqual(tabProfil({ alurMeja: { tahap: "Jahit" } }, "ringkasan").map((t) => t.key), ["ringkasan", "bahan", "dokumentasi", "riwayat", "meja"]);
  assert.equal(tabProfil(null, "meja").at(-1).label, "Meja & QC");
  assert.equal(normalBagian("pekerjaan"), "ringkasan"); assert.equal(normalBagian("meja"), "meja"); assert.equal(normalBagian("x"), "ringkasan");
});

test("status utama: SATU chip — posisi bila menentukan (belum diterima, di jalan, siap), status kerja bila sekadar di workshop; status order Sales selalu di keterangan", () => {
  const belum = statusUtama({ posisi: { key: "SUDAH_DIJEMPUT", label: "Sudah dijemput · belum diterima workshop", tone: "orange" }, kerja: { key: "BELUM_DIJADWALKAN", label: "Belum dijadwalkan" } }, { order: { statusOrder: { label: "Diproses" } } });
  assert.deepEqual(belum.utama, { teks: "Sudah dijemput · belum diterima workshop", nada: "orange", jenis: "posisi" });
  assert.deepEqual(belum.keterangan, ["Order Diproses", "Belum dijadwalkan"]);
  const kerja = statusUtama({ posisi: { key: "DI_WORKSHOP", label: "Di workshop", tone: "green" }, kerja: { key: "DIKERJAKAN", label: "Sudah dikerjakan", tone: "accent" }, meja: "TABLE_2" }, { order: { statusOrder: { label: "Diproses", terkunci: true } } });
  assert.deepEqual(kerja.utama, { teks: "Sudah dikerjakan", nada: "accent", jenis: "kerja" });
  assert.deepEqual(kerja.keterangan, ["Order Diproses (dikunci)", "Di workshop", "Meja 2"]);
});

test("Berikutnya: tombol mengikuti izin server; tindakan kecil = konfirmasi satu ketukan; membuka bagian/fokus tidak menulis; penjadwalan tetap di Rencana", () => {
  const izin = { catatPenerimaan: true, statusOrder: true, statusKerja: true, target: true, rencanaBahan: true, pemakaianAktual: true };
  assert.equal(aksiLangkah({ aksi: "CONFIRM_ARRIVAL" }, { izin, aktif: true }).jenis, "tiba");
  assert.equal(aksiLangkah({ aksi: "CONFIRM_ARRIVAL" }, { izin: {}, aktif: true }), null, "tanpa izin = tanpa tombol");
  assert.equal(aksiLangkah({ aksi: "UBAH_ORDER_DIPROSES" }, { izin, aktif: false }), null, "unit selesai/batal = tanpa tombol");
  assert.equal(aksiLangkah({ aksi: "MARK_READY" }, { izin }).jenis, "siapKirim");
  assert.equal(aksiLangkah({ aksi: "FINISH_WORK" }, { izin, aktif: true, km: { dikunciAplikasi: true }, adaMeja: true }).bagian, "meja", "dikerjakan lewat aplikasi Meja → buka Meja & QC");
  assert.equal(aksiLangkah({ aksi: "OPEN_PLAN" }, { izin }), null);
  assert.deepEqual(aksiLangkah({ aksi: "SET_TARGET" }, { izin }), { jenis: "fokus", target: "pf-target", label: "Tetapkan target" });
  assert.equal(aksiLangkah({ aksi: "RECORD_MATERIAL" }, { izin }).bagian, "bahan");
  assert.equal(aksiLangkah({ aksi: "WAIT" }, { izin }), null);
});

test("ringkasan satu baris Bahan/Foto (tanpa kartu kosong) dan segmen status kerja berlabel pendek", () => {
  assert.equal(barisBahan({ adopsi: { pemakaianBahan: {} } }), "Belum ada");
  assert.equal(barisBahan({ adopsi: { pemakaianBahan: { baruCatatan: 2, komponenLamaDipakaiKembali: 1 } }, rencanaBahan: { plan: { lines: [1, 2, 3] } } }), "2 pemakaian · 1 komponen lama · rencana 3 bahan");
  assert.equal(barisFoto({ dokumentasi: { tersedia: false } }), "Setelah masuk alur Meja"); assert.equal(barisFoto({ dokumentasi: { tersedia: true, bolehUnggah: true } }), "Lihat & unggah");
  assert.deepEqual(segmenKerja({ nilaiBoleh: [{ key: "DIJADWALKAN", label: "Dijadwalkan" }, { key: "DIKERJAKAN", label: "Sudah dikerjakan" }] }).map((s) => s.label), ["Dijadwalkan", "Dikerjakan"]);
});

test("target: tanggal WIB ↔ ISO pukul 17:00 WIB (sama dengan formulir lama)", () => {
  assert.equal(isoTarget("2026-11-20"), "2026-11-20T10:00:00.000Z"); assert.equal(isoTarget(""), null);
  assert.equal(tanggalWib("2026-11-20T10:00:00.000Z"), "2026-11-20"); assert.equal(tanggalWib("2026-11-19T18:00:00.000Z"), "2026-11-20", "lewat tengah malam WIB"); assert.equal(tanggalWib(null), "");
});

test("pengawatan: SEMUA halaman Produksi membuka profil yang sama; panel lama Order Produksi sudah dihapus", () => {
  for (const f of ["ProductionRencanaMinggu.jsx", "ProductionWorkOrders.jsx", "ProductionRencanaWorkspace.jsx", "ProductionQc.jsx", "ProductionPlannerV2.jsx"]) assert.ok(src("pages", "bengkel", f).includes("PanelUnit"), f);
  assert.ok(src("pages", "bengkel", "ProductionUnitWorkspacePage.jsx").includes("<UnitWorkspace "), "rute unit tersendiri (Status Produksi)");
  assert.ok(!fs.existsSync(path.join(here, "..", "src", "features", "production", "OrderProduksiPanel.jsx")), "panel lama tidak tersisa");
  for (const f of ["ProductionWorkOrders.jsx", "ProductionRencanaWorkspace.jsx", "ProductionQc.jsx", "ProductionPlannerV2.jsx"]) assert.ok(!src("pages", "bengkel", f).includes("<UnitOverviewDrawer"), "tanpa drawer kedua: " + f);
  const panel = src("features", "production", "rencana", "PanelUnit.jsx");
  assert.ok(panel.includes('import "@/features/production/rencana/rencana.css";'), "gaya panel ikut dimuat di halaman selain Rencana");
});
