// PENUNTASAN PEMBAYARAN HISTORIS SEBELUM SALDO AWAL (keputusan Owner 29 Sep 2026; cutoff 18 September 2026 WIB).
//
// Uang yang benar-benar DITERIMA sebelum cutoff sudah tercakup dalam saldo riil kas/bank (penyesuaian SALDO_AWAL, lawannya Laba Ditahan).
// Pembayaran itu tidak boleh menambah Kas/Bank lagi. Dasar keputusan: laporan Notion, data order/payment, bukti internal, konfirmasi CFO,
// keputusan Owner — BUKAN rekening koran. Karena itu labelnya "Historis — tercakup saldo awal, dikonfirmasi Owner/CFO", bukan "Cocok Rekening Koran".
//
// KLASIFIKASI (dihitung dari LEDGER + data order, bukan dari status tampilan sekarang):
//   C1 HISTORIS LEDGER-ONLY   pendapatan/piutang order TIDAK PERNAH dijurnal (order sudah diserahkan sebelum pembukuan) → TANPA jurnal;
//                             hanya audit "HISTORIS_TERCAKUP_SALDO_AWAL". Jurnal Uang Muka di sini = kewajiban palsu.
//   C2 PIUTANG SUDAH TERBUKA  pengakuan pendapatan POSTED → non-kas: Dr 3-3100 Laba Ditahan / Cr Piutang Usaha.
//   C3 DIBAYAR SEBELUM        order belum diserahkan (pendapatan belum diakui) → non-kas: Dr 3-3100 / Cr Uang Muka Pelanggan; saat diserahkan,
//      PENYERAHAN             mekanisme lama memindahkan Uang Muka ke Pendapatan.
//   C4 EXCEPTION              tidak jelas / berisiko hitung ganda → TIDAK diposting, alasan spesifik.
//   BANK_GANDA                jurnal Bank/Kas SUDAH ada padahal uangnya sebelum cutoff (kas terhitung dua kali) → koreksi: balik jurnal Bank,
//                             Payment lama diganti versi terverifikasi tanpa rekening, lalu jurnal pengganti sesuai C1/C2/C3.
//   SUDAH_TUNTAS              sudah punya jurnal non-kas ke Laba Ditahan (mis. dari verifikasi "Sebelum saldo awal") — tidak disentuh.
//
// Kunci idempotensi jurnal non-kas = `PEMBAYARAN_ORDER:<paymentId>` (SAMA dengan jurnal pembayaran biasa) → membatalkan/mengoreksi payment
// nanti otomatis membalik jurnal ini juga, dan menjalankan ulang batch menghasilkan delta nol.

import { moneyToNumber, toMoney } from "./money.js";
import { reverseJournal, postJournal, findEntryByKey, toBookDate, STATUS_DIHITUNG } from "./journal.js";
import { resolveAccount, SYSTEM_KEYS } from "./accounts.js";
import { KoreksiError } from "./koreksiGate.js";
import { kunciUntukPayment } from "./urutanKunci.js";
import { PILIH_TAGIHAN, tagihanOrder } from "./tagihanOrder.js";
import { STATUS_PENGAKUAN, KEY as KEY_ORDER } from "./posting/orderRevenue.js";
import { blokirKoreksiBatch } from "./koreksiPembayaran.js";
import { paidForOrder } from "./allocation.js";
import { recomputeOrderPaymentStatus } from "../paymentLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";
import { tanggalCutoff, sebelumCutoff, tampilCutoff, tanggalWIB } from "./cutoff.js";

const GATE_MATI = { enabled: false };
export const KODE_HISTORIS = "HISTORIS_TERCAKUP_SALDO_AWAL";
export const LABEL_HISTORIS = "Historis — tercakup saldo awal, dikonfirmasi Owner/CFO";
const ALASAN_MAKS = 500;
const rupiah = (n) => `Rp${Number(n).toLocaleString("id-ID")}`;

const SELECT_PAYMENT = {
  id: true, amount: true, method: true, cashAccountId: true, createdAt: true, cancelledAt: true, orderId: true, jobId: true,
  proofPhotoUrl: true, recordedById: true, referenceNumber: true, notes: true, internalNote: true, replacesPaymentId: true,
  replacedBy: { select: { id: true } }, verifications: { select: { id: true } }, finAllocations: { select: { orderId: true } },
  order: { select: { ...PILIH_TAGIHAN, orderNumber: true, customerId: true, status: true, groupId: true, group: { select: { id: true, source: true } } } },
};

async function jurnalPembayaran(db, paymentId) {
  return db.finJournalEntry.findMany({
    where: { source: "PEMBAYARAN_ORDER", sourceId: paymentId, status: { in: ["POSTED", "REVERSED"] } },
    include: { lines: { include: { account: { select: { systemKey: true, code: true } } } } }, orderBy: { createdAt: "asc" },
  });
}

/** Piutang bersih (debit − kredit) akun Piutang Usaha untuk satu order, dari seluruh jurnal yang dihitung. */
async function piutangBersihOrder(db, orderId) {
  const akun = await db.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_USAHA }, select: { id: true } });
  const a = await db.finJournalLine.aggregate({ where: { orderId, accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } }, _sum: { debit: true, credit: true } });
  return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
}

/**
 * Klasifikasi SATU payment berdasarkan ledger saat ini. `abaikanJurnalId` = id jurnal Bank yang SEDANG akan dibalik (untuk BANK_GANDA, dihitung seakan
 * sudah dibalik). Tidak menulis apa pun. Mengembalikan { kelas, kode, alasan, lawan? } — lawan = "PIUTANG" | "UANG_MUKA" | null.
 */
export async function klasifikasiPembayaranHistoris(db, p, { cutoff, sesudahBalik = false, lawanCermin = null, konfirmasiOwner = false } = {}) {
  cutoff ??= await tanggalCutoff(db);
  const tolak = (kode, alasan) => ({ kelas: "C4", kode, alasan });
  if (p.cancelledAt) return tolak("SUDAH_DIBATALKAN_ATAU_DIGANTI", p.replacedBy ? "Payment sudah diganti versi baru." : "Payment sudah dibatalkan.");
  if (p.verifications.length === 0) return tolak("BELUM_DIVERIFIKASI", "Payment belum diverifikasi.");
  // konfirmasiOwner: Owner menyatakan uangnya masuk SEBELUM cutoff walau tanggal yang tercatat tepat pada hari cutoff (mis. Aldho G, 18 Sep, Rp3.978.030).
  // Hanya tanggal <= cutoff yang boleh dinyatakan begitu; tanggal sesudahnya tetap uang berjalan.
  const historis = sebelumCutoff(p.createdAt, cutoff) || (konfirmasiOwner && tanggalWIB(p.createdAt) <= cutoff);
  if (!historis) return tolak("BUKAN_HISTORIS", `Tanggal terima ${tanggalWIB(p.createdAt)} bukan sebelum saldo awal (${cutoff}).`);
  if (!(p.amount > 0)) return tolak("NOMINAL_TIDAK_VALID", "Nominal Payment tidak valid.");
  const o = p.order;
  if (o.status === "CANCELLED") return tolak("ORDER_DIBATALKAN", `Order ${o.orderNumber} dibatalkan.`);
  if (!(Number(o.value) > 0)) return tolak("ORDER_NOL", `Order ${o.orderNumber} bernilai Rp0 (belum dihargai).`);
  if (o.groupId && o.group?.source === "BARU") return tolak("RESI", `Order ${o.orderNumber} bagian dari Resi Gabungan — tinjau manual lewat alur Resi.`);
  if (p.finAllocations.length > 0) return tolak("ADA_ALOKASI", "Payment dibagi ke beberapa order (alokasi) — klasifikasi ambigu.");

  const aktifLain = await db.payment.findMany({ where: { orderId: p.orderId, cancelledAt: null, NOT: { id: p.id } }, select: { id: true, amount: true, createdAt: true } });
  if (aktifLain.some((x) => x.amount === p.amount && tanggalWIB(x.createdAt) === tanggalWIB(p.createdAt))) return tolak("KEMUNGKINAN_GANDA", "Ada Payment lain pada order yang sama dengan nominal dan tanggal identik.");
  const dibayar = moneyToNumber(await paidForOrder(db, p.orderId, GATE_MATI));
  if (dibayar > tagihanOrder(o, o.group)) return tolak("MELEBIHI_TAGIHAN", `Total Payment aktif ${rupiah(dibayar)} melebihi tagihan order ${rupiah(tagihanOrder(o, o.group))}.`);
  const refund = await db.finRefund.findFirst({ where: { orderId: p.orderId, status: { in: ["MENUNGGU_APPROVAL", "DISETUJUI"] } }, select: { refundNumber: true } });
  if (refund) return tolak("ADA_REFUND", `Order punya refund aktif (${refund.refundNumber}).`);

  const jurnal = sesudahBalik ? [] : await jurnalPembayaran(db, p.id);
  const aktif = jurnal.filter((e) => e.status === "POSTED");
  if (aktif.length > 1 || jurnal.some((e) => e.idempotencyKey?.includes(":RECLAS"))) return tolak("JURNAL_AMBIGU", "Payment punya lebih dari satu jurnal atau jurnal penyesuaian — ambigu.");
  if (aktif.length === 1) {
    const e = aktif[0];
    const adaKas = e.lines.some((l) => l.cashAccountId);
    const adaLaba = e.lines.some((l) => l.account.systemKey === SYSTEM_KEYS.LABA_DITAHAN);
    if (adaLaba && !adaKas) return { kelas: "SUDAH_TUNTAS", kode: "SUDAH_TUNTAS", alasan: "Sudah dijurnal non-kas ke Laba Ditahan." };
    if (adaKas) return { kelas: "BANK_GANDA", kode: "BANK_GANDA", alasan: "Sudah dijurnal ke Bank/Kas padahal uang diterima sebelum saldo awal — kas terhitung dua kali.", jurnalId: e.id };
    return tolak("JURNAL_AMBIGU", "Jurnal pembayaran ada tetapi bukan pola Bank/Kas maupun Laba Ditahan.");
  }
  if (jurnal.length > 0) return tolak("JURNAL_SUDAH_DIBALIK", "Jurnal pembayaran sebelumnya sudah dibalik — ambigu.");

  const pengakuan = await findEntryByKey(db, KEY_ORDER.revenue(p.orderId));
  if (pengakuan && pengakuan.status !== "POSTED") return tolak("PENGAKUAN_DIBALIK", "Pengakuan pendapatan order sudah dibalik — ambigu.");
  if (pengakuan && lawanCermin) {
    // Koreksi kas ganda: pengganti MENCERMINKAN akun yang dikredit jurnal lama (review Opus 29 Sep 2026). Jurnal lama Dr Bank / Cr Uang Muka yang lalu
    // dipindahkan ke Piutang oleh pengakuan pendapatan, setelah dibalik, hanya bisa dipulihkan dengan Cr Uang Muka lagi — memilih ulang dari status
    // pengakuan (C2) akan meninggalkan Uang Muka bersaldo debit dan Piutang terlalu kecil.
    return { kelas: lawanCermin === "PIUTANG" ? "C2" : "C3", kode: lawanCermin === "PIUTANG" ? "PIUTANG_TERBUKA" : "UANG_MUKA_DICERMINKAN", alasan: `Pengganti mencerminkan akun yang dikredit jurnal lama (${lawanCermin === "PIUTANG" ? "Piutang" : "Uang Muka"}).`, lawan: lawanCermin };
  }
  if (pengakuan) {
    const sisa = await piutangBersihOrder(db, p.orderId);
    if (sisa.lessThan(toMoney(p.amount))) return tolak("PIUTANG_TIDAK_CUKUP", `Piutang order ${rupiah(moneyToNumber(sisa))} lebih kecil dari Payment ${rupiah(p.amount)} — akan membuat piutang bersaldo kredit.`);
    return { kelas: "C2", kode: "PIUTANG_TERBUKA", alasan: "Pendapatan sudah diakui (Piutang terbuka): tutup dengan Dr Laba Ditahan / Cr Piutang.", lawan: "PIUTANG" };
  }
  if (STATUS_PENGAKUAN.includes(o.status)) {
    return { kelas: "C1", kode: KODE_HISTORIS, alasan: "Order sudah diserahkan tetapi pendapatannya tidak pernah dijurnal (riwayat sebelum pembukuan) — tidak ada Piutang/Uang Muka untuk ditutup.", lawan: null };
  }
  return { kelas: "C3", kode: "DIBAYAR_SEBELUM_PENYERAHAN", alasan: "Order belum diserahkan: catat Uang Muka Pelanggan (non-kas, lawan Laba Ditahan).", lawan: "UANG_MUKA" };
}

/** Jurnal non-kas pengganti. Mengembalikan { posted, entryNumber?, created }. `lawan` = "PIUTANG" | "UANG_MUKA". */
async function postJurnalNonKas(tx, { p, lawan, userId, keterangan }) {
  const laba = await resolveAccount(tx, SYSTEM_KEYS.LABA_DITAHAN);
  const akunLawan = await resolveAccount(tx, lawan === "PIUTANG" ? SYSTEM_KEYS.PIUTANG_USAHA : SYSTEM_KEYS.UANG_MUKA_PELANGGAN);
  const nominal = toMoney(p.amount);
  const { entry, created } = await postJournal(tx, {
    date: toBookDate(tanggalWIB(p.createdAt)), // tanggal terima menurut WIB (sama dengan dasar cutoff), bukan tanggal UTC
    description: `${keterangan} — ${p.order.orderNumber} (diterima sebelum saldo awal; ${LABEL_HISTORIS})`,
    source: "PEMBAYARAN_ORDER",
    sourceId: p.id,
    idempotencyKey: KEY_ORDER.payment(p.id),
    userId,
    lines: [
      { accountId: laba.id, debit: nominal, description: "Kas sudah tercermin di saldo awal (penyesuaian 18 Sep 2026)", orderId: p.orderId, customerId: p.order.customerId },
      {
        accountId: akunLawan.id, credit: nominal, orderId: p.orderId, customerId: p.order.customerId,
        description: lawan === "PIUTANG" ? `Pelunasan piutang order ${p.order.orderNumber}` : `Uang muka pelanggan — order ${p.order.orderNumber}`,
      },
    ],
  });
  return { posted: true, entryNumber: entry.entryNumber, created };
}

async function catatAuditHistoris(tx, { p, kelas, kode, alasan, userId, reason, cutoff, entryNumber = null }) {
  const sudah = await tx.activityEvent.findFirst({
    where: { entityType: ENTITY_TYPES.PAYMENT, entityId: p.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, metadata: { path: ["aksi"], equals: "historis_tercakup_saldo_awal" } },
    select: { id: true },
  });
  if (sudah) return false;
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.PAYMENT, entityId: p.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId,
    metadata: {
      aksi: "historis_tercakup_saldo_awal", kode: KODE_HISTORIS, label: LABEL_HISTORIS, kelas, klasifikasi: kode, cutoff, reason, dasar: "Keputusan Owner + konfirmasi CFO; bukan rekening koran",
      alasanKlasifikasi: alasan, orderNumber: p.order.orderNumber, amount: p.amount, tanggalTerima: tanggalWIB(p.createdAt), ...(entryNumber && { jurnal: entryNumber }),
    },
  });
  return true;
}

/**
 * Tuntaskan SATU payment historis yang BELUM berjurnal (C1/C2/C3). Aman diulang: hasil kedua = { aksi: "TIDAK_ADA_PERUBAHAN" }.
 * Row lock kanonis (grup → order → payment); klasifikasi dihitung DI BAWAH kunci.
 */
export async function tuntaskanPembayaranHistoris(tx, { paymentId, userId, alasan }) {
  const reason = String(alasan ?? "").trim().slice(0, ALASAN_MAKS);
  if (!reason) throw new KoreksiError("Alasan wajib diisi", 400, "ALASAN_WAJIB");
  if (!(await kunciUntukPayment(tx, paymentId, {}))) throw new KoreksiError("Pembayaran tidak ditemukan", 404);
  const p = await tx.payment.findUnique({ where: { id: paymentId }, select: SELECT_PAYMENT });
  const cutoff = await tanggalCutoff(tx);
  const k = await klasifikasiPembayaranHistoris(tx, p, { cutoff });
  if (k.kelas === "SUDAH_TUNTAS") return { aksi: "TIDAK_ADA_PERUBAHAN", kelas: k.kelas };
  if (k.kelas === "BANK_GANDA") throw new KoreksiError("Payment ini punya jurnal Bank/Kas — gunakan koreksi pembayaran historis (balik + pengganti).", 409, "PERLU_KOREKSI_BANK");
  if (k.kelas === "C4") throw new KoreksiError(`Tidak diposting (exception ${k.kode}): ${k.alasan}`, 409, k.kode);

  // Sudah pernah diaudit & (kalau C2/C3) sudah berjurnal = hasil ulang. C1 tanpa jurnal: audit-nya dedupe.
  let entryNumber = null;
  if (k.lawan) {
    const r = await postJurnalNonKas(tx, { p, lawan: k.lawan, userId, keterangan: k.lawan === "PIUTANG" ? "Penuntasan pelunasan historis" : "Penuntasan uang muka historis" });
    entryNumber = r.entryNumber;
  }
  const dicatat = await catatAuditHistoris(tx, { p, kelas: k.kelas, kode: k.kode, alasan: k.alasan, userId, reason, cutoff, entryNumber });
  await recomputeOrderPaymentStatus(tx, p.orderId, { paidAtEfektif: true });
  return { aksi: k.lawan ? "JURNAL_NON_KAS" : "AUDIT_SAJA", kelas: k.kelas, entryNumber, auditBaru: dicatat };
}

/**
 * Koreksi payment yang sudah dijurnal ke Bank/Kas padahal uangnya diterima sebelum cutoff: balik jurnal lama (bertanggal sama), Payment lama → diganti
 * versi terverifikasi TANPA rekening (alokasi/order sama), lalu jurnal pengganti sesuai ledger (C1 tanpa jurnal / C2 Piutang / C3 Uang Muka).
 * Tanpa PIN — dijalankan Finance Admin lewat skrip server; tidak ada endpoint publik.
 */
export async function koreksiPembayaranHistoris(tx, { paymentId, userId, alasan, konfirmasiOwner = false }) {
  const reason = String(alasan ?? "").trim().slice(0, ALASAN_MAKS);
  if (!reason) throw new KoreksiError("Alasan koreksi wajib diisi", 400, "ALASAN_WAJIB");
  if (!(await kunciUntukPayment(tx, paymentId, {}))) throw new KoreksiError("Pembayaran tidak ditemukan", 404);
  const lama = await tx.payment.findUnique({ where: { id: paymentId }, select: SELECT_PAYMENT });
  // Kunci baris jurnal aktif (pencocokan mutasi bank paralel mengunci baris yang sama) SEBELUM blokir dievaluasi.
  await tx.$queryRawUnsafe(
    "SELECT l.id FROM fin_journal_lines l JOIN fin_journal_entries e ON e.id = l.entry_id WHERE e.source = 'PEMBAYARAN_ORDER' AND e.source_id = $1 AND e.status = 'POSTED' ORDER BY l.id FOR UPDATE OF l",
    paymentId,
  );
  const blokir = (await blokirKoreksiBatch(tx, [paymentId], { izinkanPraSaldoAwal: true })).get(paymentId);
  if (blokir) throw new KoreksiError(`${blokir.alasan} ${blokir.arah}`.trim(), 409, blokir.kode);

  const cutoff = await tanggalCutoff(tx);
  const awal = await klasifikasiPembayaranHistoris(tx, lama, { cutoff, konfirmasiOwner });
  if (awal.kelas !== "BANK_GANDA") throw new KoreksiError(`Bukan kasus kas terhitung dua kali (${awal.kode}): ${awal.alasan}`, 409, awal.kode === "SUDAH_TUNTAS" ? "SUDAH_TUNTAS" : awal.kode);

  // 1) Balik jurnal lama pada tanggal aslinya.
  const jurnalLama = await tx.finJournalEntry.findMany({
    where: { source: "PEMBAYARAN_ORDER", sourceId: paymentId, status: "POSTED" },
    select: { id: true, date: true, entryNumber: true, lines: { select: { credit: true, account: { select: { systemKey: true } } } } },
  });
  // Akun lawan yang DIKREDIT jurnal lama (Piutang atau Uang Muka) — dicerminkan oleh pengganti bila pendapatan order sudah diakui.
  const kreditLama = new Set(jurnalLama.flatMap((e) => e.lines.filter((l) => Number(l.credit) > 0).map((l) => l.account.systemKey)));
  const lawanCermin = kreditLama.has(SYSTEM_KEYS.PIUTANG_USAHA) ? "PIUTANG" : kreditLama.has(SYSTEM_KEYS.UANG_MUKA_PELANGGAN) ? "UANG_MUKA" : null;
  for (const e of jurnalLama) await reverseJournal(tx, { entryId: e.id, date: e.date, reason: `Koreksi pembayaran historis — ${reason}`, userId });

  // 2) Payment lama → dibatalkan (jejak tetap), Payment pengganti terverifikasi tanpa rekening, tanggal/nominal/order sama.
  await tx.payment.update({ where: { id: paymentId }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: `Dikoreksi — ${reason}`.slice(0, ALASAN_MAKS) } });
  const baru = await tx.payment.create({
    data: {
      orderId: lama.orderId, jobId: lama.jobId, amount: lama.amount, method: lama.method, proofPhotoUrl: lama.proofPhotoUrl, cashAccountId: null,
      recordedById: lama.recordedById, createdAt: lama.createdAt, referenceNumber: lama.referenceNumber, notes: lama.notes, internalNote: lama.internalNote, replacesPaymentId: lama.id,
    },
  });
  await tx.paymentVerification.create({ data: { paymentId: baru.id, verifiedById: userId } });

  // 3) Klasifikasi ULANG untuk versi pengganti (jurnal lama sudah dibalik) → jurnal non-kas sesuai ledger, atau tanpa jurnal (C1).
  const pBaru = await tx.payment.findUnique({ where: { id: baru.id }, select: SELECT_PAYMENT });
  const k = await klasifikasiPembayaranHistoris(tx, pBaru, { cutoff, sesudahBalik: true, lawanCermin, konfirmasiOwner });
  if (k.kelas === "C4") throw new KoreksiError(`Koreksi dibatalkan (exception ${k.kode}): ${k.alasan}`, 409, k.kode);
  let entryNumber = null;
  if (k.lawan) {
    const r = await postJurnalNonKas(tx, { p: pBaru, lawan: k.lawan, userId, keterangan: "Pengganti koreksi pembayaran historis" });
    entryNumber = r.entryNumber;
  }

  // 4) Status/paidAt (tanggal pembayaran pelunas, bukan waktu koreksi) + audit di kedua Payment.
  const sebelumOrder = await tx.order.findUnique({ where: { id: lama.orderId }, select: { paymentStatus: true, paidAt: true } });
  await recomputeOrderPaymentStatus(tx, lama.orderId, { paidAtEfektif: true });
  const sesudahOrder = await tx.order.findUnique({ where: { id: lama.orderId }, select: { paymentStatus: true, paidAt: true } });
  const meta = {
    reason, aksi: "koreksi_pembayaran_historis", cutoff, ...(konfirmasiOwner && { konfirmasiOwner: true }), label: LABEL_HISTORIS, dasar: "Keputusan Owner + konfirmasi CFO; bukan rekening koran", klasifikasi: k.kode,
    jurnalDibalik: jurnalLama.map((e) => e.entryNumber), jurnalPengganti: entryNumber, orderNumber: lama.order.orderNumber, amount: lama.amount, tanggalTerima: tanggalWIB(lama.createdAt),
    statusOrder: { sebelum: sebelumOrder.paymentStatus, sesudah: sesudahOrder.paymentStatus },
  };
  await recordActivity(tx, { entityType: ENTITY_TYPES.PAYMENT, entityId: paymentId, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId, metadata: { ...meta, digantiOleh: baru.id } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.PAYMENT, entityId: baru.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: userId, metadata: { ...meta, menggantikan: paymentId } });
  return { ok: true, lamaId: paymentId, baruId: baru.id, kelas: k.kelas, klasifikasi: k.kode, jurnalDibalik: jurnalLama.map((e) => e.entryNumber), jurnalPengganti: entryNumber, statusOrder: sesudahOrder.paymentStatus, paidAt: sesudahOrder.paidAt };
}

/** Semua Payment aktif bertanggal sebelum cutoff (terverifikasi) beserta klasifikasinya — baca-saja, untuk dry-run/laporan. */
export async function daftarKlasifikasiHistoris(db) {
  const cutoff = await tanggalCutoff(db);
  const batas = new Date(`${cutoff}T00:00:00+07:00`);
  const ps = await db.payment.findMany({ where: { cancelledAt: null, createdAt: { lt: batas }, verifications: { some: {} } }, select: SELECT_PAYMENT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const items = [];
  for (const p of ps) {
    const k = await klasifikasiPembayaranHistoris(db, p, { cutoff });
    items.push({ paymentId: p.id, orderNumber: p.order.orderNumber, amount: p.amount, tanggal: tanggalWIB(p.createdAt), kelas: k.kelas, kode: k.kode, alasan: k.alasan, lawan: k.lawan ?? null });
  }
  const ringkas = {};
  for (const i of items) {
    const r = (ringkas[i.kelas] ??= { jumlah: 0, nilai: 0 });
    r.jumlah += 1; r.nilai += i.amount;
  }
  return { cutoff, items, ringkas };
}

export { tampilCutoff };
