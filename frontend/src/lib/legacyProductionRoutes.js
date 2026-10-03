// P12B.2 — rute Production LAMA tidak lagi punya halaman. Setiap URL lama dialihkan ke halaman kanonis baru (bookmark, tab tersimpan,
// tautan dalam halaman). Murni data (tanpa JSX) supaya diuji `node --test`. Tidak ada database/migration/backend yang dihapus.
import { splitPathQuery } from "./splitPathQuery.js";

// base-path lama → { to: tujuan kanonis, standalone: tujuan bukan bagian kerangka tab (aplikasi mandiri) }
export const LEGACY_PRODUCTION_REDIRECTS = Object.freeze({
  "/bengkel": { to: "/bengkel/production-v2", note: "Papan Produksi (lama, V1) → Status Produksi" },
  "/bengkel/planning": { to: "/bengkel/rencana-produksi", note: "Rencana Produksi (lama, P3) → Rencana Produksi" },
  "/bengkel/workshop": { to: "/produksi/meja", standalone: true, note: "Antrean Kerja (lama, P5) → Aplikasi Meja" },
  "/bengkel/work-orders": { to: "/bengkel/order-produksi?tab=aktif", note: "Work Order (lama) → Order Produksi" },
  "/bengkel/orders": { to: "/bengkel/order-produksi?view=order", note: "Semua Order (lama) → Order Produksi, tampilan Status order" },
  "/bengkel/qc": { to: "/bengkel/quality-control", note: "Inspeksi QC (lama) → Quality Control" },
  "/bengkel/qc-v2": { to: "/bengkel/quality-control", note: "Antrean QC V2 (lama) → Quality Control" },
  "/bengkel/pengajuan-biaya": { to: "/bengkel/biaya-produksi?tab=pengajuan", note: "Pengajuan Biaya → Biaya Produksi" },
  "/bengkel/laporan-biaya": { to: "/bengkel/biaya-produksi?tab=laporan", note: "Laporan Biaya → Biaya Produksi" },
  "/bengkel/work-centers": { to: "/bengkel/pengaturan?tab=area-kerja", note: "Work Center → Pengaturan" },
  "/bengkel/operators": { to: "/bengkel/pengaturan?tab=operator", note: "Operator → Pengaturan" },
  "/bengkel/layanan-tahapan": { to: "/bengkel/pengaturan?tab=layanan", note: "Layanan & Tahapan → Pengaturan" },
  "/bengkel/scope-revisions": { to: "/bengkel/komplain-revisi?tab=revisi", note: "Komplain & Revisi (lama) → Komplain & Revisi" },
  "/bengkel/reports": { to: "/bengkel/kpi?tab=laporan", note: "Laporan Produksi (lama) → KPI & Laporan" },
});
// Fallback untuk tab tersimpan yang tujuannya halaman mandiri (tidak bisa hidup sebagai tab).
export const STANDALONE_TAB_FALLBACK = "/bengkel/ringkasan";

// Kunci tab hub lama → baru (URL ?tab=… yang sudah terlanjur dibookmark).
const ORDER_TAB_MAP = { "work-order": "aktif", "semua-order": "semua-order" };

// Mengembalikan { to, standalone } untuk path(+query) lama, atau null bila bukan rute lama. Query tambahan dari URL lama dipertahankan
// (kecuali ?tab/?status Order Produksi yang diterjemahkan ke kunci tab baru).
// P12B.4 — halaman "Unit" lama (/bengkel/units/:id) dihapus dari UI Production; detail unit = drawer Unit 360 di Order Produksi (?unit=<id>).
// Hanya SATU segmen id (bukan sub-path lain) yang dialihkan.
const LEGACY_UNIT_RE = new RegExp("^/bengkel/units/([^/?#]+)/?$");
export const unitDetailPath = (unitId) => `/bengkel/order-produksi?unit=${encodeURIComponent(unitId)}`;

export function legacyRedirectFor(pathWithQuery) {
  const { base, search } = splitPathQuery(pathWithQuery);
  const unitHit = base.match(LEGACY_UNIT_RE);
  if (unitHit) return { to: unitDetailPath(decodeURIComponent(unitHit[1])), standalone: false };
  const hit = LEGACY_PRODUCTION_REDIRECTS[base];
  if (hit) {
    const [toBase, toQuery = ""] = hit.to.split("?");
    const merged = new URLSearchParams(toQuery);
    for (const [k, v] of new URLSearchParams(search || "")) if (!merged.has(k)) merged.set(k, v);
    const qs = merged.toString();
    return { to: qs ? `${toBase}?${qs}` : toBase, standalone: !!hit.standalone };
  }
  if (base === "/bengkel/order-produksi" && search) {
    const p = new URLSearchParams(search);
    const t = p.get("tab");
    if (t && ORDER_TAB_MAP[t]) {
      if (ORDER_TAB_MAP[t] === "semua-order") return { to: `${base}?view=order`, standalone: false }; // "Semua Order" level order → tampilan sekunder Status order
      const delivered = p.get("status") === "DELIVERED";
      const next = new URLSearchParams();
      next.set("tab", ORDER_TAB_MAP[t] === "aktif" && delivered ? "riwayat" : ORDER_TAB_MAP[t]);
      return { to: `${base}?${next.toString()}`, standalone: false };
    }
    if (!t && p.get("status") === "DELIVERED") return { to: `${base}?tab=riwayat`, standalone: false };
  }
  return null;
}

// Untuk path yang akan DISIMPAN sebagai tab: tujuan mandiri diganti fallback, rute lama diterjemahkan, selain itu apa adanya.
export function tabPathFor(pathWithQuery) {
  const r = legacyRedirectFor(pathWithQuery);
  if (!r) return pathWithQuery;
  return r.standalone ? STANDALONE_TAB_FALLBACK : r.to;
}

export function isLegacyProductionRoute(path) {
  return legacyRedirectFor(path) !== null;
}
