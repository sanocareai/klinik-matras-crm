// TUNTASKAN SATU PAYMENT HISTORIS (uang diterima SEBELUM saldo awal, Payment terverifikasi, tetapi jurnalnya tidak menutup piutang order).
// Kasus nyata: Stanley NEW-07092026-008 — Payment Rp6.450.000 (11 Sep, terverifikasi) tanpa jurnal; pendapatannya baru diakui 2 Okt sehingga Piutang Usaha
// menyimpan Rp6.450.000 padahal uangnya sudah ada di saldo awal. Memakai fungsi RESMI tuntaskanPembayaranHistoris (services/finance/pembayaranHistoris.js):
// jurnal NON-KAS Dr Laba Ditahan / Cr Piutang Usaha — Kas/Bank TIDAK disentuh. Berbeda dari penuntasanHistorisSebelumSaldoAwal.js (batch semua Payment): ini HANYA satu order.
//
//   node scripts/tuntaskanPaymentHistoris.js --order=NEW-07092026-008              # PRATINJAU (tidak menulis apa pun)
//   TUNTAS_OK=1 node scripts/tuntaskanPaymentHistoris.js --order=NEW-07092026-008 --apply
import { prisma } from "../src/db.js";
import { tuntaskanPembayaranHistoris, daftarKlasifikasiHistoris, LABEL_HISTORIS } from "../src/services/finance/pembayaranHistoris.js";
import { toMoney } from "../src/services/finance/money.js";
import { tanggalWIB } from "../src/services/finance/cutoff.js";

const APPLY = process.argv.includes("--apply");
const NOMOR = (process.argv.find((a) => a.startsWith("--order=")) ?? "").slice("--order=".length).trim();
const STATUS = ["POSTED", "REVERSED"];
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
class Berhenti extends Error {}

async function foto(db, orderId) {
  const rek = await db.finCashAccount.findMany({ select: { id: true, name: true, accountId: true } });
  const saldo = {};
  for (const r of rek) {
    const a = await db.finJournalLine.aggregate({ where: { cashAccountId: r.id, accountId: r.accountId, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
    saldo[r.name] = toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
  }
  const akun = await db.finAccount.findUnique({ where: { systemKey: "PIUTANG_USAHA" }, select: { id: true } });
  const pa = await db.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  const po = await db.finJournalLine.aggregate({ where: { accountId: akun.id, orderId, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  const ner = await db.finJournalLine.aggregate({ where: { entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  const o = await db.order.findUnique({ where: { id: orderId }, select: { paymentStatus: true, paidAt: true } });
  return {
    saldo, piutang: toMoney(pa._sum.debit ?? 0).minus(toMoney(pa._sum.credit ?? 0)), piutangOrder: toMoney(po._sum.debit ?? 0).minus(toMoney(po._sum.credit ?? 0)),
    seimbang: toMoney(ner._sum.debit).equals(toMoney(ner._sum.credit)), jurnal: await db.finJournalEntry.count(), payment: await db.payment.count(),
    // Fungsi resmi menyelaraskan jam paidAt ke tanggal terima Payment (12.00 WIB); yang harus TETAP adalah status dan TANGGAL (WIB), bukan jam.
    status: o.paymentStatus, paidAt: o.paidAt ? tanggalWIB(o.paidAt) : null,
  };
}

async function periksa(db) {
  if (!NOMOR) throw new Berhenti("Wajib: --order=<nomor order>");
  const order = await db.order.findFirst({ where: { orderNumber: NOMOR }, select: { id: true, orderNumber: true } });
  if (!order) throw new Berhenti(`Order ${NOMOR} tidak ditemukan`);
  const aktif = await db.payment.findMany({ where: { orderId: order.id, cancelledAt: null }, select: { id: true, amount: true } });
  if (aktif.length !== 1) throw new Berhenti(`Order punya ${aktif.length} Payment aktif (harus tepat 1)`);
  const { items, cutoff } = await daftarKlasifikasiHistoris(db);
  const k = items.find((i) => i.paymentId === aktif[0].id);
  if (!k) throw new Berhenti("Payment ini bukan Payment historis terverifikasi (bertanggal sebelum saldo awal) — tidak diproses");
  return { order, payment: aktif[0], k, cutoff };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "PRATINJAU (tidak menulis apa pun)"}`);
  const p = await periksa(prisma);
  console.log(`Order   : ${p.order.orderNumber}\nPayment : ${p.payment.id.slice(0, 8)} ${rp(p.payment.amount)} (tanggal ${p.k.tanggal}; saldo awal ${p.cutoff})`);
  console.log(`Klasifikasi: ${p.k.kelas} / ${p.k.kode} — ${p.k.alasan}`);
  if (p.k.kelas === "SUDAH_TUNTAS") { console.log("SUDAH TUNTAS — berhenti tanpa perubahan."); return; }
  if (!["C1", "C2", "C3"].includes(p.k.kelas)) throw new Berhenti(`Kelas ${p.k.kelas} tidak boleh dituntaskan lewat skrip ini`);
  const a = await foto(prisma, p.order.id);
  console.log(`Sebelum : piutang order ${rp(a.piutangOrder)}; Piutang Usaha ${rp(a.piutang)}; ${Object.entries(a.saldo).map(([n, v]) => `${n} ${rp(v)}`).join(" | ")}`);
  const lawan = p.k.lawan;
  console.log(`Harapan : ${lawan === "PIUTANG" ? `+1 jurnal non-kas Dr Laba Ditahan / Cr Piutang ${rp(p.payment.amount)} → piutang order ${rp(a.piutangOrder.minus(p.payment.amount))}` : "tanpa jurnal baru (hanya audit)"}; Kas/Bank TIDAK berubah; status & tanggal (WIB) lunas order TIDAK berubah (jam disesuaikan ke 12.00 WIB oleh fungsi resmi).`);
  if (!APPLY) { console.log("\nPRATINJAU. Jalankan: TUNTAS_OK=1 node scripts/tuntaskanPaymentHistoris.js --order=" + NOMOR + " --apply"); return; }
  if (process.env.TUNTAS_OK !== "1") throw new Error("Menolak --apply: set TUNTAS_OK=1 (setelah backup tervalidasi)");
  const aktor = await prisma.user.findFirst({ where: { name: "OWNER (Admin)", role: "ADMIN", active: true }, select: { id: true } });
  if (!aktor) throw new Error("akun atribusi OWNER (Admin) tidak ditemukan");

  const hasil = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `TUNTAS_HISTORIS:${NOMOR}`);
    const q = await periksa(tx);
    if (q.k.kelas === "SUDAH_TUNTAS") throw new Berhenti("sudah dituntaskan oleh proses lain");
    const sebelum = await foto(tx, q.order.id);
    const r = await tuntaskanPembayaranHistoris(tx, { paymentId: q.payment.id, userId: aktor.id, alasan: `${LABEL_HISTORIS}. Penuntasan satu order atas instruksi Owner (${NOMOR}); dijalankan oleh Claude Code. Kas/Bank tidak disentuh.` });
    const sesudah = await foto(tx, q.order.id);
    for (const n of Object.keys(sebelum.saldo)) if (!sesudah.saldo[n].equals(sebelum.saldo[n])) throw new Error(`INVARIAN GAGAL: saldo ${n} berubah — rollback`);
    if (q.k.lawan === "PIUTANG" && !sesudah.piutangOrder.equals(sebelum.piutangOrder.minus(q.payment.amount))) throw new Error("INVARIAN GAGAL: piutang order tidak turun sebesar Payment — rollback");
    if (q.k.lawan === "PIUTANG" && !sesudah.piutang.equals(sebelum.piutang.minus(q.payment.amount))) throw new Error("INVARIAN GAGAL: saldo Piutang Usaha total — rollback");
    if (sesudah.status !== sebelum.status || sesudah.paidAt !== sebelum.paidAt) throw new Error("INVARIAN GAGAL: status/tanggal (WIB) lunas order berubah — rollback");
    if (sesudah.jurnal !== sebelum.jurnal + (q.k.lawan ? 1 : 0) || sesudah.payment !== sebelum.payment || !sesudah.seimbang) throw new Error("INVARIAN GAGAL: jumlah jurnal/Payment/neraca — rollback");
    return { r, sebelum, sesudah };
  }, { timeout: 60_000, maxWait: 20_000 });

  console.log(`\nDITUNTASKAN (atribusi OWNER (Admin)): ${hasil.r.aksi} ${hasil.r.entryNumber ?? ""}`);
  console.log(`piutang order ${rp(hasil.sebelum.piutangOrder)} → ${rp(hasil.sesudah.piutangOrder)}; Piutang Usaha ${rp(hasil.sebelum.piutang)} → ${rp(hasil.sesudah.piutang)}; jurnal ${hasil.sebelum.jurnal} → ${hasil.sesudah.jurnal}; Kas/Bank tidak berubah; neraca seimbang`);
  const ulang = await periksa(prisma);
  console.log(`replay: ${ulang.k.kelas === "SUDAH_TUNTAS" ? "tidak menggandakan (sudah tuntas)" : "PERIKSA!"}`);
}
main().catch((e) => { if (e instanceof Berhenti) { console.error("BERHENTI:", e.message); process.exitCode = 2; } else { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; } }).finally(async () => { await prisma.$disconnect(); });
