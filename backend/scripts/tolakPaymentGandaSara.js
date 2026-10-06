// TOLAK PAYMENT GANDA "Sara" RES-21092026-130 (instruksi Owner 6 Okt 2026: "tolak ganda sara"). Sales menginput pembayaran kartu Rp3.726.000 DUA kali; bank hanya satu settlement EDC
// (3 Okt 2026, Rp3.658.932 = 3.726.000 − potongan 67.068). Yang DITOLAK = Payment a4ee18e1 (19:00, belum diverifikasi, tanpa rekening); yang DIPERTAHANKAN = c61723ae (terverifikasi, PT Sano).
// Memakai fungsi RESMI yang sama dengan tombol "Tolak" (POST /api/finance/pembayaran/:id/tolak → tolakPembayaran): Payment dibatalkan (append-only), jurnal JV-30092026-853 dibalik, status order dihitung ulang.
//   node scripts/tolakPaymentGandaSara.js                  # PRATINJAU
//   TOLAK_OK=1 node scripts/tolakPaymentGandaSara.js --apply
import { prisma } from "../src/db.js";
import { tolakPembayaran } from "../src/services/finance/pembayaran.js";
import { toMoney } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const PAYMENT_TOLAK = "a4ee18e1-b676-4b47-a194-3dc83d5cc5d7";
const PAYMENT_TAHAN = "c61723ae-938f-4952-9c51-76ca7a3c111a";
const NOMOR = "RES-21092026-130";
const NOMINAL = 3726000;
const ALASAN = "Duplikat input Sales (Ervina): satu transaksi kartu Rp3.726.000 terinput dua kali. Bank hanya mencatat satu settlement EDC (3 Okt 2026, Rp3.658.932 = 3.726.000 − biaya 67.068). Payment terverifikasi c61723ae dipertahankan. Atas instruksi Owner 6 Okt 2026.";
const STATUS = ["POSTED", "REVERSED"];
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
class Berhenti extends Error {}

async function periksa(db) {
  const tolak = await db.payment.findUnique({ where: { id: PAYMENT_TOLAK }, include: { order: { select: { id: true, orderNumber: true, value: true, paymentStatus: true, paidAt: true } }, verifications: true } });
  const tahan = await db.payment.findUnique({ where: { id: PAYMENT_TAHAN }, include: { verifications: true } });
  if (!tolak || !tahan) throw new Berhenti("Payment tidak ditemukan");
  if (tolak.cancelledAt) return { sudah: true };
  if (tolak.order.orderNumber !== NOMOR || tahan.orderId !== tolak.orderId) throw new Berhenti("order tidak sesuai");
  if (tolak.amount !== NOMINAL || tahan.amount !== NOMINAL || tolak.method !== "CARD" || tahan.method !== "CARD") throw new Berhenti("nominal/cara bayar tidak sesuai dugaan");
  if (tolak.verifications.length) throw new Berhenti("Payment yang akan ditolak ternyata sudah diverifikasi");
  if (tahan.cancelledAt || tahan.verifications.length !== 1) throw new Berhenti("Payment yang dipertahankan harus aktif dan terverifikasi");
  const aktif = await db.payment.findMany({ where: { orderId: tolak.orderId, cancelledAt: null }, select: { id: true } });
  if (aktif.length !== 2) throw new Berhenti(`order punya ${aktif.length} Payment aktif (dugaan: 2)`);
  return { sudah: false, tolak, tahan };
}
async function foto(db) {
  const rek = await db.finCashAccount.findMany({ select: { id: true, name: true, accountId: true } }); const saldo = {};
  for (const r of rek) { const a = await db.finJournalLine.aggregate({ where: { cashAccountId: r.id, accountId: r.accountId, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } }); saldo[r.name] = toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0)); }
  const ner = await db.finJournalLine.aggregate({ where: { entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  const o = await db.order.findFirst({ where: { orderNumber: NOMOR }, select: { paymentStatus: true, paidAt: true } });
  return { saldo, seimbang: toMoney(ner._sum.debit).equals(toMoney(ner._sum.credit)), jurnal: await db.finJournalEntry.count(), batal: await db.payment.count({ where: { cancelledAt: { not: null } } }), payment: await db.payment.count(), verif: await db.paymentVerification.count(), status: o.paymentStatus, paidAt: o.paidAt?.toISOString() ?? null };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "PRATINJAU (tidak menulis apa pun)"}`);
  const p = await periksa(prisma);
  if (p.sudah) { console.log("SUDAH DITOLAK — berhenti tanpa perubahan."); return; }
  const a = await foto(prisma);
  console.log(`Tolak   : a4ee18e1 ${rp(NOMINAL)} CARD (input ${p.tolak.createdAt.toISOString()}, belum diverifikasi)`);
  console.log(`Tahan   : c61723ae ${rp(NOMINAL)} CARD (terverifikasi, ${p.tahan.verifications[0].createdAt.toISOString()})`);
  console.log(`Order   : ${NOMOR} status ${a.status}, paidAt ${a.paidAt} (harus TIDAK berubah)`);
  console.log(`Harapan : PT Sano ${rp(a.saldo["PT Sano"])} → ${rp(a.saldo["PT Sano"].minus(NOMINAL))}; KEM & Kas tetap; +1 jurnal (pembalik JV-30092026-853); +1 Payment dibatalkan`);
  if (!APPLY) { console.log("\nPRATINJAU. Jalankan: TOLAK_OK=1 node scripts/tolakPaymentGandaSara.js --apply"); return; }
  if (process.env.TOLAK_OK !== "1") throw new Error("Menolak --apply: set TOLAK_OK=1");
  const aktor = await prisma.user.findFirst({ where: { name: "OWNER (Admin)", role: "ADMIN", active: true }, select: { id: true } });
  if (!aktor) throw new Error("akun atribusi OWNER (Admin) tidak ditemukan");
  const hasil = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "TOLAK_PAYMENT_GANDA_SARA");
    const q = await periksa(tx); if (q.sudah) throw new Berhenti("sudah ditolak oleh proses lain");
    const sebelum = await foto(tx);
    const r = await tolakPembayaran(tx, { paymentId: PAYMENT_TOLAK, reason: ALASAN, userId: aktor.id });
    const sesudah = await foto(tx);
    if (!sesudah.saldo["PT Sano"].equals(sebelum.saldo["PT Sano"].minus(NOMINAL))) throw new Error("INVARIAN GAGAL: saldo PT Sano — rollback");
    for (const n of Object.keys(sebelum.saldo)) if (n !== "PT Sano" && !sesudah.saldo[n].equals(sebelum.saldo[n])) throw new Error(`INVARIAN GAGAL: saldo ${n} berubah — rollback`);
    if (sesudah.status !== sebelum.status || sesudah.paidAt !== sebelum.paidAt) throw new Error("INVARIAN GAGAL: status/paidAt order berubah — rollback");
    if (sesudah.jurnal !== sebelum.jurnal + 1 || sesudah.batal !== sebelum.batal + 1 || sesudah.payment !== sebelum.payment || sesudah.verif !== sebelum.verif || !sesudah.seimbang) throw new Error("INVARIAN GAGAL: jumlah jurnal/Payment/verifikasi/neraca — rollback");
    return { r, sebelum, sesudah };
  }, { timeout: 60_000, maxWait: 20_000 });
  console.log(`\nDITOLAK (atribusi OWNER (Admin)): jurnal dibalik = ${hasil.r.jurnal?.reversed ? "ya" : "tidak"}`);
  console.log(`PT Sano ${rp(hasil.sebelum.saldo["PT Sano"])} → ${rp(hasil.sesudah.saldo["PT Sano"])}; KEM ${rp(hasil.sesudah.saldo["KEM - Sano Bank"])}; Kas ${rp(hasil.sesudah.saldo["Uang Kas Sano"])}`);
  console.log(`order ${NOMOR}: ${hasil.sesudah.status}, paidAt ${hasil.sesudah.paidAt} (tidak berubah); jurnal ${hasil.sebelum.jurnal} → ${hasil.sesudah.jurnal}; Payment dibatalkan ${hasil.sebelum.batal} → ${hasil.sesudah.batal}; neraca seimbang`);
  const ulang = await periksa(prisma); console.log(`replay: ${ulang.sudah ? "tidak menggandakan (sudah ditolak)" : "PERIKSA!"}`);
}
main().catch((e) => { if (e instanceof Berhenti) { console.error("BERHENTI:", e.message); process.exitCode = 2; } else { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; } }).finally(async () => { await prisma.$disconnect(); });
