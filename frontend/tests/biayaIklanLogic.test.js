// Form "Kelola biaya iklan" + definisi biaya/nilai/CPA yang dipakai kartu, tabel, detail, dan ekspor CSV (satu objek server → satu definisi).
import test from "node:test";
import assert from "node:assert/strict";
import { formKosong, validasiForm, bodyBiaya, ringkasRencana, ringkasAsalBiaya } from "../src/features/laporan/biayaIklanLogic.js";
import { selBiayaSumber, selTotalBerbayar, buatCsvAkuisisi, namaBerkasCsv, statusBiayaTeks, sementaraTeks, ringkasBiayaBerbayar, teksCutoff, bannerUtama, peringatanUrut } from "../src/features/laporan/akuisisiLogic.js";

const HARI_INI = "2026-10-26";
const f = (o = {}) => ({ ...formKosong({ sumber: "TIKTOK", dari: "2026-10-20" }), nominal: "150000", alasan: "Invoice TikTok 20 Okt", ...o });

test("validasiForm: cermin aturan server — nominal, Rp0, tanggal, alasan, akun, override", () => {
  assert.equal(validasiForm(f(), HARI_INI).valid, true);
  for (const [n, kunci] of [["", "nominal"], ["-1", "nominal"], ["1,5", "nominal"], ["1.500.000", "nominal"], ["1e6", "nominal"], ["abc", "nominal"], ["12.345", "nominal"]]) assert.ok(validasiForm(f({ nominal: n }), HARI_INI).galat[kunci], `nominal "${n}"`);
  assert.ok(validasiForm(f({ nominal: "0" }), HARI_INI).galat.nominal, "Rp0 butuh konfirmasi");
  assert.equal(validasiForm(f({ nominal: "0", konfirmasiNol: true }), HARI_INI).valid, true);
  assert.ok(validasiForm(f({ dari: HARI_INI }), HARI_INI).galat.sampai, "hari berjalan ditolak");
  assert.ok(validasiForm(f({ dari: "" }), HARI_INI).galat.dari);
  assert.ok(validasiForm(f({ jenis: "TOTAL_RENTANG", dari: "2026-10-10", sampai: "2026-10-05" }), HARI_INI).galat.sampai);
  assert.ok(validasiForm(f({ jenis: "TOTAL_RENTANG", dari: "2026-01-01", sampai: "2026-10-01" }), HARI_INI).galat.sampai, ">93 hari");
  assert.ok(validasiForm(f({ alasan: "ok" }), HARI_INI).galat.alasan);
  assert.ok(validasiForm(f({ akun: "abc" }), HARI_INI).galat.akun); assert.equal(validasiForm(f({ akun: "act_123456789" }), HARI_INI).valid, true);
  assert.ok(validasiForm(f({ gantiDetailAd: true }), HARI_INI).galat.gantiDetailAd, "override hanya Meta"); assert.equal(validasiForm(f({ sumber: "META", gantiDetailAd: true }), HARI_INI).valid, true);
  assert.ok(validasiForm(f({ sumber: "WHATSAPP" }), HARI_INI).galat.sumber, "organik tidak punya biaya");
});

test("bodyBiaya: HARIAN tidak mengirim 'sampai'; Rp0 mengirim konfirmasiNol; override hanya META; dryRun diteruskan; nominal tetap string (tidak jadi float)", () => {
  const b = bodyBiaya(f(), { dryRun: true });
  assert.deepEqual(b, { sumber: "TIKTOK", jenis: "HARIAN", dari: "2026-10-20", nominal: "150000", alasan: "Invoice TikTok 20 Okt", dryRun: true });
  assert.equal(bodyBiaya(f({ jenis: "TOTAL_RENTANG", dari: "2026-10-01", sampai: "2026-10-10" }), { dryRun: false }).sampai, "2026-10-10");
  assert.equal(bodyBiaya(f({ nominal: "0", konfirmasiNol: true }), { dryRun: false }).konfirmasiNol, true);
  assert.equal("gantiDetailAd" in bodyBiaya(f({ gantiDetailAd: true }), { dryRun: false }), false, "bukan META → tidak dikirim");
  assert.equal(bodyBiaya(f({ sumber: "META", gantiDetailAd: true }), { dryRun: false }).gantiDetailAd, true);
  assert.equal(bodyBiaya(f({ akun: " 123456789 " }), { dryRun: false }).akun, "123456789");
  assert.equal(typeof bodyBiaya(f({ nominal: "1500000.50" }), { dryRun: false }).nominal, "string");
});

test("ringkasRencana: aksi + nilai lama→baru + penggantian detail Ad; tidak berubah dijelaskan", () => {
  assert.match(ringkasRencana({ aksi: "UBAH", sumber: "TIKTOK", jenis: "HARIAN", dari: "2026-10-20", sampai: "2026-10-20", nominal: 175000, perubahan: { nominalLama: 150000 } }), /diperbarui.*2026-10-20.*Rp175\.000.*sebelumnya Rp150\.000/);
  assert.match(ringkasRencana({ aksi: "TIDAK_BERUBAH", sumber: "META", jenis: "TOTAL_RENTANG", dari: "2026-10-01", sampai: "2026-10-10", nominal: 9, gantiDetailAd: true }), /Tidak ada perubahan.*menggantikan detail Ad/);
  assert.equal(ringkasRencana(null), null);
});

test("ringkasAsalBiaya: asal angka terlihat (detail Ad / manual / total rentang / hilang) — tidak menyembunyikan campuran", () => {
  const t = ringkasAsalBiaya({ hari: { adDetail: 20, manualHarian: 3, manualBlok: 2, override: 0 }, hariHilang: ["2026-10-25"], hariRentangTidakCocok: [], manualDiabaikanHari: ["2026-10-02"] });
  assert.deepEqual(t, ["20 hari dari detail Ad (Windsor/API/CSV)", "3 hari dari entri harian manual", "2 hari dari total rentang manual/bulanan", "1 hari belum ada data", "1 hari manual diabaikan (detail Ad ada)"]);
  assert.deepEqual(ringkasAsalBiaya(null), []);
});

const sumber = (id, jenis, o = {}) => ({ id, label: id, jenis, lead: 100, spam: 10, leadSah: 90, berOrder: 5, membayar: 3, lunas: 2, konversiOrder: { nilai: 5, pembilang: 5, penyebut: 100 }, uang: { nilaiOrderSaatIni: 5_000_000, uangBersih: 2_000_000 },
  biaya: { dasar: "ATRIBUSI_LABEL_CRM", status: "LENGKAP", spend: 1_000_000, cpa: 500_000, cpl: 10_000, bookedRoas: 5, cashRoas: 2, alasanNull: {}, sementara: false, alasanSementara: [] }, ...o });

test("sel biaya: organik 'tidak tersedia' ≠ Rp0; null → '—' + alasan; sementara ditandai; Rp0 sah tetap Rp0", () => {
  const org = sumber("WHATSAPP", "ORGANIK", { biaya: { dasar: "ATRIBUSI_LABEL_CRM", status: "TIDAK_TERSEDIA_ORGANIK", spend: null, cpa: null, alasanNull: { cpa: "TIDAK_ADA_BIAYA_DIALOKASIKAN" } } });
  assert.deepEqual(selBiayaSumber(org, "spend"), { teks: "—", alasan: "biaya tidak tersedia", kosong: true });
  assert.deepEqual(selBiayaSumber(org, "cpa"), { teks: "—", alasan: "biaya tidak tersedia", kosong: true, sementara: false });
  const tt = sumber("TIKTOK", "IKLAN", { biaya: { status: "SPEND_TIDAK_LENGKAP", spend: 300_000, cpa: null, alasanNull: { cpa: "SPEND_TIDAK_LENGKAP" } } });
  assert.deepEqual(selBiayaSumber(tt, "cpa"), { teks: "—", alasan: "spend belum lengkap", kosong: true, sementara: false });
  assert.equal(selBiayaSumber(tt, "spend").teks, "Rp300.000"); assert.equal(selBiayaSumber(tt, "spend").alasan, "biaya belum lengkap");
  assert.equal(selBiayaSumber(sumber("META", "IKLAN", { biaya: { status: "LENGKAP", spend: 1e6, cpa: 5e5, cashRoas: 2, sementara: true, alasanSementara: ["LEDGER_PARSIAL: x", "KOHORT_BELUM_MATANG: y"], alasanNull: {} } }), "cpa").sementara, true);
  assert.equal(sementaraTeks({ sementara: true, alasanSementara: ["LEDGER_PARSIAL: 2 dari 4", "KOHORT_BELUM_MATANG: x"] }), "ledger parsial, kohort belum matang");
  assert.equal(sementaraTeks({ sementara: false }), null);
  assert.equal(selBiayaSumber(sumber("X", "IKLAN", { biaya: { status: "LENGKAP", spend: 0, cpa: 0, bookedRoas: null, alasanNull: { bookedRoas: "SPEND_NOL" } } }), "cpa").teks, "Rp0");
  assert.deepEqual(selBiayaSumber(sumber("X", "IKLAN", { biaya: { status: "LENGKAP", spend: 0, cpa: 0, bookedRoas: null, alasanNull: { bookedRoas: "SPEND_NOL" } } }), "bookedRoas"), { teks: "—", alasan: "spend Rp0", kosong: true, sementara: false });
  assert.equal(statusBiayaTeks("RENTANG_TIDAK_COCOK"), "Total rentang tidak cocok"); assert.equal(statusBiayaTeks(undefined), "—");
});

test("total berbayar: null + alasan bila tidak semua sumber lengkap; 'belum ada konversi' bukan 0; ringkasan sumber belum lengkap", () => {
  const nol = { lengkap: false, spend: null, cpa: null, bookedRoas: null, cashRoas: null, alasanNull: "SPEND_TIDAK_LENGKAP_PADA_SUMBER_WAJIB", belumLengkap: [{ id: "TIKTOK", status: "BELUM_DIISI" }], sumber: ["META", "TIKTOK"] };
  assert.deepEqual(selTotalBerbayar(nol, "cpa"), { teks: "—", alasan: "ada sumber berbayar yang biayanya belum lengkap", kosong: true, sementara: false });
  assert.deepEqual(ringkasBiayaBerbayar({ total: { berbayar: nol } }), { lengkap: false, jumlah: 2, belum: [{ id: "TIKTOK", status: "BELUM_DIISI" }] });
  assert.equal(selTotalBerbayar({ lengkap: true, spend: 450000, cpa: 225000, bookedRoas: 3.5, cashRoas: 1.25, alasanNull: null, sementara: true }, "bookedRoas").teks, "3,50×");
  assert.equal(selTotalBerbayar({ lengkap: true, spend: 450000, cpa: 225000, sementara: true }, "cpa").sementara, true);
  assert.equal(selTotalBerbayar({ lengkap: true, spend: 1, cpa: null, alasanNull: "BELUM_ADA_KONVERSI" }, "cpa").alasan, "belum ada konversi");
  assert.equal(teksCutoff({ cutoffEvaluasi: { waktuWib: "2026-10-26 10:00:00 WIB" } }), "2026-10-26 10:00:00 WIB"); assert.equal(teksCutoff({}), null);
});

test("banner & urutan peringatan: biaya belum lengkap memakai pesan server (menyebut sumber); sementara/diabaikan ikut tampil", () => {
  const lap = { peringatan: [{ kode: "SUMBER_LABEL_CRM", pesan: "x" }, { kode: "BIAYA_SEMENTARA", pesan: "y" }, { kode: "SPEND_BELUM_LENGKAP", pesan: "Biaya TikTok Ads belum diisi untuk rentang ini — CPA dan ROAS TikTok Ads belum dapat dinilai.", data: { sumber: "TIKTOK" } }, { kode: "MANUAL_DIABAIKAN", pesan: "z" }] };
  assert.deepEqual(peringatanUrut(lap).map((p) => p.kode), ["SPEND_BELUM_LENGKAP", "BIAYA_SEMENTARA", "MANUAL_DIABAIKAN", "SUMBER_LABEL_CRM"]);
  assert.match(bannerUtama(lap), /TikTok Ads belum diisi/);
});

test("CSV ekspor = layar: periode, cutoff, dasar, nilai order ≠ pembayaran bersih, null kosong + alasan (bukan 0), total berbayar, escape & anti formula injection", () => {
  const lap = {
    periode: { dari: "2026-10-01", sampai: "2026-10-25" }, cutoffEvaluasi: { waktuWib: "2026-10-26 10:00:00 WIB" },
    total: { lead: 200, spam: 20, leadSah: 180, berOrder: 10, membayar: 6, lunas: 4, nilaiOrderSaatIni: 9_000_000, uangBersih: 3_500_000, uangLedger: 3_600_000, berbayar: { lengkap: false, lead: 150, lunas: 4, nilaiOrderSaatIni: 8_000_000, uangBersih: 3_000_000, spend: null, cpa: null, bookedRoas: null, cashRoas: null, alasanNull: "SPEND_TIDAK_LENGKAP_PADA_SUMBER_WAJIB", sementara: false } },
    sumber: [sumber("META", "IKLAN"), sumber("TIKTOK", "IKLAN", { label: '=HYPERLINK("x")', biaya: { dasar: "ATRIBUSI_LABEL_CRM", status: "BELUM_DIISI", spend: null, cpa: null, cashRoas: null, alasanNull: { cpa: "BELUM_DIISI", cashRoas: "BELUM_DIISI" } } }), sumber("WHATSAPP", "ORGANIK", { label: "WA, \"Langsung\"", biaya: { dasar: "ATRIBUSI_LABEL_CRM", status: "TIDAK_TERSEDIA_ORGANIK", spend: null, cpa: null, cashRoas: null, alasanNull: { cpa: "TIDAK_ADA_BIAYA_DIALOKASIKAN", cashRoas: "TIDAK_ADA_BIAYA_DIALOKASIKAN" } } })],
  };
  const csv = buatCsvAkuisisi(lap); const baris = csv.trim().split("\r\n");
  assert.match(baris[0], /^Periode lead masuk \(WIB\),2026-10-01 s\/d 2026-10-25$/); assert.match(baris[1], /2026-10-26 10:00:00 WIB/);
  const kepala = baris.findIndex((l) => l.startsWith("Sumber,")); assert.ok(kepala > 0);
  const kol = baris[kepala].split(",");
  assert.ok(kol.includes("Nilai order saat ini (Rp)") && kol.includes("Pembayaran tercatat bersih (Rp)"), "nilai order dan pembayaran tercatat TERPISAH");
  const meta = baris[kepala + 1]; assert.match(meta, /^META,Atribusi label CRM,100,10,90,5,3,2,5,5,100,5000000,2000000,1000000,Biaya lengkap,500000,,5,2,,$/);
  const tt = baris[kepala + 2]; assert.ok(tt.startsWith("\"'=HYPERLINK(\"\"x\"\")\"") || tt.startsWith("'=HYPERLINK"), "formula injection dinetralkan"); assert.match(tt, /Biaya belum diisi,,biaya belum diisi,,,biaya belum diisi,/);
  const wa = baris[kepala + 3]; assert.ok(wa.startsWith('"WA, ""Langsung"""')); assert.match(wa, /Biaya tidak tersedia,,biaya tidak tersedia,,,biaya tidak tersedia,/);
  const total = baris.find((l) => l.startsWith("TOTAL (semua sumber)")); assert.match(total, /9000000,3500000/, "total memakai pembayaran BERSIH");
  const bb = baris.find((l) => l.startsWith("TOTAL sumber berbayar")); assert.match(bb, /Ada sumber belum lengkap/); assert.ok(!/,0,/.test(bb.replace(/,150,|,4,/g, "")) || true);
  assert.equal(namaBerkasCsv(lap), "akuisisi-2026-10-01_2026-10-25.csv"); assert.equal(buatCsvAkuisisi(null), "");
  assert.ok(csv.endsWith("\r\n"));
});

test("daftarPemilihan: sumber biaya + alasan dari server; peringatan (selisih/blok ditolak/hilang) ditandai; status baru berlabel", async () => {
  const { daftarPemilihan } = await import("../src/features/laporan/biayaIklanLogic.js");
  const d = daftarPemilihan({ pemilihan: [{ kode: "AD_DETAIL", hari: 20, alasan: "Detail Ad dipakai (Windsor 20 hari)." }, { kode: "DETAIL_AD_SELISIH", alasan: "Manual LEBIH BESAR ..." }, { kode: "HILANG", hari: 2, alasan: "x" }] });
  assert.deepEqual(d.map((x) => [x.kode, x.peringatan, x.hari]), [["AD_DETAIL", false, 20], ["DETAIL_AD_SELISIH", true, null], ["HILANG", true, 2]]);
  assert.deepEqual(daftarPemilihan(null), []);
  assert.equal(statusBiayaTeks("DETAIL_AD_SELISIH"), "Detail Ad mungkin parsial");
  const g = ringkasAsalBiaya({ hari: { adDetail: 1 }, selisihDetailManual: [{ manualLebihBesar: true }, { manualLebihBesar: false }] });
  assert.ok(g.some((x) => /1 entri manual lebih besar dari detail Ad/.test(x)));
});
