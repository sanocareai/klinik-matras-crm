// IDENTITAS PENGHITUNG & PEMERIKSA SEBUAH STOCK COUNT — diturunkan dari jejak aplikasi (akun yang benar-benar login), bukan nama yang diketik.
//
//   Penghitung = akun yang memasukkan angka hasil hitung (HASIL_HITUNG_DIISI dengan angka) atau menyerahkan hitungan.
//   Pemeriksa  = akun lain yang menekan "Saya memeriksa hitungan ini" (HITUNGAN_DIPERIKSA) SESUDAH hitungan diserahkan.
//                Pemeriksaan BASI (tidak berlaku lagi) bila angka hitung diubah atau hitungan diulang sesudahnya (TANDA_DIRESET).
//                Penghitung tidak bisa menjadi pemeriksa; penugas (assignedTo) juga tidak.
// Disimpan di activity_events (tanpa migrasi), sama seperti tanda pergerakan sesi.
import { ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const AKSI_PERIKSA_HITUNGAN = "HITUNGAN_DIPERIKSA";
const AKSI_ISI = "HASIL_HITUNG_DIISI";
const AKSI_SERAHKAN = "HITUNGAN_DISERAHKAN";
const AKSI_RESET = "TANDA_DIRESET";

/** Murni. events: [{actorId, metadata, createdAt}] urut naik. Mengembalikan id akun (belum nama). */
export function turunkanIdentitas(events, { assignedToId = null } = {}) {
  const penghitungPerBaris = new Map(); // lineId → Set(actorId)
  const penghitung = new Set();
  let resetTerakhir = null; let serahTerakhir = null;
  for (const e of events) {
    const a = e.metadata?.aksi;
    if (a === AKSI_ISI && e.metadata && "countedQtyBaru" in e.metadata && e.metadata.countedQtyBaru !== null && e.actorId) {
      penghitung.add(e.actorId);
      if (e.metadata.lineId) (penghitungPerBaris.get(e.metadata.lineId) || penghitungPerBaris.set(e.metadata.lineId, new Set()).get(e.metadata.lineId)).add(e.actorId);
    } else if (a === AKSI_SERAHKAN) { serahTerakhir = e.createdAt; if (e.actorId) penghitung.add(e.actorId); }
    else if (a === AKSI_RESET) resetTerakhir = e.createdAt;
  }
  const pemeriksa = new Map(); // actorId → {pada, catatan}
  for (const e of events) {
    if (e.metadata?.aksi !== AKSI_PERIKSA_HITUNGAN || !e.actorId) continue;
    if (penghitung.has(e.actorId) || e.actorId === assignedToId) continue; // tidak sah: penghitung/penugas memeriksa dirinya sendiri
    if (!serahTerakhir || e.createdAt < serahTerakhir) continue; // sebelum hitungan diserahkan = bukan pemeriksaan hasil
    if (resetTerakhir && e.createdAt < resetTerakhir) continue; // angka berubah/hitung ulang sesudahnya
    pemeriksa.set(e.actorId, { pada: e.createdAt, catatan: e.metadata.catatan || null });
  }
  return { penghitung: [...penghitung], penghitungPerBaris, pemeriksa };
}

/** Membaca jejak + nama akun. `penghitungPerBaris` → {lineId: [nama]}. */
export async function muatIdentitasHitung(db, count) {
  const events = await db.activityEvent.findMany({
    where: { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED },
    select: { actorId: true, metadata: true, createdAt: true }, orderBy: { createdAt: "asc" },
  });
  const t = turunkanIdentitas(events, { assignedToId: count.assignedToId });
  const ids = new Set([...t.penghitung, ...t.pemeriksa.keys(), ...[...t.penghitungPerBaris.values()].flatMap((s) => [...s])]);
  const users = ids.size ? await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }) : [];
  const nama = new Map(users.map((u) => [u.id, u.name]));
  const n = (id) => nama.get(id) || id;
  return {
    penghitung: t.penghitung.map((id) => ({ id, nama: n(id) })),
    penghitungPerBaris: Object.fromEntries([...t.penghitungPerBaris].map(([lineId, s]) => [lineId, [...s].map(n)])),
    pemeriksa: [...t.pemeriksa].map(([id, v]) => ({ id, nama: n(id), pada: v.pada, catatan: v.catatan })),
    pemeriksaIds: [...t.pemeriksa.keys()],
  };
}
