// Tab dalam-app yang tetap di-mount di background (optimasi 13 Nov 2026 —
// lihat catatan di components/TabbedContent.jsx). Murni, dites di
// tests/tabHidup.test.js.
export const MAKS_TAB_HIDUP = 6;

// Urutan tab yang pernah dibuka sesi ini, terbaru dulu: tab aktif selalu di
// depan, tab yang sudah ditutup dibuang, sisanya dipotong di `maks`.
export function urutanTabHidup(sebelumnya, aktifId, idAda, maks = MAKS_TAB_HIDUP) {
  const ada = new Set(idAda);
  return [aktifId, ...sebelumnya.filter((id) => id !== aktifId && ada.has(id))].slice(0, maks);
}
