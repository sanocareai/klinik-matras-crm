// Logika murni SATU periode laporan untuk tab Marketing (dulu Traffic / Akuisisi / Iklan) dan URL-nya. Tanpa React, tanpa dayjs, tanpa timezone perangkat: semua tanggal adalah string "YYYY-MM-DD" (kalender WIB).
//
// MASALAH YANG DIPERBAIKI (26 Okt 2026): filter global Laporan memilih 1–26 Okt, tetapi tab Akuisisi memegang state sendiri (30 hari berakhir kemarin = 26 Sep–25 Okt) dan tab Iklan state sendiri lagi
// (7 hari) → tiga periode berbeda di satu halaman. Sekarang SATU state (range di Laporan.jsx) dibaca semua tab; URL (?tab&dari&sampai&sumber) mencerminkannya sehingga refresh, tombol Back, dan
// berpindah tab tidak mengubah periode.

import { petaTab, TAB_MARKETING, urutSumberValid, URUT_SUMBER_BAWAAN, kriteriaMetaValid, KRITERIA_META_BAWAAN, normalisasiJalurMeta, MODE_KOLOM, umurValid } from "./marketingLogic.js";

export const MAKS_HARI_PERIODE = 93;   // sama dengan batas server (/sumber, /iklan)
const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

export const tglValid = (s) => typeof s === "string" && TGL_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const tambahHari = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const selisihHari = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const tanggalPendek = (ymd) => (tglValid(ymd) ? `${Number(ymd.slice(8, 10))} ${BULAN[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}` : "—");
export const teksPeriode = (dari, sampai) => (dari === sampai ? tanggalPendek(dari) : `${tanggalPendek(dari)} – ${tanggalPendek(sampai)}`);

/**
 * Validasi range global untuk tab yang butuh rentang tertutup. Mengembalikan alasan eksplisit (tidak pernah mengganti periode diam-diam).
 * hariIni: "YYYY-MM-DD" (WIB). Hari berjalan boleh dipilih (KPI biaya per hasil sengaja kosong, dijelaskan di UI).
 */
export function periodeTab(range, hariIni) {
  const dari = range?.from ?? null, sampai = range?.to ?? null;
  if (!dari || !sampai) return { ok: false, kode: "TANPA_BATAS", alasan: "Preset 'Semua' tidak punya batas tanggal. Pilih rentang tertutup (maks. 93 hari) agar lead, order, dan biaya dihitung untuk periode yang sama." };
  if (!tglValid(dari) || !tglValid(sampai)) return { ok: false, kode: "TANGGAL_TIDAK_VALID", alasan: "Tanggal periode tidak valid." };
  if (dari > sampai) return { ok: false, kode: "TERBALIK", alasan: "Tanggal mulai sesudah tanggal akhir." };
  if (sampai > hariIni) return { ok: false, kode: "MASA_DEPAN", alasan: "Periode tidak boleh melewati hari ini." };
  const hari = selisihHari(dari, sampai) + 1;
  if (hari > MAKS_HARI_PERIODE) return { ok: false, kode: "TERLALU_PANJANG", alasan: `Periode ${hari} hari melebihi batas ${MAKS_HARI_PERIODE} hari.`, hari };
  return { ok: true, dari, sampai, hari, termasukHariBerjalan: sampai >= hariIni };
}

/** Saran rentang penuh (berakhir kemarin) — tombol pintas yang MENGUBAH filter global, bukan state lokal. */
export function saranRentang(hariIni) {
  const kemarin = tambahHari(hariIni, -1);
  return [
    { id: "PENUH_7", label: "7 hari penuh (s/d kemarin)", dari: tambahHari(kemarin, -6), sampai: kemarin },
    { id: "PENUH_30", label: "30 hari penuh (s/d kemarin)", dari: tambahHari(kemarin, -29), sampai: kemarin },
  ];
}

// ── URL ↔ state ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Kunci milik tab Marketing (semua opsional; nilai bawaan TIDAK ditulis agar URL bersih): sumber (detail sumber), urut (urutan tabel sumber), kolom (ringkas|lengkap),
// banding (=1, bandingkan periode sebelumnya), level/campaign/adset (drilldown Meta), rank (kriteria peringkat Meta), umur (kohort Meta).
const KUNCI_MARKETING = ["sumber", "urut", "kolom", "banding", "level", "campaign", "adset", "rank", "umur"];
/**
 * Baca ?tab&dari&sampai&(kunci Marketing). Nilai tak valid → null/bawaan (diabaikan, tidak pernah melempar).
 * URL LAMA tetap berlaku: ?tab=Traffic|Akuisisi|Iklan dipetakan ke Marketing (Akuisisi membawa ?sumber=; Iklan → sumber=META) — periode dipertahankan.
 */
export function bacaUrlLaporan(search, tabsValid = []) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search || "");
  const dari = p.get("dari"), sampai = p.get("sampai"); const sumber = p.get("sumber");
  const punyaRentang = tglValid(dari) && tglValid(sampai) && dari <= sampai;
  const sumberValid = sumber && /^[A-Z_]{2,16}$/.test(sumber) ? sumber : null;
  const peta = petaTab(p.get("tab"), sumberValid, tabsValid);
  const marketing = peta.tab === TAB_MARKETING;
  const jalur = normalisasiJalurMeta({ level: p.get("level"), campaign: p.get("campaign"), adset: p.get("adset") });
  return {
    tab: peta.tab, tabLama: !!peta.tab && peta.tab !== p.get("tab"),
    dari: punyaRentang ? dari : null, sampai: punyaRentang ? sampai : null,
    sumber: marketing ? peta.sumber : null,
    urut: marketing && urutSumberValid(p.get("urut")) ? p.get("urut") : URUT_SUMBER_BAWAAN,
    kolom: marketing && MODE_KOLOM.includes(p.get("kolom")) ? p.get("kolom") : "ringkas",
    banding: marketing && p.get("banding") === "1",
    level: marketing && peta.sumber === "META" ? jalur.level : "campaign",
    campaign: marketing && peta.sumber === "META" ? jalur.campaign : null,
    adset: marketing && peta.sumber === "META" ? jalur.adset : null,
    rank: marketing && kriteriaMetaValid(p.get("rank")) ? p.get("rank") : KRITERIA_META_BAWAAN,
    umur: marketing && umurValid(p.get("umur")) ? p.get("umur") : "semua",
  };
}

/**
 * Salin parameter lain apa adanya; hanya kunci milik kita (tab/dari/sampai + kunci Marketing) yang ditulis ulang.
 * Tab 'Ringkasan' (bawaan) tidak ditulis agar URL lama tetap bersih. Tanpa batas ('Semua') → dari/sampai dihapus. Kunci Marketing hanya bermakna di tab Marketing; nilai bawaan dihapus.
 * `marketing` = { sumber, urut, kolom, banding, level, campaign, adset, rank, umur }; `sumber` di argumen utama tetap diterima (kompatibel).
 */
export function tulisUrlLaporan(search, { tab, range, sumber, marketing = {} }) {
  const p = new URLSearchParams(search instanceof URLSearchParams ? search.toString() : search || "");
  if (tab && tab !== "Ringkasan") p.set("tab", tab); else p.delete("tab");
  if (range?.from && range?.to) { p.set("dari", range.from); p.set("sampai", range.to); } else { p.delete("dari"); p.delete("sampai"); }
  for (const k of KUNCI_MARKETING) p.delete(k);
  if (tab === TAB_MARKETING) {
    const m = { sumber, ...marketing };
    if (m.sumber) p.set("sumber", m.sumber);
    if (m.urut && m.urut !== URUT_SUMBER_BAWAAN && urutSumberValid(m.urut)) p.set("urut", m.urut);
    if (m.kolom === "lengkap") p.set("kolom", "lengkap");
    if (m.banding) p.set("banding", "1");
    if (m.sumber === "META") {
      const j = normalisasiJalurMeta(m);
      if (j.level !== "campaign") p.set("level", j.level);
      if (j.campaign) p.set("campaign", j.campaign);
      if (j.adset) p.set("adset", j.adset);
      if (m.rank && m.rank !== KRITERIA_META_BAWAAN && kriteriaMetaValid(m.rank)) p.set("rank", m.rank);
      if (m.umur && m.umur !== "semua" && umurValid(m.umur)) p.set("umur", m.umur);
    }
  }
  return p;
}
export const samaRentang = (a, b) => (a?.from ?? null) === (b?.from ?? null) && (a?.to ?? null) === (b?.to ?? null);

// ── navigasi antar-laporan ───────────────────────────────────────────────────────────────────────────────────────────
const PETA_TRAFFIC = { META_ADS: "META", TIKTOK_ADS: "TIKTOK", WHATSAPP_DIRECT: "WHATSAPP", INSTAGRAM: "INSTAGRAM", WEBSITE_ORGANIC: "WEBSITE", WEBSITE: "WEBSITE", OTHER: "LAINNYA", GOOGLE_ADS: "LAINNYA", REFERRAL: "LAINNYA", ADS: "LAINNYA" };
/** Label sumber Traffic (LeadSource) → id sumber Akuisisi. B2B/penjualan karyawan bukan lead pemasaran → null (tidak ada detail akuisisi). */
export const sumberAkuisisiDariTraffic = (leadSource) => (leadSource === "B2B_DIRECT" || leadSource === "PENJUALAN_KARYAWAN" ? null : PETA_TRAFFIC[leadSource] ?? (leadSource ? "LAINNYA" : null));
/** Id sumber Akuisisi → label LeadSource untuk daftar Pelanggan (?source=). Sumber gabungan (Website/Lainnya) memakai label utamanya. */
export const LABEL_PELANGGAN = Object.freeze({ META: "META_ADS", TIKTOK: "TIKTOK_ADS", WHATSAPP: "WHATSAPP_DIRECT", INSTAGRAM: "INSTAGRAM", WEBSITE: "WEBSITE_ORGANIC", LAINNYA: "OTHER" });

/** Apa yang bisa dibuka lebih dalam dari satu sumber — hanya yang datanya ADA (tidak ada tabel palsu). */
export function jalurRincian(id) {
  if (id === "META") return { campaign: true, penjelasan: "Rincian campaign → ad set → ad tersedia di atas (touch iklan terbukti + pemetaan Ad ID)." };
  if (id === "TIKTOK") return { campaign: false, penjelasan: "TikTok belum punya data per campaign/ad di sistem (tidak ada touch klik per iklan). Yang tersedia: label CRM + biaya sumber yang diinput manual." };
  return { campaign: false, penjelasan: "Sumber organik/lainnya tidak punya campaign atau biaya iklan yang dialokasikan." };
}
