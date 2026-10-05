// P12B.2 — logika murni hub bertab (TabbedHub.jsx): pilih tab dari ?tab=, bentuk path baru, dan aturan kunci lama → baru.
// Terpisah dari JSX supaya diuji `node --test`.
export function pickTab(tabs, requestedKey, defaultKey) {
  const visible = tabs.filter((t) => !t.hidden);
  if (visible.some((t) => t.key === requestedKey)) return requestedKey;
  if (visible.some((t) => t.key === defaultKey)) return defaultKey;
  return visible[0]?.key ?? null;
}

// "/bengkel/kpi?tab=meja&x=1" + tab "pic" → "/bengkel/kpi?tab=pic&x=1" (parameter lain dipertahankan).
export function withTabParam(pathWithQuery, key, param = "tab") {
  const q = pathWithQuery.indexOf("?");
  const base = q === -1 ? pathWithQuery : pathWithQuery.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : pathWithQuery.slice(q + 1));
  params.set(param, key);
  return `${base}?${params.toString()}`;
}

// P12B.3 — varian satu-parameter (filter ringan). `defaultKey` untuk parameter non-"tab" TIDAK ditulis ke URL (URL bersih untuk tampilan bawaan).
export function pickParam(validKeys, requested, defaultKey) {
  return validKeys.includes(requested) ? requested : defaultKey;
}
export function withParam(pathWithQuery, param, value, defaultKey) {
  const q = pathWithQuery.indexOf("?");
  const base = q === -1 ? pathWithQuery : pathWithQuery.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : pathWithQuery.slice(q + 1));
  if (param !== "tab" && value === defaultKey) params.delete(param); else params.set(param, value);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
