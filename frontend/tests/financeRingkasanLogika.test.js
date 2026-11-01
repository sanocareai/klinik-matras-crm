// Ringkasan Keuangan Finance — logika penyajian murni (tanpa React). Tidak mengubah rumus; tampilan diperiksa di browser terpisah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  jenisRekening, keteranganRekening, normalisasiBank, keadaanStrip, bahanBarisRekening, STATUS_PENCOCOKAN, ISTILAH, LABEL_POSISI, CATATAN_POSISI,
  TEKS_TANPA_SELISIH, susunTindakLanjut, pisahkanTindakLanjut, semuaKomponenNol, TEKS_LABA_NOL, dasarUmurTertua, potongBukti, BUKTI_AWAL, BUKTI_PER_HALAMAN,
} from "../src/features/finance/ringkasanTampilan.js";
import { hitungKualitasData } from "../src/features/finance/ringkasanKualitas.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("logo bank: hanya dari kind+bankName; normalisasi spasi/kapital; alias lama tetap; tak dikenal = ikon netral; tidak menebak dari nama rekening", () => {
  assert.equal(normalisasiBank("  Bank    Mandiri\t "), "Bank Mandiri");
  for (const n of ["  bca ", "BCA", "Bca", "bank   central\tasia", "PT. Bank Central Asia Tbk", "pt bank central asia", "Bank Central Asia"]) assert.equal(jenisRekening({ kind: "BANK", bankName: n }).jenis, "BCA", n);
  for (const n of ["MANDIRI", " mandiri  ", "Bank  MANDIRI", "bank mandiri", "Mandiri", "PT Bank Mandiri (Persero) Tbk"]) assert.equal(jenisRekening({ kind: "BANK", bankName: n }).jenis, "MANDIRI", n);
  for (const n of ["BCA Syariah", "Bank Mandiri Taspen", "BNI", "", null, undefined, "bca1"]) assert.equal(jenisRekening({ kind: "BANK", bankName: n, name: "BCA Mandiri" }).jenis, "BANK_LAIN", String(n));
  assert.equal(jenisRekening({ kind: "KAS", bankName: " BCA " }).jenis, "TUNAI"); assert.equal(jenisRekening({ kind: "EWALLET", bankName: "mandiri" }).jenis, "EWALLET");
  assert.equal(keteranganRekening({ kind: "BANK", bankName: "  bca  ", accountNumber: "1" }), "bca · 1");
  assert.equal(keteranganRekening({ kind: "KAS" }), "Kas tunai");
});

test("strip status: kondisi sama dengan banner lama; sumber hilang dinyatakan berbeda", () => {
  const k = (p) => hitungKualitasData(p);
  assert.equal(keadaanStrip(k({ antrean: { lunasBelumDicatat: { jumlah: 0, total: 0 } }, catatan: { gapTerbuka: 0 }, backfill: { kelas: [{ kelas: "LAYAK", jumlah: 0, nilai: 0 }] }, riil: { cutoffLabel: "x", rekening: [] } })), "lengkap");
  assert.equal(keadaanStrip(k({ antrean: { lunasBelumDicatat: { jumlah: 2, total: 100 } }, catatan: { gapTerbuka: 0 }, backfill: { kelas: [{ kelas: "LAYAK", jumlah: 0, nilai: 0 }] }, riil: { cutoffLabel: "x", rekening: [] } })), "belumLengkap");
  assert.equal(keadaanStrip(k({ antrean: {}, catatan: null, backfill: null, riil: null })), "sumberHilang");
});

const riilContoh = { cutoffLabel: "21 Sep 2026 pukul 20.00 WIB", danaBelumTeridentifikasi: { total: 2500000, items: [{ rekening: "PT Sano", nilai: 2500000 }] },
  rekening: [{ id: "a", name: "KEM - Sano Bank", status: "SELISIH", selisih: 12088 }, { id: "b", name: "PT Sano", status: "SESUAI", selisih: 0 }, { id: "c", name: "Kas", status: "BELUM_DIKONFIRMASI", selisih: null }] };
const antreanContoh = { lunasBelumDicatat: { jumlah: 7, total: 12400000 }, jumlahPembayaranBelumVerifikasi: 3, pengeluaranMenunggu: 2, pembelianMenunggu: 0, tagihanMenunggu: 4, refundMenunggu: 0 };
const kualitasContoh = (riil = riilContoh) => hitungKualitasData({ antrean: antreanContoh, catatan: { gapTerbuka: 5 }, backfill: { kelas: [{ kelas: "LAYAK", jumlah: 428, nilai: 1234567890 }] }, riil });
const buktiContoh = { sejak: "2026-09-01", tanpaNota: 50, belumDiverifikasi: 148, items: Array.from({ length: 198 }, (_, i) => ({ id: String(i), jenis: "expenses", nomor: `E${i}`, date: "2026-10-01", description: "x", amount: 1, status: "DISETUJUI", masalah: "TANPA_NOTA" })) };
const per = (kel, id) => kel.flatMap((g) => g.baris).find((b) => b.id === id);

test("Perlu ditindaklanjuti: empat kelompok, definisi sumber lama, tanpa total gabungan; tujuan lama dipertahankan", () => {
  const kel = susunTindakLanjut({ antrean: antreanContoh, kualitas: kualitasContoh(), riil: riilContoh, bukti: buktiContoh });
  assert.deepEqual(kel.map((g) => g.judul), ["Pencatatan", "Saldo rekening", "Persetujuan", "Bukti transaksi"]);
  const p = per(kel, "pembayaran_belum_tercatat");
  assert.equal(p.jumlah, 7); assert.equal(p.nilai, 12400000); assert.equal(p.tujuan, "/finance/payments"); assert.equal(p.status, "perlu");
  assert.equal(per(kel, "order_belum_diakui").jumlah, 428); assert.equal(per(kel, "order_belum_diakui").tujuan, "/finance/pemasukan");
  assert.equal(per(kel, "transaksi_belum_lengkap").jumlah, 5);
  assert.equal(per(kel, "pembayaran_belum_diverifikasi").jumlah, 3);
  assert.equal(per(kel, "bukti_transaksi").jumlah, 198);
  assert.ok(!kel.some((g) => "total" in g || "jumlah" in g), "tidak ada angka gabungan per kelompok");
  assert.ok(kel.every((g) => g.cakupan), "setiap kelompok punya label cakupan waktu");
});

test("Saldo rekening: selisih, rekening belum dikonfirmasi, dan dana tanpa sumber adalah tiga hal terpisah", () => {
  const kel = susunTindakLanjut({ antrean: antreanContoh, kualitas: kualitasContoh(), riil: riilContoh, bukti: null });
  const s = per(kel, "selisih_rekening"), k = per(kel, "belum_dikonfirmasi"), d = per(kel, "dana_belum_diketahui");
  assert.equal(s.jumlah, 1); assert.equal(s.nilai, 12088, "satu rekening berselisih: nilai dari server");
  assert.equal(k.jumlah, 1); assert.equal(k.nilai, null); assert.match(k.penjelasan, /bukan saldo Rp0/);
  assert.equal(d.jumlah, 1); assert.equal(d.nilai, 2500000);
  const dua = susunTindakLanjut({ antrean: antreanContoh, kualitas: kualitasContoh(), riil: { ...riilContoh, rekening: [...riilContoh.rekening, { id: "z", name: "Z", status: "SELISIH", selisih: 5 }] }, bukti: null });
  assert.equal(per(dua, "selisih_rekening").jumlah, 2); assert.equal(per(dua, "selisih_rekening").nilai, null, "beberapa rekening tidak dijumlahkan");
});

test("tidak tersedia ≠ nol: sumber gagal dimuat tampil sebagai tanpa-data dan tetap terlihat; nol disimpan di balik 'tampilkan semua'", () => {
  const hilang = susunTindakLanjut({ antrean: {}, kualitas: hitungKualitasData({ antrean: {}, catatan: null, backfill: null, riil: null }), riil: null, bukti: null });
  for (const id of ["pembayaran_belum_tercatat", "order_belum_diakui", "transaksi_belum_lengkap", "selisih_rekening", "belum_dikonfirmasi", "dana_belum_diketahui", "bukti_transaksi"]) {
    assert.equal(per(hilang, id).status, "tanpa-data", id); assert.equal(per(hilang, id).jumlah, null, id);
  }
  const kel = susunTindakLanjut({ antrean: antreanContoh, kualitas: kualitasContoh(), riil: riilContoh, bukti: buktiContoh });
  const ringkas = pisahkanTindakLanjut(kel, false), semua = pisahkanTindakLanjut(kel, true);
  assert.deepEqual(ringkas.flatMap((g) => g.nol).map((b) => b.id).sort(), ["pembelian_menunggu", "refund_menunggu"]);
  assert.ok(!ringkas.flatMap((g) => g.terlihat).some((b) => b.status === "bersih"));
  assert.ok(semua.flatMap((g) => g.terlihat).some((b) => b.id === "refund_menunggu"), "kategori nol tetap dapat dilihat");
});

test("selisih rekening bersih: 'Tidak ada selisih tercatat' + penjelasan; rekening belum dikonfirmasi tidak dianggap cocok", () => {
  const riil = { cutoffLabel: "x", rekening: [{ id: "a", name: "A", status: "SESUAI", selisih: 0 }, { id: "b", name: "Kas", status: "BELUM_DIKONFIRMASI", selisih: null }] };
  const kel = susunTindakLanjut({ antrean: antreanContoh, kualitas: kualitasContoh(riil), riil, bukti: null });
  const s = per(kel, "selisih_rekening");
  assert.equal(s.status, "bersih"); assert.equal(s.labelBersih, "Tidak ada selisih tercatat"); assert.equal(s.labelBersih, TEKS_TANPA_SELISIH.label);
  assert.equal(s.penjelasan, "Ini hanya menunjukkan selisih yang tercatat. Rekening yang belum dikonfirmasi dan dana yang sumbernya belum diketahui tetap perlu diperiksa.");
  assert.equal(per(kel, "belum_dikonfirmasi").jumlah, 1);
});

test("bukti transaksi: 5 awal, lalu halaman atas SEMUA entri yang dimuat; total tidak dibulatkan", () => {
  const awal = potongBukti(buktiContoh.items, "awal");
  assert.equal(awal.baris.length, BUKTI_AWAL); assert.equal(awal.total, 198); assert.equal(awal.adaLagi, true);
  const h0 = potongBukti(buktiContoh.items, "semua", 0), hAkhir = potongBukti(buktiContoh.items, "semua", 999);
  assert.equal(h0.baris.length, BUKTI_PER_HALAMAN); assert.equal(h0.jumlahHalaman, Math.ceil(198 / BUKTI_PER_HALAMAN));
  assert.equal(hAkhir.halaman, h0.jumlahHalaman - 1); assert.equal(hAkhir.baris.length, 198 - (h0.jumlahHalaman - 1) * BUKTI_PER_HALAMAN);
  const semuaId = new Set(); for (let h = 0; h < h0.jumlahHalaman; h++) potongBukti(buktiContoh.items, "semua", h).baris.forEach((b) => semuaId.add(b.id));
  assert.equal(semuaId.size, 198, "tidak ada entri yang terlewat atau ganda antar halaman");
  assert.equal(potongBukti([], "awal").adaLagi, false);
  assert.equal(potongBukti(buktiContoh.items.slice(0, 3), "awal").adaLagi, false);
});

test("laba rugi nol: hanya bila SEMUA komponen termuat dan 0; loading/hilang/sebagian bukan nol; teks tidak mengklaim 'tidak ada transaksi'", () => {
  const nol = { pendapatanBruto: 0, retur: 0, pendapatanBersih: 0, bebanPokok: 0, labaKotor: 0, bebanOperasional: 0, labaBersih: 0 };
  assert.equal(semuaKomponenNol(nol), true);
  assert.equal(semuaKomponenNol({ ...nol, pendapatanBruto: 1000, pendapatanBersih: 1000, labaKotor: 1000, labaBersih: 1000 }), false);
  assert.equal(semuaKomponenNol({ ...nol, bebanOperasional: 500, labaBersih: -500 }), false, "pendapatan nol tetapi biaya berisi: tidak dilipat");
  assert.equal(semuaKomponenNol({ ...nol, pendapatanBruto: 100, retur: 100 }), false, "komponen saling meniadakan tetap berisi");
  assert.equal(semuaKomponenNol(null), false); assert.equal(semuaKomponenNol(undefined), false);
  const { bebanPokok, ...tanpaSatu } = nol; assert.equal(semuaKomponenNol(tanpaSatu), false);
  assert.equal(TEKS_LABA_NOL, "Seluruh komponen laba rugi bernilai Rp0 pada periode ini.");
});

test("umur tagihan: dasar umur tertua sesuai sumber data (jatuh tempo vs tanggal order)", () => {
  assert.match(dasarUmurTertua({ dariTanggalOrder: true }), /tanggal order/);
  assert.match(dasarUmurTertua({ dariTanggalOrder: false }), /jatuh tempo invoice/);
  assert.equal(dasarUmurTertua(null), null);
});

test("Saldo rekening: PT Sano (pembukuan terbaru ≠ terkonfirmasi tetapi 'Sesuai') dijelaskan dengan tanggal acuan, tanpa menghitung selisih baru", () => {
  const riil = { cutoffLabel: "21 Sep 2026 pukul 20.00 WIB", tanggalBuku: "2026-09-21" };
  const b = bahanBarisRekening({ id: "a1", name: "PT Sano", kind: "BANK", saldo: 41250000 }, { id: "a1", saldoBuku: 39180615, saldoRiil: 39180615, selisih: 0, status: "SESUAI" }, riil);
  assert.equal(b.status.label, "Sesuai"); assert.equal(b.bukuBerbeda, true); assert.equal(b.perluTindakan, false);
  assert.equal(b.terkonfirmasi.nilai, 39180615); assert.match(b.terkonfirmasi.keterangan, /21 Sep 2026 pukul 20\.00 WIB/);
  assert.equal(b.baris.find((z) => z.k === "selisih").nilai, 0, "selisih dibaca dari server, bukan buku − riil");
  assert.ok(b.baris.some((z) => z.k === "berbeda" && /posisi terbaru/.test(z.teks)));
});

test("Saldo rekening: belum dikonfirmasi ≠ Rp0 (nilai pada tanggal acuan tetap tampil); riil gagal = tidak tersedia; selisih = perlu tindakan", () => {
  const riil = { cutoffLabel: "21 Sep 2026 pukul 20.00 WIB" };
  const r = { id: "a4", name: "BCA Ops", kind: "BANK", saldo: 9000000 };
  const belum = bahanBarisRekening(r, { saldoBuku: 7320500, saldoRiil: null, selisih: null, status: "BELUM_DIKONFIRMASI" }, riil);
  assert.equal(belum.terkonfirmasi.keadaan, "belum"); assert.equal(belum.terkonfirmasi.nilai, null);
  assert.equal(belum.baris.find((z) => z.k === "bukuAcuan").nilai, 7320500); assert.ok(belum.baris.some((z) => z.k === "belum" && /bukan saldo Rp0/.test(z.teks)));
  const hilang = bahanBarisRekening(r, undefined, null); assert.equal(hilang.terkonfirmasi.keadaan, "tidak-tersedia"); assert.equal(hilang.terkonfirmasi.nilai, null);
  const sel = bahanBarisRekening(r, { saldoBuku: 100, saldoRiil: 88, selisih: 12, status: "SELISIH" }, riil);
  assert.equal(sel.perluTindakan, true); assert.equal(STATUS_PENCOCOKAN.SELISIH.tone, "red");
});

test("bahasa & label posisi: istilah sederhana, istilah asli tersedia; posisi tanpa tanggal klien", () => {
  assert.equal(ISTILAH.pencocokanSaldo.tampil, "Pencocokan saldo"); assert.equal(ISTILAH.pencocokanSaldo.asli, "Rekonsiliasi rekening");
  assert.equal(ISTILAH.tanggalAcuan.tampil, "Tanggal acuan"); assert.equal(ISTILAH.tanggalAcuan.asli, "Cutoff");
  assert.equal(ISTILAH.lengkapiOrderLama.tampil, "Melengkapi data order lama"); assert.equal(ISTILAH.sumberDanaBelumDiketahui.tampil, "Sumber dana belum diketahui");
  assert.equal(ISTILAH.penyesuaianPengurangBiaya.tampil, "Penyesuaian pengurang biaya");
  assert.equal(LABEL_POSISI, "Posisi terbaru dalam pembukuan");
  assert.match(CATATAN_POSISI, /tanggal buku hari ini \(WIB\)/); assert.match(CATATAN_POSISI, /bukan rentang tanggal laba/);
});

test("sumber logo dicatat: URL asli, tanpa klaim izin; berkas tak dimodifikasi (hash di dokumen = hash berkas)", async () => {
  const crypto = await import("node:crypto");
  const doc = fs.readFileSync(path.join(repo, "..", "docs/ASET-LOGO-BANK.md"), "utf8");
  assert.ok(doc.includes("https://pustaka.bca.co.id/public-assets/logo-bca.svg") && doc.includes("https://bankmandiri.co.id/image/layout_set_logo?img_id=31567"));
  assert.match(doc, /Tidak ada dokumen izin pakai merek yang dimiliki/);
  for (const f of ["bca.svg", "mandiri.png"]) { const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, "src/assets/bank", f))).digest("hex"); assert.ok(doc.includes(h), "hash " + f); }
});

test("baris bukti: jumlah 'terdeteksi' + ringkasan jenis masalah + batas data langsung di dekat angka; angka dinamis", () => {
  const kel = susunTindakLanjut({ antrean: antreanContoh, kualitas: kualitasContoh(), riil: riilContoh, bukti: buktiContoh });
  const b = per(kel, "bukti_transaksi");
  assert.equal(b.jumlah, 198); assert.equal(b.satuan, "bukti terdeteksi"); assert.equal(b.status, "perlu");
  assert.equal(b.ringkas, "148 nota menunggu verifikasi · 50 transaksi wajib nota tetapi belum ada");
  assert.equal(b.catatanBatas, "Dari maksimal 200 pengeluaran dan 200 pembelian terbaru.");
  const kecil = per(susunTindakLanjut({ antrean: antreanContoh, kualitas: kualitasContoh(), riil: riilContoh, bukti: { ...buktiContoh, items: buktiContoh.items.slice(0, 7), belumDiverifikasi: 4, tanpaNota: 3 } }), "bukti_transaksi");
  assert.equal(kecil.jumlah, 7); assert.match(kecil.ringkas, /^4 nota .* 3 transaksi/);
  assert.equal(per(susunTindakLanjut({ antrean: antreanContoh, kualitas: kualitasContoh(), riil: riilContoh, bukti: null }), "bukti_transaksi").ringkas, null, "gagal dimuat: tidak ada ringkasan palsu");
});

test("strip: kondisi 'lengkap' tidak menyimpulkan seluruh keuangan; menyebut konfirmasi/pencocokan saldo diperiksa terpisah", async () => {
  const { TEKS_STRIP } = await import("../src/features/finance/ringkasanTampilan.js");
  assert.equal(TEKS_STRIP.lengkap.judul, "Tidak ada kekurangan pencatatan yang terdeteksi");
  assert.match(TEKS_STRIP.lengkap.isi, /Konfirmasi rekening dan pencocokan saldo diperiksa terpisah/);
  assert.ok(!/lengkap menurut/i.test(TEKS_STRIP.lengkap.judul));
});
