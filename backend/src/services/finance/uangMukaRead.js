// BACA UANG MUKA OPERASIONAL — SATU sumber query untuk layar Uang Muka (GET /uang-muka dan GET /uang-muka/riwayat di
// routes/financeOperationalAdvance.js) dan Export Excel (services/finance/export/uang-muka.js), supaya angka di berkas Excel tidak
// mungkin berbeda dari yang tampil di layar. Murni baca: tidak ada tulis ke database.

import { todayBookDateWIB } from "./journal.js";
import { moneyToNumber } from "./money.js";
import { uangMukaInclude, bentukUangMuka } from "./operationalAdvance.js";
import { idValid, urutkanSesuaiIds } from "./supplierRead.js";

/**
 * Daftar uang muka + ringkasan (kartu layar). `ids` (opsional) memuat ulang baris itu berurutan; ringkasan tetap dihitung dari
 * baris yang dikembalikan. Bentuk hasil = respons GET /uang-muka.
 */
export async function ambilDaftarUangMuka(db, { status, holderId, q, lewatTempo } = {}, { take = 500, ids = null } = {}) {
  let rows;
  if (ids) {
    const dapat = await db.finOperationalAdvance.findMany({ where: { id: { in: idValid(ids) } }, include: uangMukaInclude });
    rows = urutkanSesuaiIds(dapat, idValid(ids));
  } else {
    rows = await db.finOperationalAdvance.findMany({
      where: {
        ...(status && { status }),
        ...(holderId && { holderId }),
        ...(q && { OR: [
          { advanceNumber: { contains: String(q), mode: "insensitive" } },
          { purpose: { contains: String(q), mode: "insensitive" } },
          { holder: { name: { contains: String(q), mode: "insensitive" } } },
        ] }),
      },
      include: uangMukaInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take,
    });
  }
  const hariIni = todayBookDateWIB();
  let items = rows.map((a) => bentukUangMuka(a, { hariIni }));
  if (lewatTempo === "1") items = items.filter((a) => a.lewatTempo);

  const aktif = items.filter((a) => ["AKTIF", "SEBAGIAN"].includes(a.status));
  const perPemegang = new Map();
  for (const a of aktif) {
    const p = perPemegang.get(a.holderId) || { holderId: a.holderId, nama: a.holder?.name || "—", jumlah: 0, saldo: 0, lewatTempo: 0 };
    p.jumlah += 1; p.saldo += a.saldo; p.lewatTempo += a.lewatTempo ? 1 : 0;
    perPemegang.set(a.holderId, p);
  }
  return {
    items,
    ringkasan: {
      jumlahAktif: aktif.length,
      totalSaldoAktif: aktif.reduce((s, a) => s + a.saldo, 0),
      jumlahLewatTempo: aktif.filter((a) => a.lewatTempo).length,
      perPemegang: [...perPemegang.values()].sort((a, b) => b.saldo - a.saldo),
    },
  };
}

/** Riwayat (pemberian, pertanggungjawaban, pengembalian, pembatalan), terbaru di atas. Bentuk = `items` GET /uang-muka/riwayat. */
export async function ambilRiwayatUangMuka(db) {
  const advances = await db.finOperationalAdvance.findMany({
    include: { holder: { select: { id: true, name: true } }, settlements: { include: { expense: { select: { expenseNumber: true, description: true } } } } },
    orderBy: { createdAt: "desc" }, take: 300,
  });
  const baris = [];
  for (const a of advances) {
    baris.push({ tanggal: a.date, waktu: a.createdAt, jenis: "DIBERIKAN", advanceId: a.id, advanceNumber: a.advanceNumber, pemegang: a.holder?.name, nominal: moneyToNumber(a.amount), keterangan: a.purpose, status: a.status === "DIBATALKAN" ? "DIBATALKAN" : "AKTIF", alasan: a.cancelReason || null });
    for (const s of a.settlements) {
      baris.push({
        tanggal: s.date, waktu: s.createdAt, jenis: s.type, advanceId: a.id, advanceNumber: a.advanceNumber, pemegang: a.holder?.name,
        nominal: moneyToNumber(s.amount), status: s.status === "CANCELLED" ? "DIBATALKAN" : "AKTIF", alasan: s.cancelReason || null,
        keterangan: s.expense ? `${s.expense.expenseNumber} — ${s.expense.description}` : (s.note || "Pengembalian sisa"),
        settlementId: s.id,
      });
    }
  }
  baris.sort((x, y) => new Date(y.waktu) - new Date(x.waktu));
  return baris.slice(0, 500);
}
