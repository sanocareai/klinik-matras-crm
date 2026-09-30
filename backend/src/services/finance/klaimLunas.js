// KLAIM LUNAS SALES (1 Okt 2026) — gerbang "Lunas" untuk Sales di web dan aplikasi.
//
// MASALAH ASLI: Sales menandai order LUNAS lewat dropdown (PATCH /orders/:id, paymentStatus) tanpa satu pun catatan/bukti pembayaran. Status itu langsung
// dihitung sebagai "Nilai Order yang Menjadi Lunas" (dasar komisi) walau uangnya belum tentu masuk — 19 order menjelang tutup bulan September 2026 bernasib
// begitu (Rp30,98 jt), dan 149 order LUNAS lama tidak punya satu pun Payment.
//
// ATURAN BARU (keputusan Owner):
//  1. Sales TIDAK bisa lagi menandai LUNAS. Sales MENGAJUKAN klaim: tanggal, nominal, metode, rekening (bila transfer), catatan, dan MINIMAL satu
//     Bukti Pembayaran. Draft boleh disimpan tanpa bukti, tetapi tidak boleh diajukan. Server menolak pengajuan yang tidak lengkap (UI hanya membantu).
//  2. Mengajukan klaim TIDAK mengubah apa pun di sisi uang: paymentStatus, paidAt, komisi, jurnal, saldo, piutang — semuanya tetap. Yang tertulis hanya baris
//     klaim + berkas bukti + jejak audit.
//  3. Finance memilih: Minta Bukti (alasan wajib), Tolak (alasan wajib), atau Verifikasi. Verifikasi membuat TEPAT SATU Payment resmi (bukti klaim
//     menjadi bukti Payment), lalu status order dihitung ulang dari ledger — LUNAS hanya bila pembayaran terverifikasi mencapai tagihan kanonis.
//  4. Klaim lama (order yang sudah berstatus LUNAS tanpa Payment) TIDAK diubah dan TIDAK dibuatkan Payment otomatis; ia tampil di antrean Finance lama
//     dengan penanda "Bukti belum lengkap" sampai ada klaim berbukti atau Finance menanganinya.
//
// KONKURENSI: urutan kunci kanonis order → baris klaim (FOR UPDATE). Dua pengajuan/verifikasi paralel atas klaim yang sama berjalan berurutan; yang kedua
// melihat status baru dan dijawab idempoten (pengajuan) atau 409 (verifikasi) — tidak pernah membuat Payment kedua (paymentId @unique sebagai jaring akhir).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../../db.js";
import { kunciKanonis } from "./urutanKunci.js";
import { PILIH_TAGIHAN, dasarStatusBayar } from "./tagihanOrder.js";
import { paidForOrder } from "./allocation.js";
import { getVerificationGate } from "./settings.js";
import { tanggalCutoff, tanggalWIB } from "./cutoff.js";
import { moneyToNumber } from "./money.js";
import { verifikasiPenerimaan } from "./penerimaanOrder.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { pastikanBukanAnakResiWajibBayarLewatResi } from "../resiPembayaran.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";
import {
  MAKS_BERKAS_PER_KLAIM, berkasTersimpan, hapusBerkasDisk, urlBertandaTangan, salinKeBuktiPayment,
} from "./klaimLunasBerkas.js";

export const STATUS = Object.freeze({
  DRAFT: "DRAFT", SUBMITTED: "SUBMITTED", EVIDENCE_REQUESTED: "EVIDENCE_REQUESTED", REJECTED: "REJECTED", VERIFIED: "VERIFIED", CANCELLED: "CANCELLED",
});
/** Hanya satu klaim aktif per order pada satu waktu. */
export const STATUS_AKTIF = Object.freeze([STATUS.DRAFT, STATUS.SUBMITTED, STATUS.EVIDENCE_REQUESTED]);
/** Status yang masih boleh diedit Sales (isi form / bukti) sebelum diajukan (ulang). */
export const STATUS_BISA_DIEDIT = Object.freeze([STATUS.DRAFT, STATUS.EVIDENCE_REQUESTED, STATUS.REJECTED]);
export const METODE_BAYAR = Object.freeze(["CASH", "TRANSFER", "QRIS", "CARD"]);
const REKENING_TUNAI_KEM = /(^|[^A-Za-z])KEM([^A-Za-z]|$)/i;
const DIR_BUKTI_PAYMENT = process.env.PAYMENT_PROOFS_DIR
  || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../data/payment-proofs");

export class KlaimError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) {
    super(message);
    this.name = "KlaimError";
    this.statusCode = statusCode;
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}

const rp = (n) => `Rp${Number(n).toLocaleString("id-ID")}`;
const TX_OPSI = { maxWait: 15_000, timeout: 60_000 };

// ── validasi field (dipakai draft sebagian maupun pengajuan penuh) ───────────────────────────────────────────────────

function tanggalKalenderValid(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

/** Normalisasi + validasi input form klaim. `sebagian` = true untuk draft (field boleh kosong, tetapi yang terisi harus valid). */
export function normalisasiInput(input = {}, { sekarang = new Date() } = {}) {
  const out = {};
  if (input.paymentDate !== undefined) {
    const t = input.paymentDate === null || input.paymentDate === "" ? null : String(input.paymentDate).trim();
    if (t !== null) {
      if (!tanggalKalenderValid(t)) throw new KlaimError("Tanggal pembayaran tidak valid (format YYYY-MM-DD)", 400, "TANGGAL_TIDAK_VALID");
      if (t > tanggalWIB(sekarang)) throw new KlaimError("Tanggal pembayaran tidak boleh di masa depan", 400, "TANGGAL_MASA_DEPAN");
      if (t < "2020-01-01") throw new KlaimError("Tanggal pembayaran terlalu lampau", 400, "TANGGAL_TIDAK_VALID");
    }
    out.paymentDate = t;
  }
  if (input.amount !== undefined) {
    if (input.amount === null || input.amount === "") out.amount = null;
    else {
      const n = Number(input.amount);
      if (!Number.isInteger(n) || n <= 0 || n > 2_000_000_000) throw new KlaimError("Nominal klaim harus bilangan bulat lebih dari 0", 400, "NOMINAL_TIDAK_VALID");
      out.amount = n;
    }
  }
  if (input.method !== undefined) {
    if (input.method === null || input.method === "") out.method = null;
    else {
      if (!METODE_BAYAR.includes(input.method)) throw new KlaimError("Metode pembayaran tidak valid (Tunai, Transfer, QRIS, atau Kartu)", 400, "METODE_TIDAK_VALID");
      out.method = input.method;
    }
  }
  if (input.cashAccountId !== undefined) out.cashAccountId = input.cashAccountId ? String(input.cashAccountId) : null;
  if (input.note !== undefined) {
    const n = input.note === null ? "" : String(input.note).trim();
    if (n.length > 1000) throw new KlaimError("Catatan pembayaran maksimal 1000 karakter", 400, "CATATAN_TERLALU_PANJANG");
    out.note = n || null;
  }
  return out;
}

async function pastikanRekeningValid(db, { cashAccountId, method }) {
  if (!cashAccountId) return;
  if (!/^[0-9a-f-]{36}$/i.test(cashAccountId)) throw new KlaimError("Rekening tujuan tidak valid", 400, "REKENING_TIDAK_VALID");
  const akun = await db.finCashAccount.findUnique({ where: { id: cashAccountId }, select: { active: true, name: true } });
  if (!akun || !akun.active) throw new KlaimError("Rekening tujuan tidak valid atau sudah nonaktif", 400, "REKENING_TIDAK_VALID");
  // Sama dengan pencatatan pembayaran Sales lain (routes/orders.js): Tunai hanya boleh ke rekening Sano KEM (keputusan Owner 30 Sep 2026).
  if (method === "CASH" && !REKENING_TUNAI_KEM.test(akun.name)) throw new KlaimError("Pembayaran Tunai hanya bisa dicatat ke rekening Sano KEM", 400, "REKENING_TUNAI_TIDAK_SESUAI");
}

/** Daftar kekurangan klaim yang belum boleh diajukan. Kosong = lengkap. `evidence` = baris bukti klaim. */
export function kekuranganKlaim(klaim, evidence) {
  const k = [];
  if (!klaim.paymentDate) k.push({ field: "paymentDate", pesan: "Tanggal pembayaran wajib diisi" });
  if (!klaim.amount || klaim.amount <= 0) k.push({ field: "amount", pesan: "Nominal yang diklaim wajib diisi" });
  if (!klaim.method) k.push({ field: "method", pesan: "Metode pembayaran wajib dipilih" });
  if (klaim.method === "TRANSFER" && !klaim.cashAccountId) k.push({ field: "cashAccountId", pesan: "Rekening tujuan wajib dipilih untuk pembayaran Transfer" });
  if (!klaim.note || klaim.note.trim().length < 3) k.push({ field: "note", pesan: "Catatan pembayaran wajib diisi" });
  if (!evidence.length) k.push({ field: "evidence", pesan: "Unggah minimal satu Bukti Pembayaran" });
  else if (evidence.some((e) => !berkasTersimpan(e.storedName, e.sizeBytes))) k.push({ field: "evidence", pesan: "Ada Bukti Pembayaran yang belum tersimpan di server — unggah ulang" });
  return k;
}

// ── pembacaan ────────────────────────────────────────────────────────────────────────────────────────────────────────

const PILIH_KLAIM = {
  id: true, orderId: true, status: true, paymentDate: true, amount: true, method: true, cashAccountId: true, note: true, createdById: true,
  submittedAt: true, submitCount: true, reviewedById: true, reviewedAt: true, reviewReason: true, paymentId: true, version: true, createdAt: true, updatedAt: true,
  cashAccount: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  evidence: { orderBy: { createdAt: "asc" }, select: { id: true, storedName: true, originalName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true } },
};

/** Bentuk klaim untuk UI. URL bukti SELALU bertanda-tangan berumur pendek; nama berkas di disk tidak dikirim. */
export function bentukKlaim(k) {
  return {
    id: k.id, orderId: k.orderId, status: k.status, paymentDate: k.paymentDate, amount: k.amount, method: k.method,
    cashAccountId: k.cashAccountId, cashAccount: k.cashAccount ?? null, note: k.note,
    createdById: k.createdById, createdByName: k.createdBy?.name ?? null,
    submittedAt: k.submittedAt, submitCount: k.submitCount,
    reviewedByName: k.reviewedBy?.name ?? null, reviewedAt: k.reviewedAt, reviewReason: k.reviewReason,
    paymentId: k.paymentId, version: k.version, createdAt: k.createdAt, updatedAt: k.updatedAt,
    bukti: (k.evidence || []).map((e) => ({
      id: e.id, nama: e.originalName, mime: e.mimeType, ukuran: e.sizeBytes, pada: e.createdAt, url: urlBertandaTangan(e.storedName),
    })),
    kekurangan: k.status === STATUS.VERIFIED || k.status === STATUS.CANCELLED ? [] : kekuranganKlaim(k, k.evidence || []),
  };
}

/** Sisa tagihan KANONIS order menurut ledger (bukan menurut label paymentStatus). */
async function sisaTagihan(db, order) {
  const gate = await getVerificationGate(db);
  const dibayar = moneyToNumber(await paidForOrder(db, order.id, gate));
  const tagihan = dasarStatusBayar(order);
  return { tagihan, dibayar, sisa: Math.max(tagihan - dibayar, 0) };
}

const PILIH_ORDER_KLAIM = {
  ...PILIH_TAGIHAN, orderNumber: true, paymentStatus: true, paidAt: true, customerId: true,
  customer: { select: { name: true, assignedSales: { select: { id: true, name: true } } } },
};

const adalahAdmin = (user) => (user?.roles || [user?.role]).includes("ADMIN");

async function muatKlaimMilik(db, claimId, user, { kunci = false } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(claimId))) throw new KlaimError("Klaim tidak ditemukan", 404, "KLAIM_TIDAK_ADA");
  if (kunci) await lockRowForUpdate(db, "order_payment_claims", claimId);
  const k = await db.orderPaymentClaim.findUnique({ where: { id: claimId }, select: PILIH_KLAIM });
  // Milik orang lain dijawab 404 (bukan 403) — keberadaan klaim orang lain tidak perlu bocor.
  if (!k || (k.createdById !== user.id && !adalahAdmin(user))) throw new KlaimError("Klaim tidak ditemukan", 404, "KLAIM_TIDAK_ADA");
  return k;
}

/** Klaim order ini + apakah order bisa diklaim (untuk tombol di UI). Sales hanya melihat klaim miliknya; Admin/Finance semua. */
export async function klaimUntukOrder(db, { orderId, user, lihatSemua = false }) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: PILIH_ORDER_KLAIM });
  if (!order) throw new KlaimError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  const klaim = await db.orderPaymentClaim.findMany({
    where: { orderId, ...(lihatSemua || adalahAdmin(user) ? {} : { createdById: user.id }) },
    orderBy: { createdAt: "desc" }, select: PILIH_KLAIM,
  });
  const { tagihan, dibayar, sisa } = await sisaTagihan(db, order);
  const aktif = klaim.find((k) => STATUS_AKTIF.includes(k.status)) || null;
  let bolehDiklaim = true; let alasan = null;
  if (order.status === "CANCELLED") { bolehDiklaim = false; alasan = "Order sudah dibatalkan"; }
  else if (!(order.value > 0)) { bolehDiklaim = false; alasan = "Order belum punya harga"; }
  else if (sisa <= 0) { bolehDiklaim = false; alasan = "Order ini sudah tercatat lunas oleh pembayaran terverifikasi"; }
  else {
    try { await pastikanBukanAnakResiWajibBayarLewatResi(db, orderId); } catch (e) { bolehDiklaim = false; alasan = e.message; }
  }
  return {
    orderId, orderNumber: order.orderNumber, paymentStatus: order.paymentStatus,
    tagihan, dibayar, sisa, bolehDiklaim, alasanTidakBisa: alasan,
    // Order yang SUDAH ditandai Lunas (cara lama) tetapi uangnya belum tercatat: tampil "Bukti belum lengkap" sampai ada klaim berbukti yang diverifikasi.
    buktiBelumLengkap: order.paymentStatus === "LUNAS" && sisa > 0 && order.status !== "CANCELLED" && order.value > 0,
    klaimAktifId: aktif?.id ?? null,
    klaim: klaim.map(bentukKlaim),
  };
}

// ── Sales: draft → bukti → ajukan ────────────────────────────────────────────────────────────────────────────────────

/** Buat draft klaim (idempoten: draft aktif milik pengguna yang sama untuk order ini dikembalikan, bukan digandakan). */
export async function buatDraft(db, { orderId, user, data = {} }) {
  const input = normalisasiInput(data);
  return db.$transaction(async (tx) => {
    await kunciKanonis(tx, { orderIds: [orderId] });
    const order = await tx.order.findUnique({ where: { id: orderId }, select: PILIH_ORDER_KLAIM });
    if (!order) throw new KlaimError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
    if (order.status === "CANCELLED") throw new KlaimError("Order sudah dibatalkan — tidak bisa diajukan klaim", 409, "ORDER_DIBATALKAN");
    if (!(order.value > 0)) throw new KlaimError("Order belum punya harga — isi harga dulu sebelum mengajukan klaim", 409, "ORDER_TANPA_HARGA");
    await pastikanBukanAnakResiWajibBayarLewatResi(tx, orderId);
    const { sisa } = await sisaTagihan(tx, order);
    if (sisa <= 0) throw new KlaimError("Order ini sudah tercatat lunas oleh pembayaran terverifikasi — tidak ada yang perlu diklaim", 409, "SUDAH_LUNAS");
    const aktif = await tx.orderPaymentClaim.findFirst({ where: { orderId, status: { in: STATUS_AKTIF } }, select: { id: true, createdById: true, status: true, createdBy: { select: { name: true } } } });
    if (aktif) {
      if (aktif.createdById === user.id) return { klaim: bentukKlaim(await tx.orderPaymentClaim.findUnique({ where: { id: aktif.id }, select: PILIH_KLAIM })), dibuatBaru: false };
      throw new KlaimError(`Sudah ada klaim aktif untuk order ini dari ${aktif.createdBy?.name || "pengguna lain"}`, 409, "KLAIM_AKTIF_ADA");
    }
    if (input.cashAccountId) await pastikanRekeningValid(tx, { cashAccountId: input.cashAccountId, method: input.method });
    const dibuat = await tx.orderPaymentClaim.create({
      data: { orderId, createdById: user.id, status: STATUS.DRAFT, ...input },
      select: PILIH_KLAIM,
    });
    await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.KLAIM_LUNAS, actorId: user.id, metadata: { aksi: "draft_dibuat", klaimId: dibuat.id } });
    return { klaim: bentukKlaim(dibuat), dibuatBaru: true };
  }, TX_OPSI);
}

/** Ubah isi klaim (draft / diminta bukti / ditolak). Status TIDAK berubah — pengajuan (ulang) tetap lewat ajukanKlaim. */
export async function ubahKlaim(db, { claimId, user, data, versi = null }) {
  const input = normalisasiInput(data);
  return db.$transaction(async (tx) => {
    const awal = await muatKlaimMilik(tx, claimId, user);
    await kunciKanonis(tx, { orderIds: [awal.orderId] });
    const k = await muatKlaimMilik(tx, claimId, user, { kunci: true });
    if (!STATUS_BISA_DIEDIT.includes(k.status)) throw new KlaimError("Klaim ini tidak bisa diubah lagi (sedang menunggu Finance atau sudah selesai)", 409, "KLAIM_TIDAK_BISA_DIEDIT");
    if (versi !== null && Number(versi) !== k.version) throw new KlaimError("Klaim sudah berubah di perangkat lain — muat ulang", 409, "VERSI_BERBEDA");
    const metode = input.method !== undefined ? input.method : k.method;
    const rekening = input.cashAccountId !== undefined ? input.cashAccountId : k.cashAccountId;
    await pastikanRekeningValid(tx, { cashAccountId: rekening, method: metode });
    const baru = await tx.orderPaymentClaim.update({ where: { id: k.id }, data: { ...input, version: { increment: 1 } }, select: PILIH_KLAIM });
    return bentukKlaim(baru);
  }, TX_OPSI);
}

/** Lampirkan metadata berkas yang SUDAH tersimpan di disk (simpanBerkas) ke klaim. Bukti yang sama (isi identik) pada klaim yang sama tidak digandakan. */
export async function lampirkanBukti(db, { claimId, user, berkas }) {
  return db.$transaction(async (tx) => {
    const awal = await muatKlaimMilik(tx, claimId, user);
    await kunciKanonis(tx, { orderIds: [awal.orderId] });
    const k = await muatKlaimMilik(tx, claimId, user, { kunci: true });
    if (!STATUS_BISA_DIEDIT.includes(k.status)) throw new KlaimError("Bukti tidak bisa ditambah — klaim sedang menunggu Finance atau sudah selesai", 409, "KLAIM_TIDAK_BISA_DIEDIT");
    const sama = k.evidence.find((e) => e.sha256 === berkas.sha256);
    if (sama) return { bukti: { id: sama.id, nama: sama.originalName, mime: sama.mimeType, ukuran: sama.sizeBytes, url: urlBertandaTangan(sama.storedName) }, duplikat: true };
    if (k.evidence.length >= MAKS_BERKAS_PER_KLAIM) throw new KlaimError(`Maksimal ${MAKS_BERKAS_PER_KLAIM} Bukti Pembayaran per klaim`, 409, "TERLALU_BANYAK_BUKTI");
    const e = await tx.orderPaymentClaimEvidence.create({
      data: { claimId: k.id, storedName: berkas.storedName, originalName: berkas.originalName, mimeType: berkas.mimeType, sizeBytes: berkas.sizeBytes, sha256: berkas.sha256, uploadedById: user.id },
    });
    await tx.orderPaymentClaim.update({ where: { id: k.id }, data: { version: { increment: 1 } } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: k.orderId, eventType: EVENT_TYPES.KLAIM_LUNAS, actorId: user.id, metadata: { aksi: "bukti_ditambah", klaimId: k.id, evidenceId: e.id } });
    return { bukti: { id: e.id, nama: e.originalName, mime: e.mimeType, ukuran: e.sizeBytes, url: urlBertandaTangan(e.storedName) }, duplikat: false };
  }, TX_OPSI);
}

export async function hapusBukti(db, { claimId, evidenceId, user }) {
  const hasil = await db.$transaction(async (tx) => {
    const awal = await muatKlaimMilik(tx, claimId, user);
    await kunciKanonis(tx, { orderIds: [awal.orderId] });
    const k = await muatKlaimMilik(tx, claimId, user, { kunci: true });
    if (!STATUS_BISA_DIEDIT.includes(k.status)) throw new KlaimError("Bukti tidak bisa dihapus — klaim sedang menunggu Finance atau sudah selesai", 409, "KLAIM_TIDAK_BISA_DIEDIT");
    // Bukti hanya bisa dihapus lewat klaim YANG MEMILIKINYA — id bukti klaim lain tidak pernah cocok.
    const e = k.evidence.find((x) => x.id === evidenceId);
    if (!e) throw new KlaimError("Bukti tidak ditemukan pada klaim ini", 404, "BUKTI_TIDAK_ADA");
    await tx.orderPaymentClaimEvidence.delete({ where: { id: e.id } });
    await tx.orderPaymentClaim.update({ where: { id: k.id }, data: { version: { increment: 1 } } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: k.orderId, eventType: EVENT_TYPES.KLAIM_LUNAS, actorId: user.id, metadata: { aksi: "bukti_dihapus", klaimId: k.id, evidenceId: e.id } });
    return e.storedName;
  }, TX_OPSI);
  hapusBerkasDisk(hasil); // setelah commit — kegagalan hapus disk tidak boleh membatalkan transaksi
  return { ok: true };
}

/**
 * Sales mengajukan klaim. SERVER menolak yang tidak lengkap (422 + daftar kekurangan), apa pun yang dikirim UI. Idempoten: klaim yang sudah SUBMITTED
 * dijawab `diulang: true` tanpa menulis apa-apa (double-click / ulang jaringan). TIDAK menyentuh Order, Payment, jurnal, saldo, atau piutang.
 */
export async function ajukanKlaim(db, { claimId, user }) {
  return db.$transaction(async (tx) => {
    const awal = await muatKlaimMilik(tx, claimId, user);
    await kunciKanonis(tx, { orderIds: [awal.orderId] });
    const k = await muatKlaimMilik(tx, claimId, user, { kunci: true });
    if (k.status === STATUS.SUBMITTED) return { klaim: bentukKlaim(k), diulang: true };
    if (!STATUS_BISA_DIEDIT.includes(k.status)) throw new KlaimError("Klaim ini tidak bisa diajukan (sudah selesai atau ditarik)", 409, "KLAIM_TIDAK_BISA_DIAJUKAN");

    const kurang = kekuranganKlaim(k, k.evidence);
    if (kurang.length) throw new KlaimError("Klaim belum lengkap: " + kurang.map((x) => x.pesan).join("; "), 422, "KLAIM_TIDAK_LENGKAP", { kekurangan: kurang });

    const order = await tx.order.findUnique({ where: { id: k.orderId }, select: PILIH_ORDER_KLAIM });
    if (order.status === "CANCELLED") throw new KlaimError("Order sudah dibatalkan — klaim tidak bisa diajukan", 409, "ORDER_DIBATALKAN");
    await pastikanBukanAnakResiWajibBayarLewatResi(tx, k.orderId);
    const { sisa } = await sisaTagihan(tx, order);
    if (sisa <= 0) throw new KlaimError("Order ini sudah tercatat lunas oleh pembayaran terverifikasi — tidak ada yang perlu diklaim", 409, "SUDAH_LUNAS");
    if (k.amount > sisa) throw new KlaimError(`Nominal klaim ${rp(k.amount)} melebihi sisa tagihan ${rp(sisa)}`, 422, "NOMINAL_MELEBIHI_SISA");
    await pastikanRekeningValid(tx, { cashAccountId: k.cashAccountId, method: k.method });
    if (k.paymentDate > tanggalWIB(new Date())) throw new KlaimError("Tanggal pembayaran tidak boleh di masa depan", 422, "TANGGAL_MASA_DEPAN");

    const ulang = k.submitCount > 0;
    const baru = await tx.orderPaymentClaim.update({
      where: { id: k.id },
      data: {
        status: STATUS.SUBMITTED, submittedAt: new Date(), submitCount: { increment: 1 }, version: { increment: 1 },
        reviewedById: null, reviewedAt: null, reviewReason: null, // alasan sebelumnya tetap ada di jejak audit
      },
      select: PILIH_KLAIM,
    });
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: k.orderId, eventType: EVENT_TYPES.KLAIM_LUNAS, actorId: user.id,
      metadata: { aksi: ulang ? "diajukan_ulang" : "diajukan", klaimId: k.id, amount: k.amount, method: k.method, jumlahBukti: k.evidence.length, orderNumber: order.orderNumber },
    });
    return { klaim: bentukKlaim(baru), diulang: false };
  }, TX_OPSI);
}

/** Sales menarik klaim sebelum diverifikasi. */
export async function tarikKlaim(db, { claimId, user }) {
  return db.$transaction(async (tx) => {
    const awal = await muatKlaimMilik(tx, claimId, user);
    await kunciKanonis(tx, { orderIds: [awal.orderId] });
    const k = await muatKlaimMilik(tx, claimId, user, { kunci: true });
    if (k.status === STATUS.CANCELLED) return { klaim: bentukKlaim(k), diulang: true };
    if (k.status === STATUS.VERIFIED) throw new KlaimError("Klaim sudah diverifikasi Finance — tidak bisa ditarik", 409, "KLAIM_SUDAH_DIVERIFIKASI");
    const baru = await tx.orderPaymentClaim.update({ where: { id: k.id }, data: { status: STATUS.CANCELLED, version: { increment: 1 } }, select: PILIH_KLAIM });
    await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: k.orderId, eventType: EVENT_TYPES.KLAIM_LUNAS, actorId: user.id, metadata: { aksi: "ditarik", klaimId: k.id } });
    return { klaim: bentukKlaim(baru), diulang: false };
  }, TX_OPSI);
}

// ── Finance: antrean, minta bukti, tolak, verifikasi ─────────────────────────────────────────────────────────────────

/** Bukti dengan isi identik yang juga dipakai klaim LAIN (peringatan untuk Finance; tidak memblokir — satu transfer gabungan bisa sah untuk banyak order). */
async function peringatanBuktiSama(db, klaim) {
  const hash = (klaim.evidence || []).map((e) => e.sha256);
  if (!hash.length) return [];
  const lain = await db.orderPaymentClaimEvidence.findMany({
    where: { sha256: { in: hash }, claimId: { not: klaim.id } },
    select: { claim: { select: { id: true, status: true, order: { select: { orderNumber: true } } } } },
  });
  const unik = new Map(lain.map((x) => [x.claim.id, x.claim]));
  return [...unik.values()].map((c) => ({ klaimId: c.id, orderNumber: c.order?.orderNumber ?? null, status: c.status }));
}

async function bentukUntukFinance(db, k) {
  const order = await db.order.findUnique({ where: { id: k.orderId }, select: { ...PILIH_ORDER_KLAIM, value: true } });
  const { tagihan, dibayar, sisa } = await sisaTagihan(db, order);
  const peringatan = [];
  if (k.amount && k.amount > sisa) peringatan.push({ kode: "NOMINAL_MELEBIHI_SISA", pesan: `Nominal klaim ${rp(k.amount)} melebihi sisa tagihan ${rp(sisa)}` });
  if (sisa <= 0) peringatan.push({ kode: "SUDAH_LUNAS_LEDGER", pesan: "Order ini sudah tercatat lunas oleh pembayaran terverifikasi" });
  if (order.status === "CANCELLED") peringatan.push({ kode: "ORDER_DIBATALKAN", pesan: "Order sudah dibatalkan" });
  const sama = await peringatanBuktiSama(db, k);
  if (sama.length) peringatan.push({ kode: "BUKTI_SAMA", pesan: `Bukti dengan isi identik juga dipakai klaim lain: ${sama.map((s) => s.orderNumber || s.klaimId).join(", ")}. Wajar untuk satu transfer gabungan, tetapi pastikan nominalnya tidak dihitung ganda.` });
  return {
    ...bentukKlaim(k),
    order: {
      id: order.id, orderNumber: order.orderNumber, customerName: order.customer?.name ?? "—", salesName: order.customer?.assignedSales?.name ?? null,
      status: order.status, paymentStatus: order.paymentStatus, nilai: order.value, tagihan, dibayar, sisa,
    },
    peringatan,
  };
}

export async function daftarKlaimFinance(db, { status = [STATUS.SUBMITTED, STATUS.EVIDENCE_REQUESTED], take = 300 } = {}) {
  const baris = await db.orderPaymentClaim.findMany({
    where: { status: { in: status } }, orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }], take, select: PILIH_KLAIM,
  });
  const items = [];
  for (const k of baris) items.push(await bentukUntukFinance(db, k));
  const menunggu = items.filter((i) => i.status === STATUS.SUBMITTED);
  return {
    items,
    menunggu: { jumlah: menunggu.length, total: menunggu.reduce((s, i) => s + (i.amount || 0), 0) },
    dimintaBukti: { jumlah: items.filter((i) => i.status === STATUS.EVIDENCE_REQUESTED).length },
  };
}

export async function detailKlaimFinance(db, claimId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(claimId))) throw new KlaimError("Klaim tidak ditemukan", 404, "KLAIM_TIDAK_ADA");
  const k = await db.orderPaymentClaim.findUnique({ where: { id: claimId }, select: PILIH_KLAIM });
  if (!k) throw new KlaimError("Klaim tidak ditemukan", 404, "KLAIM_TIDAK_ADA");
  return bentukUntukFinance(db, k);
}

async function kunciKlaimFinance(tx, claimId, versi, { izinStatus }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(claimId))) throw new KlaimError("Klaim tidak ditemukan", 404, "KLAIM_TIDAK_ADA");
  const awal = await tx.orderPaymentClaim.findUnique({ where: { id: claimId }, select: { orderId: true } });
  if (!awal) throw new KlaimError("Klaim tidak ditemukan", 404, "KLAIM_TIDAK_ADA");
  await kunciKanonis(tx, { orderIds: [awal.orderId] });
  await lockRowForUpdate(tx, "order_payment_claims", claimId);
  const k = await tx.orderPaymentClaim.findUnique({ where: { id: claimId }, select: PILIH_KLAIM });
  if (!izinStatus.includes(k.status)) {
    const teks = { VERIFIED: "sudah diverifikasi", REJECTED: "sudah ditolak", CANCELLED: "sudah ditarik Sales", DRAFT: "masih draft (belum diajukan Sales)", SUBMITTED: "sedang menunggu verifikasi", EVIDENCE_REQUESTED: "sedang menunggu bukti tambahan dari Sales" }[k.status];
    throw new KlaimError(`Klaim ini ${teks}. Muat ulang halaman.`, 409, k.status === STATUS.VERIFIED ? "KLAIM_SUDAH_DIVERIFIKASI" : "STATUS_KLAIM_BERUBAH");
  }
  if (versi !== undefined && versi !== null && Number(versi) !== k.version) throw new KlaimError("Klaim sudah berubah sejak Anda membukanya (mungkin Sales memperbarui). Muat ulang.", 409, "VERSI_BERBEDA");
  return k;
}

const alasanWajib = (alasan) => {
  const t = String(alasan ?? "").trim();
  if (t.length < 3) throw new KlaimError("Alasan wajib diisi", 400, "ALASAN_WAJIB");
  return t.slice(0, 500);
};

/** Finance meminta bukti tambahan. Hanya mengubah status klaim + audit — tidak menyentuh order/keuangan. */
export async function mintaBuktiKlaim(tx, { claimId, alasan, versi, userId }) {
  const teks = alasanWajib(alasan);
  const k = await kunciKlaimFinance(tx, claimId, versi, { izinStatus: [STATUS.SUBMITTED] });
  await tx.orderPaymentClaim.update({ where: { id: k.id }, data: { status: STATUS.EVIDENCE_REQUESTED, reviewedById: userId, reviewedAt: new Date(), reviewReason: teks, version: { increment: 1 } } });
  const order = await tx.order.findUnique({ where: { id: k.orderId }, select: { orderNumber: true } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: k.orderId, eventType: EVENT_TYPES.KLAIM_LUNAS, actorId: userId, metadata: { aksi: "bukti_diminta", klaimId: k.id, alasan: teks, orderNumber: order?.orderNumber ?? null } });
  return { klaimId: k.id, status: STATUS.EVIDENCE_REQUESTED };
}

/** Finance menolak klaim (mis. uang tidak ditemukan di rekening). Status order TIDAK berubah — klaim memang tidak pernah mengubahnya. */
export async function tolakKlaim(tx, { claimId, alasan, versi, userId }) {
  const teks = alasanWajib(alasan);
  const k = await kunciKlaimFinance(tx, claimId, versi, { izinStatus: [STATUS.SUBMITTED, STATUS.EVIDENCE_REQUESTED] });
  await tx.orderPaymentClaim.update({ where: { id: k.id }, data: { status: STATUS.REJECTED, reviewedById: userId, reviewedAt: new Date(), reviewReason: teks, version: { increment: 1 } } });
  const order = await tx.order.findUnique({ where: { id: k.orderId }, select: { orderNumber: true } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: k.orderId, eventType: EVENT_TYPES.KLAIM_LUNAS, actorId: userId, metadata: { aksi: "ditolak", klaimId: k.id, alasan: teks, orderNumber: order?.orderNumber ?? null } });
  return { klaimId: k.id, status: STATUS.REJECTED };
}

/**
 * Finance memverifikasi klaim → TEPAT SATU Payment resmi (+ verifikasi + jurnal bila setelah saldo awal) lewat jalur verifikasiPenerimaan yang sama
 * dengan verifikasi penerimaan lain (cutoff 18 Sep, rekening, nominal ≤ sisa, hitung ulang status dari ledger). Bukti klaim menjadi bukti Payment.
 * Finance boleh mengoreksi rekening/tanggal/nominal/metode (mis. klaim Tunai tanpa rekening); klaim menyimpan apa yang DIAJUKAN Sales, Payment menyimpan
 * apa yang DIVERIFIKASI.
 */
export async function verifikasiKlaim(tx, { claimId, verifierId, cashAccountId = null, date = null, amount = null, method = null, versi }) {
  const k = await kunciKlaimFinance(tx, claimId, versi, { izinStatus: [STATUS.SUBMITTED] });
  // Pertahanan berlapis: klaim yang lolos ke sini pasti lengkap, tetapi berkasnya dicek ULANG (mis. disk dipulihkan dari cadangan lama).
  const kurang = kekuranganKlaim(k, k.evidence);
  const hanyaBerkas = kurang.filter((x) => x.field === "evidence" || x.field === "note");
  if (hanyaBerkas.length) throw new KlaimError("Klaim tidak lengkap: " + hanyaBerkas.map((x) => x.pesan).join("; "), 422, "KLAIM_TIDAK_LENGKAP", { kekurangan: hanyaBerkas });

  const order = await tx.order.findUnique({ where: { id: k.orderId }, select: { status: true, orderNumber: true } });
  if (order.status === "CANCELLED") throw new KlaimError(`Order ${order.orderNumber} sudah dibatalkan — klaim tidak bisa diverifikasi`, 409, "ORDER_DIBATALKAN");

  const urlBukti = k.evidence.map((e) => salinKeBuktiPayment(e, { dirTujuan: DIR_BUKTI_PAYMENT }));
  const hasil = await verifikasiPenerimaan(tx, {
    orderId: k.orderId,
    mode: "REKENING", // server mengalihkan sendiri ke "sebelum saldo awal" bila tanggal uang diterima sebelum cutoff (tidak mengubah saldo)
    method: method || k.method,
    cashAccountId: cashAccountId || k.cashAccountId || null,
    date: date || k.paymentDate,
    amount: amount ?? k.amount,
    proofPhotoUrls: urlBukti,
    verifierId,
    klaim: { id: k.id, createdById: k.createdById },
  });
  const statusBayar = (await tx.order.findUnique({ where: { id: k.orderId }, select: { paymentStatus: true } })).paymentStatus;
  await tx.orderPaymentClaim.update({
    where: { id: k.id },
    data: { status: STATUS.VERIFIED, paymentId: hasil.paymentId, reviewedById: verifierId, reviewedAt: new Date(), reviewReason: null, version: { increment: 1 } },
  });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: k.orderId, eventType: EVENT_TYPES.KLAIM_LUNAS, actorId: verifierId,
    metadata: { aksi: "diverifikasi", klaimId: k.id, paymentId: hasil.paymentId, amount: hasil.amount, statusBayar, orderNumber: order.orderNumber },
  });
  return { ...hasil, klaimId: k.id, statusBayar };
}

/** Jumlah klaim menunggu Finance (badge/ringkasan). */
export async function ringkasKlaimMenunggu(db = prisma) {
  const [menunggu, diminta] = await Promise.all([
    db.orderPaymentClaim.aggregate({ where: { status: STATUS.SUBMITTED }, _count: { _all: true }, _sum: { amount: true } }),
    db.orderPaymentClaim.count({ where: { status: STATUS.EVIDENCE_REQUESTED } }),
  ]);
  return { jumlah: menunggu._count._all, total: menunggu._sum.amount || 0, dimintaBukti: diminta };
}

export { tanggalCutoff };
