// KONFIRMASI KESIAPAN FISIK UNIT (pengecualian operasional Delivery, mode transisi) — 14 Okt 2026.
//
// Selama workspace Produksi belum lengkap, sebuah unit bisa SUDAH SIAP secara nyata (barang jadi di workshop) padahal progres digital Produksi belum ada / alurnya belum dipetakan.
// Admin Produksi / dispatcher yang berwenang dapat mengonfirmasi kesiapan FISIK per unit — dengan alasan, pelaku, waktu (server), dan bukti bila ada. Ini HANYA pengecualian Delivery:
//   • TIDAK mengubah status unit, tahap Produksi, jurnal, stok, atau harga, dan TIDAK menyatakan seluruh unit selesai.
//   • Hanya berlaku pada unit yang DIPILIH (bukan seluruh order). Unit yang tidak ada/belum siap fisik tidak pernah ikut job diam-diam; pengiriman sebagian memakai alur resmi.
//   • Hanya di mode TRANSISI (services/produksiRuteMode.js). Di mode KETAT konfirmasi lama diabaikan dan yang baru ditolak.
//   • Jejak = baris append-only di delivery_execution_events (action UNIT_READY_PHYSICAL); tanpa tabel/kolom baru. Idempoten per Idempotency-Key.
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { bacaModeRute, MODE_RUTE } from "./produksiRuteMode.js";
import { suggestDeliveryJob } from "./deliveryHandoff.js";
import { AKSI_SIAP_FISIK, STATUS_SIAP_PRODUKSI, SUDAH_BERANGKAT } from "./deliverySiapFisik.js";
export { AKSI_SIAP_FISIK, bacaSiapFisik, nilaiSiap, periksaUnitSiapKirim } from "./deliverySiapFisik.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLA_KUNCI = /^[A-Za-z0-9._:-]{8,128}$/;

export class KesiapanFisikError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.name = "KesiapanFisikError"; this.statusCode = statusCode; this.code = code; if (extra) this.extra = extra; }
}
const gagal = (m, s, c, e) => new KesiapanFisikError(m, s, c, e);

/** Catat konfirmasi (di transaksi pemanggil). Mengembalikan { replayed, unit, sudahSiap, jobDibuat }. */
export async function catatKesiapanFisik(tx, { orderId, unitIds, alasan, idempotencyKey, userId = null, bukti = null }) {
  if (!idempotencyKey || !POLA_KUNCI.test(String(idempotencyKey))) throw gagal("Header Idempotency-Key wajib (8–128 karakter) untuk konfirmasi kesiapan fisik", 428, "IDEMPOTENCY_KEY_REQUIRED");
  const teks = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (teks.length < 5) throw gagal("Alasan konfirmasi kesiapan fisik wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (teks.length > 500) throw gagal("Alasan maksimal 500 karakter", 400, "ALASAN_TERLALU_PANJANG");
  if (!Array.isArray(unitIds) || unitIds.length === 0) throw gagal("Pilih minimal satu unit yang nyata sudah siap", 400, "UNIT_WAJIB");
  if (unitIds.length > 50 || unitIds.some((u) => !UUID.test(String(u)))) throw gagal("Daftar unit tidak valid", 400, "UNIT_TIDAK_VALID");
  const pilih = [...new Set(unitIds.map(String))].sort();
  const buktiTeks = bukti == null ? null : String(bukti).trim().slice(0, 300) || null;
  if (typeof orderId !== "string" || orderId.length < 8 || orderId.length > 64) throw gagal("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");

  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId);
  const kunciEvent = `kesiapan-fisik:${orderId}:${idempotencyKey}`;
  const ada = await tx.deliveryExecutionEvent.findUnique({ where: { idempotencyKey: kunciEvent } });
  if (ada) {
    const sama = JSON.stringify([...(ada.payload?.unitIds ?? [])].sort()) === JSON.stringify(pilih) && ada.payload?.alasan === teks;
    if (!sama) throw gagal("Idempotency-Key ini sudah dipakai untuk konfirmasi lain. Pakai kunci baru.", 409, "IDEMPOTENCY_KEY_DIPAKAI");
    return { replayed: true, unit: ada.payload.unitCodes ?? [], sudahSiap: ada.payload.sudahSiapProduksi ?? [], jobDibuat: null };
  }
  if ((await bacaModeRute(tx)) !== MODE_RUTE.TRANSISI) {
    throw gagal("Mode rute Produksi KETAT: kesiapan hanya mengikuti status unit di Produksi. Konfirmasi fisik tidak diterima.", 409, "MODE_KETAT");
  }
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, status: true, penjualanKaryawanId: true, penjualanKaryawan: { select: { nomor: true } } } });
  if (!order) throw gagal("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  if (!order.penjualanKaryawanId) throw gagal("Konfirmasi kesiapan fisik hanya untuk order Penjualan Karyawan", 409, "BUKAN_ORDER_PKR");
  if (order.status === "CANCELLED") throw gagal("Order sudah dibatalkan", 409, "ORDER_DIBATALKAN");
  await tx.$queryRawUnsafe('SELECT id FROM units WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', pilih);
  const unit = await tx.unit.findMany({ where: { id: { in: pilih } }, select: { id: true, unitCode: true, status: true, orderId: true } });
  const peta = new Map(unit.map((u) => [u.id, u]));
  const baru = []; const sudahSiap = [];
  for (const id of pilih) {
    const u = peta.get(id);
    if (!u || u.orderId !== order.id) throw gagal("Ada unit yang bukan bagian dari order ini", 400, "UNIT_BUKAN_BAGIAN_ORDER");
    if (SUDAH_BERANGKAT.includes(u.status)) throw gagal(`Unit ${u.unitCode} berstatus ${u.status} — tidak bisa dikonfirmasi siap.`, 409, "UNIT_TIDAK_VALID_STATUS");
    if (STATUS_SIAP_PRODUKSI.includes(u.status)) sudahSiap.push(u.unitCode); else baru.push(u);
  }
  if (baru.length === 0) throw gagal("Semua unit yang dipilih sudah ditandai siap oleh Produksi — konfirmasi fisik tidak diperlukan.", 409, "SUDAH_SIAP_PRODUKSI", { unit: sudahSiap });
  await tx.deliveryExecutionEvent.create({
    data: {
      idempotencyKey: kunciEvent, action: AKSI_SIAP_FISIK, actorId: userId, source: "ADMIN_WEB",
      payload: {
        orderId: order.id, nomorOrder: order.orderNumber, nomorPkr: order.penjualanKaryawan?.nomor ?? null,
        unitIds: baru.map((u) => u.id).sort(), unitCodes: baru.map((u) => u.unitCode), alasan: teks, bukti: buktiTeks, sudahSiapProduksi: sudahSiap,
        statusProduksiSaatItu: Object.fromEntries(baru.map((u) => [u.unitCode, u.status])),
        catatan: "Pengecualian operasional Delivery. Status unit, tahap Produksi, jurnal, stok tidak diubah.",
      },
    },
  });
  const meta = { aksi: "kesiapan_fisik", nomorPkr: order.penjualanKaryawan?.nomor ?? null, penjualanId: order.penjualanKaryawanId, orderId: order.id, unit: baru.map((u) => u.unitCode), alasan: teks };
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: order.id, eventType: EVENT_TYPES.PKR_ORDER_SINKRON, actorId: userId, metadata: meta });
  // Jalur baku: bila seluruh unit yang dikirim kini siap (Produksi atau fisik), SATU job gabungan dibuat otomatis (idempoten, tidak menyisipkan ke job yang sudah ada).
  let jobDibuat = null;
  for (const u of baru) { const j = await suggestDeliveryJob(tx, u.id); if (j) jobDibuat = j; }
  return { replayed: false, unit: baru.map((u) => u.unitCode), sudahSiap, jobDibuat };
}
