// PROFIL UNIT — satu profil unit untuk seluruh workspace Produksi (permintaan Owner 13 Nov 2026). Model murni + pengawatan halaman.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aksiLangkah, barisBahan, barisFoto, isoTarget, normalBagian, ringkasHpp, segmenKerja, statusUtama, tabProfil, tanggalWib } from "../src/features/production/workspace/profilModel.js";
import { dariTampilTanggal, keTampilTanggal } from "../src/lib/dateRange.js";

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

test("HPP bahan di profil: total = angka server; per bahan dikelompokkan; pemakaian tanpa harga ≠ Rp0 (ditandai); susut terpisah", () => {
  const h = { status: "PARSIAL", ringkasan: { hppOperasionalDibekukan: 150000, susutOperasional: 5000, pemakaianTanpaHargaOperasional: 0, pemakaianBelumDibekukan: 1, pemakaianGagalPembekuan: 0 },
    baris: [
      { kode: "K1", nama: "Kain", satuan: "M", qty: -3, status: "DIBEKUKAN", nilai: 90000, tipe: "ISSUE" },
      { kode: "K1", nama: "Kain", satuan: "M", qty: 1, status: "DIBEKUKAN", nilai: -30000, tipe: "RETURN" },
      { kode: "B2", nama: "Busa", satuan: "LBR", qty: -1, status: "DIBEKUKAN", nilai: 90000, tipe: "ISSUE" },
      { kode: "P3", nama: "Per", satuan: "PCS", qty: -2, status: "BELUM_DIBEKUKAN", nilai: null, tipe: "ISSUE" },
      { kode: "K1", nama: "Kain", satuan: "M", qty: -0.5, status: "DIBEKUKAN", nilai: 5000, tipe: "WASTE" },
    ], belumMemakai: [] };
  const r = ringkasHpp(h);
  assert.equal(r.total, 150000, "total dari server, bukan dijumlah ulang di klien"); assert.equal(r.parsial, true); assert.equal(r.tanpaHarga, 1); assert.equal(r.susut, 5000);
  assert.deepEqual(r.perBahan.map((b) => [b.kode, b.dipakai, b.nilai, b.tanpaHarga]), [["B2", 1, 90000, false], ["K1", 2, 60000, false], ["P3", 2, null, true]]);
  assert.equal(ringkasHpp({ status: "BELUM_ADA_PEMAKAIAN", ringkasan: { hppOperasionalDibekukan: 0 }, baris: [], belumMemakai: [] }).total, null, "tanpa pemakaian = 'Belum ada', bukan Rp0");
  assert.equal(ringkasHpp(null), null);
});

test("HPP terbuka untuk semua yang membuka profil (keputusan Owner 14 Nov 2026): tanpa gerbang izin di klien; sumber = data.hppOperasional dari server", () => {
  const ring = src("features", "production", "workspace", "RingkasanUnit.jsx");
  assert.ok(ring.includes("const ring = ringkasHpp(data.hppOperasional);") && ring.includes("<GrupHpp data={data} onBagian={onBagian} />"));
  assert.ok(!ring.includes("lihatNilai") && !ring.includes("getJejakBahanUnit"), "tidak ada gerbang nominal / panggilan jejak PO di profil");
  const rute = fs.readFileSync(path.join(here, "..", "..", "backend", "src", "routes", "productionAdopsi.js"), "utf8");
  assert.ok(rute.includes("hppOperasionalUnit(prisma, unit.id)") && rute.includes("hppBahan, hppOperasional,"), "server mengirim hppOperasional di respons profil");
  assert.ok(rute.includes("ambilPemakaianAktual(prisma, unit.id, { izinHarga: true })"), "harga per baris di tab Bahan juga terbuka");
  assert.ok(rute.includes("bacaJejakUnit(prisma, unit.id, { izinHarga: hasPermission(req.user, P.FINANCE_READ) })"), "biaya perolehan Finance (PO/supplier) tetap finance:read");
});

test("pemilih rentang tanggal: isian dd/mm/yyyy (bukan mm/dd/yyyy bawaan browser); tanggal tidak sah / melewati batas ditolak; panel selalu di dalam layar", () => {
  assert.equal(keTampilTanggal("2026-11-01"), "01/11/2026"); assert.equal(keTampilTanggal(""), "");
  assert.equal(dariTampilTanggal("1/11/2026"), "2026-11-01"); assert.equal(dariTampilTanggal("01-11-2026"), "2026-11-01");
  assert.equal(dariTampilTanggal("31/02/2026"), null, "31 Feb ditolak, bukan digulirkan ke Maret"); assert.equal(dariTampilTanggal("15/11/2026", "2026-11-14"), null); assert.equal(dariTampilTanggal("abc"), null);
  const d = src("components", "DateRangePicker.jsx");
  assert.ok(!d.includes('type="date"'), "tanpa isian tanggal bawaan browser"); assert.ok(d.includes("<IsianTanggal ") && d.includes('placeholder="dd/mm/yyyy"'));
  assert.ok(d.includes("style={{ left: geserPanel }}") && d.includes("Math.max(PAD, kiri) - rect.left") && d.includes("document.documentElement.clientWidth"), "panel digeser supaya di dalam layar (bukan rata kiri/kanan saja)");
  assert.ok(d.includes("drp-panel") && src("components", "DateRangePicker.css").includes(':root[data-theme="dark"] .drp-panel'), "panel terangkat di tema gelap");
});

test("satu tema kontrol formulir Produksi: select berpanah + garis tipis, isian tanggal/teks bergaris sama; menang atas tema kaca; hanya .prod-skin", () => {
  const css = src("styles", "sanss-produksi.css"); const blok = css.slice(css.indexOf("SATU TEMA kontrol formulir di workspace Produksi"));
  assert.ok(blok.includes(":root .app-shell.crm-skin.prod-skin :is(select:not([multiple]), input[type=\"date\"]"), "lingkup .prod-skin");
  assert.ok(blok.includes("box-shadow: inset 0 0 0 1px var(--hairline) !important;"), "garis lewat box-shadow (border:none !important global berlapis)");
  assert.ok(blok.includes('background-image: url("data:image/svg+xml') && blok.includes('%3Cpath d=\'M3 4.5 6 7.5 9 4.5\'/%3E%3C/svg%3E") !important;'), "panah select");
  assert.ok(blok.includes(".rc-pic select { box-shadow: none !important; background: none !important;"), "select tak terlihat di pil PIC tidak ikut digambar");
  for (const f of [["features", "production", "rencana", "RencanaAntrean.jsx"], ["features", "production", "workspace", "StatusWorkList.jsx"]]) {
    const x = src(...f); assert.ok(x.includes("<PilihanUrutan ") && !x.includes("<select"), "urutan memakai kontrol urutan yang sama dengan Order Produksi: " + f.join("/"));
  }
});
