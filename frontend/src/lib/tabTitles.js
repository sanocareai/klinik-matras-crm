// Judul & pencarian tab dalam-app — dipisah dari TabsContext.jsx (P8.1, UI &
// Navigation Consolidation) supaya bisa diuji lewat `node --test` (yang tidak
// mentranspile JSX). Logika PERSIS sama dengan sebelumnya (dipindah, bukan
// ditulis ulang), ditambah tiga hal baru:
//   1. findTabIndexByPath — dedup: tab dengan path TUJUAN (bukan path mentah
//      sebelum resolveEntryPath) yang sama tidak boleh dibuka dobel.
//   2. Prefiks divisi untuk potongan path AMBIGU ("dashboard", "reports", dst)
//      yang muncul di banyak divisi — sebelumnya semua tab itu berjudul sama
//      persis ("Dashboard"), tidak bisa dibedakan di tab strip.
//   3. Query string ("?tab=...", dipakai menu "Riwayat") dibuang SEBELUM
//      judul diturunkan — tanpa ini judul tab jadi title-case dari seluruh
//      query mentah ("Order Produksi?Tab=Work Order&Status=DELIVERED"),
//      bug nyata yang ditemukan lewat QA visual.
import { splitPathQuery, canonicalizeTabPath } from "./splitPathQuery.js";

const RESOURCE_LABELS = {
  units: "Unit",
};

const DIVISION_LABELS = {
  armada: "Delivery",
  bengkel: "Produksi",
  produksi: "Produksi",
  warehouse: "Gudang",
  gudang: "Gudang",
  finance: "Finance",
  kendali: "All Teams",
};

// Potongan path TERAKHIR yang berulang di banyak divisi dengan arti berbeda
// (mis. "/armada/dashboard" vs "/warehouse/dashboard") — tab-nya perlu
// prefiks nama divisi supaya tab strip tidak menampilkan beberapa tab
// berjudul sama persis tanpa konteks.
const AMBIGUOUS_SEGMENTS = new Set(["dashboard", "reports", "settings", "pengaturan", "orders"]);

function looksLikeId(seg) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || // UUID
    /^[0-9a-f]{16,}$/i.test(seg) || // hash/hex panjang
    /^\d{4,}$/.test(seg) // ID numerik panjang
  );
}

export function titleFromPath(rawPath) {
  const { base } = splitPathQuery(rawPath);
  const parts = base.split("/").filter(Boolean);
  const divisionSeg = parts[0];
  let seg = parts.pop() || "portal";
  if (looksLikeId(seg) && parts.length > 0) {
    const resource = parts.pop();
    seg = RESOURCE_LABELS[resource] || resource;
  }
  const rawLast = seg.toLowerCase();
  const label = seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (AMBIGUOUS_SEGMENTS.has(rawLast) && divisionSeg && DIVISION_LABELS[divisionSeg] && parts.length + 1 > 0 && divisionSeg !== rawLast) {
    return `${DIVISION_LABELS[divisionSeg]} · ${label}`;
  }
  return label;
}

// Dedup tab (P8.1) — dicari lewat PATH TUJUAN resolved (sama persis dengan apa
// yang disimpan di tabs[].path, lihat resolveEntryPath di pageRegistry.jsx),
// bukan path mentah yang diklik. Mengembalikan index tab yang sudah terbuka
// untuk path itu, atau -1 kalau belum ada. P8.2: dibandingkan dalam bentuk
// KANONIK (canonicalizeTabPath) — urutan parameter query beda tidak dianggap
// tab berbeda.
export function findTabIndexByPath(tabs, path) {
  const target = canonicalizeTabPath(path);
  return tabs.findIndex((t) => canonicalizeTabPath(t.path) === target);
}

// Migrasi/dedup tab tersimpan (P8.2, UI Polish) — laporan owner dari
// screenshot live: tab "Dashboard" dobel di tab strip. PENYEBAB: dedup di
// openNewTab (P8.1) cuma mencegah duplikat BARU; tab yang SUDAH tersimpan
// di localStorage dari SEBELUM perbaikan itu (atau dari alur navigasi lain
// yang tidak lewat openNewTab, mis. loadTabs() lama) tetap dobel selamanya.
// Dipanggil OTOMATIS setiap kali tab dimuat dari localStorage (TabsContext.jsx)
// — bukan flag sekali-jalan yang rapuh (kalau bug serupa muncul lagi di masa
// depan, flag sekali-jalan akan MENCEGAH pembersihan berikutnya; fungsi murni
// idempoten ini aman dipanggil berkali-kali, tidak berbiaya kalau memang
// sudah bersih).
//
// Aturan: SATU tab bertahan per path KANONIK. Kalau tab yang sedang AKTIF
// (activeId) adalah salah satu duplikat, tab AKTIF itu yang dipertahankan
// (bukan yang pertama ditemukan) — "jangan menghapus tab aktif pengguna
// yang valid". Urutan RELATIF tab yang tersisa mengikuti kemunculan PERTAMA
// path itu di daftar asli.
export function dedupeTabs(tabs, activeId) {
  const winnerByPath = new Map();
  for (const t of tabs) {
    const key = canonicalizeTabPath(t.path);
    const existing = winnerByPath.get(key);
    if (!existing || t.id === activeId) winnerByPath.set(key, t);
  }
  const seen = new Set();
  const result = [];
  for (const t of tabs) {
    const key = canonicalizeTabPath(t.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(winnerByPath.get(key));
  }
  return result;
}
