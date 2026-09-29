// P8.2 (UI Polish) — kecocokan "aktif" menu sidebar, EKSPLISIT dan testable
// lewat `node --test` (pageRegistry.jsx/SidebarLink.jsx mengandung JSX,
// tidak bisa diimpor test runner itu langsung). Dipisah dari komponen supaya
// aturannya jelas dan diuji, bukan bergantung ke perilaku bawaan NavLink.
//
// Bug NYATA yang diperbaiki (ditemukan dari screenshot live P8.1):
//   1. NavLink React Router TANPA `end` mencocokkan berdasarkan PREFIX
//      pathname — item lama "/bengkel" (Papan Produksi V1, section Legacy)
//      jadi ikut aktif untuk SEMUA route baru di bawahnya ("/bengkel/
//      production-v2", "/bengkel/order-produksi", dst), karena semuanya
//      berawalan "/bengkel". Diperbaiki: pathname harus SAMA PERSIS
//      (bukan prefix) — lihat basePathMatches.
//   2. "Order Produksi" (/bengkel/order-produksi) dan "Riwayat" (/bengkel/
//      order-produksi?tab=work-order&status=DELIVERED) berbagi PATHNAME
//      yang sama persis — keduanya akan sama-sama tampak "aktif" kalau
//      hanya pathname yang dibandingkan. Item BERQUERY menang (lebih
//      spesifik) kalau query-nya terpenuhi; item TANPA query hanya aktif
//      kalau tidak ada "saudara" berquery yang lebih spesifik yang cocok.
import { splitPathQuery } from "./splitPathQuery.js";

// Semua pasangan query wajib item HARUS ada (dengan nilai sama persis) di
// query URL saat ini — query URL boleh punya parameter LAIN di luar itu
// (subset match), supaya tidak rapuh terhadap parameter tambahan yang tidak
// terkait navigasi (mis. dari state halaman itu sendiri).
export function searchParamsSatisfy(requiredSearch, currentSearch) {
  if (!requiredSearch) return true;
  const req = new URLSearchParams(requiredSearch);
  const cur = new URLSearchParams(currentSearch || "");
  for (const [k, v] of req.entries()) {
    if (cur.get(k) !== v) return false;
  }
  return true;
}

// `item`: { to } — entri menu yang diperiksa.
// `siblings`: seluruh item menu SATU divisi (flat, lintas section) — dipakai
// untuk mendeteksi "saudara" berquery yang lebih spesifik berbagi pathname
// yang sama, supaya item TANPA query tahu kapan harus mengalah.
export function isSidebarItemActive(item, siblings, currentPathname, currentSearch) {
  const { base, search } = splitPathQuery(item.to);
  if (base !== currentPathname) return false;
  if (search) return searchParamsSatisfy(search, currentSearch);
  const moreSpecificSiblingMatches = (siblings || []).some((other) => {
    if (other === item || other.to === item.to) return false;
    const o = splitPathQuery(other.to);
    return o.base === base && o.search && searchParamsSatisfy(o.search, currentSearch);
  });
  return !moreSpecificSiblingMatches;
}
