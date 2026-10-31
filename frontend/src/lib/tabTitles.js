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
import { cariItemHub } from "./financeHubs.js";

const RESOURCE_LABELS = {
  units: "Unit",
  // Halaman detail Penerimaan Barang (Tahap 1 UX Gudang): /warehouse/goods-receipt/<id> → tab "Penerimaan" (bukan "Goods Receipt").
  "goods-receipt": "Penerimaan",
  // Tahap 2: /warehouse/material-issue/<id> dan /warehouse/transfers/<id> → tab bernama menu (bukan "Material Issue" / "Transfers").
  "material-issue": "Pengeluaran",
  transfers: "Transfer",
  // Tahap 2 (pola sederhana): halaman detail Opname, Restok, Barang Rusak, Retur, Penyesuaian.
  "stock-count": "Opname",
  replenishment: "Restok",
  damaged: "Barang Rusak",
  returns: "Retur",
  stock: "Penyesuaian",
  // Tahap 4: koreksi & retur supplier sebagai jendela fokus.
  koreksi: "Koreksi",
  "retur-supplier": "Retur Supplier",
};

// P9B.1 — segmen path yang tidak title-case rapi dengan aturan umum di bawah (huruf/angka bercampur, singkatan
// versi, dll). URL /bengkel/production-v2 SENGAJA TIDAK diganti (kompatibilitas bookmark/tab lama) walau halamannya
// sekarang berjudul "Status Produksi" — override ini HANYA memperbaiki judul tab, tidak menyentuh URL/redirect.
const SEGMENT_LABEL_OVERRIDE = {
  "production-v2": "Status Produksi",
};

// Fase 1 kerangka bersama Sales CRM — rute Sales CRM satu-segmen yang dibuka lewat URL/bilah alamat (bukan klik menu)
// dulu berjudul slug Inggris ("Customers", "Orders"); sekarang memakai nama menu di sidebar.
const SALES_ROOT_LABELS = {
  customers: "Pelanggan",
  orders: "Order",
  products: "Galeri Produk",
  komplain: "Kasus Komplain",
  tracking: "Link Pelacakan",
  broadcast: "Broadcast & Campaign",
  "broadcast-sales": "Broadcast Team",
  "sales-intelligence": "Sales Performance Intelligence",
  copilot: "Tanya Sano",
  automation: "Otomasi",
  "pengaturan-sales": "Pengaturan",
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
  const { base, search } = splitPathQuery(rawPath);
  // Halaman Finance: judul tab = label hub Indonesia (lib/financeHubs.js), bukan segmen path berbahasa Inggris ("Receivables" → "Piutang & Refund").
  if (base.startsWith("/finance/")) {
    const hit = cariItemHub(base, search || "");
    if (hit) return hit.item.label;
  }
  const parts = base.split("/").filter(Boolean);
  const divisionSeg = parts[0];
  // Tahap 4: jendela fokus di atas Beranda (/warehouse/dashboard/<jenis>/<id>) tetap bertab "Gudang · Beranda".
  if (divisionSeg === "warehouse" && parts[1] === "dashboard") return "Gudang · Beranda";
  if (divisionSeg === "warehouse" && parts[1] === "perlu-perhatian") return "Perlu Perhatian";
  if (divisionSeg === "warehouse" && parts[1] === "stock-count" && parts[3] === "hitung") return "Hitung Opname";
  let seg = parts.pop() || "portal";
  if (looksLikeId(seg) && parts.length > 0) {
    const resource = parts.pop();
    seg = RESOURCE_LABELS[resource] || resource;
  }
  const rawLast = seg.toLowerCase();
  // Tahap 1 UX Gudang: tab dua menu inti memakai nama menu di sidebar (bukan "Inventory" / "Goods Receipt").
  if (divisionSeg === "warehouse" && parts.length === 1) { if (rawLast === "inventory") return "Stok & Lokasi"; if (rawLast === "goods-receipt") return "Penerimaan Barang"; if (rawLast === "material-issue") return "Pengeluaran Material"; if (rawLast === "transfers") return "Transfer Stok"; if (rawLast === "replenishment") return "Restok"; if (rawLast === "stock-count") return "Stock Opname"; if (rawLast === "adjustments") return "Barang Rusak & Retur"; }
  // Menu Gudang bernama "Beranda" (bukan Dashboard) agar tidak terkesan ada dua dashboard.
  if (divisionSeg === "warehouse" && rawLast === "dashboard") return "Gudang · Beranda";
  if (SEGMENT_LABEL_OVERRIDE[rawLast]) return SEGMENT_LABEL_OVERRIDE[rawLast];
  if (parts.length === 0 && SALES_ROOT_LABELS[rawLast]) return SALES_ROOT_LABELS[rawLast];
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

// Fase 1 kerangka bersama Sales CRM (31 Okt 2026) — identitas tab bernama sama.
// Dua tab bisa berjudul persis sama dari divisi berbeda (mis. menu "Laporan" di
// Sales CRM dan di Delivery, atau "Dashboard"); tab strip dulu menampilkan
// keduanya tanpa konteks. Konteks diturunkan HANYA dari data yang sudah ada di
// tab (path/query) dan HANYA muncul saat ada judul kembar — tab yang judulnya
// sudah unik tampil seperti biasa. Murni & tanpa efek samping (bisa diuji).
const KONTEKS_DIVISI = { ...DIVISION_LABELS, b2b: "B2B", marketing: "Marketing" };

export function konteksDivisiTab(path) {
  const seg = splitPathQuery(path || "").base.split("/").filter(Boolean)[0];
  if (!seg) return "Sales CRM";
  return KONTEKS_DIVISI[seg] || "Sales CRM";
}

// Petunjuk dari query ("?tab=…", "?section=…") bila dua tab sama judul DAN sama divisi.
function petunjukQuery(path) {
  const { search } = splitPathQuery(path || "");
  if (!search) return null;
  const p = new URLSearchParams(search);
  const v = p.get("tab") || p.get("section") || p.get("status");
  return v ? v.replace(/[-_]/g, " ") : null;
}

// → Map<tabId, string|null>: teks konteks untuk tab berjudul kembar, atau null.
export function konteksTabKembar(tabs) {
  const hasil = new Map();
  const kelompok = new Map();
  for (const t of tabs) {
    const k = String(t.title || "").trim().toLowerCase();
    if (!kelompok.has(k)) kelompok.set(k, []);
    kelompok.get(k).push(t);
  }
  for (const anggota of kelompok.values()) {
    if (anggota.length < 2) { for (const t of anggota) hasil.set(t.id, null); continue; }
    const hitung = new Map();
    for (const t of anggota) { const d = konteksDivisiTab(t.path); hitung.set(d, (hitung.get(d) || 0) + 1); }
    const urut = new Map();
    for (const t of anggota) {
      const d = konteksDivisiTab(t.path);
      // Judul yang sudah memuat nama divisi ("Delivery · Dashboard") sudah jelas.
      if (String(t.title).includes(" · ")) { hasil.set(t.id, null); continue; }
      if (hitung.get(d) === 1) { hasil.set(t.id, d); continue; }
      const q = petunjukQuery(t.path);
      const n = (urut.get(d) || 0) + 1; urut.set(d, n);
      hasil.set(t.id, q ? `${d} · ${q}` : `${d} · ${n}`);
    }
  }
  return hasil;
}
