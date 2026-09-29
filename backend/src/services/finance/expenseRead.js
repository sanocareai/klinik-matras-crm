// BACA PENGELUARAN — SATU sumber query untuk layar Pengeluaran (GET /api/finance/expenses) dan Export Excel
// (services/finance/export/pengeluaran.js), supaya angka di berkas Excel tidak mungkin berbeda dari yang tampil di layar.
// Murni baca: tidak ada tulis ke database.

import { hasPermission, PERMISSIONS as P } from "../../middleware/authorize.js";
import { sumMoney, moneyToNumber, ZERO } from "./money.js";
import { ambangNota, notaWajibDenganAmbang } from "./receipts.js";
import { expenseInclude, bentukExpense } from "./expenses.js";

/**
 * Klausa pencarian teks bebas untuk daftar pengeluaran/pembelian. Tiap KATA di
 * `q` harus cocok di salah satu kolom (AND antar kata, OR antar kolom), jadi
 * "kain oscar sep" menyempit dengan wajar. Kata berupa angka (mis. "150000"
 * atau "150.000") juga dicocokkan ke NOMINAL persis.
 */
export function klausaCari(q, kolomTeks) {
  const kata = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return kata.map((k) => {
    const atau = kolomTeks.map((path) => {
      const bagian = path.split(".");
      return bagian.reduceRight((isi, kunci, i) => (i === bagian.length - 1 ? { [kunci]: { contains: k, mode: "insensitive" } } : { [kunci]: isi }), null);
    });
    const angka = k.replace(/\./g, "");
    if (/^\d{3,}$/.test(angka)) atau.push({ amount: Number(angka) });
    return { OR: atau };
  });
}

/** Filter status bukti: ada | tanpa | terverifikasi | belum. */
export function klausaBukti(bukti) {
  if (bukti === "ada") return { receiptUrl: { not: null } };
  if (bukti === "tanpa") return { receiptUrl: null };
  if (bukti === "terverifikasi") return { receiptVerifiedAt: { not: null } };
  if (bukti === "belum") return { receiptUrl: { not: null }, receiptVerifiedAt: null };
  return {};
}

export const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KOLOM_CARI_PENGELUARAN = ["expenseNumber", "description", "payeeName", "notes", "category.name", "supplier.name", "reimburseTo.name"];

/** Pemegang finance:expense:submit TANPA finance:read hanya boleh melihat pengajuannya SENDIRI (pola JOB_OWN_READ milik driver). */
export const hanyaMilikSendiri = (user) => !hasPermission(user, P.FINANCE_READ);

/** Batasan baris milik sendiri untuk pengguna tanpa finance:read (kosong bila boleh melihat semua). */
export function batasMilikSendiri(user) {
  return hanyaMilikSendiri(user) ? [{ OR: [{ createdById: user.id }, { reimburseToId: user.id }] }] : [];
}

async function perkaya(db, rows) {
  // `notaWajib`: aturan yang sama dengan yang dipakai saat Setujui — supaya UI bisa memberi tahu SEBELUM tombol ditekan.
  const ambang = await ambangNota(db);
  return rows.map((e) => ({
    ...bentukExpense(e),
    notaWajib: notaWajibDenganAmbang({ jenis: "expense", mode: e.mode, amount: e.amount, categoryCode: e.category?.code }, ambang),
  }));
}

/**
 * Daftar pengeluaran menurut filter layar. `rentang` = { from, to } (Date tanggal-buku, dari rentangDariQuery).
 * Mengembalikan bentuk yang sama persis dengan respons GET /expenses.
 */
export async function ambilDaftarPengeluaran(db, { rentang, status, division, categoryId, mode, q, bukti, cashAccountId } = {}, { user, take = 300 } = {}) {
  const expenses = await db.finExpense.findMany({
    where: {
      date: { gte: rentang.from, lte: rentang.to },
      ...(status && { status }),
      ...(division && { division }),
      ...(categoryId && { categoryId }),
      ...(mode && { mode }),
      ...(cashAccountId && { cashAccountId }),
      ...klausaBukti(bukti),
      AND: [
        ...batasMilikSendiri(user),
        ...klausaCari(q, KOLOM_CARI_PENGELUARAN),
      ],
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
    include: expenseInclude,
  });

  const total = expenses.length === 0 ? ZERO : sumMoney(expenses.map((e) => e.amount));
  return {
    expenses: await perkaya(db, expenses),
    total: moneyToNumber(total),
    hanyaMilikSendiri: hanyaMilikSendiri(user),
    terpotong: expenses.length === take,
  };
}

/**
 * Muat ulang baris tertentu (mis. baris yang tampil di layar) lewat bentuk & batasan izin yang SAMA dengan daftar layar,
 * dengan URUTAN mengikuti `ids`. Id yang tidak ada / tidak boleh dilihat pengguna dilewati.
 */
export async function ambilPengeluaranByIds(db, ids, { user } = {}) {
  const idValid = ids.filter((id) => POLA_UUID.test(id)); // id bukan UUID membuat Prisma error — cukup dilewati
  const rows = await db.finExpense.findMany({
    where: { id: { in: idValid }, AND: batasMilikSendiri(user) },
    include: expenseInclude,
  });
  const urut = new Map(idValid.map((id, i) => [id, i]));
  rows.sort((a, b) => urut.get(a.id) - urut.get(b.id));
  return perkaya(db, rows);
}
