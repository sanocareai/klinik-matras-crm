// KOMITMEN BELUM DIBAYAR per divisi (Fase 2). BACA-SAJA. Aturan atribusi SAMA dengan Aktual/Kas Keluar (atribusi.js).
//
// Komitmen = dokumen yang sudah diajukan/disetujui tetapi uangnya BELUM keluar. Dua keadaan yang SENGAJA dipisah supaya tidak tercampur dengan Aktual:
//   BELUM_DIBUKUKAN          — menunggu persetujuan: BELUM beban dan BELUM kas keluar (belum ada jurnal sama sekali).
//   DIBUKUKAN_BELUM_DIBAYAR  — sudah disetujui & dibukukan (bila berupa beban, SUDAH masuk Aktual) tetapi BELUM kas keluar (reimbursement/utang/tagihan terbuka).
// Basis tanggal: tanggal dokumen (FinExpense.date, FinPurchase.date, FinSupplierBill.billDate) dalam periode. DRAF tidak dihitung (belum diajukan).
import { moneyToNumber } from "../money.js";
import { atribusiDokumenKomitmen, SELEKTOR } from "./atribusi.js";

export const JENIS_KOMITMEN = Object.freeze({ BELUM_DIBUKUKAN: "BELUM_DIBUKUKAN", DIBUKUKAN_BELUM_DIBAYAR: "DIBUKUKAN_BELUM_DIBAYAR" });

export async function hitungKomitmen(db, { from, to }) {
  const rentang = { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) };
  const [exp, beli, bill] = await Promise.all([
    db.finExpense.findMany({ where: { date: rentang, status: { in: ["MENUNGGU_APPROVAL", "DISETUJUI"] } }, select: { ...SELEKTOR.SEL_EXP, date: true, amount: true, mode: true, advanceAppliedAmount: true } }),
    db.finPurchase.findMany({ where: { date: rentang, status: { in: ["MENUNGGU_APPROVAL", "DISETUJUI"] } }, select: { ...SELEKTOR.SEL_BELI, date: true, amount: true, advanceApplicationsAsTarget: { where: { status: "ACTIVE" }, select: { amount: true } } } }),
    db.finSupplierBill.findMany({ where: { billDate: rentang, status: { in: ["MENUNGGU_APPROVAL", "DISETUJUI", "DIBAYAR_SEBAGIAN"] } }, select: { ...SELEKTOR.SEL_BILL, billDate: true, amount: true, allocations: { select: { amount: true, payment: { select: { cancelledAt: true } } } } } }),
  ]);
  const atr = await atribusiDokumenKomitmen(db, { expenses: exp, purchases: beli, bills: bill });
  const item = (modul, d, tanggal, jumlah, jenis, a) => ({ modul, id: d.id, nomor: a.dokumen?.nomor ?? null, tanggal: tanggal.toISOString().slice(0, 10), status: d.status, jumlah, jenis, atribusi: a });
  const out = [];
  for (const d of exp) {
    const menunggu = d.status === "MENUNGGU_APPROVAL";
    // Mode UANG_MUKA: bagian yang dipakai dari uang muka SUDAH keluar sebagai kas saat uang muka diberikan — hanya selisihnya yang masih komitmen (jangan hitung dua kali).
    const jumlah = !menunggu && d.mode === "UANG_MUKA" ? Math.max(moneyToNumber(d.amount) - moneyToNumber(d.advanceAppliedAmount), 0) : moneyToNumber(d.amount);
    if (!menunggu && jumlah === 0) continue;
    out.push(item("pengeluaran", d, d.date, jumlah, menunggu ? JENIS_KOMITMEN.BELUM_DIBUKUKAN : JENIS_KOMITMEN.DIBUKUKAN_BELUM_DIBAYAR, atr.pengeluaran.get(d.id)));
  }
  for (const d of beli) {
    const menunggu = d.status === "MENUNGGU_APPROVAL";
    // DP pembelian yang sudah DITERAPKAN (Dr Utang / Cr Uang Muka) sudah keluar sebagai kas saat DP dibayar — kurangkan dari sisa komitmen.
    const dp = d.advanceApplicationsAsTarget.reduce((s, x) => s + moneyToNumber(x.amount), 0);
    const jumlah = menunggu ? moneyToNumber(d.amount) : Math.max(moneyToNumber(d.amount) - dp, 0);
    if (!menunggu && jumlah === 0) continue;
    out.push(item("pembelian", d, d.date, jumlah, menunggu ? JENIS_KOMITMEN.BELUM_DIBUKUKAN : JENIS_KOMITMEN.DIBUKUKAN_BELUM_DIBAYAR, atr.pembelian.get(d.id)));
  }
  for (const b of bill) {
    const terbayar = b.allocations.filter((a) => !a.payment?.cancelledAt).reduce((s, a) => s + moneyToNumber(a.amount), 0);
    const sisa = Math.max(moneyToNumber(b.amount) - terbayar, 0);
    if (b.status !== "MENUNGGU_APPROVAL" && sisa === 0) continue; // sudah lunas dibayar → bukan komitmen
    out.push(item("supplier-utang", b, b.billDate, b.status === "MENUNGGU_APPROVAL" ? moneyToNumber(b.amount) : sisa, b.status === "MENUNGGU_APPROVAL" ? JENIS_KOMITMEN.BELUM_DIBUKUKAN : JENIS_KOMITMEN.DIBUKUKAN_BELUM_DIBAYAR, atr.tagihan.get(b.id)));
  }
  return out;
}
