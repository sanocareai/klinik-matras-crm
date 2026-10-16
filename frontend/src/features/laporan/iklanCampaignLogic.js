// Logika MURNI tab "Iklan (Campaign)" di Laporan — tanpa React, dapat diuji di Node.
// Sumber: GET /api/atribusi/iklan (ADMIN, baca-saja). Semua angka datang dari server; di sini hanya penyusunan parameter, label, dan baris tampilan.
// ATURAN: tidak ada kredit campaign yang dihitung di klien; baris UNMAPPED dan UNKNOWN tidak pernah diberi nama campaign; nama hanya label.

export const LEVELS = ["campaign", "adset", "ad"];
export const UMUR = [{ id: "semua", label: "Semua umur" }, { id: "hari7", label: "≥ 7 hari" }, { id: "hari30", label: "≥ 30 hari" }, { id: "hari60", label: "≥ 60 hari" }];

/** Parameter query dari rentang (DateRange kanonik {from,to}), level, dan jalur drilldown. Rentang kosong → server memakai 7 hari terakhir. */
export function kueriIklan({ range, level = "campaign", campaignId = null, adSetId = null } = {}) {
  const q = { level };
  if (range?.from && range?.to) { q.dari = range.from; q.sampai = range.to; }
  if (campaignId && level !== "campaign") q.campaignId = campaignId;
  if (adSetId && level === "ad") q.adSetId = adSetId;
  return q;
}

/** Level berikutnya saat baris diklik (drilldown); null bila tidak bisa (sudah level ad, atau baris tanpa kredit campaign). */
export function drilldown(baris, level) {
  if (!baris || baris.kreditCampaign === false || baris.status !== "MAPPED") return null;
  if (level === "campaign") return { level: "adset", campaignId: baris.campaign?.id ?? null, adSetId: null };
  if (level === "adset") return { level: "ad", campaignId: baris.campaign?.id ?? null, adSetId: baris.adSet?.id ?? null };
  return null;
}

/** Nama tampilan baris: nama hanya label; selalu sertakan ID (kunci) supaya tidak ambigu. */
export function labelBaris(g) {
  if (g.status === "UNKNOWN") return { judul: "Tanpa bukti akuisisi (UNKNOWN)", sub: "Lead baru bertouch iklan, tetapi tidak terbukti dibuat oleh webhook iklan. Tidak dikreditkan ke campaign." };
  if (g.status === "UNMAPPED") return { judul: g.ad?.id ? `Ad ID ${g.ad.id} belum terpetakan` : "Ad ID belum terpetakan (UNMAPPED)", sub: "Pemetaan Ad → Ad Set → Campaign belum diimpor. Tidak ditebak dari nama." };
  const lvl = g.level;
  const nama = lvl === "campaign" ? g.campaign?.nama : lvl === "adset" ? g.adSet?.nama : g.ad?.nama;
  const id = lvl === "campaign" ? g.campaign?.id : lvl === "adset" ? g.adSet?.id : g.ad?.id;
  const induk = lvl === "campaign" ? null : lvl === "adset" ? g.campaign : (g.adSet ?? g.campaign);
  return { judul: nama || `${lvl === "campaign" ? "Campaign" : lvl === "adset" ? "Ad Set" : "Ad"} ${id}`, sub: `ID ${id}${induk?.nama ? ` · ${induk.nama}` : ""}` };
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
export const formatPersen = (v) => (v == null ? "—" : `${String(v).replace(".", ",")}%`);

/** Satu baris tabel. `umur` memilih 'semua' (dihitung dari tanggal order/bayar apa adanya) atau jendela kematangan (hanya lead berumur ≥ N hari, hasil dalam N hari). */
export function barisTabel(g, umur = "semua") {
  const k = umur === "semua" ? null : g.kematangan?.[umur];
  const leadSah = g.lead.leadSah;
  const dasar = {
    kunci: g.kunci, status: g.status, kredit: g.kreditCampaign !== false, label: labelBaris(g), bisaDrilldown: g.kreditCampaign !== false && g.status === "MAPPED" && g.level !== "ad",
    leadUnik: g.lead.unik, spam: g.lead.spam, bukanSpam: g.lead.bukanSpam, leadSah,
    prospek: g.pernahDitandaiProspek?.jumlah ?? 0,
    reaktivasi: g.reaktivasi, assisted: g.assisted, touchTanpaBukti: g.touchTanpaBukti,
    jumlahAd: g.jumlahAd,
  };
  if (!k) {
    return {
      ...dasar,
      customerOrder: g.customerDenganOrder, orderEligible: g.orderEligible, orderPernahDp: g.orderPernahDp,
      customerLunasCrm: g.customerLunasMenurutCrm, closing: g.closingUtama.customerLunasTerbuktiLedger,
      persenClosing: formatPersen(pct(g.closingUtama.customerLunasTerbuktiLedger, leadSah)),
      booked: g.bookedValue, uangLedger: g.uangLedger, cakupanLedger: g.cakupanLedger?.persenOrderBerLedger ?? null,
      leadMatang: null,
    };
  }
  return {
    ...dasar,
    customerOrder: k.customerDenganOrder, orderEligible: k.orderEligible, orderPernahDp: null,
    customerLunasCrm: null, closing: k.customerLunasTerbuktiLedger,
    persenClosing: formatPersen(pct(k.customerLunasTerbuktiLedger, k.leadMatang)),
    booked: k.bookedValue, uangLedger: k.uangLedger, cakupanLedger: null,
    leadMatang: k.leadMatang,
  };
}

/** Ringkasan rekonsiliasi untuk kartu cakupan. */
export function ringkasCakupan(lap) {
  const c = lap?.cakupan;
  if (!c) return null;
  const r = lap.rekonMetaAds;
  return {
    bagian: [
      { id: "terbukti", label: "Akuisisi terbukti (campaign + UNMAPPED)", n: c.denganTouchAkuisisi, kredit: true },
      { id: "unknown", label: "Bertouch iklan, tanpa bukti akuisisi (UNKNOWN)", n: c.leadBaruTouchTanpaBukti, kredit: false },
      { id: "sudahAda", label: "Bertouch iklan, customer sudah ada lebih dulu", n: c.leadBaruTouchPadaCustomerSudahAda, kredit: false },
      { id: "tanpa", label: "Tanpa touch iklan (organik / non-CTWA / pola teks / tanpa sourceID)", n: c.tanpaTouch, kredit: false },
    ],
    total: c.leadBaruDalamRentang,
    terpetakan: c.terpetakan, tidakTerpetakan: c.tidakTerpetakan,
    persenDenganTouch: c.persenDenganTouch,
    metaAds: r ? {
      label: r.metaAdsCrmLeadBaru, terbukti: r.akuisisiTerbukti, unknown: r.touchTanpaBukti, sudahAda: r.touchPadaCustomerSudahAda, tanpaTouch: r.tanpaTouchIklan, terbuktiBukanLabelMeta: r.akuisisiTerbuktiTetapiLabelBukanMetaAds,
    } : null,
  };
}

/** Peringatan yang selalu ditonjolkan (coverage gap), urut dari yang paling penting. */
const URUT_PERINGATAN = ["REKONSILIASI_GAGAL", "ATRIBUSI_BELUM_MULAI", "RENTANG_SEBELUM_ATRIBUSI", "AD_ID_TIDAK_TERPETAKAN", "TOUCH_TANPA_BUKTI_AKUISISI", "LEAD_TANPA_TOUCH", "KOHORT_BELUM_MATANG", "BIAYA_BELUM_TERHUBUNG"];
export function peringatanUrut(lap) {
  const w = [...(lap?.peringatan || [])];
  const idx = (k) => { const i = URUT_PERINGATAN.indexOf(k); return i < 0 ? 99 : i; };
  return w.sort((a, b) => idx(a.kode) - idx(b.kode));
}

/** Status biaya untuk tampilan. CPA/ROAS tidak pernah dihitung di klien. */
export function statusBiaya(lap) {
  const b = lap?.biaya;
  const tersambung = b?.status === "TERSAMBUNG" && b?.cpa != null;
  return { tersambung, teks: tersambung ? "Tersambung" : "Belum tersambung", alasan: b?.alasan ?? null, opsi: b?.opsiIntegrasi ?? [] };
}

/** Breadcrumb drilldown. */
export function jejak(level, nama) {
  const out = [{ level: "campaign", label: "Semua campaign" }];
  if (level !== "campaign") out.push({ level: "adset", label: nama?.campaign || "Campaign" });
  if (level === "ad") out.push({ level: "ad", label: nama?.adSet || "Ad Set" });
  return out;
}

// ═══ FASE 3: biaya, KPI, target ═══════════════════════════════════════════════════════════════════════════════════════════════
// Semua angka biaya datang dari server (baris.biaya). Klien TIDAK menghitung CPL/CPA/ROAS dan tidak pernah mengubah null menjadi 0.

export const STATUS_BIAYA_LABEL = {
  BELUM_TERHUBUNG: { teks: "Belum tersambung", tip: "Spend Meta belum ada di sistem (impor CSV atau sinkronisasi API belum berjalan).", nada: "netral" },
  DATA_BELUM_MATANG: { teks: "Data belum matang", tip: "Sebagian lead belum cukup umur; closing dan revenue masih bertambah.", nada: "peringatan" },
  BELUM_ADA_KONVERSI: { teks: "Belum ada konversi", tip: "Ada spend tetapi belum ada lead/closing sebagai penyebut.", nada: "netral" },
  MAPPING_BELUM_ADA: { teks: "Mapping belum ada", tip: "Ad ID belum punya referensi Ad → Ad Set → Campaign (atau lead UNKNOWN).", nada: "peringatan" },
  DATA_TERLAMBAT: { teks: "Data terlambat", tip: "Spend terbaru tertinggal; rentang meminta hari yang belum ada datanya.", nada: "peringatan" },
  TANPA_SPEND_DI_RENTANG: { teks: "Tanpa spend di rentang", tip: "Tidak ada baris spend untuk entitas ini pada rentang yang dipilih.", nada: "netral" },
  SIAP_DIEVALUASI: { teks: "Siap dievaluasi", tip: "Spend, mapping, dan kematangan memenuhi syarat; evaluasi mengikuti target ADMIN bila diisi.", nada: "baik" },
};
export const ALASAN_NULL_LABEL = { BELUM_ADA_KONVERSI: "belum ada konversi", BELUM_ADA_SPEND: "belum ada spend", SPEND_NOL: "spend Rp0" };
export const EVALUASI_LABEL = { DATA_KURANG: "Data kurang", PANTAU: "Pantau", BAIK: "Baik", PERLU_REVIEW: "Perlu review" };

/** Sel angka biaya: null tetap "—" dengan alasan; TIDAK ada nol palsu. */
export function selBiaya(nilai, alasan, { rupiah = true, desimal = false } = {}) {
  if (nilai === null || nilai === undefined) return { teks: "—", alasan: ALASAN_NULL_LABEL[alasan] || (alasan ? String(alasan).toLowerCase() : null), kosong: true };
  const n = Number(nilai);
  const teks = rupiah ? "Rp" + Math.round(n).toLocaleString("id-ID") : n.toLocaleString("id-ID", { minimumFractionDigits: desimal ? 2 : 0, maximumFractionDigits: 2 }) + (desimal ? "×" : "");
  return { teks, alasan: null, kosong: false };
}

/** Baris biaya untuk tabel. Warna HANYA bila evaluasi (target ADMIN) tersedia; tanpa target nada = null. */
export function barisBiaya(g) {
  const b = g?.biaya;
  if (!b) return null;
  const st = STATUS_BIAYA_LABEL[b.status] || { teks: String(b.status || "—"), tip: "", nada: "netral" };
  const al = b.alasanNull || {};
  const ev = b.evaluasi?.status ?? null;
  return {
    status: b.status, statusTeks: st.teks, statusTip: st.tip, nada: st.nada,
    spend: b.spend === null || b.spend === undefined ? { teks: "—", alasan: null, kosong: true } : selBiaya(b.spend, null),
    konversasiPlatform: b.platformConversations ?? null,
    cpl: selBiaya(b.cpl, al.cpl), cplQualified: selBiaya(b.costPerQualifiedLead, al.costPerQualifiedLead),
    cplOrder: selBiaya(b.costPerCustomerOrder, al.costPerCustomerOrder), cpa: selBiaya(b.cpa, al.cpa),
    bookedRoas: selBiaya(b.bookedRoas, al.bookedRoas, { rupiah: false, desimal: true }), cashRoas: selBiaya(b.cashRoas, al.cashRoas, { rupiah: false, desimal: true }),
    evaluasi: ev, evaluasiTeks: ev ? EVALUASI_LABEL[ev] : null, evaluasiNada: ev === "BAIK" ? "baik" : ev === "PERLU_REVIEW" ? "buruk" : ev === "PANTAU" ? "peringatan" : ev ? "netral" : null,
    pelanggaran: b.evaluasi?.pelanggaran || [],
    kesegaran: b.kesegaranSpend || null, matang: b.kematangan?.matang ?? null,
  };
}

/** Status biaya tingkat laporan (menggantikan versi Fase 2): tersambung bila server menyatakan sumber spend terhubung. */
export function statusBiayaLaporan(lap) {
  const b = lap?.biaya;
  const tersambung = !!b?.sumber?.terhubung;
  return {
    tersambung, status: b?.status ?? "BELUM_TERHUBUNG", teks: tersambung ? (STATUS_BIAYA_LABEL[b.status]?.teks || b.status) : "Belum tersambung",
    alasan: b?.alasan ?? null, opsi: b?.opsiIntegrasi ?? [], spendTotal: tersambung ? b.spendTotal : null, spendTidakTerpetakan: b?.spendTidakTerpetakan ?? 0,
    terakhirTanggal: b?.sumber?.terakhirTanggal ?? null, tertinggalHari: b?.sumber?.tertinggalHari ?? null, terlambat: !!b?.sumber?.terlambat,
    targetDiatur: !!b?.targetDiatur, definisi: b?.definisiKpi ?? null,
  };
}

export const KOLOM_TARGET = [
  { k: "maxCpl", label: "Maks. CPL acquisition (Rp)", rupiah: true }, { k: "maxCostPerQualifiedLead", label: "Maks. cost per qualified lead (Rp)", rupiah: true },
  { k: "maxCostPerCustomerOrder", label: "Maks. cost per customer ber-order (Rp)", rupiah: true }, { k: "maxCpaClosing", label: "Maks. CPA closing utama (Rp)", rupiah: true },
  { k: "minBookedRoas", label: "Min. booked ROAS (×)" }, { k: "minCashRoas", label: "Min. cash ROAS (×)" },
  { k: "minAcquisitionLeads", label: "Min. jumlah acquisition lead", int: true }, { k: "minClosings", label: "Min. jumlah closing", int: true },
  { k: "minCohortAgeDays", label: "Min. umur kohort (hari)", int: true }, { k: "maxSpamSharePercent", label: "Maks. share spam (%)" },
];

/** Form target → body PUT (kosong = null; salah = galat). */
export function bodyTarget(nilai) {
  const body = {};
  for (const { k, int, rupiah } of KOLOM_TARGET) {
    const v = nilai?.[k];
    if (v === undefined) continue;
    if (v === null || String(v).trim() === "") { body[k] = null; continue; }
    const mentah = String(v).trim();
    const n = Number(rupiah ? mentah.replace(/\./g, "").replace(",", ".") : mentah.replace(",", "."));   // titik = pemisah ribuan hanya pada kolom rupiah
    if (!Number.isFinite(n) || n < 0) return { galat: `${k}: angka ≥ 0 atau kosong` };
    if (int && !Number.isInteger(n)) return { galat: `${k}: bilangan bulat` };
    body[k] = n;
  }
  if (Object.keys(body).length === 0) return { galat: "Tidak ada perubahan" };
  return { body };
}

export const NADA_KELAS = { baik: "text-green", buruk: "text-red", peringatan: "text-orange", netral: "text-ink3" };
