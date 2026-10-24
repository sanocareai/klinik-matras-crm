// ASAL KOREKSI SALDO — penelusuran "koreksi saldo bahan (Penyesuaian Stok) ini dipicu apa". Saldo TIDAK pernah ditimpa: koreksi tetap permintaan penyesuaian yang wajib disetujui orang lain.
// Asal yang dikenal: USAGE_NOTE (catatan pemakaian historis), UNIT_USAGE (pemakaian per order = id unit), MOVEMENT (pergerakan stok). Dipakai route penyesuaian (validasi) dan Order Produksi (riwayat + bagian Catatan).
export const ASAL_KOREKSI_TIPE = ["USAGE_NOTE", "UNIT_USAGE", "MOVEMENT"];
const koma = (v) => String(Math.round(Number(v) * 10000) / 10000).replace(".", ",");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AsalKoreksiError extends Error { constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; } }

/** Memastikan asal ada dan menyangkut BAHAN yang sama dengan koreksi saldo. Tanpa menulis. Mengembalikan ringkasan asal. */
export async function validasiAsalKoreksi(db, { originType, originId, materialId }) {
  if (!ASAL_KOREKSI_TIPE.includes(originType)) throw new AsalKoreksiError("originType tidak dikenal");
  const id = String(originId ?? "");
  if (!UUID.test(id)) throw new AsalKoreksiError("originId bukan id yang valid");
  if (originType === "USAGE_NOTE") {
    const n = await db.unitUsageNote.findUnique({ where: { id }, select: { id: true, materialId: true, unitId: true, orderNumber: true } });
    if (!n) throw new AsalKoreksiError("Catatan asal tidak ditemukan", 404);
    if (n.materialId && n.materialId !== materialId) throw new AsalKoreksiError("Catatan asal untuk bahan lain; koreksi saldo harus untuk bahan yang sama", 409);
    return { tipe: originType, id, unitId: n.unitId, order: n.orderNumber };
  }
  if (originType === "UNIT_USAGE") {
    const u = await db.unit.findUnique({ where: { id }, select: { id: true, unitCode: true } });
    if (!u) throw new AsalKoreksiError("Unit asal tidak ditemukan", 404);
    return { tipe: originType, id, unitId: u.id, unit: u.unitCode };
  }
  const m = await db.stockMovement.findUnique({ where: { id }, select: { id: true, materialId: true, unitId: true } });
  if (!m) throw new AsalKoreksiError("Pergerakan asal tidak ditemukan", 404);
  if (m.materialId !== materialId) throw new AsalKoreksiError("Pergerakan asal untuk bahan lain; koreksi saldo harus untuk bahan yang sama", 409);
  return { tipe: originType, id, unitId: m.unitId };
}

/** Ringkasan asal untuk tampilan detail penyesuaian (baca-saja): jenis, unit/order yang dituju. Null bila asal tak ditemukan. */
export async function ringkasAsalKoreksi(db, { originType, originId }) {
  if (!originType || !originId) return null;
  const NAMA = { USAGE_NOTE: "Catatan pemakaian historis", UNIT_USAGE: "Koreksi pemakaian per order", MOVEMENT: "Pergerakan stok" };
  let unitId = null;
  if (originType === "USAGE_NOTE") unitId = (await db.unitUsageNote.findUnique({ where: { id: originId }, select: { unitId: true } }))?.unitId ?? null;
  else if (originType === "UNIT_USAGE") unitId = originId;
  else if (originType === "MOVEMENT") unitId = (await db.stockMovement.findUnique({ where: { id: originId }, select: { unitId: true } }))?.unitId ?? null;
  const unit = unitId ? await db.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true } }) : null;
  return { tipe: originType, label: NAMA[originType] ?? originType, unitId: unit?.id ?? null, unitCode: unit?.unitCode ?? null };
}

const SELECT = { id: true, adjustmentNumber: true, status: true, beforeQty: true, adjustmentQty: true, reason: true, originType: true, originId: true, createdAt: true, approvedAt: true, postedAt: true, updatedAt: true, material: { select: { id: true, code: true, name: true, unit: true } }, requestedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, postedBy: { select: { name: true } } };

/** Semua koreksi saldo yang asalnya menyangkut unit ini (catatan unit, pemakaian unit, atau pergerakan unit). */
export async function koreksiSaldoUnit(db, unitId) {
  const [notes, movs] = await Promise.all([
    db.unitUsageNote.findMany({ where: { unitId }, select: { id: true } }),
    db.stockMovement.findMany({ where: { unitId }, select: { id: true } }),
  ]);
  const ids = [unitId, ...notes.map((n) => n.id), ...movs.map((m) => m.id)];
  const rows = await db.stockAdjustmentRequest.findMany({ where: { originType: { in: ASAL_KOREKSI_TIPE }, originId: { in: ids } }, select: SELECT, orderBy: { createdAt: "asc" } });
  const NAMA_ASAL = { USAGE_NOTE: "catatan pemakaian historis", UNIT_USAGE: "pemakaian unit ini", MOVEMENT: "pergerakan stok unit ini" };
  return rows.map((r) => {
    const sesudah = Number(r.beforeQty) + Number(r.adjustmentQty); const sat = r.material.unit;
    return { id: r.id, nomor: r.adjustmentNumber, status: r.status, bahan: { id: r.material.id, kode: r.material.code, nama: r.material.name, satuan: sat }, saldoSebelum: Number(r.beforeQty), selisih: Number(r.adjustmentQty), saldoSesudahPerkiraan: Math.round(sesudah * 10000) / 10000,
      alasan: r.reason, asal: { tipe: r.originType, id: r.originId, label: NAMA_ASAL[r.originType] }, diajukanOleh: r.requestedBy?.name ?? null, diajukanPada: r.createdAt, disetujuiOleh: r.approvedBy?.name ?? null, disetujuiPada: r.approvedAt, dipostingOleh: r.postedBy?.name ?? null, dipostingPada: r.postedAt, diperbaruiPada: r.updatedAt };
  });
}

/** Entri Riwayat unit: diajukan / disetujui / diposting / dibatalkan, lengkap sebelum–sesudah, alasan, pelaku, asal. */
export function riwayatKoreksiSaldo(daftar) {
  const out = [];
  for (const k of daftar) {
    const uraian = `${k.bahan.nama}: saldo ${koma(k.saldoSebelum)} → ${koma(k.saldoSesudahPerkiraan)} ${k.bahan.satuan} (selisih ${k.selisih > 0 ? "+" : ""}${koma(k.selisih)})`;
    out.push({ kind: "KOREKSI_SALDO_DIAJUKAN", sumber: "KOREKSI_SALDO", at: k.diajukanPada, actor: k.diajukanOleh, label: `Koreksi saldo ${k.nomor} diajukan — ${uraian}. Asal: ${k.asal.label}. Alasan: ${k.alasan}`, before: { saldo: k.saldoSebelum }, after: { saldo: k.saldoSesudahPerkiraan } });
    if (k.disetujuiPada) out.push({ kind: "KOREKSI_SALDO_DISETUJUI", sumber: "KOREKSI_SALDO", at: k.disetujuiPada, actor: k.disetujuiOleh, label: `Koreksi saldo ${k.nomor} disetujui (stok belum berubah sampai diposting)` });
    if (k.status === "POSTED" && k.dipostingPada) out.push({ kind: "KOREKSI_SALDO_DIPOSTING", sumber: "KOREKSI_SALDO", at: k.dipostingPada, actor: k.dipostingOleh, label: `Koreksi saldo ${k.nomor} diposting ke stok — ${uraian}` });
    if (k.status === "CANCELLED") out.push({ kind: "KOREKSI_SALDO_DIBATALKAN", sumber: "KOREKSI_SALDO", at: k.diperbaruiPada, actor: null, label: `Koreksi saldo ${k.nomor} dibatalkan (saldo tidak berubah)` });
  }
  return out;
}
