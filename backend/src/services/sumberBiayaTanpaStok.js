// SATU SUMBER HISTORIS = SATU JALUR (Nov 2026). Catatan pemakaian historis yang menjadi sumber biaya tanpa stok AKTIF (DIAJUKAN/DISETUJUI) tidak boleh diposting
// menjadi pengeluaran stok (ISSUE) — juga sesudah tautan SO dibatalkan atau catatan dinyatakan "belum tercermin". Dipakai rencana + eksekusi posting historis; database
// menegakkan hal yang sama lewat trigger (migrasi 20261231180000) sehingga jalur lain pun tertolak. Modul kecil tanpa impor layanan lain (menghindari impor melingkar).
export const STATUS_AKTIF_BIAYA = Object.freeze(["DIAJUKAN", "DISETUJUI"]);

/** Set id catatan (dari noteIds) yang menjadi sumber biaya tanpa stok aktif. */
export async function catatanSumberBiayaAktif(db, noteIds) {
  const ids = [...new Set((noteIds ?? []).filter(Boolean).map(String))];
  if (!ids.length) return new Set();
  const rows = await db.orderBiayaTanpaStok.findMany({ where: { sumberJenis: "CATATAN_HISTORIS", sumberRef: { in: ids }, status: { in: STATUS_AKTIF_BIAYA } }, select: { sumberRef: true } });
  return new Set(rows.map((r) => r.sumberRef));
}
