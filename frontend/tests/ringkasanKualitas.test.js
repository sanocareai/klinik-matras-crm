// Logika murni Ringkasan Keuangan: butir kualitas data, margin tidak final, tiga jenis piutang terpisah, aging.
import test from "node:test";
import assert from "node:assert/strict";
import { hitungKualitasData, margin, pisahkanPiutang, ringkasAging, LABEL_BANNER, LABEL_REKONSILIASI } from "../src/features/finance/ringkasanKualitas.js";

const antrean = { lunasBelumDicatat: { jumlah: 343, total: 700_000_000 }, jumlahPembayaranBelumVerifikasi: 2 };
const backfill = { kelas: [{ kelas: "LAYAK", jumlah: 298, nilai: "744615500.00" }] };
const riil = { cutoffLabel: "21 Sep 2026 pukul 20.00 WIB", rekening: [{ id: "a", name: "PT Sano", status: "SESUAI", selisih: 0 }, { id: "b", name: "KEM - Sano Bank", status: "SELISIH", selisih: 2526981 }, { id: "c", name: "Uang Kas Sano", status: "BELUM_DIKONFIRMASI", selisih: null }] };

test("Label wajib persis", () => {
  assert.equal(LABEL_BANNER, "Pendapatan 2026 masih dalam proses rekonsiliasi data sebelum sistem dan backfill order. Angka belum final.");
  assert.equal(LABEL_REKONSILIASI, "Rekonsiliasi sementara tanpa rekening koran. Saldo akhir telah dikonfirmasi owner, tetapi mutasi individual belum seluruhnya diverifikasi.");
});

test("Kualitas data: 343 pembayaran, 298 order, 1 belum lengkap, selisih KEM Rp2.526.981 — urut prioritas; belum final", () => {
  const k = hitungKualitasData({ antrean, catatan: { gapTerbuka: 1 }, backfill, riil });
  assert.deepEqual(k.butir.map((b) => b.id), ["pembayaran_belum_tercatat", "order_belum_diakui", "transaksi_belum_lengkap", "selisih_b"]);
  assert.equal(k.butir[0].jumlah, 343); assert.equal(k.butir[1].jumlah, 298); assert.equal(k.butir[1].nilai, 744615500); assert.equal(k.butir[2].jumlah, 1);
  assert.equal(k.butir[3].jumlah, 2526981); assert.equal(k.butir[3].label, "Selisih KEM");
  assert.match(k.butir[3].hint, /lebih tinggi/);
  assert.equal(k.belumFinal, true); assert.equal(k.jumlahBermasalah, 4);
});

test("Data tidak tersedia ≠ nol: butir null membuat halaman tetap 'belum final'", () => {
  const k = hitungKualitasData({ antrean, catatan: { gapTerbuka: 0 }, backfill: null, riil: null });
  assert.equal(k.butir.find((b) => b.id === "order_belum_diakui").jumlah, null);
  assert.equal(k.belumFinal, true);
  assert.deepEqual(k.tidakTersedia.sort(), ["order_belum_diakui", "selisih_rekening"]);
});

test("Semua bersih → final (tetap dihitung, bukan dipaksa 'belum final')", () => {
  const k = hitungKualitasData({ antrean: { lunasBelumDicatat: { jumlah: 0, total: 0 } }, catatan: { gapTerbuka: 0 }, backfill: { kelas: [{ kelas: "LAYAK", jumlah: 0, nilai: "0.00" }] }, riil: { cutoffLabel: "x", rekening: [{ id: "a", name: "PT Sano", status: "SESUAI", selisih: 0 }] } });
  assert.equal(k.belumFinal, false);
  assert.equal(margin(k, { marginBersih: 12.34 }).tampil, true);
});

test("Margin tidak tampil sebagai angka selama pendapatan belum lengkap; tanpa pendapatan → alasan terpisah", () => {
  const k = hitungKualitasData({ antrean, catatan: { gapTerbuka: 0 }, backfill, riil });
  const m = margin(k, { marginBersih: 42.1 });
  assert.equal(m.tampil, false); assert.match(m.alasan, /pendapatan belum lengkap/);
  assert.equal(margin(k, { marginBersih: null }).tampil, false);
  assert.match(margin(k, {}).alasan, /Belum ada pendapatan/);
  const tanpaData = hitungKualitasData({ antrean, catatan: { gapTerbuka: 0 }, backfill: null, riil });
  assert.equal(margin(tanpaData, { marginBersih: 10 }).tampil, false, "data backfill tidak tersedia → tidak menampilkan margin");
});

test("Tiga piutang terpisah: buku besar = operasional + menunggu verifikasi; pembayaran belum tercatat TIDAK dijumlahkan", () => {
  const p = pisahkanPiutang({ piutang: { total: 9_790_000, menungguVerifikasi: { jumlah: 5, total: 1_000_000 } }, antrean });
  assert.equal(p.bukuBesar, 10_790_000); assert.equal(p.operasional, 9_790_000); assert.equal(p.menungguVerifikasi.total, 1_000_000);
  assert.equal(p.pembayaranBelumTercatat.jumlah, 343); assert.equal(p.pembayaranBelumTercatat.total, 700_000_000);
  assert.equal(p.pembayaranBelumDiverifikasi, 2);
  assert.equal(pisahkanPiutang({ piutang: { total: 0 }, antrean: {} }).pembayaranBelumTercatat.jumlah, null);
});

test("Aging: belum jatuh tempo, lewat jatuh tempo (rincian), tertua dari baris teratas; persen; tanpa piutang aman", () => {
  const a = ringkasAging({ ringkasan: { belum_jatuh_tempo: 100, "1_30": 200, "31_60": 300, "61_90": 0, "90_plus": 400 }, teratas: [{ orderNumber: "X-1", hariLewat: 12, sisaTagihan: 5, sumberJatuhTempo: "invoice" }, { orderNumber: "X-2", hariLewat: 95, sisaTagihan: 7, sumberJatuhTempo: "tanggal_order" }] });
  assert.equal(a.belumJatuhTempo, 100); assert.equal(a.lewatJatuhTempo, 900); assert.equal(a.total, 1000);
  assert.deepEqual(a.tertua, { hari: 95, order: "X-2", sisa: 7, dariTanggalOrder: true });
  assert.equal(a.bagian.find((x) => x.key === "90_plus").persen, 40);
  const kosong = ringkasAging({ ringkasan: {}, teratas: [] });
  assert.equal(kosong.total, 0); assert.equal(kosong.tertua, null); assert.ok(kosong.bagian.every((x) => x.persen === 0));
  assert.equal(ringkasAging({ ringkasan: { belum_jatuh_tempo: 50 }, teratas: [{ hariLewat: 0, orderNumber: "Z" }] }).tertua, null, "belum jatuh tempo bukan 'tertua'");
});

test("Butir selisih rekening menaut langsung ke periode rekonsiliasi bila ada periodeId", () => {
  const r = { cutoffLabel: "x", rekening: [{ id: "b", name: "KEM - Sano Bank", status: "SELISIH", selisih: 2526981, periodeId: "abc-123" }, { id: "a", name: "PT Sano", status: "SELISIH", selisih: 5 }] };
  const k = hitungKualitasData({ antrean, catatan: { gapTerbuka: 0 }, backfill, riil: r });
  assert.equal(k.butir.find((b) => b.id === "selisih_b").tujuan, "/finance/reconciliation?periode=abc-123");
  assert.equal(k.butir.find((b) => b.id === "selisih_a").tujuan, "/finance/reconciliation", "tanpa periode → halaman daftar");
});
