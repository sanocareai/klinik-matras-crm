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
