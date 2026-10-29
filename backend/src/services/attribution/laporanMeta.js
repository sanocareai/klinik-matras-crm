// LAPORAN META ADS UNTUK KONEKTOR (MCP) — lapisan PENYAJIAN di atas service atribusi yang SAMA dengan GET /api/atribusi/iklan.
//
// TIDAK ADA tracking kedua dan TIDAK ADA rumus bisnis kedua di sini:
//   • angka lead/order/pembayaran/lunas/uang/spend/KPI semuanya datang dari hitungLaporanIklan (iklanReport.js → cohort.js + biayaKpi.js + spend.js);
//   • modul ini hanya MEMILIH kolom (daftar-putih, tanpa data customer), MENGURUTKAN peringkat, dan MENYUSUN ULANG per hari dengan memanggil
//     hitungLaporanIklan per hari (rekap harian) — akumulasi periode dihitung ULANG dari data sumber, tidak pernah dijumlahkan dari angka/persentase harian.
//   • satu-satunya angka turunan: nilaiOrderSetelahBiayaIklan = nilai order − spend (bukan laba), dengan pengaman KPI yang sama seperti ROAS.
//
// Fungsi `susun*` MURNI (tanpa DB) supaya bisa dites; fungsi `laporan*` / `rekap*` / `kesehatan*` memuat lewat service dan menjaga satu perhitungan sekaligus
// lewat penjaga bersama (penjagaLaporan.js). Semua pemuatan berjalan di transaksi READ ONLY milik service atribusi.
import { hitungLaporanIklan, parseParameterIklan, ParameterError, MAKS_HARI } from "./iklanReport.js";
import { hitungKesehatanCapture } from "./captureHealth.js";
import { ringkasanSpendHarian } from "./spend.js";
import { denganAntrean } from "./penjagaLaporan.js";
import { hariWIB } from "./cohort.js";

export { ParameterError };

const DAY = 86_400_000;
const geserHari = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const selisihHari = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const r2 = (x) => (x === null || x === undefined ? null : Math.round(Number(x) * 100) / 100);
const wibStr = (d) => new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().replace("T", " ").slice(0, 16);

/** Rekap harian: satu perhitungan penuh per hari → dibatasi. */
export const MAKS_HARI_REKAP = 31;
export const BATAS_BARIS_BAWAAN = 20;
export const BATAS_BARIS_MAKS = 100;
const MAKS_BARIS_TIDAK_TERPETAKAN = 50;

/** Alasan KPI CRM sengaja null karena rentang tidak sebanding dengan spend/atribusi (bukan "nol"). */
const ALASAN_PENGAMAN = Object.freeze(["SPEND_TIDAK_LENGKAP", "HARI_BERJALAN_PARSIAL", "SEBELUM_ATRIBUSI", "HARI_ATRIBUSI_PARSIAL"]);

// ── KRITERIA PERINGKAT ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Semua kriteria "terbaik dulu". `ambil` membaca BARIS RINGKAS (bukan baris mentah). Nilai null = tidak dapat diperingkat (alasan disertakan), bukan 0.
export const KRITERIA_URUT = Object.freeze({
  customer_lunas_ledger: { label: "Customer unik lunas terbukti ledger (closing utama)", arah: "desc", ambil: (b) => b.order.customerLunasTerbuktiLedger },
  customer_pernah_membayar: { label: "Customer unik pernah membayar (>= 1 pembayaran ledger sah; DP dan lunas termasuk)", arah: "desc", ambil: (b) => b.order.customerPernahMembayar },
  customer_ber_order: { label: "Customer unik ber-order eligible", arah: "desc", ambil: (b) => b.order.customerBerOrder },
  lead_akuisisi: { label: "Lead akuisisi terbukti (customer baru, touch CTWA pertama)", arah: "desc", ambil: (b) => b.akuisisi.leadTerbukti },
  nilai_order: { label: "Nilai order eligible (bersih nota kredit, tanpa ongkir)", arah: "desc", ambil: (b) => b.order.nilaiOrder },
  uang_ledger_bersih: { label: "Uang ledger bersih (pembayaran sah − refund disetujui; termasuk ongkir)", arah: "desc", ambil: (b) => b.uang.uangLedgerBersih },
  spend: { label: "Spend Meta (hanya bila ada baris spend)", arah: "desc", ambil: (b) => b.biaya.spend, alasan: (b) => b.biaya.alasanNull.spend ?? "BELUM_ADA_SPEND" },
  cpa_lunas: { label: "CPA lunas = spend ÷ customer unik lunas ledger (terendah = terbaik)", arah: "asc", ambil: (b) => b.biaya.cpaLunas, alasan: (b) => b.biaya.alasanNull.cpaLunas ?? "TIDAK_TERSEDIA" },
  booked_roas: { label: "Booked ROAS = nilai order ÷ spend", arah: "desc", ambil: (b) => b.biaya.bookedRoas, alasan: (b) => b.biaya.alasanNull.bookedRoas ?? "TIDAK_TERSEDIA" },
  cash_roas: { label: "Cash ROAS = uang ledger bersih ÷ spend", arah: "desc", ambil: (b) => b.biaya.cashRoas, alasan: (b) => b.biaya.alasanNull.cashRoas ?? "TIDAK_TERSEDIA" },
});
export const DAFTAR_KRITERIA = Object.freeze(Object.keys(KRITERIA_URUT));

export const DEFINISI = Object.freeze({
  leadAkuisisiTerbukti: "Customer BARU saat touch CTWA_AD pertamanya (bukti kausal), satu customer = satu baris. Spam, internal, B2B tetap terhitung di leadTerbukti tetapi dipisah di 'spam'; leadSah = tanpa pengecualian.",
  customerBerOrder: "Customer unik lead sah dengan >= 1 order eligible. Order eligible = bukan CANCELLED/PENDING, bukan penjualan karyawan; customer spam/internal/B2B/staf tidak masuk.",
  customerPernahMembayar: "Customer unik dengan >= 1 pembayaran sah di ledger pada order eligible (DP dan lunas termasuk; pembayaran dibatalkan/belum terverifikasi tidak dihitung).",
  customerLunasTerbuktiLedger: "CLOSING UTAMA: customer unik dengan >= 1 order eligible yang ledger sah (− refund disetujui) menutup seluruh tagihan. Ber-order ≠ lunas. 'Lunas menurut CRM' (status tersimpan) adalah metrik terpisah dan bukan bukti uang.",
  nilaiOrder: "Nilai order eligible SAAT INI (bersih Nota Kredit), TANPA ongkir; bukan uang diterima.",
  uangLedgerBersih: "Pembayaran sah di ledger − refund disetujui. Pembayaran memuat ongkir, sedangkan nilai order tidak: selisih uang vs nilai order dapat berupa ongkir, bukan kesalahan.",
  cpaLunas: "spend ÷ customer unik lunas terbukti ledger. Penyebut 0 → null (BELUM_ADA_KONVERSI), bukan 0.",
  bookedRoas: "nilai order ÷ spend (nilai order tanpa ongkir).",
  cashRoas: "uang ledger bersih ÷ spend (uang memuat ongkir; tidak sebanding langsung dengan Booked ROAS). Definisi Cash ROAS yang ada dipertahankan.",
  nilaiOrderSetelahBiayaIklan: "nilai order − spend (tanpa biaya lain). BUKAN laba bersih. null bila spend tidak ada/tidak lengkap/periode tidak sebanding.",
  reaktivasi: "Customer lama (sudah ada sebelum touch) yang mengklik iklan lagi: dipisah, tidak menambah lead/closing campaign akuisisi.",
  UNMAPPED: "Customer/spend dengan Ad ID yang belum punya referensi Ad → Ad Set → Campaign. Selalu ditampilkan terpisah; tidak pernah dialokasikan ke campaign.",
  UNKNOWN: "Lead baru bertouch iklan tanpa bukti kausal akuisisi. Ditampilkan terpisah; tidak dikreditkan ke campaign mana pun.",
  kreatifTidakDipakai: "URL kreatif/postingan TIDAK dipakai untuk atribusi campaign (satu postingan dapat dipakai ulang di banyak campaign). Atribusi hanya lewat Ad ID dari webhook (sourceID) dan referensi pemetaan.",
});

// ── PROYEKSI BARIS (daftar-putih; tidak ada identitas/telepon/ID customer) ───────────────────────────────────────────────────────────────────────

/** Blok biaya ringkas dari hasil hitungBiayaBaris (biayaKpi.js) + satu-satunya angka turunan. `booked` = nilai order baris yang sama. */
export function ringkasBiaya(b, booked) {
  if (!b) return { status: null, spend: null, hariAdaSpend: 0, platformConversations: null, cpl: null, costPerCustomerOrder: null, cpaLunas: null, bookedRoas: null, cashRoas: null, nilaiOrderSetelahBiayaIklan: null, alasanNull: {}, spamSharePercent: null, evaluasi: null };
  const an = b.alasanNull || {};
  const spend = b.spend === undefined ? null : b.spend;
  let setelah = null, alasanSetelah = null;
  if (spend === null) alasanSetelah = "BELUM_ADA_SPEND";
  else if (ALASAN_PENGAMAN.includes(an.bookedRoas)) alasanSetelah = an.bookedRoas;
  else setelah = r2((Number(booked) || 0) - spend);
  const alasanNull = {};
  const taruh = (k, v) => { if (v) alasanNull[k] = v; };
  taruh("spend", spend === null ? "BELUM_ADA_SPEND" : null);
  taruh("cpl", an.cpl); taruh("cpaLunas", an.cpa); taruh("costPerCustomerOrder", an.costPerCustomerOrder);
  taruh("bookedRoas", an.bookedRoas); taruh("cashRoas", an.cashRoas); taruh("nilaiOrderSetelahBiayaIklan", alasanSetelah);
  return {
    status: b.status, spend, hariAdaSpend: b.hariAdaSpend ?? 0,
    platformConversations: b.platformConversations ?? null,   // hasil percakapan versi Meta; BUKAN lead CRM
    cpl: b.cpl ?? null, costPerCustomerOrder: b.costPerCustomerOrder ?? null, cpaLunas: b.cpa ?? null,
    bookedRoas: b.bookedRoas ?? null, cashRoas: b.cashRoas ?? null,
    nilaiOrderSetelahBiayaIklan: setelah,
    alasanNull, spamSharePercent: b.spamSharePercent ?? null,
    evaluasi: b.evaluasi?.status ?? null,
  };
}

function sementara(g) {
  const alasan = [];
  const m = g.biaya?.kematangan;
  if (m && m.matang === false) alasan.push("KOHORT_BELUM_MATANG");
  const p = g.cakupanLedger?.persenOrderBerLedger;
  if (p !== null && p !== undefined && p < 100) alasan.push(`CAKUPAN_LEDGER_${p}_PERSEN`);
  return { sementara: alasan.length > 0, alasan };
}

/** Satu baris laporan mentah (grup) → baris ringkas. */
export function ringkasBaris(g) {
  const sem = sementara(g);
  return {
    kunci: g.kunci, status: g.status, level: g.level,
    campaign: g.campaign ?? null, adSet: g.adSet ?? null, ad: g.ad ?? null, jumlahAd: g.jumlahAd ?? 0,
    akuisisi: {
      leadTerbukti: g.lead?.unik ?? 0, leadSah: g.lead?.leadSah ?? 0, spam: g.lead?.spam ?? 0, bukanSpam: g.lead?.bukanSpam ?? 0,
      pernahDitandaiProspek: g.pernahDitandaiProspek?.jumlah ?? 0,
    },
    order: {
      customerBerOrder: g.customerDenganOrder ?? 0, jumlahOrderEligible: g.orderEligible ?? 0, nilaiOrder: g.bookedValue ?? 0,
      customerPernahMembayar: g.customerPernahMembayar ?? 0, orderPernahDp: g.orderPernahDp ?? 0,
      customerLunasTerbuktiLedger: g.closingUtama?.customerLunasTerbuktiLedger ?? 0, orderLunasTerbuktiLedger: g.closingUtama?.orderLunasTerbuktiLedger ?? 0,
      customerLunasMenurutCrm: g.customerLunasMenurutCrm ?? 0,
    },
    uang: { uangLedger: g.uangLedger ?? 0, refundDisetujui: g.refundDisetujui ?? 0, uangLedgerBersih: g.uangBersihLedger ?? 0 },
    cakupanLedger: g.cakupanLedger ?? null,
    reaktivasi: { touch: g.reaktivasi?.touch ?? 0, customerUnik: g.reaktivasi?.customerUnik ?? 0 },
    assisted: { touch: g.assisted?.touch ?? 0, customerUnik: g.assisted?.customerUnik ?? 0 },
    touchTanpaBukti: { touch: g.touchTanpaBukti?.touch ?? 0, customerUnik: g.touchTanpaBukti?.customerUnik ?? 0 },
    biaya: ringkasBiaya(g.biaya, g.bookedValue),
    kematangan: g.biaya?.kematangan ?? null,
    sementara: sem.sementara, alasanSementara: sem.alasan,
  };
}

/** Total (semua akuisisi terbukti, termasuk UNMAPPED, tanpa UNKNOWN) dari blok ringkasan laporan. */
export function ringkasTotal(laporan) {
  const t = laporan.jumlahTeratribusi || {};
  const grup = (laporan.grup || []).filter((g) => g.status !== "UNKNOWN");
  const sum = (f) => grup.reduce((s, g) => s + (f(g) || 0), 0);
  const booked = t.bookedValue ?? 0;
  return {
    akuisisi: { leadTerbukti: t.leadUnik ?? 0, leadSah: t.leadSah ?? 0, spam: sum((g) => g.lead?.spam), pernahDitandaiProspek: sum((g) => g.pernahDitandaiProspek?.jumlah) },
    order: {
      customerBerOrder: t.customerDenganOrder ?? 0, jumlahOrderEligible: t.orderEligible ?? 0, nilaiOrder: booked,
      customerPernahMembayar: t.customerPernahMembayar ?? 0, orderPernahDp: t.orderPernahDp ?? 0,
      customerLunasTerbuktiLedger: t.closingUtama?.customerLunasTerbuktiLedger ?? 0, orderLunasTerbuktiLedger: t.closingUtama?.orderLunasTerbuktiLedger ?? 0,
      customerLunasMenurutCrm: t.customerLunasMenurutCrm ?? 0,
    },
    uang: { uangLedger: t.uangLedger ?? 0, refundDisetujui: t.refundDisetujui ?? 0, uangLedgerBersih: t.uangBersihLedger ?? 0 },
    biaya: ringkasBiaya(laporan.biaya, booked),
  };
}

// ── PERINGKAT ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * MURNI. Urutkan baris ringkas menurut kriteria "terbaik dulu". Seri → peringkat sama (competition ranking); pemecah seri deterministik
 * (lunas ledger → pernah membayar → ber-order → lead → kunci) hanya mengatur URUTAN TAMPIL, bukan peringkat.
 * Nilai null → tanpa peringkat (alasan disertakan) dan diletakkan di akhir; nol yang sah tetap diperingkat.
 */
export function susunPeringkat(baris, kriteria) {
  const k = KRITERIA_URUT[kriteria];
  if (!k) throw new ParameterError(`urutkan harus salah satu: ${DAFTAR_KRITERIA.join(", ")}`);
  const nilai = (b) => { const v = k.ambil(b); return v === null || v === undefined ? null : Number(v); };
  const pemecah = (a, b) =>
    (b.order.customerLunasTerbuktiLedger - a.order.customerLunasTerbuktiLedger) || (b.order.customerPernahMembayar - a.order.customerPernahMembayar) ||
    (b.order.customerBerOrder - a.order.customerBerOrder) || (b.akuisisi.leadTerbukti - a.akuisisi.leadTerbukti) || (a.kunci < b.kunci ? -1 : a.kunci > b.kunci ? 1 : 0);
  const ada = baris.filter((b) => nilai(b) !== null);
  const tanpa = baris.filter((b) => nilai(b) === null);
  ada.sort((a, b) => (k.arah === "asc" ? nilai(a) - nilai(b) : nilai(b) - nilai(a)) || pemecah(a, b));
  let peringkat = 0, sebelumnya;
  const hasil = ada.map((b, i) => {
    const v = nilai(b);
    if (i === 0 || v !== sebelumnya) { peringkat = i + 1; sebelumnya = v; }
    return { ...b, peringkat, nilaiKriteria: v };
  });
  tanpa.sort(pemecah);
  for (const b of tanpa) hasil.push({ ...b, peringkat: null, nilaiKriteria: null, alasanTanpaPeringkat: k.alasan ? k.alasan(b) : "TIDAK_TERSEDIA" });
  const semuaNol = ada.length > 0 && ada.every((b) => nilai(b) === 0);
  return { baris: hasil, kriteria: { id: kriteria, label: k.label, arah: k.arah === "asc" ? "terendah = terbaik" : "tertinggi = terbaik" }, semuaNol };
}

const ringkasPeringatan = (laporan) => (laporan.peringatan || []).map(({ kode, pesan, data }) => ({ kode, pesan, ...(data ? { data } : {}) }));

const ringkasSpend = (laporan) => {
  const b = laporan.biaya || {};
  const k = b.kesegaran || {};
  return {
    sumberTerhubung: !!b.sumber?.terhubung, spendTotal: b.spendTotal ?? null, spendTidakTerpetakan: b.spendTidakTerpetakan ?? 0,
    adTidakTerpetakan: (b.spendUnmapped || []).slice(0, MAKS_BARIS_TIDAK_TERPETAKAN),
    terakhirTanggalSpend: k.terakhirTanggal ?? null, tertinggalHari: k.tertinggalHari ?? null, terlambat: k.terlambat ?? false,
    hariHilang: Array.isArray(k.hariHilang) ? k.hariHilang : null, termasukHariBerjalan: k.termasukHariBerjalan ?? false,
  };
};

const ringkasRekon = (laporan) => ({ ok: !!laporan.rekonsiliasi?.ok, jumlahCek: laporan.rekonsiliasi?.cek?.length ?? 0, gagal: (laporan.rekonsiliasi?.cek || []).filter((c) => !c.ok).map((c) => c.id) });

/**
 * MURNI. Laporan mentah (hasil hitungLaporanIklan) → jawaban tool performa campaign/ad set/ad.
 * UNMAPPED dan UNKNOWN TIDAK diperingkat tetapi SELALU tampil (tidakTerpetakan / unknown); total memuat UNMAPPED, tidak memuat UNKNOWN.
 */
export function susunPerforma(laporan, { urutkan = "customer_lunas_ledger", batas = BATAS_BARIS_BAWAAN } = {}) {
  const semua = (laporan.grup || []).map(ringkasBaris);
  const terpetakan = semua.filter((b) => b.status === "MAPPED");
  const tidakTerpetakan = semua.filter((b) => b.status === "UNMAPPED");
  const unknown = semua.find((b) => b.status === "UNKNOWN") ?? null;
  const p = susunPeringkat(terpetakan, urutkan);
  const dipotong = p.baris.length > batas;
  const level = laporan.rentangLead?.level;
  const peringatan = ringkasPeringatan(laporan);
  if (p.semuaNol) peringatan.push({ kode: "TIDAK_ADA_PEMENANG", pesan: `Semua baris bernilai 0 pada kriteria '${urutkan}': peringkat 1 bersama bukan pemenang.` });
  if (dipotong) peringatan.push({ kode: "BARIS_DIPOTONG", pesan: `Hanya ${batas} dari ${p.baris.length} baris terpetakan yang ditampilkan; Total tetap mencakup semuanya. Naikkan 'batas' (maks ${BATAS_BARIS_MAKS}) atau persempit dengan campaignId/adSetId.` });
  return {
    versi: 1,
    sumberData: "Service atribusi yang sama dengan GET /api/atribusi/iklan (hitungLaporanIklan); tidak ada tracking kedua.",
    snapshot: {
      dihitungPadaUtc: laporan.dihitungPada, dihitungPadaWib: wibStr(laporan.dihitungPada), hariIniWib: laporan.hariIni ?? null,
      cutoffPembayaran: "Semua pembayaran ledger sah yang tercatat sampai waktu dihitung (hasil kohort lead di periode ini, bertambah seiring waktu).",
    },
    periodeLead: { dari: laporan.rentangLead.dari, sampai: laporan.rentangLead.sampai, zonaWaktu: "WIB", level, filter: laporan.rentangLead.filter ?? null, bawaan: !!laporan.rentangLead.bawaan, termasukHariBerjalan: laporan.periode?.termasukHariBerjalan ?? false, periodePenuh: laporan.periode?.penuh ?? null },
    atribusiMulaiWib: laporan.atribusi?.attributionStartWib ?? null,
    urutan: { ...p.kriteria, peringkat: "seri = peringkat sama; UNMAPPED/UNKNOWN tidak diperingkat" },
    total: ringkasTotal(laporan),
    baris: p.baris.slice(0, batas),
    jumlahBarisTerpetakan: p.baris.length,
    terpotong: dipotong,
    tidakTerpetakan: tidakTerpetakan.slice(0, MAKS_BARIS_TIDAK_TERPETAKAN),
    unknown,
    adIdTidakTerpetakan: (laporan.tidakTerpetakan?.adIds || []).slice(0, MAKS_BARIS_TIDAK_TERPETAKAN),
    cakupanAtribusi: laporan.cakupan ?? null,
    rekonMetaAds: laporan.rekonMetaAds ?? null,
    spend: ringkasSpend(laporan),
    rekonsiliasi: ringkasRekon(laporan),
    peringatan,
    definisi: DEFINISI,
  };
}

// ── PEMUAT ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Parameter tool → parameter service (validasi sama dengan endpoint). */
export function parameterPerforma(arg = {}, now = new Date()) {
  const q = { dari: arg.dari, sampai: arg.sampai, level: arg.level, campaignId: arg.campaignId, adSetId: arg.adSetId };
  for (const k of Object.keys(q)) if (q[k] === undefined || q[k] === null || q[k] === "") delete q[k];
  return parseParameterIklan(q, now);
}

export async function laporanPerforma(db, arg = {}, { now = new Date(), hitung = hitungLaporanIklan } = {}) {
  const urutkan = arg.urutkan ?? "customer_lunas_ledger";
  if (!KRITERIA_URUT[urutkan]) throw new ParameterError(`urutkan harus salah satu: ${DAFTAR_KRITERIA.join(", ")}`);
  const batas = Math.min(Math.max(Math.floor(Number(arg.batas ?? BATAS_BARIS_BAWAAN)) || BATAS_BARIS_BAWAAN, 1), BATAS_BARIS_MAKS);
  const parameter = parameterPerforma(arg, now);
  const laporan = await denganAntrean(() => hitung(db, parameter, { now }));
  return susunPerforma(laporan, { urutkan, batas });
}

// ── REKAP HARIAN ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Metrik aditif yang boleh dijumlahkan lintas hari DALAM kohort tanggal-lead (tiap customer tepat satu hari lead). Dipakai hanya sebagai PEMERIKSAAN, bukan sumber akumulasi. */
const ADITIF = Object.freeze([
  ["leadTerbukti", (r) => r.akuisisi.leadTerbukti], ["spam", (r) => r.akuisisi.spam], ["customerBerOrder", (r) => r.order.customerBerOrder],
  ["jumlahOrderEligible", (r) => r.order.jumlahOrderEligible], ["customerPernahMembayar", (r) => r.order.customerPernahMembayar],
  ["customerLunasTerbuktiLedger", (r) => r.order.customerLunasTerbuktiLedger], ["nilaiOrder", (r) => r.order.nilaiOrder],
  ["uangLedgerBersih", (r) => r.uang.uangLedgerBersih], ["spend", (r) => r.biaya.spend],
]);

function statusHari({ tanggal, hariIni, atribusiMulaiHari }) {
  if (!atribusiMulaiHari || tanggal < atribusiMulaiHari) return "SEBELUM_ATRIBUSI";
  if (tanggal === atribusiMulaiHari) return "HARI_ATRIBUSI_PARSIAL";
  if (tanggal === hariIni) return "HARI_BERJALAN";
  return "PENUH";
}

/** MURNI. Satu baris harian dari laporan satu-hari. */
export function susunBarisHarian(laporan, { tanggal, hariIni }) {
  const tot = ringkasTotal(laporan);
  const grup = laporan.grup || [];
  const unk = grup.find((g) => g.status === "UNKNOWN");
  const unm = grup.find((g) => g.status === "UNMAPPED");
  const mulaiHari = laporan.atribusi?.attributionStartAt ? hariWIB(laporan.atribusi.attributionStartAt) : null;
  const umur = selisihHari(tanggal, hariIni);
  return {
    tanggal,
    statusHari: statusHari({ tanggal, hariIni, atribusiMulaiHari: mulaiHari }),
    umurKohortHari: umur,
    ...tot,
    leadUnmapped: unm?.lead?.unik ?? 0,
    leadUnknownTidakDikreditkan: unk?.lead?.unik ?? 0,
    reaktivasiTouch: grup.filter((g) => g.status !== "UNKNOWN").reduce((s, g) => s + (g.reaktivasi?.touch || 0), 0),
    rekonsiliasi: ringkasRekon(laporan),
    peringatan: ringkasPeringatan(laporan).filter((w) => ["SEBELUM_ATRIBUSI", "RENTANG_SEBELUM_ATRIBUSI", "BIAYA_SEBELUM_ATRIBUSI", "BIAYA_HARI_ATRIBUSI_PARSIAL", "SPEND_TIDAK_LENGKAP", "SPEND_HARI_BERJALAN_PARSIAL", "SPEND_TERLAMBAT", "SPEND_UNMAPPED", "AD_ID_TIDAK_TERPETAKAN", "REKONSILIASI_GAGAL"].includes(w.kode)).map((w) => w.kode),
  };
}

/** MURNI. Susun rekap dari laporan per hari + laporan akumulasi yang dihitung ULANG atas seluruh periode. */
export function susunRekapHarian({ dari, sampai, level, filter, hariIni, laporanHarian, laporanAkumulasi }) {
  const harian = laporanHarian.map(({ tanggal, laporan }) => susunBarisHarian(laporan, { tanggal, hariIni }));
  const akum = ringkasTotal(laporanAkumulasi);
  const akumBaris = { akuisisi: akum.akuisisi, order: akum.order, uang: akum.uang, biaya: akum.biaya };
  const cek = ADITIF.map(([nama, f]) => {
    const jumlah = harian.reduce((s, r) => s + (f(r) ?? 0), 0);
    const pembanding = f(akumBaris);
    // spend akumulasi null (mis. periode memuat hari berjalan) tidak diperiksa: akumulasi sengaja tidak dihitung dari harian.
    if (nama === "spend" && (pembanding === null || pembanding === undefined)) return { metrik: nama, ok: null, jumlahHarian: r2(jumlah), akumulasi: null, catatan: "spend akumulasi tidak tersedia" };
    return { metrik: nama, ok: Math.abs(jumlah - (pembanding ?? 0)) < 0.005, jumlahHarian: r2(jumlah), akumulasi: r2(pembanding) };
  });
  const peringatan = ringkasPeringatan(laporanAkumulasi);
  if (cek.some((c) => c.ok === false)) peringatan.push({ kode: "REKAP_TIDAK_COCOK", pesan: "Σ harian tidak sama dengan akumulasi dihitung-ulang pada metrik aditif; jangan pakai angka ini.", data: { metrik: cek.filter((c) => c.ok === false).map((c) => c.metrik) } });
  return {
    versi: 1,
    sumberData: "Service atribusi yang sama dengan GET /api/atribusi/iklan; satu perhitungan penuh per hari + satu perhitungan penuh atas seluruh periode.",
    tampilan: "KOHORT_AKUISISI",
    penjelasanTampilan: "Baris harian = lead yang MASUK pada tanggal itu (tanggal lead WIB), dengan hasil order/pembayaran SAMPAI cutoff snapshot — bukan aktivitas kalender hari itu. Hari lebih baru berumur lebih muda: hasilnya masih bertambah.",
    snapshot: { dihitungPadaUtc: laporanAkumulasi.dihitungPada, dihitungPadaWib: wibStr(laporanAkumulasi.dihitungPada), hariIniWib: hariIni, cutoffPembayaran: "Semua pembayaran ledger sah tercatat sampai waktu dihitung." },
    periodeLead: { dari, sampai, zonaWaktu: "WIB", level, filter: filter ?? null },
    harian,
    akumulasi: { catatan: "Dihitung ULANG dari data sumber atas seluruh periode (customer unik periode); bukan penjumlahan angka/persentase harian.", ...akumBaris },
    pemeriksaanAditif: { catatan: "Dalam kohort tanggal-lead tiap customer berada di tepat satu hari, jadi hitungan customer/order/uang/spend harian harus sama dengan akumulasi. KPI (CPA, ROAS, persen) TIDAK dijumlahkan.", cek },
    spend: ringkasSpend(laporanAkumulasi),
    peringatan,
    definisi: DEFINISI,
  };
}

function* hariDalam(dari, sampai) {
  for (let h = dari; h <= sampai; h = geserHari(h, 1)) yield h;
}

export async function rekapHarian(db, arg = {}, { now = new Date(), hitung = hitungLaporanIklan } = {}) {
  const level = arg.campaignId ? "adset" : "campaign";
  const akumParam = parameterPerforma({ dari: arg.dari, sampai: arg.sampai, level, campaignId: arg.campaignId }, now);
  const n = selisihHari(akumParam.dari, akumParam.sampai) + 1;
  if (n > MAKS_HARI_REKAP) throw new ParameterError(`Rekap harian paling lama ${MAKS_HARI_REKAP} hari (satu perhitungan penuh per hari); untuk periode lebih panjang pakai performa_campaign_meta`);
  const laporanHarian = [];
  for (const tanggal of hariDalam(akumParam.dari, akumParam.sampai)) {
    const p = parameterPerforma({ dari: tanggal, sampai: tanggal, level, campaignId: arg.campaignId }, now);
    laporanHarian.push({ tanggal, laporan: await denganAntrean(() => hitung(db, p, { now })) });
  }
  const laporanAkumulasi = await denganAntrean(() => hitung(db, akumParam, { now }));
  return susunRekapHarian({ dari: akumParam.dari, sampai: akumParam.sampai, level, filter: akumParam.filter, hariIni: akumParam.hariIni, laporanHarian, laporanAkumulasi });
}

// ── KESEHATAN & COVERAGE ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const JUMLAH_ADITIF_LEVEL = Object.freeze([
  ["leadTerbukti", (t) => t.akuisisi.leadTerbukti], ["customerBerOrder", (t) => t.order.customerBerOrder], ["jumlahOrderEligible", (t) => t.order.jumlahOrderEligible],
  ["customerPernahMembayar", (t) => t.order.customerPernahMembayar], ["customerLunasTerbuktiLedger", (t) => t.order.customerLunasTerbuktiLedger],
  ["nilaiOrder", (t) => t.order.nilaiOrder], ["uangLedgerBersih", (t) => t.uang.uangLedgerBersih],
]);

/**
 * MURNI. Rekonsiliasi campaign → ad set → ad pada snapshot yang sama: untuk tiap level, Σ baris (tanpa UNKNOWN) harus = total; dan total
 * ketiga level harus sama satu sama lain (customer tidak dihitung ganda, tidak ada yang hilang).
 */
export function rekonsiliasiLintasLevel(laporanPerLevel) {
  const level = Object.keys(laporanPerLevel);
  const totals = Object.fromEntries(level.map((l) => [l, ringkasTotal(laporanPerLevel[l])]));
  const jumlahBaris = Object.fromEntries(level.map((l) => {
    const baris = (laporanPerLevel[l].grup || []).filter((g) => g.status !== "UNKNOWN").map(ringkasBaris);
    return [l, baris];
  }));
  const cek = [];
  for (const [nama, f] of JUMLAH_ADITIF_LEVEL) {
    for (const l of level) {
      const sigma = jumlahBaris[l].reduce((s, b) => s + (f(b) ?? 0), 0);
      cek.push({ id: `sigma_baris_${l}_${nama}`, ok: Math.abs(sigma - f(totals[l])) < 0.005, a: r2(sigma), b: r2(f(totals[l])) });
    }
    for (let i = 1; i < level.length; i++) cek.push({ id: `total_${level[0]}_vs_${level[i]}_${nama}`, ok: Math.abs(f(totals[level[0]]) - f(totals[level[i]])) < 0.005, a: r2(f(totals[level[0]])), b: r2(f(totals[level[i]])) });
  }
  for (const l of level) { const s = jumlahBaris[l].reduce((x, b) => x + (b.biaya.spend ?? 0), 0); const tot = totals[l].biaya.spend ?? 0; cek.push({ id: `sigma_baris_${l}_spend`, ok: Math.abs(s - tot) < 0.005, a: r2(s), b: r2(tot) }); }
  return { ok: cek.every((c) => c.ok), jumlahCek: cek.length, gagal: cek.filter((c) => !c.ok), level };
}

/** MURNI. Susun jawaban kesehatan & coverage. */
export function susunKesehatan({ laporan, capture, spendHarian, lintasLevel = null }) {
  const c = laporan.cakupan;
  const tot = ringkasTotal(laporan);
  const b = laporan.biaya || {};
  const k = b.kesegaran || {};
  const grupLedger = (laporan.grup || []).filter((g) => g.status !== "UNKNOWN");
  const ledgerOrderEligible = grupLedger.reduce((s, g) => s + (g.cakupanLedger?.orderEligible || 0), 0);
  const ledgerOrderBer = grupLedger.reduce((s, g) => s + (g.cakupanLedger?.orderBerLedger || 0), 0);
  return {
    versi: 1,
    sumberData: "captureHealth.js (hitungKesehatanCapture) + hitungLaporanIklan + ringkasanSpendHarian — service yang sama dengan GET /api/atribusi/iklan/kesehatan, /iklan dan /spend.",
    snapshot: { dihitungPadaUtc: laporan.dihitungPada, dihitungPadaWib: wibStr(laporan.dihitungPada) },
    periodeLead: { dari: laporan.rentangLead.dari, sampai: laporan.rentangLead.sampai, zonaWaktu: "WIB", bawaan: !!laporan.rentangLead.bawaan },
    capture: capture ? {
      captureAktif: capture.captureAktif, atribusiMulaiUtc: capture.db.touchTertua, touchTerbaruUtc: capture.db.touchTerbaru, usiaTouchTerbaruJam: capture.db.usiaTouchTerbaruJam,
      touchTotal: capture.db.touchTotal, touch24Jam: capture.db.touch24Jam, touch7Hari: capture.db.touch7Hari,
      statusCustomerTouch: capture.db.statusCustomer, auditAdReplyTanpaPenanda: capture.db.auditAdReplyTanpaPenanda,
      referensi: capture.db.referensi, pendingPemetaan: capture.db.pendingPemetaan,
      proses: { catatan: capture.proses.catatan, direkam: capture.proses.direkam, gagal: capture.proses.gagal, gagalPulih: capture.proses.gagalPulih, tertunda: capture.proses.tertunda, terakhirGagalAt: capture.proses.terakhirGagalAt },
    } : null,
    cakupanAtribusi: c ? {
      ...c,
      bacaan: `${c.denganTouchAkuisisi} dari ${c.leadBaruDalamRentang} lead baru (${c.persenDenganTouch ?? "—"}%) punya touch akuisisi terbukti; sisanya organik/non-CTWA/tanpa bukti dan TIDAK diberi kredit campaign. ${c.tidakTerpetakan} lead UNMAPPED.`,
    } : null,
    rekonMetaAds: laporan.rekonMetaAds ?? null,
    spend: {
      ...ringkasSpend(laporan),
      statusBiayaTotal: tot.biaya.status,
      tersediaDiRentang: k.adaDataDiRentang ?? false,
      harian: (spendHarian?.harian || []).map((h) => ({ tanggal: h.tanggal, spend: h.spend, spendUnmapped: h.spendUnmapped, sumber: h.sumber, jumlahAd: h.ads })),
      imporTerakhir: (spendHarian?.impor || []).slice(0, 3).map((i) => ({ sumber: i.sumber, dari: i.dari, sampai: i.sampai, baris: i.baris, diterima: i.diterima, ditolak: i.ditolak, waktu: i.waktu })),
      catatan: "Biaya manual per SUMBER (Kelola biaya iklan) bukan biaya campaign dan TIDAK masuk laporan campaign/ad set/ad.",
    },
    ledger: {
      orderEligible: ledgerOrderEligible, orderBerLedger: ledgerOrderBer, persenOrderBerLedger: ledgerOrderEligible > 0 ? Math.round((ledgerOrderBer / ledgerOrderEligible) * 1000) / 10 : null,
      catatan: "Order eligible yang punya >= 1 pembayaran sah di ledger. Order yang memang belum dibayar juga tidak punya ledger, jadi bukan semua selisih = data hilang; pembayaran di luar sistem tidak terlihat.",
    },
    kesiapanKpi: {
      atribusiSebanding: !["SEBELUM_ATRIBUSI", "HARI_ATRIBUSI_PARSIAL"].includes(tot.biaya.status),
      spendLengkap: Array.isArray(k.hariHilang) ? k.hariHilang.length === 0 && k.termasukHariBerjalan !== true : null,
      periodeMemuatHariBerjalan: k.termasukHariBerjalan ?? false,
      pemetaanLengkap: (c?.tidakTerpetakan ?? 0) === 0 && (b.spendTidakTerpetakan ?? 0) === 0,
      statusBiayaTotal: tot.biaya.status,
      bacaan: "KPI CRM (CPA/ROAS) hanya tampil bila atribusi sebanding, spend lengkap setiap hari, periode penuh (tanpa hari berjalan) dan Ad terpetakan; selain itu null dengan alasan eksplisit — bukan 0.",
    },
    rekonsiliasi: ringkasRekon(laporan),
    rekonsiliasiLintasLevel: lintasLevel,
    peringatan: ringkasPeringatan(laporan),
  };
}

export async function kesehatanAtribusi(db, arg = {}, { now = new Date(), hitung = hitungLaporanIklan } = {}) {
  const parameter = parameterPerforma({ dari: arg.dari, sampai: arg.sampai, level: "campaign" }, now);
  const periksa = arg.periksaLintasLevel === true;
  const laporan = await denganAntrean(() => hitung(db, parameter, { now }));
  let lintasLevel = null;
  if (periksa) {
    const perLevel = { campaign: laporan };
    for (const l of ["adset", "ad"]) perLevel[l] = await denganAntrean(() => hitung(db, { ...parameter, level: l }, { now }));
    lintasLevel = rekonsiliasiLintasLevel(perLevel);
  }
  const capture = await hitungKesehatanCapture(db, { now });
  const spendHarian = await ringkasanSpendHarian(db, { dari: parameter.dari, sampai: parameter.sampai });
  return susunKesehatan({ laporan, capture, spendHarian, lintasLevel });
}

export { MAKS_HARI };
