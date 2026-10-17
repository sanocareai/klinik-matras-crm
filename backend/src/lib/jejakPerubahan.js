// JEJAK PERUBAHAN DRAF (Okt 2026) — dokumen Gudang yang BELUM diposting boleh diedit sesuai izin, tetapi setiap perubahan harus meninggalkan jejak sebelum–sesudah (siapa, kapan, apa).
// Dipakai di dalam transaksi pemanggil; hanya menulis log aktivitas (append-only), tidak pernah mengubah dokumen atau stok.
import { recordActivity, EVENT_TYPES } from "./activityLog.js";

const ABAIKAN = new Set(["approvedById", "approvedAt", "receivedAt", "inspectedAt", "updatedAt"]);

function norm(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && typeof v.toString === "function" && v.constructor?.name === "Decimal") return v.toString();
  return typeof v === "number" || typeof v === "boolean" ? v : String(v);
}

/** { sebelum, sesudah } hanya untuk bidang di `data` yang nilainya benar-benar berbeda dari `lama`. */
export function selisihField(lama, data) {
  const sebelum = {}; const sesudah = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (ABAIKAN.has(k)) continue;
    const a = norm(lama?.[k]); const b = norm(v);
    if (a !== b) { sebelum[k] = a; sesudah[k] = b; }
  }
  return { sebelum, sesudah };
}

/** Catat DOCUMENT_EDITED bila ada bidang yang berubah. Mengembalikan true bila tercatat. */
export async function catatPerubahanDraf(tx, { entityType, entityId, actorId, nomor, lama, data, bagian = "dokumen" }) {
  const { sebelum, sesudah } = selisihField(lama, data);
  if (Object.keys(sesudah).length === 0) return false;
  await recordActivity(tx, { entityType, entityId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId, metadata: { aksi: "DRAF_DIUBAH", bagian, nomor, sebelum, sesudah } });
  return true;
}
