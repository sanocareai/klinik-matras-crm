// PERIODE REKONSILIASI BANK SEMENTARA 19–21 Sep 2026 (PT Sano & KEM Sano) — TANPA mutasi bank, TANPA jurnal, TANPA perubahan saldo.
//
//   node scripts/buatPeriodeRekonSementara.js            # PRATINJAU (tidak menulis)
//   node scripts/buatPeriodeRekonSementara.js --apply    # membuat periode berstatus DRAF_MENUNGGU_MUTASI (idempoten)
//
// Aman dijalankan ulang: kunci sumber unik + pemeriksaan (rekening, periode) → tidak pernah membuat periode kedua.

import { prisma } from "../src/db.js";
import { buatPeriodeSementara, PERIODE_SEMENTARA_20260919, saldoBukuSampai } from "../src/services/finance/rekonBank.js";
import { toMoney } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "PRATINJAU (tidak menulis apa pun)"}`);
  const jurnal0 = await prisma.finJournalEntry.count();
  const baris0 = await prisma.finBankStatementLine.count();
  for (const d of PERIODE_SEMENTARA_20260919) {
    const rek = await prisma.finCashAccount.findFirst({ where: { name: d.rekening }, select: { id: true, name: true } });
    if (!rek) { console.log(`✗ ${d.rekening}: rekening tidak ditemukan`); continue; }
    const buku = await saldoBukuSampai(prisma, rek.id, new Date(`${d.periodEnd}T00:00:00.000Z`));
    const ada = await prisma.finBankStatement.findUnique({ where: { sourceKey: d.sourceKey }, select: { id: true, status: true } });
    console.log(`\n${d.rekening}  ${d.periodStart} → ${d.periodEnd}\n  saldo awal bank ${rp(d.openingBalance)}  saldo akhir bank ${rp(d.closingBalance)}  saldo buku akhir ${rp(buku.toFixed(2))}  selisih (buku − bank) ${rp(buku.minus(toMoney(d.closingBalance)).toFixed(2))}\n  ${ada ? `SUDAH ADA (${ada.status}, id ${ada.id})` : "belum ada"}`);
  }
  if (!APPLY) { console.log("\nIni PRATINJAU. Jalankan dengan --apply untuk membuat periode."); return; }
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  const hasil = await buatPeriodeSementara(prisma, { userId: admin?.id ?? null });
  console.log("\nHASIL:"); for (const h of hasil) console.log(`  ${h.rekening}: ${h.dibuat ? "DIBUAT" : `tidak dibuat (${h.alasan})`}  id ${h.id}`);
  const ulang = await buatPeriodeSementara(prisma, { userId: admin?.id ?? null });
  console.log(`Jalankan ulang: ${ulang.every((h) => !h.dibuat) ? "tidak ada periode baru (idempoten)" : "PERIKSA: ada yang dibuat!"}`);
  console.log(`jurnal ${jurnal0} → ${await prisma.finJournalEntry.count()}; baris mutasi bank ${baris0} → ${await prisma.finBankStatementLine.count()}; periode dengan kunci ini: ${await prisma.finBankStatement.count({ where: { sourceKey: { startsWith: "REKON_SEMENTARA_20260919_20260921:" } } })}`);
}
main().catch((e) => { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
