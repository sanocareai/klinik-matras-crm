// Logika murni SATU periode laporan untuk tab Akuisisi / Iklan (dan URL-nya). Tanpa React, tanpa dayjs, tanpa timezone perangkat: semua tanggal adalah string "YYYY-MM-DD" (kalender WIB).
//
// MASALAH YANG DIPERBAIKI (26 Okt 2026): filter global Laporan memilih 1–26 Okt, tetapi tab Akuisisi memegang state sendiri (30 hari berakhir kemarin = 26 Sep–25 Okt) dan tab Iklan state sendiri lagi
// (7 hari) → tiga periode berbeda di satu halaman. Sekarang SATU state (range di Laporan.jsx) dibaca semua tab; URL (?tab&dari&sampai&sumber) mencerminkannya sehingga refresh, tombol Back, dan
// berpindah tab tidak mengubah periode.

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
/** Baca ?tab&dari&sampai&sumber. Nilai tak valid → null (diabaikan, tidak pernah melempar). */
export function bacaUrlLaporan(search, tabsValid = []) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search || "");
  const tab = p.get("tab"); const dari = p.get("dari"), sampai = p.get("sampai"); const sumber = p.get("sumber");
  const punyaRentang = tglValid(dari) && tglValid(sampai) && dari <= sampai;
  return {
    tab: tab && tabsValid.includes(tab) ? tab : null,
    dari: punyaRentang ? dari : null, sampai: punyaRentang ? sampai : null,
    sumber: sumber && /^[A-Z_]{2,16}$/.test(sumber) ? sumber : null,
  };
}

/**
 * Salin parameter lain apa adanya; hanya kunci milik kita (tab/dari/sampai/sumber) yang ditulis ulang.
 * Tab 'Ringkasan' (bawaan) tidak ditulis agar URL lama tetap bersih. Tanpa batas ('Semua') → dari/sampai dihapus. sumber hanya bermakna di tab Akuisisi.
 */
export function tulisUrlLaporan(search, { tab, range, sumber }) {
  const p = new URLSearchParams(search instanceof URLSearchParams ? search.toString() : search || "");
  if (tab && tab !== "Ringkasan") p.set("tab", tab); else p.delete("tab");
  if (range?.from && range?.to) { p.set("dari", range.from); p.set("sampai", range.to); } else { p.delete("dari"); p.delete("sampai"); }
  if (sumber && tab === "Akuisisi") p.set("sumber", sumber); else p.delete("sumber");
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
  if (id === "META") return { campaign: true, penjelasan: "Rincian campaign → ad set → ad tersedia di tab Iklan (touch iklan terbukti + pemetaan Ad ID)." };
  if (id === "TIKTOK") return { campaign: false, penjelasan: "TikTok belum punya data per campaign/ad di sistem (tidak ada touch klik per iklan). Yang tersedia: label CRM + biaya sumber yang diinput manual." };
  return { campaign: false, penjelasan: "Sumber organik/lainnya tidak punya campaign atau biaya iklan yang dialokasikan." };
}
