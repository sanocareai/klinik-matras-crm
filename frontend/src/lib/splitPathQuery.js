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
