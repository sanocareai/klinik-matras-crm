// LAPORAN PRODUKSI TERPADU (frontend) — model MURNI: tab menurut izin, periode <-> URL, kueri API, format angka, label. Tanpa React/DOM (diuji node --test).
// Periode memakai SKEMA STANDAR app (lib/dateRange.js: makeRange/makeCustomRange/toApiParams + DateRangePicker yang sama dengan Sales/CRM) — tidak ada pemilih tanggal baru.
import { makeCustomRange, makeRange, PRESET_BY_ID, toApiParams } from "../../../lib/dateRange.js";

export const TABS = Object.freeze([
  { key: "ringkasan", label: "Ringkasan", api: "ringkasan", izin: "ringkasan" },
  { key: "biaya", label: "Biaya per Order", api: "biaya-order", izin: "biayaOrder" },
  { key: "kinerja", label: "Kinerja Produksi", api: "kinerja", izin: "kinerja" },
  { key: "bahan", label: "Bahan & Gudang", api: "bahan-gudang", izin: "bahanGudang" },
]);
export const TAB_DEFAULT = "ringkasan";

/** Kunci tab lama (KPI & Laporan versi sebelumnya) → tab baru, supaya tautan lama tetap bekerja. */
export const TAB_LAMA = Object.freeze({ ringkasan: "ringkasan", produksi: "ringkasan", meja: "kinerja", pic: "kinerja", gudang: "bahan", laporan: "biaya", export: "ringkasan" });
export const normalisasiTab = (k) => (TABS.some((t) => t.key === k) ? k : TAB_LAMA[k] ?? TAB_DEFAULT);

/** Tab yang boleh dilihat (diputuskan server lewat /laporan/meta.capabilities; UI hanya mengikuti). */
export function tabsUntuk(cap = {}) { return TABS.filter((t) => cap[t.izin]); }
export function tabAktif(kunci, tabs) { const k = normalisasiTab(kunci); return tabs.find((t) => t.key === k) ?? tabs[0] ?? null; }

// ── periode <-> URL ─────────────────────────────────────────────────────────
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const tanggalValid = (v) => KEY_RE.test(v ?? "") && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)); // pola benar DAN tanggal nyata (sama dengan validasi server)
/** Baca periode dari ?preset=&dari=&sampai=&n=. Tidak valid / kosong → 30 hari terakhir (preset standar app). */
export function rangeDariParams(params, bawaan = "last_30_days") {
  const get = (k) => (typeof params?.get === "function" ? params.get(k) : params?.[k]) ?? null;
  const preset = get("preset"); const dari = get("dari"); const sampai = get("sampai");
  if (preset === "custom" && tanggalValid(dari) && tanggalValid(sampai)) return makeCustomRange(dari, sampai);
  if (preset && preset !== "custom" && PRESET_BY_ID[preset]) { const n = Number(get("n")) || 30; return makeRange(preset, { n }); }
  return makeRange(bawaan);
}
/** Tulis periode ke URLSearchParams (mengganti kunci periode saja; kunci lain dipertahankan). */
export function paramsDariRange(params, range, bawaan = null) {
  const out = new URLSearchParams(params);
  for (const k of ["preset", "dari", "sampai", "n"]) out.delete(k);
  if (bawaan && range?.preset === bawaan) return out; // periode bawaan tidak ditulis ke URL (tautan tetap bersih)
  if (range?.preset === "custom") { out.set("preset", "custom"); out.set("dari", range.from); out.set("sampai", range.to); }
  else if (range?.preset) { out.set("preset", range.preset); if (PRESET_BY_ID[range.preset]?.parametrized) out.set("n", String(range.n ?? 30)); }
  return out;
}

// ── kueri API (periode + filter) ─────────────────────────────────────────────
export const FILTER_KOSONG = Object.freeze({ qOrder: "", qBahan: "", status: "", masalah: "", alasan: "", urut: "masalah", hanyaPemakaian: false, peran: "MEJA", dasar: "meja" });
/** Hanya filter yang BERLAKU pada tab itu yang dikirim (pencarian order tidak boleh menyaring tab Bahan, dst.). `tab` = kunci tab model (ringkasan|biaya|kinerja|bahan). */
export function filterUntukTab(tab, f = {}) {
  const g = { ...FILTER_KOSONG, ...f };
  if (tab === "biaya") return { q: g.qOrder, status: g.status, masalah: g.masalah, alasan: g.alasan, urut: g.urut, hanyaPemakaian: g.hanyaPemakaian };
  if (tab === "bahan") return { q: g.qBahan };
  if (tab === "kinerja") return { peran: g.peran };
  return {};
}
export function queryLaporan(range, filters = {}, ekstra = {}) {
  const p = new URLSearchParams(); const api = toApiParams(range);
  if (api.from) p.set("from", api.from); if (api.to) p.set("to", api.to);
  const f = { q: "", status: "", masalah: "", alasan: "", urut: FILTER_KOSONG.urut, hanyaPemakaian: false, peran: "MEJA", ...filters };
  if (f.q?.trim()) p.set("q", f.q.trim());
  if (f.status) p.set("status", f.status);
  if (f.masalah) p.set("masalah", f.masalah);
  if (f.alasan) p.set("alasan", f.alasan);
  if (f.urut && f.urut !== FILTER_KOSONG.urut) p.set("urut", f.urut);
  if (f.hanyaPemakaian) p.set("hanyaPemakaian", "1");
  if (f.peran === "CORNER") p.set("peran", "CORNER");
  for (const [k, v] of Object.entries(ekstra)) if (v != null && v !== "") p.set(k, String(v));
  return p.toString();
}
/** Rupiah hanya bila nilai benar-benar diketahui; selain itu teks status (BUKAN Rp 0). */
export const rupiahDiketahui = (v, diketahui) => (diketahui ? rupiah(v) : "Belum diketahui");
export const jumlahFilterLanjut = (f = {}) => [f.status, f.masalah, f.alasan, f.hanyaPemakaian ? "1" : "", f.urut && f.urut !== FILTER_KOSONG.urut ? f.urut : ""].filter(Boolean).length;

// ── format ──────────────────────────────────────────────────────────────────
const nfRp = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
/** Rupiah utuh; null/undefined = "—" (BUKAN Rp 0: nilai yang belum diketahui tidak boleh tampil nol). */
export const rupiah = (v) => (v == null ? "—" : `Rp ${nfRp.format(Math.round(v))}`);
export const angka = (v) => (v == null ? "—" : nf.format(v));
export function rupiahRingkas(v) {
  if (v == null) return "—"; const a = Math.abs(v);
  if (a >= 1e9) return `Rp ${nf.format(v / 1e9)} M`; if (a >= 1e6) return `Rp ${nf.format(v / 1e6)} jt`; if (a >= 1e3) return `Rp ${nf.format(v / 1e3)} rb`; return rupiah(v);
}
export const menit = (m) => { if (m == null) return "—"; if (m < 60) return `${m} mnt`; const j = Math.floor(m / 60); const s = m % 60; return s ? `${j} j ${s} mnt` : `${j} j`; };
export const tglPendek = (key) => { if (!key) return "—"; const [y, m, d] = key.split("-"); return `${d}/${m}/${y.slice(2)}`; };
export function durasiTeks(d) { if (!d) return "Belum tersedia"; return d.rataMenit != null ? `${menit(d.rataMenit)} (n=${d.n})` : d.catatan || "Belum tersedia"; }

export const NADA_STATUS = Object.freeze({ LENGKAP: "bg-greenbg text-green", PARSIAL: "bg-orangebg text-orange", BELUM_DIKETAHUI: "bg-redbg text-red" });
export const LABEL_STATUS_BAHAN = Object.freeze({
  DIBEKUKAN: "Dibekukan", BELUM_DIBEKUKAN: "Belum dibekukan", TANPA_HARGA: "Tanpa harga", GAGAL: "Pembekuan gagal",
});
export const LABEL_ALASAN_LINGKUP = Object.freeze({ PEMAKAIAN: "Ada pemakaian", MASUK: "Unit masuk", SELESAI: "Selesai", TERKIRIM: "Terkirim" });
/** Tautan "Lengkapi": Order Produksi dengan pencarian nomor order (tindakan nyata ada di sana: catat bahan / nyatakan tanpa bahan baru). */
export const tautanLengkapi = (nomorOrder) => `/bengkel/order-produksi?q=${encodeURIComponent(nomorOrder ?? "")}`;

/** Daftar masalah (untuk chip & rincian) berurutan dari jenis terbanyak; hanya yang > 0. */
export function daftarMasalah(masalah = {}, definisi = {}) {
  return Object.entries(masalah).filter(([, n]) => n > 0).map(([k, n]) => ({ key: k, n, label: definisi[k]?.label ?? k, aksi: definisi[k]?.aksi ?? "" })).sort((a, b) => b.n - a.n);
}
/** Nilai grafik → tinggi batang (0–100), aman untuk semua nol. */
export function skalaBatang(seri = []) { const maks = Math.max(0, ...seri.map((s) => s.nilai)); return seri.map((s) => ({ ...s, pct: maks > 0 ? Math.round((s.nilai / maks) * 100) : 0 })); }
export const jumlahSeri = (seri = []) => Math.round(seri.reduce((a, s) => a + s.nilai, 0) * 100) / 100;

/** Tombol Export mengikuti tab, periode, dan filter aktif → query ekspor. */
export function queryEkspor(tabKey, range, filters) { const tab = TABS.find((t) => t.key === tabKey); return `tab=${tab?.api ?? "ringkasan"}&${queryLaporan(range, filterUntukTab(tabKey, filters))}`; }
