// ANGGARAN BULANAN PER DIVISI (Fase 2). Versi + persetujuan + audit. TIDAK PERNAH menyentuh ledger.
//
// Satu kunci logis = divisi + kategori(opsional) + proyek/campaign(opsional) + bulan. Setiap perubahan = VERSI BARU (baris baru); hanya satu versi DISETUJUI yang
// berlaku per kunci — saat versi baru disetujui, versi sebelumnya otomatis DIGANTIKAN. Versi DRAF boleh diubah; versi DISETUJUI/DIGANTIKAN tidak pernah diubah.
// Pemisahan tugas: penyetuju HARUS berbeda dari pembuat (kecuali Owner/Admin Finance dengan finance:admin).
//
// TINGKAT (menentukan angka "Anggaran" sebuah divisi pada satu bulan, tanpa hitung ganda):
//   DIVISI   = tanpa kategori & tanpa proyek   → bila ada, ITU angka anggaran divisi (rincian di bawahnya adalah bagian darinya)
//   KATEGORI = kategori terisi, tanpa proyek   → bila tidak ada baris DIVISI, anggaran divisi = Σ baris KATEGORI
//   PROYEK   = proyek/campaign terisi          → bila tidak ada keduanya, anggaran divisi = Σ baris PROYEK
// Tidak ada baris DISETUJUI = anggaran null → UI menampilkan "Belum ada anggaran" (BUKAN Rp0, BUKAN merah).
import { Prisma } from "@prisma/client";
import { toMoney, moneyToNumber, sumMoney, ZERO } from "../money.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../../lib/activityLog.js";
import { DIVISI, bulanKunci } from "./divisi.js";

export class AnggaranError extends Error {
  constructor(message, statusCode = 400, code = "ANGGARAN_TIDAK_VALID") { super(message); this.statusCode = statusCode; this.code = code; }
}

const POLA_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** "YYYY-MM" atau "YYYY-MM-DD" → Date tanggal 1 (UTC, kolom DATE). */
export function periodeBulan(input) {
  const s = String(input ?? "");
  const bulan = POLA_BULAN.test(s) ? s : /^\d{4}-\d{2}-\d{2}$/.test(s) && POLA_BULAN.test(s.slice(0, 7)) ? s.slice(0, 7) : null;
  if (!bulan) throw new AnggaranError("Periode anggaran harus berupa bulan (YYYY-MM)");
  return new Date(`${bulan}-01T00:00:00.000Z`);
}
export const kunciBaris = (division, categoryId, projectKey, period) => `${division}|${categoryId || "-"}|${(projectKey || "-").toLowerCase()}|${bulanKunci(period)}`;
export const tingkat = (b) => (b.projectKey ? "PROYEK" : b.categoryId ? "KATEGORI" : "DIVISI");

function rapikanJumlah(amount) {
  let m;
  try { m = toMoney(amount); } catch { throw new AnggaranError("Nominal anggaran tidak valid"); }
  if (m.isNegative()) throw new AnggaranError("Nominal anggaran tidak boleh negatif");
  if (m.greaterThan(1_000_000_000_000)) throw new AnggaranError("Nominal anggaran terlalu besar");
  return m;
}
function rapikanProyek(p) {
  const s = String(p ?? "").trim();
  if (!s) return null;
  if (s.length > 80) throw new AnggaranError("Nama proyek/campaign maksimal 80 karakter");
  return s;
}

export function bentukAnggaran(b) {
  return {
    id: b.id, lineKey: b.lineKey, version: b.version, tingkat: tingkat(b), division: b.division, categoryId: b.categoryId, kategori: b.category ? { kode: b.category.code, nama: b.category.name } : null,
    projectKey: b.projectKey, period: bulanKunci(b.period), amount: moneyToNumber(b.amount), status: b.status, reason: b.reason,
    createdById: b.createdById, createdByName: b.createdBy?.name ?? null, createdAt: b.createdAt, approvedById: b.approvedById, approvedByName: b.approvedBy?.name ?? null, approvedAt: b.approvedAt, supersededAt: b.supersededAt,
  };
}
const INCLUDE = { category: { select: { code: true, name: true } }, createdBy: { select: { name: true } }, approvedBy: { select: { name: true } } };

/** Buat DRAF (versi baru) atau perbarui DRAF yang sudah ada untuk kunci yang sama. `tx` = klien transaksi. */
export async function simpanDraf(tx, { division, categoryId = null, projectKey = null, period, amount, reason = null, userId }) {
  if (!DIVISI.includes(division)) throw new AnggaranError("Divisi anggaran tidak valid");
  if (division === "SHARED") throw new AnggaranError("Biaya bersama tidak dianggarkan per divisi; anggarkan pada divisi pemilik atau alokasikan resmi lebih dulu");
  const bulan = periodeBulan(period);
  const proyek = rapikanProyek(projectKey);
  const jumlah = rapikanJumlah(amount);
  if (categoryId) {
    const kat = await tx.finExpenseCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!kat) throw new AnggaranError("Kategori tidak ditemukan", 404, "KATEGORI_TIDAK_ADA");
  }
  const lineKey = kunciBaris(division, categoryId, proyek, bulan);
  const ada = await tx.finDivisionBudget.findMany({ where: { lineKey }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true, amount: true, reason: true } });
  const draf = ada.find((x) => x.status === "DRAF");
  const alasan = reason == null ? null : String(reason).trim() || null;

  if (draf) {
    const baru = await tx.finDivisionBudget.update({ where: { id: draf.id }, data: { amount: jumlah, reason: alasan, createdById: undefined }, include: INCLUDE });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_DIVISION_BUDGET, entityId: baru.id, eventType: EVENT_TYPES.DIVISION_BUDGET_CHANGED, actorId: userId, metadata: { aksi: "draf_diubah", lineKey, version: baru.version, dari: moneyToNumber(draf.amount), ke: moneyToNumber(jumlah), alasan } });
    return baru;
  }
  const versi = (ada[0]?.version ?? 0) + 1;
  if (versi > 1 && !alasan) throw new AnggaranError("Alasan perubahan wajib diisi untuk versi anggaran berikutnya", 422, "ALASAN_WAJIB");
  try {
    const baru = await tx.finDivisionBudget.create({ data: { lineKey, version: versi, division, categoryId, projectKey: proyek, period: bulan, amount: jumlah, status: "DRAF", reason: alasan, createdById: userId }, include: INCLUDE });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_DIVISION_BUDGET, entityId: baru.id, eventType: EVENT_TYPES.DIVISION_BUDGET_CHANGED, actorId: userId, metadata: { aksi: "draf_dibuat", lineKey, version: versi, ke: moneyToNumber(jumlah), alasan } });
    return baru;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AnggaranError("Versi anggaran ini baru saja dibuat pengguna lain; muat ulang lalu coba lagi", 409, "VERSI_BENTROK");
    throw e;
  }
}

/** Setujui sebuah DRAF: versi lama yang berlaku → DIGANTIKAN; versi ini → DISETUJUI. */
export async function setujui(tx, { id, userId, adminFinance = false }) {
  const b = await tx.finDivisionBudget.findUnique({ where: { id }, include: INCLUDE });
  if (!b) throw new AnggaranError("Anggaran tidak ditemukan", 404, "TIDAK_ADA");
  if (b.status !== "DRAF") throw new AnggaranError(`Anggaran berstatus ${b.status} tidak dapat disetujui`, 409, "STATUS_TIDAK_VALID");
  if (b.createdById && b.createdById === userId && !adminFinance) throw new AnggaranError("Pembuat anggaran tidak boleh menyetujuinya sendiri", 403, "PEMISAHAN_TUGAS");
  const sekarang = new Date();
  const berlaku = await tx.finDivisionBudget.findMany({ where: { lineKey: b.lineKey, status: "DISETUJUI" }, select: { id: true, amount: true, version: true } });
  for (const v of berlaku) await tx.finDivisionBudget.update({ where: { id: v.id }, data: { status: "DIGANTIKAN", supersededAt: sekarang } });
  const baru = await tx.finDivisionBudget.update({ where: { id }, data: { status: "DISETUJUI", approvedById: userId, approvedAt: sekarang }, include: INCLUDE });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_DIVISION_BUDGET, entityId: id, eventType: EVENT_TYPES.DIVISION_BUDGET_CHANGED, actorId: userId, metadata: { aksi: "disetujui", lineKey: b.lineKey, version: b.version, ke: moneyToNumber(b.amount), menggantikan: berlaku.map((v) => ({ id: v.id, version: v.version, amount: moneyToNumber(v.amount) })), alasan: b.reason } });
  return baru;
}

export async function hapusDraf(tx, { id, userId }) {
  const b = await tx.finDivisionBudget.findUnique({ where: { id } });
  if (!b) throw new AnggaranError("Anggaran tidak ditemukan", 404, "TIDAK_ADA");
  if (b.status !== "DRAF") throw new AnggaranError("Hanya DRAF yang dapat dihapus; versi disetujui tidak pernah dihapus", 409, "STATUS_TIDAK_VALID");
  await tx.finDivisionBudget.delete({ where: { id } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_DIVISION_BUDGET, entityId: id, eventType: EVENT_TYPES.DIVISION_BUDGET_CHANGED, actorId: userId, metadata: { aksi: "draf_dihapus", lineKey: b.lineKey, version: b.version, ke: moneyToNumber(b.amount) } });
}

export async function daftarAnggaran(db, { divisions = null, from = null, to = null, status = null } = {}) {
  const where = {
    ...(divisions ? { division: { in: divisions } } : {}),
    ...(status ? { status } : {}),
    ...(from || to ? { period: { ...(from ? { gte: periodeBulan(from) } : {}), ...(to ? { lte: periodeBulan(to) } : {}) } } : {}),
  };
  const rows = await db.finDivisionBudget.findMany({ where, orderBy: [{ period: "asc" }, { division: "asc" }, { lineKey: "asc" }, { version: "desc" }], include: INCLUDE, take: 2000 });
  return rows.map(bentukAnggaran);
}

/**
 * Anggaran BERLAKU (versi DISETUJUI) untuk rentang bulan, per divisi — tanpa hitung ganda (lihat TINGKAT di atas).
 * @returns Map<scope, { jumlahBulan:number, total:number|null, perKategori:Map<kode|null,{nama,jumlah}>, perProyek:Map<proyek,jumlah>, bulan:Map<YYYY-MM,number> }>
 */
export async function anggaranBerlaku(db, { from, to, divisions = null }) {
  const bulanAwal = periodeBulan(String(from).slice(0, 7));
  const bulanAkhir = periodeBulan(String(to).slice(0, 7));
  const rows = await db.finDivisionBudget.findMany({
    where: { status: "DISETUJUI", period: { gte: bulanAwal, lte: bulanAkhir }, ...(divisions ? { division: { in: divisions } } : {}) },
    include: { category: { select: { code: true, name: true } } },
  });
  const hasil = new Map();
  const perDivBulan = new Map(); // `${div}|${bulan}` → rows
  for (const r of rows) {
    const k = `${r.division}|${bulanKunci(r.period)}`;
    if (!perDivBulan.has(k)) perDivBulan.set(k, []);
    perDivBulan.get(k).push(r);
  }
  for (const [k, baris] of perDivBulan) {
    const [div, bulan] = k.split("|");
    const levelDiv = baris.filter((b) => tingkat(b) === "DIVISI");
    const levelKat = baris.filter((b) => tingkat(b) === "KATEGORI");
    const levelPro = baris.filter((b) => tingkat(b) === "PROYEK");
    const total = levelDiv.length ? sumMoney(levelDiv.map((b) => b.amount)) : levelKat.length ? sumMoney(levelKat.map((b) => b.amount)) : sumMoney(levelPro.map((b) => b.amount));
    if (!hasil.has(div)) hasil.set(div, { total: ZERO, perKategori: new Map(), perProyek: new Map(), bulan: new Map(), ada: true });
    const h = hasil.get(div);
    h.total = h.total.plus(total);
    h.bulan.set(bulan, (h.bulan.get(bulan) ?? 0) + moneyToNumber(total));
    for (const b of levelKat) {
      const kode = b.category?.code ?? null;
      const cur = h.perKategori.get(kode) ?? { nama: b.category?.name ?? null, jumlah: 0 };
      cur.jumlah += moneyToNumber(b.amount); h.perKategori.set(kode, cur);
    }
    for (const b of levelPro) h.perProyek.set(b.projectKey, (h.perProyek.get(b.projectKey) ?? 0) + moneyToNumber(b.amount));
  }
  for (const h of hasil.values()) h.total = moneyToNumber(h.total);
  return hasil;
}
