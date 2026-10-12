// HUB NAVIGASI FINANCE — restrukturisasi sidebar (Okt 2026). Murni data + fungsi (tanpa JSX) supaya diuji `node --test`.
//
// Prinsip (jangan dilanggar):
//   • Ini NAVIGASI & entry point saja. Setiap tab hub = RUTE LAMA yang sudah ada (path + ?tab= bila halamannya punya tab internal). Tidak ada
//     tabel/data bisnis yang digabung dan tidak ada route yang dihapus: /finance/payments, /finance/receivables, dst tetap berfungsi dan deep-link-nya
//     langsung menyorot hub + tab yang benar.
//   • Izin: item bertanda `bolehPeran` disaring sama seperti sidebar lama (server tetap penegak izin sungguhan).
//   • Badge pekerjaan hanya memakai angka antrean yang SUDAH disediakan server (GET /finance/dashboard → antrean); tidak ada hitungan baru di klien.
import { splitPathQuery } from "./splitPathQuery.js";

const PERAN_PENGAJUAN = ["ADMIN", "OWNER", "FINANCE", "APPROVER"]; // sama dengan item "Pengajuan Biaya Divisi" di sidebar lama

/**
 * Definisi hub. `item.to` = rute lama (boleh memuat ?tab=). `item.tabs` (opsional) = nilai ?tab= yang dianggap milik item ini pada path yang sama;
 * `item.tabs: []` berarti "apa pun selain tab yang diklaim saudaranya". `badge` = kunci antrean dari server (lihat BADGE_SUMBER).
 */
export const FINANCE_HUBS = Object.freeze([
  {
    key: "ringkasan", label: "Ringkasan", ikon: "dashboard",
    items: [{ key: "dashboard", label: "Ringkasan", to: "/finance/dashboard" }],
  },
  {
    key: "penjualan", label: "Penjualan & Piutang", ikon: "pemasukan",
    items: [
      { key: "uang-masuk", label: "Uang Masuk", to: "/finance/pemasukan" },
      { key: "verifikasi", label: "Verifikasi", to: "/finance/payments", tabs: ["perlu", "terverifikasi", "dibatalkan", ""], badge: "pembayaranBelumVerifikasi" },
      { key: "invoice", label: "Invoice Pelanggan", to: "/finance/invoices" },
      { key: "piutang", label: "Piutang & Refund", to: "/finance/receivables", badge: "refundMenunggu" },
      { key: "rekon-sales", label: "Rekonsiliasi Sales–Finance", to: "/finance/payments?tab=lunas_crm", tabs: ["lunas_crm"] },
    ],
  },
  {
    key: "pengeluaran", label: "Pengeluaran & Biaya", ikon: "pengeluaran",
    items: [
      { key: "pengeluaran", label: "Pengeluaran", to: "/finance/expenses", badge: "pengeluaranMenunggu" },
      { key: "pengajuan", label: "Pengajuan Biaya Divisi", to: "/finance/pengajuan-divisi", bolehPeran: PERAN_PENGAJUAN },
    ],
  },
  {
    key: "pembelian", label: "Pembelian & Supplier", ikon: "pembelian",
    items: [
      { key: "po", label: "Purchase Order", to: "/finance/purchase-orders" },
      { key: "pembelian", label: "Pembelian/Faktur", to: "/finance/purchases", badge: "pembelianMenunggu" },
      { key: "supplier", label: "Supplier & Utang", to: "/finance/suppliers", tabs: ["tagihan", "pembayaran", "supplier", ""], badge: "tagihanMenunggu" },
      { key: "aging", label: "Jadwal & Aging", to: "/finance/suppliers?tab=aging", tabs: ["aging"] },
      { key: "retur", label: "Retur & Debit Note", to: "/finance/retur-supplier" },
    ],
  },
  {
    key: "kas", label: "Kas & Bank", ikon: "kas",
    items: [
      { key: "saldo", label: "Saldo Rekening", to: "/finance/cash?tab=rekening", tabs: ["rekening", "transfer", "pemasukan", ""] },
      { key: "mutasi", label: "Mutasi Buku", to: "/finance/cash?tab=mutasi", tabs: ["mutasi"] },
      { key: "rekon-bank", label: "Rekonsiliasi Bank", to: "/finance/reconciliation" },
    ],
  },
  {
    key: "karyawan", label: "Transaksi Karyawan", ikon: "karyawan",
    items: [
      { key: "penjualan-karyawan", label: "Penjualan Karyawan", to: "/finance/penjualan-karyawan" },
      { key: "kasbon", label: "Kasbon", to: "/finance/kasbon" },
      { key: "uang-muka", label: "Uang Muka Operasional", to: "/finance/uang-muka" },
    ],
  },
  {
    key: "persediaan", label: "Persediaan & HPP", ikon: "persediaan",
    items: [
      { key: "biaya-bahan", label: "Biaya Bahan per Unit", to: "/finance/biaya-bahan" },
      // Satu halaman nyata ("Tutup Stok & Persediaan Awal"); tidak dipecah jadi dua tab yang membuka halaman sama.
      { key: "persediaan-awal", label: "Persediaan Awal & Tutup Stok", to: "/finance/persediaan-awal" },
    ],
  },
  {
    key: "pembukuan", label: "Pembukuan", ikon: "pembukuan",
    items: [
      { key: "jurnal", label: "Jurnal Umum", to: "/finance/journal" },
      { key: "buku-besar", label: "Buku Besar", to: "/finance/ledger" },
      { key: "akun", label: "Bagan Akun", to: "/finance/accounts" },
    ],
  },
  {
    key: "laporan", label: "Laporan", ikon: "laporan",
    items: [
      { key: "keuangan", label: "Laporan Keuangan", to: "/finance/reports" },
      { key: "divisi", label: "Laporan Divisi", to: "/finance/laporan-divisi" },
    ],
  },
  {
    key: "pengaturan", label: "Pengaturan", ikon: "pengaturan",
    items: [
      { key: "pengaturan", label: "Pengaturan Finance", to: "/finance/settings" },
      { key: "pengecualian", label: "Pengecualian Tanggal Lunas", to: "/finance/pengecualian-lunas" },
    ],
  },
]);

/** Sumber angka badge: kunci → field `antrean` pada GET /finance/dashboard (angka dari server apa adanya). */
export const BADGE_SUMBER = Object.freeze({
  pembayaranBelumVerifikasi: "jumlahPembayaranBelumVerifikasi",
  refundMenunggu: "refundMenunggu",
  pengeluaranMenunggu: "pengeluaranMenunggu",
  pembelianMenunggu: "pembelianMenunggu",
  tagihanMenunggu: "tagihanMenunggu",
});

const parse = (to) => { const { base, search } = splitPathQuery(to); return { base, params: new URLSearchParams(search || "") }; };

/** Item hub yang cocok dengan lokasi (path + ?tab=), atau null bila bukan halaman hub Finance. Pencocokan: path persis; bila beberapa item berbagi path, ?tab= menentukan. */
export function cariItemHub(pathname, search = "") {
  const { base: path } = splitPathQuery(pathname);
  const tab = new URLSearchParams(search || "").get("tab") ?? "";
  let kandidat = null;
  for (const hub of FINANCE_HUBS) {
    for (const item of hub.items) {
      const { base } = parse(item.to);
      if (base !== path) continue;
      if (!item.tabs) return { hub, item };
      if (item.tabs.includes(tab)) return { hub, item };
      kandidat = kandidat ?? { hub, item };
    }
  }
  return kandidat;
}

/** Hub yang aktif untuk lokasi ini (key), atau null. */
export const hubAktif = (pathname, search = "") => cariItemHub(pathname, search)?.hub.key ?? null;

const boleh = (item, roles) => !item.bolehPeran || (roles || []).some((r) => item.bolehPeran.includes(r));

/** Hub dengan item yang boleh dilihat peran ini; hub tanpa item tersisa dibuang. `to` hub = item pertama yang terlihat. */
export function hubTerlihat(roles) {
  return FINANCE_HUBS
    .map((h) => ({ ...h, items: h.items.filter((i) => boleh(i, roles)) }))
    .filter((h) => h.items.length > 0)
    .map((h) => ({ ...h, to: h.items[0].to }));
}

/** Semua rute lama Finance → { hub, tab } untuk dokumentasi/tes pemetaan; satu entri per item (path + ?tab=). */
export function petaRuteLama() {
  return FINANCE_HUBS.flatMap((h) => h.items.map((i) => ({ rute: i.to, hub: h.key, hubLabel: h.label, tab: i.label })));
}

/** Angka badge item dari `antrean` server; 0/undefined → null (tidak ditampilkan). Tanpa hitungan baru. */
export function badgeItem(item, antrean) {
  if (!item.badge || !antrean) return null;
  const n = Number(antrean[BADGE_SUMBER[item.badge]]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Badge hub = jumlah angka antrean item-itemnya (penjumlahan hitungan antrean dari server, bukan angka keuangan). null bila 0. */
export function badgeHub(hub, antrean) {
  const total = hub.items.reduce((a, i) => a + (badgeItem(i, antrean) ?? 0), 0);
  return total > 0 ? total : null;
}
