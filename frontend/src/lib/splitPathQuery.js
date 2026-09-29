// P8.1 (UI & Navigation Consolidation) — dipakai resolveEntryPath()
// (routes/pageRegistry.jsx) untuk memisah query string SEBELUM dicocokkan ke
// PAGES lewat matchPath (yang tidak paham "?..." menempel di pathname).
// Dipisah ke sini (modul .js polos, tanpa JSX) supaya bisa diuji langsung
// lewat `node --test` — pageRegistry.jsx sendiri tidak bisa diimpor test
// runner itu (mengandung JSX & import react-router-dom).
export function splitPathQuery(pathname) {
  const qIndex = pathname.indexOf("?");
  if (qIndex === -1) return { base: pathname, search: "" };
  return { base: pathname.slice(0, qIndex), search: pathname.slice(qIndex) };
}

// P8.2 (UI Polish) — bentuk KANONIK path+query, dipakai dedup tab
// (findTabIndexByPath, dedupeTabs) supaya dua path yang SECARA MAKNA sama
// (cuma beda urutan parameter query, mis. "?status=DELIVERED&tab=work-
// order" vs "?tab=work-order&status=DELIVERED") dianggap tab yang SAMA,
// bukan dua tab terpisah. Parameter diurutkan berdasarkan kunci; nilai
// TIDAK diubah.
export function canonicalizeTabPath(pathname) {
  const { base, search } = splitPathQuery(pathname);
  if (!search) return base;
  const params = new URLSearchParams(search);
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = new URLSearchParams(sorted).toString();
  return qs ? `${base}?${qs}` : base;
}
