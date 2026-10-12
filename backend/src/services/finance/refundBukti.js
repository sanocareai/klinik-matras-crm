// BUKTI TRANSFER REFUND (Okt 2026) — dipakai Koreksi Refund.
//
// TIDAK ada sistem penyimpanan baru: validasi isi berkas (magic bytes JPG/PNG/WEBP/PDF), batas 8 MB, nama acak di disk, label nama asli yang dibersihkan, dan penghapusan
// berkas SEMUA berasal dari klaimLunasBerkas.js (satu-satunya tempat perlindungan upload bukti); URL bertanda-tangan memakai lib/mediaSigning.js dengan label kunci sendiri.
// Yang baru hanya folder (supaya berkas refund tidak tercampur klaim Sales) dan tabel metadata fin_refund_evidences + relasi eksplisit fin_refund_evidence_links.
//
// Siklus berkas:
//   1. Unggah  -> berkas ditulis + baris STAGED (milik pengunggah). Gagal menulis baris = berkas ikut dihapus (tidak yatim).
//   2. Pratinjau/simpan koreksi -> merujuk id STAGED. Pratinjau di-ROLLBACK (tautan tidak tersimpan); simpan menautkan + STAGED -> DIGUNAKAN dalam transaksi koreksi.
//   3. Dibatalkan pengguna / tidak pernah dipakai -> dihapus eksplisit, atau disapu otomatis setelah BATAS_STAGED_MS (disapu setiap ada unggahan baru).
//   4. DIGUNAKAN -> tidak pernah berubah/terhapus (trigger DB); bukti dokumen lama tetap melekat ke dokumen lama, dokumen pengganti punya tautan sendiri.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signFile, verifyFileSignature } from "../../lib/mediaSigning.js";
import { simpanBerkas, hapusBerkasDisk, pathBerkas, berkasTersimpan, BerkasError, POLA_NAMA, MAKS_UKURAN_BYTE } from "./klaimLunasBerkas.js";
import { KoreksiError } from "./koreksiGate.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

export const REFUND_BUKTI_DIR = process.env.REFUND_BUKTI_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../data/refund-bukti");
// Disajikan lewat router /media/finance-receipts yang SUDAH ada (routes/financeMedia.js) — tidak menambah titik mount baru.
export const URL_PREFIX = "/media/finance-receipts/refund-bukti";
export const KUNCI_TTL_DETIK = 5 * 60;
export const PURPOSE = "refund-bukti-v1";
export const MAKS_BUKTI_PER_DOKUMEN = 10;
export const MAKS_STAGED_PER_USER = 20;
export const BATAS_STAGED_MS = 2 * 60 * 60 * 1000;
export const MAKS_UKURAN_MB = MAKS_UKURAN_BYTE / 1024 / 1024;
export const MODE_BUKTI = Object.freeze(["LAMA", "TAMBAH", "GANTI"]);
export const TIPE_BERKAS = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pathBukti = (storedName) => pathBerkas(storedName, REFUND_BUKTI_DIR);
export const hapusBerkasBukti = (storedName) => hapusBerkasDisk(storedName, REFUND_BUKTI_DIR);

export function urlBertandaTangan(storedName, { now = Date.now() } = {}) {
  const { exp, sig } = signFile(storedName, { ttlSeconds: KUNCI_TTL_DETIK, now, purpose: PURPOSE });
  return `${URL_PREFIX}/${storedName}?exp=${exp}&sig=${sig}`;
}
export const tandaTanganSah = (storedName, exp, sig, opsi = {}) => verifyFileSignature(storedName, exp, sig, { ...opsi, purpose: PURPOSE });

/** Bentuk respons satu bukti (URL bertanda-tangan berumur 5 menit; BUKAN path statis). */
export function bentukBukti(ev, { origin = null } = {}) {
  return {
    id: ev.id, nama: ev.originalName, tipe: ev.mimeType, pdf: ev.mimeType === "application/pdf", ukuranByte: ev.sizeBytes, status: ev.status,
    dibuat: ev.createdAt, origin, url: urlBertandaTangan(ev.storedName),
  };
}

const galat = (pesan, status, kode) => new BerkasError(pesan, status, kode);

// ── Unggah / hapus / sapu ─────────────────────────────────────────────────────────────────────────────

/** Sapu bukti STAGED yang tidak dipakai lebih dari `lamaMs` (berkas + baris). Aman dijalankan kapan saja; yang sudah DIGUNAKAN tidak pernah tersentuh. */
export async function bersihkanBuktiStaged(db, { lamaMs = BATAS_STAGED_MS, now = Date.now() } = {}) {
  const basi = await db.finRefundEvidence.findMany({ where: { status: "STAGED", createdAt: { lt: new Date(now - lamaMs) } }, select: { id: true, storedName: true } });
  let dihapus = 0;
  for (const b of basi) {
    const r = await db.finRefundEvidence.deleteMany({ where: { id: b.id, status: "STAGED" } });
    if (r.count === 1) { hapusBerkasBukti(b.storedName); dihapus += 1; }
  }
  return { dihapus };
}

/** Validasi isi berkas + simpan + catat sebagai STAGED milik pengunggah. `berkas` = { buffer, originalname } (multer memoryStorage). */
export async function unggahBukti(db, { berkas, userId }) {
  await bersihkanBuktiStaged(db).catch(() => null);
  const dipakai = await db.finRefundEvidence.count({ where: { status: "STAGED", uploadedById: userId } });
  if (dipakai >= MAKS_STAGED_PER_USER) throw galat(`Terlalu banyak bukti yang belum dipakai (${MAKS_STAGED_PER_USER}). Hapus yang tidak perlu atau selesaikan koreksi lebih dulu.`, 429, "BUKTI_STAGED_PENUH");
  const meta = simpanBerkas(berkas, { dir: REFUND_BUKTI_DIR }); // melempar BerkasError (413/415/400) SEBELUM menulis apa pun bila tidak sah
  try {
    const ev = await db.finRefundEvidence.create({
      data: { storedName: meta.storedName, originalName: meta.originalName, mimeType: meta.mimeType, sizeBytes: meta.sizeBytes, sha256: meta.sha256, uploadedById: userId, status: "STAGED" },
    });
    return bentukBukti(ev);
  } catch (e) {
    hapusBerkasBukti(meta.storedName); // baris gagal tersimpan -> berkas tidak boleh yatim
    throw e;
  }
}

/** Hapus bukti STAGED (batal pakai). Bukti yang sudah DIGUNAKAN tidak bisa dihapus. */
export async function hapusBuktiStaged(db, { id, userId, bolehSemua = false }) {
  if (!UUID.test(String(id))) throw galat("Bukti tidak ditemukan", 404, "BUKTI_TIDAK_ADA");
  const ev = await db.finRefundEvidence.findUnique({ where: { id } });
  if (!ev) throw galat("Bukti tidak ditemukan", 404, "BUKTI_TIDAK_ADA");
  if (ev.status !== "STAGED") throw galat("Bukti ini sudah dipakai dokumen refund dan tidak bisa dihapus.", 409, "BUKTI_SUDAH_DIPAKAI");
  if (ev.uploadedById !== userId && !bolehSemua) throw galat("Bukti ini diunggah pengguna lain.", 403, "BUKTI_BUKAN_MILIK");
  const r = await db.finRefundEvidence.deleteMany({ where: { id, status: "STAGED" } });
  if (r.count === 1) hapusBerkasBukti(ev.storedName);
  return { ok: true, dihapus: r.count === 1 };
}

// ── Baca ─────────────────────────────────────────────────────────────────────────────────────────────

/** Bukti yang melekat ke satu dokumen refund (relasi eksplisit) + lampiran lama (`attachmentUrl`, bila ada). */
export async function buktiDokumen(db, refund) {
  const links = await db.finRefundEvidenceLink.findMany({ where: { refundId: refund.id }, include: { evidence: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const berkas = links.map((l) => bentukBukti(l.evidence, { origin: l.origin }));
  const lampiranLama = String(refund.attachmentUrl ?? "").trim() || null;
  return { berkas, lampiranLama, jumlah: berkas.length + (lampiranLama ? 1 : 0) };
}

/** Jumlah bukti banyak dokumen sekaligus: Map refundId -> jumlah (tautan + lampiran lama). */
export async function jumlahBuktiBatch(db, refunds) {
  if (!refunds.length) return new Map();
  const per = await db.finRefundEvidenceLink.groupBy({ by: ["refundId"], where: { refundId: { in: refunds.map((r) => r.id) } }, _count: { _all: true } });
  const peta = new Map(per.map((p) => [p.refundId, p._count._all]));
  return new Map(refunds.map((r) => [r.id, (peta.get(r.id) ?? 0) + (String(r.attachmentUrl ?? "").trim() ? 1 : 0)]));
}

// ── Rencana bukti untuk dokumen pengganti (dipakai koreksi) ───────────────────────────────────────────

/** Normalisasi `body.bukti` = { mode: LAMA|TAMBAH|GANTI, ids: [uuid] }. Tanpa `bukti` = LAMA tanpa tambahan. */
export function bacaPermintaanBukti(bukti) {
  if (bukti === undefined || bukti === null) return { mode: "LAMA", ids: [] };
  if (typeof bukti !== "object" || Array.isArray(bukti)) throw new KoreksiError("Isian bukti tidak valid", 400, "BUKTI_TIDAK_VALID");
  const mode = String(bukti.mode ?? "LAMA").toUpperCase();
  if (!MODE_BUKTI.includes(mode)) throw new KoreksiError("Pilihan bukti tidak dikenal. Pilih: gunakan bukti lama, tambah bukti baru, atau ganti bukti.", 400, "BUKTI_MODE_TIDAK_VALID");
  const mentah = bukti.ids === undefined || bukti.ids === null ? [] : bukti.ids;
  if (!Array.isArray(mentah)) throw new KoreksiError("Daftar bukti baru tidak valid", 400, "BUKTI_TIDAK_VALID");
  const ids = [...new Set(mentah.map(String))];
  if (ids.some((i) => !UUID.test(i))) throw new KoreksiError("ID bukti tidak valid", 400, "BUKTI_TIDAK_VALID");
  if (mode === "LAMA" && ids.length) throw new KoreksiError("Pilihan 'gunakan bukti lama' tidak boleh disertai bukti baru. Pilih 'tambah bukti baru' bila ingin menambah.", 400, "BUKTI_MODE_TIDAK_SESUAI");
  if (mode !== "LAMA" && ids.length === 0) throw new KoreksiError("Unggah minimal satu bukti baru untuk pilihan ini.", 422, "BUKTI_BARU_WAJIB");
  return { mode, ids };
}

/** Kunci (FOR UPDATE) + periksa bukti STAGED milik pengunggah yang berkas fisiknya ada. Dipakai koreksi DAN "Lampirkan Bukti" (aturan sama). */
async function muatBuktiStaged(tx, ids, userId) {
  if (!ids.length) return [];
  await tx.$queryRawUnsafe("SELECT id FROM fin_refund_evidences WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", ids);
  const rows = await tx.finRefundEvidence.findMany({ where: { id: { in: ids } } });
  const peta = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const ev = peta.get(id);
    if (!ev) throw new KoreksiError("Salah satu bukti baru tidak ditemukan (mungkin sudah dibersihkan). Unggah ulang.", 409, "BUKTI_TIDAK_ADA");
    if (ev.status !== "STAGED") throw new KoreksiError("Salah satu bukti baru sudah dipakai dokumen lain. Unggah ulang bukti yang berbeda.", 409, "BUKTI_SUDAH_DIPAKAI");
    if (ev.uploadedById !== userId) throw new KoreksiError("Bukti baru harus diunggah oleh Anda sendiri.", 403, "BUKTI_BUKAN_MILIK");
    if (!berkasTersimpan(ev.storedName, ev.sizeBytes, REFUND_BUKTI_DIR)) throw new KoreksiError("Berkas salah satu bukti baru tidak ditemukan di server. Unggah ulang.", 409, "BUKTI_HILANG");
  }
  return ids.map((id) => peta.get(id));
}

/**
 * Susun rencana bukti untuk dokumen pengganti (TIDAK menulis). Dipanggil di dalam transaksi koreksi supaya bukti baru terkunci (FOR UPDATE) sampai commit/rollback.
 *  LAMA   = bukti dokumen lama dibawa; TAMBAH = lama + baru; GANTI = hanya baru (bukti lama tetap di dokumen lama).
 * Dokumen pengganti WAJIB punya minimal satu bukti.
 */
export async function rencanakanBukti(tx, { lama, permintaan, userId }) {
  const { mode, ids } = permintaan;
  const tautLama = await tx.finRefundEvidenceLink.findMany({ where: { refundId: lama.id }, include: { evidence: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const lampiranLama = String(lama.attachmentUrl ?? "").trim() || null;

  const baru = await muatBuktiStaged(tx, ids, userId);

  const dibawa = mode === "GANTI" ? [] : tautLama.map((t) => t.evidence);
  const lampiranDibawa = mode === "GANTI" ? null : lampiranLama;
  const jumlah = dibawa.length + (lampiranDibawa ? 1 : 0) + baru.length;
  if (jumlah < 1) {
    throw new KoreksiError(
      lama.id && tautLama.length === 0 && !lampiranLama
        ? "Refund ini belum punya bukti transfer. Unggah minimal satu bukti (JPG, PNG, WEBP, atau PDF) sebelum mengoreksi."
        : "Dokumen pengganti wajib punya minimal satu bukti transfer. Unggah bukti baru atau pilih gunakan bukti lama.",
      422, "BUKTI_WAJIB",
    );
  }
  if (jumlah > MAKS_BUKTI_PER_DOKUMEN) throw new KoreksiError(`Maksimal ${MAKS_BUKTI_PER_DOKUMEN} bukti per dokumen refund.`, 400, "BUKTI_TERLALU_BANYAK");
  return { mode, dibawa, baru, lampiranDibawa, lampiranLama, lamaBerkas: tautLama.map((t) => t.evidence), jumlah, adaBuktiLama: tautLama.length + (lampiranLama ? 1 : 0) };
}

/** Tautkan rencana ke dokumen pengganti (relasi eksplisit) dan tandai bukti baru DIGUNAKAN — satu transaksi dengan koreksi. */
export async function lampirkanBukti(tx, { refundBaruId, rencana, userId }) {
  for (const ev of rencana.dibawa) await tx.finRefundEvidenceLink.create({ data: { refundId: refundBaruId, evidenceId: ev.id, origin: "DIBAWA", createdById: userId } });
  for (const ev of rencana.baru) await tx.finRefundEvidenceLink.create({ data: { refundId: refundBaruId, evidenceId: ev.id, origin: "BARU", createdById: userId } });
  if (rencana.baru.length) {
    const r = await tx.finRefundEvidence.updateMany({ where: { id: { in: rencana.baru.map((e) => e.id) }, status: "STAGED" }, data: { status: "DIGUNAKAN", attachedAt: new Date() } });
    if (r.count !== rencana.baru.length) throw new KoreksiError("Bukti baru berubah selama koreksi diproses. Ulangi.", 409, "BUKTI_BERUBAH");
  }
}

/** Ringkasan rencana untuk pratinjau & audit (tanpa URL). */
export function ringkasRencana(rencana) {
  const ringkas = (ev) => ({ id: ev.id, nama: ev.originalName, tipe: ev.mimeType, ukuranByte: ev.sizeBytes });
  return {
    mode: rencana.mode,
    lama: [...(rencana.lampiranLama ? [{ id: null, nama: "Lampiran lama (tautan)", tipe: null, ukuranByte: null }] : []), ...rencana.lamaBerkas.map(ringkas)],
    pengganti: [...(rencana.lampiranDibawa ? [{ id: null, nama: "Lampiran lama (tautan)", tipe: null, ukuranByte: null }] : []), ...rencana.dibawa.map((e) => ({ ...ringkas(e), origin: "DIBAWA" })), ...rencana.baru.map((e) => ({ ...ringkas(e), origin: "BARU" }))],
    jumlah: rencana.jumlah,
  };
}

/**
 * LAMPIRKAN BUKTI TANPA KOREKSI. Hanya MENAMBAH relasi bukti (append-only) pada dokumen refund yang sudah pernah menghasilkan transaksi — TIDAK membuat dokumen pengganti, TIDAK
 * menyentuh jurnal/saldo, dan TIDAK mengubah baris fin_refunds sama sekali (nominal, biaya admin, rekening, tanggal, status, updated_at tetap). Bukti yang sudah tertaut tidak bisa
 * diganti/dihapus (trigger DB). Dokumen yang sudah diganti koreksi boleh diberi bukti (bukti merujuk transaksi versi itu); refund yang belum pernah berjurnal (draf/ditolak) diblokir.
 */
export async function lampirkanBuktiSaja(tx, { refundId, ids, alasan, userId }) {
  const reason = String(alasan ?? "").trim();
  if (reason.length < 5) throw new KoreksiError("Alasan wajib diisi (minimal 5 karakter)", 400, "ALASAN_WAJIB");
  if (reason.length > 500) throw new KoreksiError("Alasan terlalu panjang (maksimal 500 karakter)", 400, "TERLALU_PANJANG");
  if (!Array.isArray(ids) || ids.length === 0) throw new KoreksiError("Unggah minimal satu bukti untuk dilampirkan.", 422, "BUKTI_BARU_WAJIB");
  const unik = [...new Set(ids.map(String))];
  if (unik.some((i) => !UUID.test(i))) throw new KoreksiError("ID bukti tidak valid", 400, "BUKTI_TIDAK_VALID");
  if (!UUID.test(String(refundId))) throw new KoreksiError("Refund tidak ditemukan", 404);

  await lockRowForUpdate(tx, '"fin_refunds"', refundId);
  const r = await tx.finRefund.findUnique({
    where: { id: refundId },
    select: { id: true, refundNumber: true, status: true, amount: true, transferFeeAmount: true, attachmentUrl: true, cashAccount: { select: { name: true } }, replacedBy: { select: { refundNumber: true } } },
  });
  if (!r) throw new KoreksiError("Refund tidak ditemukan", 404);
  // Boleh: refund AKTIF (DISETUJUI) atau versi LAMA yang sudah diganti koreksi (bukti merujuk transaksi versi itu). Draf/ditolak/dibatalkan-tanpa-pengganti diblokir.
  const berjurnal = await tx.finJournalEntry.count({ where: { source: "REFUND", sourceId: refundId } });
  const boleh = berjurnal > 0 && (r.status === "DISETUJUI" || (r.status === "DIBATALKAN" && r.replacedBy));
  if (!boleh) {
    const label = r.status === "MENUNGGU_APPROVAL" ? "menunggu persetujuan" : r.status === "DITOLAK" ? "ditolak" : r.status === "DIBATALKAN" ? "dibatalkan tanpa dokumen pengganti" : "belum menghasilkan transaksi";
    throw new KoreksiError(`Refund ${r.refundNumber} berstatus ${label} sehingga tidak bisa diberi bukti transfer. Bukti hanya bisa dilampirkan pada refund yang sudah disetujui (atau versi lama yang sudah dikoreksi).`, 409, "REFUND_BELUM_BERTRANSAKSI");
  }
  const sudahTertaut = await tx.finRefundEvidenceLink.count({ where: { refundId } });
  const lampiran = String(r.attachmentUrl ?? "").trim() ? 1 : 0;
  if (sudahTertaut + lampiran + unik.length > MAKS_BUKTI_PER_DOKUMEN) {
    throw new KoreksiError(`Maksimal ${MAKS_BUKTI_PER_DOKUMEN} bukti per dokumen refund (sudah ada ${sudahTertaut + lampiran}).`, 400, "BUKTI_TERLALU_BANYAK");
  }
  const baru = await muatBuktiStaged(tx, unik, userId);
  for (const ev of baru) await tx.finRefundEvidenceLink.create({ data: { refundId, evidenceId: ev.id, origin: "BARU", createdById: userId } });
  const u = await tx.finRefundEvidence.updateMany({ where: { id: { in: baru.map((e) => e.id) }, status: "STAGED" }, data: { status: "DIGUNAKAN", attachedAt: new Date() } });
  if (u.count !== baru.length) throw new KoreksiError("Bukti berubah selama diproses. Ulangi.", 409, "BUKTI_BERUBAH");
  const sesudah = sudahTertaut + lampiran + baru.length;
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_REFUND, entityId: refundId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId,
    metadata: {
      aksi: "lampirkan_bukti_refund", refundNumber: r.refundNumber, reason, before: { jumlahBukti: sudahTertaut + lampiran }, after: { jumlahBukti: sesudah },
      bukti: baru.map((e) => ({ nama: e.originalName, tipe: e.mimeType, ukuranByte: e.sizeBytes })), dampakKeuangan: "Rp0 — hanya melampirkan bukti; jurnal, saldo, dan dokumen tidak berubah",
      diganti: r.replacedBy?.refundNumber ?? null,
    },
  });
  return {
    ok: true, refundId, nomor: r.refundNumber, ditambah: baru.length, jumlahBukti: sesudah, dokumenSudahDiganti: r.replacedBy?.refundNumber ?? null,
    dampakKeuangan: { jurnalBaru: 0, perubahanSaldo: 0, dokumenBaru: 0, ringkasan: "Rp0 — hanya melampirkan bukti" },
    ringkasan: { status: r.status, rekening: r.cashAccount?.name ?? null, nominal: Number(r.amount), biayaAdmin: Number(r.transferFeeAmount ?? 0), totalKeluar: Number(r.amount) + Number(r.transferFeeAmount ?? 0) },
  };
}

export { POLA_NAMA, BerkasError };
export const adaBerkasDisk = (storedName) => fs.existsSync(pathBukti(storedName));
