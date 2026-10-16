// ATRIBUSI META ADS FASE 3 — KPI biaya per campaign/ad set/ad. MODUL MURNI (tanpa DB): menerima laporan atribusi yang sudah disusun + agregat spend, mengisi `biaya` tiap baris.
//
// DEFINISI (terkunci):
//   Platform conversation   : hasil percakapan versi Meta (kolom spend). BUKAN lead CRM dan tidak pernah dipakai sebagai penyebut CPL/CPA.
//   Acquisition lead        : customer dengan touch pertama kausal NEW (WEBHOOK_MEMBUAT / CLID_COCOK) — `lead.unik` pada baris laporan.
//   Qualified lead          : acquisition lead yang pernah ditandai PROSPECT (riwayat transisi) — `pernahDitandaiProspek.jumlah`.
//   Customer dengan order   : acquisition lead dengan >= 1 order eligible.
//   Closing utama           : customerLunasTerbuktiLedger.
//   Booked revenue          : nilai order eligible (bersih nota kredit). Cash/ledger revenue: ledger valid dikurangi refund disetujui (uangBersihLedger).
//   CPL = spend / acquisition lead; cost per qualified lead = spend / qualified lead; cost per customer order = spend / customer dengan order;
//   CPA utama = spend / closing utama; booked ROAS = booked value / spend; cash ROAS = uang bersih ledger / spend.
//   Penyebut 0 → nilai null dengan alasan BELUM_ADA_KONVERSI (bukan 0 / Infinity). Spend 0 → ROAS null (BELUM_ADA_SPEND).
//
// ATURAN: spend dikelompokkan menurut tanggal delivery WIB dan dipetakan ke hierarki lewat REFERENSI terkini (sama dengan lead). Ad ID tanpa referensi = SPEND_UNMAPPED.
// Sistem TIDAK mengubah iklan/budget. Warna/evaluasi hanya muncul bila target ADMIN diisi.

export const STATUS_BIAYA = Object.freeze({
  BELUM_TERHUBUNG: "BELUM_TERHUBUNG",
  DATA_BELUM_MATANG: "DATA_BELUM_MATANG",
  BELUM_ADA_KONVERSI: "BELUM_ADA_KONVERSI",
  MAPPING_BELUM_ADA: "MAPPING_BELUM_ADA",
  DATA_TERLAMBAT: "DATA_TERLAMBAT",
  TANPA_SPEND_DI_RENTANG: "TANPA_SPEND_DI_RENTANG",
  SIAP_DIEVALUASI: "SIAP_DIEVALUASI",
  // Rentang yang dimulai SEBELUM (atau pada hari parsial) awal atribusi: spend tercatat untuk audit, tetapi lead/closing berbasis touch belum sebanding.
  SEBELUM_ATRIBUSI: "SEBELUM_ATRIBUSI",
  HARI_ATRIBUSI_PARSIAL: "HARI_ATRIBUSI_PARSIAL",
});
export const EVALUASI_TIDAK_SEBANDING = Object.freeze({
  SEBELUM_ATRIBUSI: "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI",
  HARI_ATRIBUSI_PARSIAL: "TIDAK_DAPAT_DIEVALUASI_HARI_ATRIBUSI_PARSIAL",
});

/**
 * Apakah rentang laporan sebanding dengan data atribusi? `mulaiHari` = hari WIB (YYYY-MM-DD) touch pertama tersimpan (null = belum ada touch).
 * dari < mulaiHari  -> SEBELUM_ATRIBUSI (lead pada hari itu tidak punya touch: 0 lead BUKAN performa nol).
 * dari = mulaiHari  -> HARI_ATRIBUSI_PARSIAL (touch baru ada sejak jam awal atribusi; spend hari itu penuh).
 * Mengembalikan null bila sebanding.
 */
export function ketidaksebandingan({ dari, mulaiHari }) {
  if (!mulaiHari) return "SEBELUM_ATRIBUSI";
  if (dari < mulaiHari) return "SEBELUM_ATRIBUSI";
  if (dari === mulaiHari) return "HARI_ATRIBUSI_PARSIAL";
  return null;
}
export const EVALUASI = Object.freeze({ DATA_KURANG: "DATA_KURANG", PANTAU: "PANTAU", BAIK: "BAIK", PERLU_REVIEW: "PERLU_REVIEW" });
export const BATAS_TERLAMBAT_HARI = 2;      // spend terbaru boleh tertinggal sampai 2 hari WIB dari hari ini
export const UMUR_MATANG_BAWAAN_HARI = 30;  // hanya untuk label kematangan bila target umur kohort belum diisi (BUKAN target mutu)

export const TARGET_KOSONG = Object.freeze({
  maxCpl: null, maxCostPerQualifiedLead: null, maxCostPerCustomerOrder: null, maxCpaClosing: null,
  minBookedRoas: null, minCashRoas: null, minAcquisitionLeads: null, minClosings: null, minCohortAgeDays: null, maxSpamSharePercent: null,
});

const rp = (x) => Math.round((Number(x) || 0) * 100) / 100;
const n2 = (x) => (x === null || x === undefined ? null : Math.round(Number(x) * 100) / 100);

/** Nilai KPI + alasan penyebut/pembilang kosong. */
function bagi(pembilang, penyebut, { alasanPenyebut = "BELUM_ADA_KONVERSI", nolPembilang = true } = {}) {
  if (pembilang === null || pembilang === undefined) return { nilai: null, alasan: "BELUM_ADA_SPEND" };
  if (!(penyebut > 0)) return { nilai: null, alasan: alasanPenyebut };
  if (!nolPembilang && !(pembilang > 0)) return { nilai: null, alasan: "BELUM_ADA_SPEND" };
  return { nilai: n2(pembilang / penyebut), alasan: null };
}

/** Target dari baris DB / objek → angka atau null. */
export function normalisasiTarget(t) {
  const o = { ...TARGET_KOSONG };
  if (!t) return o;
  for (const k of Object.keys(TARGET_KOSONG)) {
    const v = t[k];
    o[k] = v === null || v === undefined || v === "" ? null : Number(v);
    if (o[k] !== null && !Number.isFinite(o[k])) o[k] = null;
  }
  return o;
}
export const adaTarget = (t) => Object.values(t).some((v) => v !== null);

/** Jendela kematangan yang dipakai: hari7|hari30|hari60 (terkecil yang >= umur). */
export function kunciKematangan(umurHari) {
  const u = umurHari ?? UMUR_MATANG_BAWAAN_HARI;
  return u <= 7 ? "hari7" : u <= 30 ? "hari30" : "hari60";
}

/** Selisih hari kalender antara dua string YYYY-MM-DD. */
const selisihHari = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * Kesegaran spend. `spend.terakhirTanggal` = tanggal WIB spend terbaru di DB (sumber manapun). `hariIni` = YYYY-MM-DD WIB.
 */
export function kesegaranSpend({ terakhirTanggal, terakhirImportAt, adaDataDiRentang, hariIni, sampai }) {
  if (!terakhirTanggal) return { tersedia: false, terakhirTanggal: null, terakhirImportAt: null, tertinggalHari: null, terlambat: false, adaDataDiRentang: false };
  const tertinggal = selisihHari(hariIni, terakhirTanggal);
  return {
    tersedia: true, terakhirTanggal, terakhirImportAt: terakhirImportAt ?? null,
    tertinggalHari: tertinggal, batasHari: BATAS_TERLAMBAT_HARI,
    // terlambat bila rentang meminta hari yang belum ada datanya DAN ketertinggalan melewati batas
    terlambat: tertinggal > BATAS_TERLAMBAT_HARI && sampai > terakhirTanggal,
    adaDataDiRentang: !!adaDataDiRentang,
  };
}

/** Evaluasi terhadap target ADMIN. Tidak ada target → null (tanpa warna). Hanya label; tidak pernah mengubah iklan. */
export function evaluasiTarget({ target, statusBiaya, metrik, lead, spamSharePercent, closings }) {
  if (!adaTarget(target)) return { status: null, alasan: "TARGET_BELUM_DIATUR", pelanggaran: [] };
  if (statusBiaya !== STATUS_BIAYA.SIAP_DIEVALUASI) return { status: EVALUASI.DATA_KURANG, alasan: statusBiaya, pelanggaran: [] };
  if (target.minAcquisitionLeads !== null && lead < target.minAcquisitionLeads) return { status: EVALUASI.DATA_KURANG, alasan: "LEAD_DI_BAWAH_MINIMUM", pelanggaran: [] };
  if (target.minClosings !== null && closings < target.minClosings) return { status: EVALUASI.DATA_KURANG, alasan: "CLOSING_DI_BAWAH_MINIMUM", pelanggaran: [] };
  const cek = [
    ["cpl", metrik.cpl, target.maxCpl, "maks"], ["costPerQualifiedLead", metrik.costPerQualifiedLead, target.maxCostPerQualifiedLead, "maks"],
    ["costPerCustomerOrder", metrik.costPerCustomerOrder, target.maxCostPerCustomerOrder, "maks"], ["cpaClosing", metrik.cpaClosing, target.maxCpaClosing, "maks"],
    ["bookedRoas", metrik.bookedRoas, target.minBookedRoas, "min"], ["cashRoas", metrik.cashRoas, target.minCashRoas, "min"],
  ];
  const pelanggaran = []; let kosong = 0; let diperiksa = 0;
  for (const [nama, nilai, batas, jenis] of cek) {
    if (batas === null) continue;
    diperiksa++;
    if (nilai === null) { kosong++; continue; }
    if (jenis === "maks" ? nilai > batas : nilai < batas) pelanggaran.push({ metrik: nama, nilai, batas, jenis });
  }
  if (target.maxSpamSharePercent !== null && spamSharePercent !== null) {
    diperiksa++;
    if (spamSharePercent > target.maxSpamSharePercent) pelanggaran.push({ metrik: "spamShare", nilai: spamSharePercent, batas: target.maxSpamSharePercent, jenis: "maks" });
  }
  if (pelanggaran.length) return { status: EVALUASI.PERLU_REVIEW, alasan: "MELANGGAR_TARGET", pelanggaran };
  if (kosong > 0) return { status: EVALUASI.PANTAU, alasan: "SEBAGIAN_METRIK_BELUM_ADA_KONVERSI", pelanggaran: [] };
  if (diperiksa === 0) return { status: EVALUASI.PANTAU, alasan: "TARGET_TIDAK_RELEVAN", pelanggaran: [] };
  return { status: EVALUASI.BAIK, alasan: "SEMUA_TARGET_TERPENUHI", pelanggaran: [] };
}

/**
 * Hitung blok `biaya` satu baris.
 * @param {object} p
 *   baris   : baris laporan (lead, pernahDitandaiProspek, customerDenganOrder, orderEligible, closingUtama, bookedValue, uangBersihLedger, kematangan, status)
 *   spend   : null (tidak ada baris spend) | { spend, platformConversations, impressions, linkClicks, hariAdaSpend }
 *   konteks : { sumberTerhubung, kesegaran, target, hariKematangan }
 */
export function hitungBiayaBaris({ baris, spend, konteks }) {
  const { sumberTerhubung, kesegaran, target } = konteks;
  const tidakSebanding = sumberTerhubung ? (konteks.tidakSebanding ?? null) : null;
  const lead = baris.lead?.unik ?? 0;
  const qualified = baris.pernahDitandaiProspek?.jumlah ?? 0;
  const custOrder = baris.customerDenganOrder ?? 0;
  const closing = baris.closingUtama?.customerLunasTerbuktiLedger ?? 0;
  const booked = baris.bookedValue ?? 0;
  const cash = baris.uangBersihLedger ?? 0;
  const spamShare = lead > 0 ? n2(((baris.lead?.spam ?? 0) / lead) * 100) : null;
  const unmappedAtauUnknown = baris.status === "UNMAPPED" || baris.status === "UNKNOWN";

  const S = spend ? rp(spend.spend) : null;
  const metrik = {
    cpl: bagi(S, lead).nilai,
    costPerQualifiedLead: bagi(S, qualified).nilai,
    costPerCustomerOrder: bagi(S, custOrder).nilai,
    cpaClosing: bagi(S, closing).nilai,
    bookedRoas: S === null ? null : (S > 0 ? n2(booked / S) : null),
    cashRoas: S === null ? null : (S > 0 ? n2(cash / S) : null),
  };
  const alasan = {
    cpl: bagi(S, lead).alasan, costPerQualifiedLead: bagi(S, qualified).alasan, costPerCustomerOrder: bagi(S, custOrder).alasan, cpa: bagi(S, closing).alasan,
    bookedRoas: S === null ? "BELUM_ADA_SPEND" : S > 0 ? null : "SPEND_NOL", cashRoas: S === null ? "BELUM_ADA_SPEND" : S > 0 ? null : "SPEND_NOL",
  };
  for (const k of Object.keys(metrik)) if (metrik[k] !== null) alasan[k] = null;
  // sebelum/awal atribusi: tidak ada CPL/CPA/ROAS berbasis CRM (denominator lead tanpa touch bukan "nol performa"); spend dan konversasi platform tetap tampil
  if (tidakSebanding) {
    for (const k of Object.keys(metrik)) { metrik[k] = null; alasan[k === "cpaClosing" ? "cpa" : k] = tidakSebanding; }
  }

  // kematangan: semua lead sah harus berumur >= umur jendela
  const kunciMatang = kunciKematangan(target.minCohortAgeDays);
  const leadMatang = baris.kematangan?.[kunciMatang]?.leadMatang ?? 0;
  const leadSah = baris.lead?.leadSah ?? 0;
  const matang = leadSah === 0 || leadMatang >= leadSah;

  let status;
  if (!sumberTerhubung) status = STATUS_BIAYA.BELUM_TERHUBUNG;
  else if (tidakSebanding) status = STATUS_BIAYA[tidakSebanding];
  else if (unmappedAtauUnknown) status = STATUS_BIAYA.MAPPING_BELUM_ADA;
  else if (kesegaran.terlambat) status = STATUS_BIAYA.DATA_TERLAMBAT;
  else if (S === null) status = STATUS_BIAYA.TANPA_SPEND_DI_RENTANG;
  else if (lead === 0) status = STATUS_BIAYA.BELUM_ADA_KONVERSI;
  else if (!matang) status = STATUS_BIAYA.DATA_BELUM_MATANG;
  else status = STATUS_BIAYA.SIAP_DIEVALUASI;

  const evaluasi = tidakSebanding
    ? { status: EVALUASI_TIDAK_SEBANDING[tidakSebanding], alasan: tidakSebanding, pelanggaran: [] }
    : evaluasiTarget({ target, statusBiaya: status, metrik, lead, spamSharePercent: spamShare, closings: closing });
  return {
    status,
    spend: S,
    platformConversations: spend ? (spend.platformConversations ?? null) : null,
    platformConversationsCatatan: "hasil percakapan versi Meta; BUKAN lead CRM",
    impressions: spend ? (spend.impressions ?? null) : null,
    linkClicks: spend ? (spend.linkClicks ?? null) : null,
    hariAdaSpend: spend ? spend.hariAdaSpend : 0,
    cpl: metrik.cpl, costPerQualifiedLead: metrik.costPerQualifiedLead, costPerCustomerOrder: metrik.costPerCustomerOrder, cpa: metrik.cpaClosing,
    bookedRoas: metrik.bookedRoas, cashRoas: metrik.cashRoas,
    alasanNull: alasan,
    ...(tidakSebanding ? { catatanPembanding: "Rentang dimulai sebelum/pada hari awal atribusi: lead berbasis touch belum sebanding dengan spend. 0 lead di sini BUKAN performa nol; CPL/CPA/ROAS CRM tidak dihitung." } : {}),
    penyebut: { acquisitionLead: lead, qualifiedLead: qualified, customerDenganOrder: custOrder, closingUtama: closing, bookedValue: booked, uangBersihLedger: cash },
    spamSharePercent: spamShare,
    kematangan: { jendela: kunciMatang, leadMatang, leadSah, matang },
    kesegaranSpend: { terakhirTanggal: kesegaran.terakhirTanggal, tertinggalHari: kesegaran.tertinggalHari, terlambat: kesegaran.terlambat },
    evaluasi,
  };
}

/** Baris laporan kosong (semua angka 0) untuk entitas yang punya spend tetapi belum punya lead. */
export function barisKosong({ level, kunci, ref }) {
  const nol = { jumlah: 0, nilai: 0, tanggalTidakPasti: 0 };
  return {
    kunci, level, status: "MAPPED", kreditCampaign: true,
    campaign: ref ? { id: ref.campaignId, nama: ref.campaignName ?? null } : { id: level === "campaign" ? kunci : null, nama: null },
    adSet: level === "campaign" ? null : { id: level === "adset" ? kunci : (ref?.adSetId ?? null), nama: ref?.adSetName ?? null },
    ad: level === "ad" ? { id: kunci, nama: ref?.adName ?? null } : null,
    jumlahAd: 0,
    lead: { unik: 0, spam: 0, bukanSpam: 0, leadSah: 0, dikecualikan: { SPAM: 0, B2B_DIRECT: 0, INTERNAL_STAFF: 0, PROFIL_KARYAWAN: 0 } },
    closingUtama: { definisi: "customer dengan >= 1 order eligible lunas terbukti ledger", customerLunasTerbuktiLedger: 0, persenDariLeadSah: null, orderLunasTerbuktiLedger: 0, perBulanLunasPertama: {} },
    pernahDitandaiProspek: { berTanggal: 0, tanpaTanggal: 0, jumlah: 0 },
    customerDenganOrder: 0, orderEligible: 0, orderPernahDp: 0, orderDpSaatIniLedger: 0, customerLunasMenurutCrm: 0, lunasMenurutCrm: nol,
    lunasTerbuktiLedger: { jumlah: 0, nilai: 0 }, buktiPelunasan: {}, bookedValue: 0, uangLedger: 0, refundDisetujui: 0, uangBersihLedger: 0,
    cakupanLedger: { orderBerLedger: 0, orderEligible: 0, persenOrderBerLedger: null },
    kematangan: { hari7: { leadMatang: 0 }, hari30: { leadMatang: 0 }, hari60: { leadMatang: 0 } },
    sentuhanBerikutnya: { touch: 0, customerUnik: 0 }, reaktivasi: { touch: 0, customerUnik: 0 }, assisted: { touch: 0, customerUnik: 0 }, touchTanpaBukti: { touch: 0, customerUnik: 0 },
    hanyaSpend: true,
  };
}

/**
 * Terapkan spend ke laporan. `spendPerAd`: Array<{ adId, spend, platformConversations, impressions, linkClicks, hariAdaSpend }> (sudah satu sumber per hari).
 * Mengubah `laporan.grup[*].biaya`, menambah baris kosong untuk entitas yang hanya punya spend, mengisi `laporan.biaya` (ringkasan) dan peringatan.
 * Mengembalikan laporan yang sama (dimutasi).
 */
export function terapkanBiaya(laporan, { spendPerAd, referensi, kesegaran, target, hariIni, ringkasanImport = null, mulaiHari = undefined }) {
  const level = laporan.rentangLead.level;
  const filter = laporan.rentangLead.filter || null;
  const sumberTerhubung = (spendPerAd?.length ?? 0) > 0 || !!(kesegaran && kesegaran.tersedia);
  const lolos = (r) => !filter || (r && (!filter.campaignId || r.campaignId === filter.campaignId) && (!filter.adSetId || r.adSetId === filter.adSetId));

  // kelompokkan spend per kunci baris (sama dengan kunci grup laporan)
  const perKunci = new Map();
  const tambah = (k, s) => {
    const a = perKunci.get(k) || { spend: 0, platformConversations: null, impressions: null, linkClicks: null, hariAdaSpend: 0, adIds: new Set() };
    a.spend = rp(a.spend + s.spend);
    for (const f of ["platformConversations", "impressions", "linkClicks"]) if (s[f] !== null && s[f] !== undefined) a[f] = (a[f] ?? 0) + Number(s[f]);
    a.hariAdaSpend = Math.max(a.hariAdaSpend, s.hariAdaSpend ?? 0);
    a.adIds.add(s.adId);
    perKunci.set(k, a);
  };
  let spendTidakTerpetakan = 0; const adIdTidakTerpetakan = new Map();
  let spendDalamFilter = 0;
  for (const s of spendPerAd || []) {
    const r = referensi.get(s.adId) || null;
    if (!r) {
      if (filter) continue;                       // drilldown hanya Ad yang referensinya cocok (tanpa tebakan)
      spendTidakTerpetakan = rp(spendTidakTerpetakan + s.spend);
      adIdTidakTerpetakan.set(s.adId, rp((adIdTidakTerpetakan.get(s.adId) || 0) + s.spend));
      tambah(level === "ad" ? s.adId : "UNMAPPED", s);
      continue;
    }
    if (!lolos(r)) continue;
    spendDalamFilter = rp(spendDalamFilter + s.spend);
    tambah(level === "ad" ? s.adId : level === "adset" ? r.adSetId : r.campaignId, s);
  }

  const ada = new Set(laporan.grup.map((g) => g.kunci));
  for (const [k, a] of perKunci) {
    if (ada.has(k)) continue;
    const sampelAd = [...a.adIds][0];
    const ref = referensi.get(sampelAd) || null;
    const kosong = barisKosong({ level, kunci: k, ref });
    if (k === "UNMAPPED") { kosong.status = "UNMAPPED"; kosong.kreditCampaign = false; kosong.campaign = null; kosong.adSet = null; kosong.ad = null; }
    else if (!ref) { kosong.status = "UNMAPPED"; kosong.kreditCampaign = false; kosong.campaign = null; kosong.adSet = null; kosong.ad = level === "ad" ? { id: k, nama: null } : null; }
    laporan.grup.push(kosong);
  }

  // mulaiHari undefined = tidak diketahui pemanggil (tes lama) -> dianggap sebanding
  const tidakSebanding = mulaiHari === undefined ? null : ketidaksebandingan({ dari: laporan.rentangLead.dari, mulaiHari });
  const konteks = { sumberTerhubung, kesegaran, target, tidakSebanding };
  for (const g of laporan.grup) {
    const a = g.status === "UNKNOWN" ? null : perKunci.get(g.kunci) || null;
    g.biaya = hitungBiayaBaris({ baris: g, spend: a ? { spend: a.spend, platformConversations: a.platformConversations, impressions: a.impressions, linkClicks: a.linkClicks, hariAdaSpend: a.hariAdaSpend } : null, konteks });
    if (g.hanyaSpend) g.jumlahAd = perKunci.get(g.kunci)?.adIds.size ?? 0;
  }
  laporan.grup.sort((x, y) => (y.lead.unik - x.lead.unik) || ((y.biaya.spend ?? 0) - (x.biaya.spend ?? 0)) || (x.kunci < y.kunci ? -1 : 1));
  laporan.jumlahGrup = laporan.grup.length;

  // ringkasan total (penyebut = akuisisi terbukti; spend = seluruh spend dalam rentang/filter termasuk SPEND_UNMAPPED)
  const spendTotal = filter ? spendDalamFilter : rp([...perKunci.values()].reduce((s, a) => s + a.spend, 0));
  const t = laporan.jumlahTeratribusi;
  const totalBaris = { lead: { unik: t.leadUnik, spam: laporan.grup.reduce((s, g) => s + (g.status === "UNKNOWN" ? 0 : g.lead.spam), 0), leadSah: t.leadSah }, pernahDitandaiProspek: { jumlah: laporan.grup.filter((g) => g.status !== "UNKNOWN").reduce((s, g) => s + g.pernahDitandaiProspek.jumlah, 0) }, customerDenganOrder: t.customerDenganOrder, closingUtama: { customerLunasTerbuktiLedger: t.closingUtama.customerLunasTerbuktiLedger }, bookedValue: t.bookedValue, uangBersihLedger: t.uangBersihLedger, status: "MAPPED", kematangan: laporan.grup.reduce((acc, g) => { for (const k of ["hari7", "hari30", "hari60"]) acc[k] = { leadMatang: (acc[k]?.leadMatang || 0) + (g.status === "UNKNOWN" ? 0 : g.kematangan?.[k]?.leadMatang || 0) }; return acc; }, {}) };
  const bTotal = hitungBiayaBaris({ baris: totalBaris, spend: perKunci.size ? { spend: spendTotal, hariAdaSpend: 0 } : null, konteks });
  const biayaLama = laporan.biaya || {};
  laporan.biaya = {
    ...(sumberTerhubung ? {} : { alasan: biayaLama.alasan, catatanAdSpendManual: biayaLama.catatanAdSpendManual, opsiIntegrasi: biayaLama.opsiIntegrasi, syarat: biayaLama.syarat, ekspor: biayaLama.ekspor }),
    penyebutCpa: biayaLama.penyebutCpa ?? "closingUtama.customerLunasTerbuktiLedger",
    ...bTotal,
    status: bTotal.status,
    roas: null,   // DEPRECATED (kompatibilitas klien lama): selalu null; gunakan bookedRoas dan cashRoas
    sumber: {
      terhubung: sumberTerhubung,
      terakhirTanggal: kesegaran.terakhirTanggal, terakhirImportAt: kesegaran.terakhirImportAt ?? null, tertinggalHari: kesegaran.tertinggalHari, terlambat: kesegaran.terlambat,
      catatan: "Tanggal spend = tanggal delivery pada zona waktu akun iklan; akun wajib berzona WIB (UTC+7). Hari ini dan kemarin dapat berubah karena koreksi platform.",
    },
    spendTotal, spendTidakTerpetakan, spendUnmapped: [...adIdTidakTerpetakan].map(([adId, spend]) => ({ adId, spend })).sort((a, b) => b.spend - a.spend),
    kesegaran,
    target: adaTarget(target) ? target : null,
    targetDiatur: adaTarget(target),
    definisiKpi: DEFINISI_KPI,
    ...(ringkasanImport ? { importTerakhir: ringkasanImport } : {}),
  };
  const w = (kode, pesan, data) => laporan.peringatan.push({ kode, pesan, ...(data ? { data } : {}) });
  laporan.peringatan = laporan.peringatan.filter((x) => x.kode !== "BIAYA_BELUM_TERHUBUNG");
  if (!sumberTerhubung) w("BIAYA_BELUM_TERHUBUNG", "Spend Meta belum ada di sistem (impor CSV Ads Manager atau sinkronisasi API belum berjalan): biaya, CPL, CPA, dan ROAS sengaja null.");
  else {
    if (tidakSebanding === "SEBELUM_ATRIBUSI") w("BIAYA_SEBELUM_ATRIBUSI", "Rentang dimulai sebelum atribusi tersimpan: spend dan percakapan platform ditampilkan untuk audit, tetapi CPL/CPA/ROAS berbasis CRM TIDAK dihitung dan lead 0 bukan performa nol (status evaluasi: TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI).");
    if (tidakSebanding === "HARI_ATRIBUSI_PARSIAL") w("BIAYA_HARI_ATRIBUSI_PARSIAL", "Rentang dimulai pada hari awal atribusi (touch baru ada sejak jam awal): spend hari itu penuh sedangkan lead berbasis touch parsial. CPL/CPA/ROAS CRM tidak dihitung; gunakan rentang yang dimulai hari berikutnya.");
    if (kesegaran.terlambat) w("SPEND_TERLAMBAT", `Spend terakhir tanggal ${kesegaran.terakhirTanggal} (tertinggal ${kesegaran.tertinggalHari} hari WIB); rentang meminta hari yang belum ada datanya.`, { terakhirTanggal: kesegaran.terakhirTanggal });
    if (spendTidakTerpetakan > 0) w("SPEND_UNMAPPED", `Ada spend Rp${spendTidakTerpetakan.toLocaleString("id-ID")} pada ${adIdTidakTerpetakan.size} Ad ID yang belum punya referensi Ad → Ad Set → Campaign (SPEND_UNMAPPED). Impor pemetaan untuk menutupnya.`, { adIds: adIdTidakTerpetakan.size, spend: spendTidakTerpetakan });
    if (laporan.biaya.status === STATUS_BIAYA.DATA_BELUM_MATANG) w("BIAYA_KOHORT_BELUM_MATANG", "Sebagian lead belum cukup umur: closing dan revenue masih bertambah. Jangan menilai CPA/ROAS sebelum matang.");
  }
  // rekonsiliasi spend: Σ baris = total (dalam filter)
  const sigmaBaris = rp(laporan.grup.reduce((s, g) => s + (g.biaya.spend ?? 0), 0));
  const cekSpend = { id: "spend_baris_vs_total", ok: sigmaBaris === spendTotal, a: sigmaBaris, b: spendTotal, ket: "Σ spend baris (campaign + UNMAPPED) = total spend dalam rentang/filter" };
  laporan.rekonsiliasi.cek.push(cekSpend);
  if (!cekSpend.ok) { laporan.rekonsiliasi.ok = false; w("REKONSILIASI_GAGAL", "Rekonsiliasi spend gagal; jangan pakai biaya ini.", { gagal: ["spend_baris_vs_total"] }); }
  laporan.definisi = laporan.definisi.map((d) => (d.id === "biaya" ? { id: "biaya", label: "CPL / CPA / ROAS", status: sumberTerhubung ? "SIAP" : "BELUM_ADA_DATA", definisi: DEFINISI_KPI.ringkas, tanggal: "Spend: tanggal delivery WIB; lead: tanggal lead WIB; revenue mengikuti campaign akuisisi lead.", catatan: [] } : d));
  if (hariIni) laporan.hariIni = hariIni;
  return laporan;
}

export const DEFINISI_KPI = Object.freeze({
  ringkas: "CPL = spend / acquisition lead; cost per qualified lead = spend / pernah ditandai PROSPECT; cost per customer order = spend / customer dengan order; CPA utama = spend / closing utama (customerLunasTerbuktiLedger); booked ROAS = booked value / spend; cash ROAS = uang bersih ledger / spend. Penyebut 0 → null (BELUM_ADA_KONVERSI).",
  platformConversation: "Hasil percakapan versi Meta. Bukan lead CRM dan bukan CPA customer SANSS.",
  reaktivasi: "Customer lama yang mengklik iklan lagi (EXISTING) tampil sebagai reaktivasi; tidak menambah acquisition lead dan revenue repeat tidak otomatis dikreditkan ke campaign akuisisi.",
  kohort: "Filter utama = tanggal lead. Spend pada rentang tanggal yang sama; hasil order/pembayaran mengikuti lead dan masih bertambah (lihat kematangan 7/30/60 hari). Jangan membandingkan spend hari ini dengan closing historis.",
});
