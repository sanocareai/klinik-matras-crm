// SATUAN PAKAI BAHAN — akses pengaturan (production_settings, kunci `satuan_pakai_bahan`). Aturan bawaan ada di lib/domain/satuanPakaiBahan.js (keputusan Owner 4 Nov 2026: LIST WIBING 1 ROLL = 90 METER);
// penimpaan hanya lewat penulis ini: izin pengelola (UNIT_ROUTING_WRITE) ditegakkan route, tiap perubahan tercatat di log aktivitas pengaturan. Mengubah faktor TIDAK mengubah pergerakan stok yang sudah tercatat
// (jumlah meter tiap pergerakan tersimpan di catatannya). Tanpa penimpaan = aturan bawaan.
import { ENTITY_TYPES, EVENT_TYPES, recordActivity } from "../lib/activityLog.js";
import { ATURAN_BAWAAN, aturanBerlaku, galatAturan, ringkasAturan } from "../lib/domain/satuanPakaiBahan.js";

export const KUNCI_SATUAN_PAKAI = "satuan_pakai_bahan";
const galat = (pesan, status, code) => Object.assign(new Error(pesan), { statusCode: status, code });

export async function bacaPenimpaanSatuanPakai(db) {
  const row = await db.productionSetting.findUnique({ where: { key: KUNCI_SATUAN_PAKAI } });
  return row?.value ?? null;
}
export async function muatAturanSatuanPakai(db) { return aturanBerlaku(await bacaPenimpaanSatuanPakai(db)); }
/** Aturan yang berlaku + bawaannya (untuk layar pengaturan/baca). */
export async function lihatAturanSatuanPakai(db) {
  const penimpaan = await bacaPenimpaanSatuanPakai(db);
  return { bawaan: ATURAN_BAWAAN.map((a) => ({ ...a, ringkas: ringkasAturan(a) })), penimpaan: penimpaan?.aturan ?? [], berlaku: aturanBerlaku(penimpaan).map((a) => ({ ...a, ringkas: ringkasAturan(a) })) };
}
/** Simpan penimpaan (seluruh daftar). Setiap aturan divalidasi; alasan wajib (10–300). Mengembalikan aturan yang berlaku. */
export async function simpanPenimpaanSatuanPakai(prisma, { aturan, alasan, actorId }) {
  if (!Array.isArray(aturan) || aturan.length > 50) throw galat("Daftar aturan tidak valid (maksimal 50).", 400, "SATUAN_PAKAI_ATURAN_TIDAK_VALID");
  for (const a of aturan) { const g = a?.nonaktif === true ? (/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(String(a.awalan ?? "")) ? null : "Awalan kode bahan tidak valid.") : galatAturan(a); if (g) throw galat(g, 400, "SATUAN_PAKAI_ATURAN_TIDAK_VALID"); }
  const teks = String(alasan ?? "").trim(); if (teks.length < 10 || teks.length > 300) throw galat("Alasan perubahan wajib diisi (10–300 karakter).", 400, "SATUAN_PAKAI_ALASAN_WAJIB");
  const bersih = aturan.map((a) => (a.nonaktif === true ? { awalan: a.awalan, nonaktif: true } : { awalan: a.awalan, satuanStok: a.satuanStok, satuanPakai: a.satuanPakai, faktor: Number(a.faktor), catatan: a.catatan ? String(a.catatan).slice(0, 200) : null }));
  await prisma.$transaction(async (tx) => {
    await tx.productionSetting.upsert({ where: { key: KUNCI_SATUAN_PAKAI }, create: { key: KUNCI_SATUAN_PAKAI, value: { aturan: bersih }, updatedById: actorId || null }, update: { value: { aturan: bersih }, updatedById: actorId || null } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.PRODUCTION_SETTING, entityId: KUNCI_SATUAN_PAKAI, eventType: EVENT_TYPES.PRODUCTION_SETTING_CHANGED, actorId: actorId || null, metadata: { key: KUNCI_SATUAN_PAKAI, label: "Satuan pakai bahan", to: bersih, alasan: teks } });
  });
  return lihatAturanSatuanPakai(prisma);
}
