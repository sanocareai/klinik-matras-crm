// UANG MUKA OPERASIONAL — satu-satunya tempat yang mengubah saldo uang muka.
//
// Invarian yang dijaga di sini (bukan di UI):
//  - Saldo = amount − Σ settlement ACTIVE, TIDAK PERNAH negatif. Semua perubahan saldo
//    (pertanggungjawaban, pengembalian, pembatalan) berjalan di bawah kunci baris uang
//    muka (SELECT … FOR UPDATE) — dua permintaan paralel diserialkan, yang kedua melihat
//    saldo yang sudah berkurang.
//  - Satu pengeluaran memakai uang muka MAKSIMAL SEKALI (indeks parsial unik di DB +
//    kunci baris pengeluaran).
//  - Pengeluaran > saldo: saldo dipakai habis dulu, selisih jadi utang reimbursement ke
//    pemegang (dibayar lewat /pay biasa). Tidak pernah saldo negatif.
//  - Kas/bank berkurang sekali (saat diberikan). Pertanggungjawaban tanpa mutasi kas.
//  - Pembatalan setelah posting = reversal resmi (reverseJournal); jurnal asli tidak dihapus.

import { generateDocumentNumber, toBookDate, todayBookDateWIB, reverseJournal } from "./journal.js";
import { toMoney, moneyToNumber, sumMoney, ZERO } from "./money.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { hitungBiayaTransfer, TransferFeeError, ringkasBiaya } from "./transferFee.js";
import { postUangMukaDiberikan, postUangMukaDikembalikan, KEY } from "./posting/operationalAdvance.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

export class AdvanceError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AdvanceError";
    this.statusCode = statusCode;
  }
}

const STATUS_BISA_DIPAKAI = ["AKTIF", "SEBAGIAN"];
const DIVISI_VALID = ["SALES", "PRODUKSI", "GUDANG", "DELIVERY", "DIGITAL_TECHNOLOGY", "OFFICE", "MANAGEMENT", "UMUM"];

export const lockUangMuka = (tx, id) => lockRowForUpdate(tx, '"fin_operational_advances"', id);

function tanggalBuku(v, fallback = null) {
  if (!v) return fallback;
  return toBookDate(v);
}

/** Σ pertanggungjawaban & pengembalian yang masih ACTIVE. */
async function totalSettlement(tx, advanceId) {
  const baris = await tx.finOperationalAdvanceSettlement.findMany({
    where: { advanceId, status: "ACTIVE" }, select: { type: true, amount: true },
  });
  const pakai = sumMoney(baris.filter((b) => b.type === "PERTANGGUNGJAWABAN").map((b) => b.amount));
  const kembali = sumMoney(baris.filter((b) => b.type === "PENGEMBALIAN").map((b) => b.amount));
  return { pakai, kembali, total: pakai.plus(kembali) };
}

export async function saldoUangMuka(tx, advance) {
  const { total } = await totalSettlement(tx, advance.id);
  return toMoney(advance.amount).minus(total);
}

/** Hitung ulang & simpan status (AKTIF/SEBAGIAN/SELESAI). DIBATALKAN tidak pernah diubah di sini. */
export async function sinkronStatusUangMuka(tx, advanceId) {
  const a = await tx.finOperationalAdvance.findUnique({ where: { id: advanceId } });
  if (!a || a.status === "DIBATALKAN") return a;
  const { total } = await totalSettlement(tx, advanceId);
  const saldo = toMoney(a.amount).minus(total);
  if (saldo.isNegative()) throw new AdvanceError("Saldo uang muka tidak boleh negatif (invarian dilanggar)", 500);
  const baru = saldo.isZero() ? "SELESAI" : total.greaterThan(0) ? "SEBAGIAN" : "AKTIF";
  if (baru === a.status) return a;
  return tx.finOperationalAdvance.update({ where: { id: advanceId }, data: { status: baru } });
}

async function balikkanJurnal(tx, { key, alasan, userId }) {
  const entry = await tx.finJournalEntry.findFirst({ where: { status: "POSTED", idempotencyKey: key } });
  if (entry) await reverseJournal(tx, { entryId: entry.id, reason: alasan, userId });
  return entry;
}

// ─── Berikan ─────────────────────────────────────────────────────────────
export async function berikanUangMuka(tx, input) {
  const { holderId, division, purpose, date, dueDate, amount, cashAccountId, receiptUrl, notes, idempotencyKey, user } = input;

  if (idempotencyKey) {
    const ada = await tx.finOperationalAdvance.findUnique({ where: { idempotencyKey } });
    if (ada) return { advance: ada, diulang: true };
  }
  if (!holderId) throw new AdvanceError("Pemegang uang muka wajib dipilih");
  if (!purpose?.trim()) throw new AdvanceError("Tujuan uang muka wajib diisi");
  const nominal = toMoney(amount, { field: "Nominal uang muka" });
  if (nominal.lessThanOrEqualTo(0)) throw new AdvanceError("Nominal uang muka harus lebih dari 0");
  if (!cashAccountId) throw new AdvanceError("Rekening kas/bank sumber uang wajib dipilih");
  const divisi = division || "UMUM";
  if (!DIVISI_VALID.includes(divisi)) throw new AdvanceError(`Divisi tidak dikenal: ${divisi}`);

  const pemegang = await tx.user.findUnique({ where: { id: holderId }, select: { id: true, name: true, active: true } });
  if (!pemegang || pemegang.active === false) throw new AdvanceError("Pemegang uang muka tidak ditemukan atau nonaktif", 404);

  const rekening = await tx.finCashAccount.findUnique({ where: { id: cashAccountId }, select: { id: true, active: true } });
  if (!rekening || !rekening.active) throw new AdvanceError("Rekening kas/bank tidak ditemukan atau nonaktif", 404);

  const tgl = tanggalBuku(date, todayBookDateWIB());
  const tenggat = tanggalBuku(dueDate);
  if (!tenggat) throw new AdvanceError("Tenggat pertanggungjawaban wajib diisi");
  if (tenggat < tgl) throw new AdvanceError("Tenggat pertanggungjawaban tidak boleh lebih awal dari tanggal pemberian");

  if (receiptUrl && !String(receiptUrl).startsWith("/media/finance-receipts/")) {
    throw new AdvanceError("Bukti harus diunggah lewat fitur upload");
  }

  let biaya;
  try {
    biaya = await hitungBiayaTransfer(tx, { cashAccountId, paymentMethod: input.paymentMethod, transferFeeType: input.transferFeeType, transferFeeAmount: input.transferFeeAmount });
  } catch (e) {
    if (e instanceof TransferFeeError) throw new AdvanceError(e.message, e.statusCode);
    throw e;
  }

  const advance = await tx.finOperationalAdvance.create({
    data: {
      advanceNumber: await generateDocumentNumber(tx, "UMO", tgl),
      holderId, division: divisi, purpose: purpose.trim(), date: tgl, dueDate: tenggat, amount: nominal,
      cashAccountId,
      paymentMethod: biaya.paymentMethod, transferFeeType: biaya.transferFeeType, transferFeeAmount: biaya.transferFeeAmount,
      receiptUrl: receiptUrl || null, notes: notes?.trim() || null,
      idempotencyKey: idempotencyKey || null,
      createdById: user.id,
    },
  });
  await postUangMukaDiberikan(tx, { advanceId: advance.id, userId: user.id });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_UANG_MUKA, entityId: advance.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: user.id,
    metadata: { advanceNumber: advance.advanceNumber, aksi: "diberikan", holder: pemegang.name, amount: String(nominal), tujuan: purpose.trim() },
  });
  return { advance, diulang: false };
}

// ─── Pertanggungjawaban (dipanggil saat pengeluaran mode UANG_MUKA disetujui) ───
/**
 * Terapkan saldo uang muka ke SATU pengeluaran. Pemanggil sudah mengunci baris
 * pengeluaran. Mengembalikan {applied, sisa} dan menulis baris settlement.
 */
export async function terapkanKePengeluaran(tx, { expense, userId }) {
  if (!expense.advanceId) throw new AdvanceError("Pengeluaran ini bermode uang muka tetapi tidak tertaut ke uang muka mana pun", 409);
  await lockUangMuka(tx, expense.advanceId);
  const adv = await tx.finOperationalAdvance.findUnique({ where: { id: expense.advanceId } });
  if (!adv) throw new AdvanceError("Uang muka tidak ditemukan", 404);
  if (adv.status === "DIBATALKAN") throw new AdvanceError(`Uang muka ${adv.advanceNumber} sudah dibatalkan — tidak bisa dipakai`, 409);

  const saldo = await saldoUangMuka(tx, adv);
  const tersedia = saldo.greaterThan(0) ? saldo : ZERO;
  const nominal = toMoney(expense.amount);
  const applied = tersedia.lessThan(nominal) ? tersedia : nominal;
  const sisa = nominal.minus(applied);

  if (applied.greaterThan(0)) {
    try {
      await tx.finOperationalAdvanceSettlement.create({
        data: {
          advanceId: adv.id, type: "PERTANGGUNGJAWABAN", amount: applied, date: expense.date,
          expenseId: expense.id, createdById: userId || expense.createdById,
          note: sisa.greaterThan(0) ? "Melebihi saldo: sisanya jadi utang reimbursement ke pemegang" : null,
        },
      });
    } catch (e) {
      if (e?.code === "P2002") throw new AdvanceError("Pengeluaran ini sudah memakai uang muka (pemakaian ganda ditolak)", 409);
      throw e;
    }
  }
  return { applied, sisa, advance: adv };
}

/** Batalkan pertanggungjawaban sebuah pengeluaran (dipanggil /cancel pengeluaran) — saldo pulih. */
export async function batalkanPertanggungjawabanPengeluaran(tx, { expense, reason, userId }) {
  if (!expense.advanceId) return null;
  await lockUangMuka(tx, expense.advanceId);
  const s = await tx.finOperationalAdvanceSettlement.findFirst({
    where: { expenseId: expense.id, type: "PERTANGGUNGJAWABAN", status: "ACTIVE" },
  });
  if (s) {
    await tx.finOperationalAdvanceSettlement.update({
      where: { id: s.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: userId, cancelReason: reason },
    });
  }
  await sinkronStatusUangMuka(tx, expense.advanceId);
  return s;
}

// ─── Pengembalian sisa ───────────────────────────────────────────────────
export async function kembalikanSisa(tx, { advanceId, amount, cashAccountId, date, note, receiptUrl, idempotencyKey, user }) {
  if (idempotencyKey) {
    const ada = await tx.finOperationalAdvanceSettlement.findUnique({ where: { idempotencyKey } });
    if (ada) return { settlement: ada, diulang: true };
  }
  await lockUangMuka(tx, advanceId);
  const adv = await tx.finOperationalAdvance.findUnique({ where: { id: advanceId } });
  if (!adv) throw new AdvanceError("Uang muka tidak ditemukan", 404);
  if (!STATUS_BISA_DIPAKAI.includes(adv.status)) {
    throw new AdvanceError(`Uang muka berstatus ${adv.status} — tidak ada sisa yang bisa dikembalikan`, 409);
  }
  const nominal = toMoney(amount, { field: "Nominal pengembalian" });
  if (nominal.lessThanOrEqualTo(0)) throw new AdvanceError("Nominal pengembalian harus lebih dari 0");
  const saldo = await saldoUangMuka(tx, adv);
  if (nominal.greaterThan(saldo)) {
    throw new AdvanceError(`Pengembalian melebihi saldo uang muka (saldo Rp${Number(saldo).toLocaleString("id-ID")})`, 409);
  }
  if (!cashAccountId) throw new AdvanceError("Rekening kas/bank penerima wajib dipilih");
  const rekening = await tx.finCashAccount.findUnique({ where: { id: cashAccountId }, select: { id: true, active: true } });
  if (!rekening || !rekening.active) throw new AdvanceError("Rekening kas/bank tidak ditemukan atau nonaktif", 404);
  if (receiptUrl && !String(receiptUrl).startsWith("/media/finance-receipts/")) throw new AdvanceError("Bukti harus diunggah lewat fitur upload");

  const settlement = await tx.finOperationalAdvanceSettlement.create({
    data: {
      advanceId, type: "PENGEMBALIAN", amount: nominal, date: tanggalBuku(date, todayBookDateWIB()),
      cashAccountId, note: note?.trim() || null, receiptUrl: receiptUrl || null,
      idempotencyKey: idempotencyKey || null, createdById: user.id,
    },
  });
  await postUangMukaDikembalikan(tx, { settlementId: settlement.id, userId: user.id });
  await sinkronStatusUangMuka(tx, advanceId);
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_UANG_MUKA, entityId: advanceId, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: user.id,
    metadata: { advanceNumber: adv.advanceNumber, aksi: "pengembalian", amount: String(nominal) },
  });
  return { settlement, diulang: false };
}

export async function batalkanPengembalian(tx, { advanceId, settlementId, reason, user }) {
  if (!reason?.trim()) throw new AdvanceError("Alasan pembatalan wajib diisi");
  await lockUangMuka(tx, advanceId);
  const adv = await tx.finOperationalAdvance.findUnique({ where: { id: advanceId } });
  if (!adv) throw new AdvanceError("Uang muka tidak ditemukan", 404);
  const s = await tx.finOperationalAdvanceSettlement.findUnique({ where: { id: settlementId } });
  if (!s || s.advanceId !== advanceId || s.type !== "PENGEMBALIAN") throw new AdvanceError("Pengembalian tidak ditemukan", 404);
  if (s.status === "CANCELLED") throw new AdvanceError("Pengembalian ini sudah dibatalkan", 409);
  if (adv.status === "DIBATALKAN") throw new AdvanceError("Uang muka sudah dibatalkan", 409);

  await balikkanJurnal(tx, { key: KEY.kembali(s.id), alasan: `Pembatalan pengembalian ${adv.advanceNumber} — ${reason.trim()}`, userId: user.id });
  await tx.finOperationalAdvanceSettlement.update({
    where: { id: s.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason.trim() },
  });
  await sinkronStatusUangMuka(tx, advanceId);
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_UANG_MUKA, entityId: advanceId, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: user.id,
    metadata: { advanceNumber: adv.advanceNumber, aksi: "pengembalian dibatalkan", reason: reason.trim(), amount: String(s.amount) },
  });
  return s;
}

/** Batalkan SELURUH uang muka — hanya bila belum ada pertanggungjawaban/pengembalian aktif (batalkan itu dulu). */
export async function batalkanUangMuka(tx, { advanceId, reason, user }) {
  if (!reason?.trim()) throw new AdvanceError("Alasan pembatalan wajib diisi");
  await lockUangMuka(tx, advanceId);
  const adv = await tx.finOperationalAdvance.findUnique({ where: { id: advanceId } });
  if (!adv) throw new AdvanceError("Uang muka tidak ditemukan", 404);
  if (adv.status === "DIBATALKAN") throw new AdvanceError("Uang muka ini sudah dibatalkan", 409);
  const aktif = await tx.finOperationalAdvanceSettlement.count({ where: { advanceId, status: "ACTIVE" } });
  if (aktif > 0) {
    throw new AdvanceError(`Uang muka ini masih punya ${aktif} pertanggungjawaban/pengembalian aktif — batalkan itu dulu sebelum membatalkan uang muka`, 409);
  }
  const menunggu = await tx.finExpense.count({ where: { advanceId, status: { in: ["DRAFT", "MENUNGGU_APPROVAL"] } } });
  if (menunggu > 0) {
    throw new AdvanceError(`Ada ${menunggu} pengeluaran yang menunggu keputusan dan tertaut ke uang muka ini — selesaikan/tolak dulu`, 409);
  }
  await balikkanJurnal(tx, { key: KEY.berikan(adv.id), alasan: `Pembatalan uang muka ${adv.advanceNumber} — ${reason.trim()}`, userId: user.id });
  const updated = await tx.finOperationalAdvance.update({
    where: { id: advanceId },
    data: { status: "DIBATALKAN", cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason.trim() },
  });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_UANG_MUKA, entityId: advanceId, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: user.id,
    metadata: { advanceNumber: adv.advanceNumber, aksi: "dibatalkan", reason: reason.trim(), amount: String(adv.amount) },
  });
  return updated;
}

// ─── Pembacaan ───────────────────────────────────────────────────────────
export const uangMukaInclude = {
  holder: { select: { id: true, name: true } },
  cashAccount: { select: { id: true, name: true, kind: true } },
  createdBy: { select: { id: true, name: true } },
  settlements: {
    orderBy: { createdAt: "asc" },
    include: {
      expense: { select: { id: true, expenseNumber: true, description: true, status: true, amount: true, advanceAppliedAmount: true } },
      cashAccount: { select: { id: true, name: true } },
    },
  },
};

/** Bentuk respons: saldo & angka turunan dihitung SERVER dari settlement ACTIVE. */
export function bentukUangMuka(a, { hariIni = todayBookDateWIB() } = {}) {
  const aktif = (a.settlements || []).filter((s) => s.status === "ACTIVE");
  const pakai = sumMoney(aktif.filter((s) => s.type === "PERTANGGUNGJAWABAN").map((s) => s.amount));
  const kembali = sumMoney(aktif.filter((s) => s.type === "PENGEMBALIAN").map((s) => s.amount));
  const saldo = a.status === "DIBATALKAN" ? ZERO : toMoney(a.amount).minus(pakai).minus(kembali);
  const bisaDipakai = STATUS_BISA_DIPAKAI.includes(a.status);
  return {
    ...a,
    amount: moneyToNumber(a.amount),
    transferFeeAmount: moneyToNumber(a.transferFeeAmount ?? 0),
    ...ringkasBiaya({ amount: a.amount, transferFeeAmount: a.transferFeeAmount }),
    dipertanggungjawabkan: moneyToNumber(pakai),
    dikembalikan: moneyToNumber(kembali),
    saldo: moneyToNumber(saldo),
    lewatTempo: bisaDipakai && !!a.dueDate && new Date(a.dueDate) < hariIni,
    settlements: (a.settlements || []).map((s) => ({
      ...s, amount: moneyToNumber(s.amount),
      expense: s.expense ? { ...s.expense, amount: moneyToNumber(s.expense.amount), advanceAppliedAmount: moneyToNumber(s.expense.advanceAppliedAmount) } : null,
    })),
  };
}

/** Uang muka aktif (saldo > 0) milik `holderIds` — untuk pilihan di Pengajuan Biaya. */
export async function daftarAktifUntuk(db, holderIds) {
  const ids = [...new Set((holderIds || []).filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = await db.finOperationalAdvance.findMany({
    where: { holderId: { in: ids }, status: { in: STATUS_BISA_DIPAKAI } },
    include: { holder: { select: { id: true, name: true } }, settlements: { where: { status: "ACTIVE" } } },
    orderBy: { date: "asc" },
  });
  return rows.map((a) => bentukUangMuka(a)).filter((a) => a.saldo > 0).map((a) => ({
    id: a.id, advanceNumber: a.advanceNumber, holderId: a.holderId, holderName: a.holder?.name || null,
    purpose: a.purpose, division: a.division, date: a.date, dueDate: a.dueDate, saldo: a.saldo, lewatTempo: a.lewatTempo,
  }));
}

/** Validasi bahwa uang muka ini boleh dipakai pengajuan milik `pemilikIds` (pengaju/PIC). */
export async function pastikanUangMukaBolehDipakai(db, { advanceId, pemilikIds }) {
  const adv = await db.finOperationalAdvance.findUnique({ where: { id: advanceId }, include: { settlements: { where: { status: "ACTIVE" } } } });
  if (!adv) throw new AdvanceError("Uang muka tidak ditemukan", 404);
  if (!STATUS_BISA_DIPAKAI.includes(adv.status)) throw new AdvanceError(`Uang muka ${adv.advanceNumber} berstatus ${adv.status} — pilih uang muka yang masih aktif`, 409);
  if (!(pemilikIds || []).filter(Boolean).includes(adv.holderId)) {
    throw new AdvanceError("Uang muka ini bukan milik pengaju/PIC pengajuan — pilih uang muka atas nama pengaju atau PIC", 403);
  }
  const b = bentukUangMuka(adv);
  if (b.saldo <= 0) throw new AdvanceError(`Saldo uang muka ${adv.advanceNumber} sudah habis`, 409);
  return { advance: adv, saldo: b.saldo };
}
