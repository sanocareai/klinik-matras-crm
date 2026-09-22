// TERAPKAN UANG MUKA — logika BACA bersama (eligibilitas, daftar DP eligible,
// ringkasan + histori). SATU tempat dipakai baik oleh route web
// (routes/financeTransactions.js, /purchases/:id/advance-eligible &
// /advance-summary) MAUPUN read-model mobile (services/finance/transaksi.js)
// — supaya kedua sisi TIDAK PERNAH menghitung aturan eligibilitas secara
// berbeda. Posting (tulis) tetap di posting/purchaseAdvance.js; file ini
// murni baca, tidak pernah menulis jurnal/dokumen.

import { toMoney, sumMoney, ZERO, moneyToNumber } from "./money.js";

export function saldoDariAplikasi(list) {
  return list.length === 0 ? ZERO : sumMoney(list.map((a) => a.amount));
}

export function bentukAplikasiDp(a) {
  return {
    id: a.id,
    amount: moneyToNumber(a.amount),
    status: a.status,
    createdAt: a.createdAt,
    createdBy: a.createdBy?.name || null,
    journal: a.journal ? { id: a.journal.id, entryNumber: a.journal.entryNumber } : null,
    reversalJournal: a.reversalJournal ? { id: a.reversalJournal.id, entryNumber: a.reversalJournal.entryNumber } : null,
    reversedAt: a.reversedAt,
    reversedBy: a.reversedBy?.name || null,
    reverseReason: a.reverseReason,
    ...(a.advancePurchase && { advancePurchase: a.advancePurchase }),
    ...(a.targetPurchase && { targetPurchase: a.targetPurchase }),
  };
}

/** Alasan (Indonesia) kenapa `target` TIDAK bisa menerima penerapan DP — array kosong berarti bisa. */
export function alasanTidakEligible(target) {
  const alasan = [];
  if (target.category.code === "UANG_MUKA_PEMBELIAN") alasan.push("Pembelian ini sendiri berkategori Uang Muka Pembelian — tidak bisa menerima penerapan DP lain");
  if (target.mode !== "UTANG") alasan.push("Hanya pembelian mode Utang yang punya Utang Usaha untuk dikurangi DP");
  if (target.status !== "DISETUJUI") alasan.push(`Status pembelian ini ${target.status} — hanya status Disetujui (belum dibayar) yang bisa menerima penerapan DP`);
  if (!target.supplierId) alasan.push("Pembelian ini belum punya supplier — DP hanya bisa diterapkan antar dokumen supplier yang sama");
  return alasan;
}

/** Daftar DP eligible untuk diterapkan ke SATU pembelian tujuan (dipakai picker UI web & mobile). */
export async function daftarDpEligible(db, target) {
  const alasan = alasanTidakEligible(target);
  if (alasan.length > 0) return { eligible: [], bisaMenerapkan: false, alasan };

  const kandidat = await db.finPurchase.findMany({
    where: { supplierId: target.supplierId, status: "DIBAYAR", category: { code: "UANG_MUKA_PEMBELIAN" } },
    include: { advanceApplicationsAsSource: { where: { status: "ACTIVE" }, select: { amount: true } } },
    orderBy: { date: "asc" },
  });
  const aplikasiTarget = await db.finPurchaseAdvanceApplication.findMany({
    where: { targetPurchaseId: target.id, status: "ACTIVE" }, select: { amount: true },
  });
  const sisaUtang = toMoney(target.amount).minus(saldoDariAplikasi(aplikasiTarget));

  const eligible = kandidat
    .map((k) => {
      const dipakai = saldoDariAplikasi(k.advanceApplicationsAsSource);
      const tersedia = toMoney(k.amount).minus(dipakai);
      return {
        id: k.id, purchaseNumber: k.purchaseNumber, date: k.date,
        nilaiAwal: moneyToNumber(k.amount), sudahDigunakan: moneyToNumber(dipakai), saldoTersedia: moneyToNumber(tersedia),
      };
    })
    .filter((k) => k.saldoTersedia > 0);

  return { eligible, bisaMenerapkan: true, sisaUtang: moneyToNumber(sisaUtang), totalPembelian: moneyToNumber(target.amount) };
}

/** Ringkasan + histori penerapan DP untuk SATU pembelian (sisi sumber DP maupun sisi penerima). */
export async function ringkasanDp(db, p) {
  const aplikasiInclude = {
    journal: { select: { id: true, entryNumber: true } },
    reversalJournal: { select: { id: true, entryNumber: true } },
    createdBy: { select: { name: true } },
    reversedBy: { select: { name: true } },
  };
  const [sebagaiSumber, sebagaiTujuan] = await Promise.all([
    db.finPurchaseAdvanceApplication.findMany({
      where: { advancePurchaseId: p.id },
      include: { ...aplikasiInclude, targetPurchase: { select: { id: true, purchaseNumber: true, description: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.finPurchaseAdvanceApplication.findMany({
      where: { targetPurchaseId: p.id },
      include: { ...aplikasiInclude, advancePurchase: { select: { id: true, purchaseNumber: true, description: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const dipakaiDariSumber = saldoDariAplikasi(sebagaiSumber.filter((a) => a.status === "ACTIVE"));
  const dpDiterapkanKeTujuan = saldoDariAplikasi(sebagaiTujuan.filter((a) => a.status === "ACTIVE"));
  const sisaUtang = toMoney(p.amount).minus(dpDiterapkanKeTujuan);

  return {
    purchaseId: p.id, purchaseNumber: p.purchaseNumber, kategoriUangMuka: p.category.code === "UANG_MUKA_PEMBELIAN",
    sebagaiSumberUangMuka: {
      nilaiAwal: moneyToNumber(p.amount),
      sudahDigunakan: moneyToNumber(dipakaiDariSumber),
      saldoTersedia: moneyToNumber(toMoney(p.amount).minus(dipakaiDariSumber)),
      histori: sebagaiSumber.map(bentukAplikasiDp),
    },
    sebagaiTujuanPembelian: {
      totalPembelian: moneyToNumber(p.amount),
      dpDiterapkan: moneyToNumber(dpDiterapkanKeTujuan),
      sisaUtang: moneyToNumber(sisaUtang),
      sisaDibayarTunai: p.status === "DIBAYAR" ? 0 : moneyToNumber(sisaUtang),
      histori: sebagaiTujuan.map(bentukAplikasiDp),
    },
  };
}
