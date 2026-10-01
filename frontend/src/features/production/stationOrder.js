// Urutan unit di satu meja (Rencana Produksi) — logika MURNI, tanpa React.
// Aturan (sama dengan server, backend/src/lib/domain/productionBoard.js#compareStationOrder):
//  - urutan MANUAL (plan.stationSequence, diatur lewat seret-lepas / tombol Naik-Turun) selalu menang;
//  - prioritas HANYA urutan bawaan untuk kartu yang belum bernomor (prioritas tinggi dulu, lalu target mulai paling awal);
//  - kartu bernomor selalu di atas kartu yang belum bernomor.
export function compareStationOrder(a, b) {
  const sa = a?.stationSequence ?? null;
  const sb = b?.stationSequence ?? null;
  if (sa != null && sb != null && sa !== sb) return sa - sb;
  if (sa != null && sb == null) return -1;
  if (sa == null && sb != null) return 1;
  return ((b?.priority ?? 0) - (a?.priority ?? 0))
    || (new Date(a?.targetStartAt || 0).getTime() - new Date(b?.targetStartAt || 0).getTime());
}

export const orderedStationItems = (items) => [...(items || [])].sort((a, b) => compareStationOrder(a.plan, b.plan));
export const hasManualOrder = (items) => (items || []).some((v) => v.plan?.stationSequence != null);

// Pindahkan satu id satu langkah. Mengembalikan array baru, atau null bila tidak mungkin (sudah di ujung / id tak ada).
export function moveStep(ids, id, delta) {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

// Seret `dragId` ke sebelum/sesudah `targetId`. Null bila hasilnya tidak berubah atau salah satu id tidak ada.
export function moveRelativeTo(ids, dragId, targetId, position = "before") {
  if (dragId === targetId) return null;
  const from = ids.indexOf(dragId);
  if (from < 0 || ids.indexOf(targetId) < 0) return null;
  const rest = ids.filter((id) => id !== dragId);
  const at = rest.indexOf(targetId) + (position === "after" ? 1 : 0);
  const next = [...rest.slice(0, at), dragId, ...rest.slice(at)];
  return next.every((id, i) => id === ids[i]) ? null : next;
}

// Posisi lepas relatif kartu sasaran: separuh atas = sebelum, separuh bawah = sesudah.
export const dropPosition = (clientY, rect) => (clientY < rect.top + rect.height / 2 ? "before" : "after");
