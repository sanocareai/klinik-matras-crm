// FINANCE WORKSPACE — KASBON (uang muka gaji karyawan).
//
// Di-mount di prefix /api/finance yang sama dengan router finance lain.
// Model & alasan desain: lihat komentar di schema.prisma (FinKasbon) dan
// services/finance/posting/kasbon.js (jurnalnya).
//
// Aturan yang ditegakkan di sini:
//  • Kasbon baru WAJIB punya urgensi, dan (kalau batas diatur di Pengaturan)
//    total kasbon aktif karyawan tidak boleh melewati batas — kecuali admin
//    sengaja mengizinkan.
//  • Kasbon = gaji yang dicairkan lebih awal: TIDAK dikembalikan, hanya
//    dipotong dari gaji (kas tidak tersentuh). Pemotongan tidak boleh
//    melebihi yang belum dipotong. Pinjaman karyawan bukan kasbon.
//  • Pembatalan (kasbon maupun pelunasan) lewat reversal jurnal + alasan.
//  • Kasbon hasil impor histori (historis=true, LUNAS) tidak punya jurnal.

import express from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { idempotency } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P, hasPermission } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { reverseJournal, generateDocumentNumber, toBookDate, todayBookDateWIB, findEntryByKey } from "../services/finance/journal.js";
import { toMoney, sumMoney, moneyToNumber, ZERO } from "../services/finance/money.js";
import { postKasbonDiberikan, postKasbonPelunasan, KEY as KASBON_KEY } from "../services/finance/posting/kasbon.js";
import { getSettingRaw, parseIntOr, SETTING_KEYS } from "../services/finance/settings.js";
import { RECEIPTS_URL_PREFIX } from "../services/finance/receipts.js";
import { handleFinanceError } from "./finance.js";

export const financeKasbonRouter = express.Router();
financeKasbonRouter.use(requireAuth);
// Idempotency-Key untuk command uang (opsional di web, wajib di token mobile).
financeKasbonRouter.use(idempotency);

function err(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

/** "imam  " / "IMAM" / "ujang sigit" → "Imam" / "Ujang Sigit" — satu ejaan untuk satu orang. */
export function rapikanNama(nama) {
  return String(nama || "").trim().replace(/\s+/g, " ")
    .toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

const METODE = ["POTONG_GAJI"];

const kasbonInclude = {
  repayments: {
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: { createdBy: { select: { id: true, name: true } }, cashAccount: { select: { id: true, name: true } } },
  },
  cashAccount: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

function bentukKasbon(k) {
  const aktif = k.repayments.filter((r) => !r.cancelledAt);
  const dariBaris = aktif.length ? sumMoney(aktif.map((r) => r.amount)) : ZERO;
  const amount = toMoney(k.amount);
  const lunas = k.status === "LUNAS";
  const sisa = k.status === "AKTIF" ? amount.minus(dariBaris) : ZERO;
  return {
    ...k,
    amount: moneyToNumber(amount),
    terlunasi: moneyToNumber(lunas ? amount : dariBaris),
    sisa: moneyToNumber(sisa),
    repayments: k.repayments.map((r) => ({ ...r, amount: moneyToNumber(r.amount) })),
  };
}

/** Sisa kasbon aktif satu karyawan (semua kasbon AKTIF-nya, nama dicocokkan tanpa peduli huruf besar-kecil). */
async function sisaAktifKaryawan(db, nama) {
  const daftar = await db.finKasbon.findMany({
    where: { employeeName: { equals: nama, mode: "insensitive" }, status: "AKTIF" },
    include: { repayments: { where: { cancelledAt: null } } },
  });
  let total = ZERO;
  for (const k of daftar) {
    const bayar = k.repayments.length ? sumMoney(k.repayments.map((r) => r.amount)) : ZERO;
    total = total.plus(toMoney(k.amount).minus(bayar));
  }
  return total;
}

function klausaCari(q) {
  const kata = String(q || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return kata.map((k) => {
    const atau = ["kasbonNumber", "employeeName", "urgency", "notes"].map((f) => ({ [f]: { contains: k, mode: "insensitive" } }));
    const angka = k.replace(/\./g, "");
    if (/^\d{3,}$/.test(angka)) atau.push({ amount: Number(angka) });
    return { OR: atau };
  });
}

// ─── DAFTAR + RINGKASAN ──────────────────────────────────────────────────
financeKasbonRouter.get("/kasbon", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { q, status, karyawan, from, to } = req.query;
    const rows = await prisma.finKasbon.findMany({
      where: {
        ...(status && { status }),
        ...(karyawan && { employeeName: { equals: karyawan, mode: "insensitive" } }),
        ...((from || to) && { date: { ...(from && { gte: toBookDate(from) }), ...(to && { lte: toBookDate(to) }) } }),
        AND: klausaCari(q),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
      include: kasbonInclude,
    });

    // Ringkasan SELALU dihitung dari seluruh kasbon aktif, bukan dari baris
    // yang sedang disaring — supaya angka "siapa berutang berapa" tidak
    // berubah-ubah mengikuti pencarian.
    const aktif = await prisma.finKasbon.findMany({
      where: { status: "AKTIF" },
      include: { repayments: { where: { cancelledAt: null } } },
      orderBy: { date: "asc" },
    });
    const peta = new Map();
    let totalSisa = ZERO;
    for (const k of aktif) {
      const bayar = k.repayments.length ? sumMoney(k.repayments.map((r) => r.amount)) : ZERO;
      const sisa = toMoney(k.amount).minus(bayar);
      totalSisa = totalSisa.plus(sisa);
      const kunci = k.employeeName.trim().toLowerCase();
      const cur = peta.get(kunci) || { nama: rapikanNama(k.employeeName), jumlah: 0, sisa: ZERO, terlama: k.date };
      cur.jumlah += 1;
      cur.sisa = cur.sisa.plus(sisa);
      peta.set(kunci, cur);
    }
    const perKaryawan = [...peta.values()]
      .map((v) => ({ ...v, sisa: moneyToNumber(v.sisa) }))
      .sort((a, b) => b.sisa - a.sisa);

    const hariIni = todayBookDateWIB();
    const awal = new Date(Date.UTC(hariIni.getUTCFullYear(), hariIni.getUTCMonth(), 1));
    const akhir = new Date(Date.UTC(hariIni.getUTCFullYear(), hariIni.getUTCMonth() + 1, 0));
    const [diberikan, dipotong] = await Promise.all([
      prisma.finKasbon.aggregate({ where: { status: { not: "DIBATALKAN" }, date: { gte: awal, lte: akhir } }, _sum: { amount: true } }),
      prisma.finKasbonRepayment.aggregate({ where: { cancelledAt: null, date: { gte: awal, lte: akhir } }, _sum: { amount: true } }),
    ]);

    res.json({
      kasbon: rows.map(bentukKasbon),
      perKaryawan,
      totalSisa: moneyToNumber(totalSisa),
      bulanIni: { diberikan: Number(diberikan._sum.amount || 0), terpotong: Number(dipotong._sum.amount || 0) },
      batas: parseIntOr(await getSettingRaw(prisma, SETTING_KEYS.KASBON_BATAS_AKTIF), 0),
      terpotong: rows.length === 500,
    });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Nama untuk saran isian form: pernah dapat kasbon + seluruh user sistem.
financeKasbonRouter.get("/kasbon/karyawan-nama", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const [a, b] = await Promise.all([
      prisma.finKasbon.findMany({ distinct: ["employeeName"], select: { employeeName: true } }),
      prisma.user.findMany({ select: { name: true } }),
    ]);
    const unik = new Map();
    for (const n of [...a.map((x) => x.employeeName), ...b.map((x) => x.name)]) {
      const rapi = rapikanNama(n);
      if (rapi && !unik.has(rapi.toLowerCase())) unik.set(rapi.toLowerCase(), rapi);
    }
    res.json({ nama: [...unik.values()].sort((x, y) => x.localeCompare(y, "id")) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ─── KASBON BARU ─────────────────────────────────────────────────────────
financeKasbonRouter.post("/kasbon", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { date, amount, employeeName, urgency, cashAccountId, notes, receiptUrl, lewatBatas } = req.body;
    const nama = rapikanNama(employeeName);
    if (!nama) throw err("Nama karyawan wajib diisi");
    if (!urgency?.trim() || urgency.trim().length < 3) throw err("Urgensi/alasan kasbon wajib diisi");
    const nominal = toMoney(amount, { field: "Nominal kasbon" });
    if (nominal.lessThanOrEqualTo(0)) throw err("Nominal kasbon harus lebih dari 0");
    if (!cashAccountId) throw err("Rekening sumber uang wajib dipilih");
    if (receiptUrl && !String(receiptUrl).startsWith(`${RECEIPTS_URL_PREFIX}/`)) throw err("Bukti harus diunggah lewat fitur upload");

    const hasil = await prisma.$transaction(async (tx) => {
      const rekening = await tx.finCashAccount.findUnique({ where: { id: cashAccountId }, select: { id: true, name: true, accountId: true, active: true } });
      if (!rekening || !rekening.active) throw err("Rekening sumber tidak ditemukan atau nonaktif", 404);

      const batas = parseIntOr(await getSettingRaw(tx, SETTING_KEYS.KASBON_BATAS_AKTIF), 0);
      if (batas > 0) {
        const setelah = (await sisaAktifKaryawan(tx, nama)).plus(nominal);
        if (setelah.greaterThan(batas)) {
          if (!lewatBatas) {
            throw Object.assign(
              err(`Total kasbon aktif ${nama} akan menjadi Rp${Number(setelah).toLocaleString("id-ID")}, melewati batas Rp${batas.toLocaleString("id-ID")}.`, 422),
              { kodeBatas: true }
            );
          }
          if (!hasPermission(req.user, P.FINANCE_ADMIN)) throw err("Hanya admin yang boleh melewati batas kasbon", 403);
        }
      }

      const tanggal = date ? toBookDate(date) : todayBookDateWIB();
      const id = randomUUID();
      const pengguna = await tx.user.findFirst({ where: { name: { equals: nama, mode: "insensitive" } }, select: { id: true } });
      const k = await tx.finKasbon.create({
        data: {
          id, kasbonNumber: await generateDocumentNumber(tx, "KSB", tanggal),
          date: tanggal, amount: nominal, employeeName: nama, employeeId: pengguna?.id || null,
          urgency: urgency.trim(), notes: notes?.trim() || null, cashAccountId,
          receiptUrl: receiptUrl || null, journalRef: id, createdById: req.user.id,
        },
      });
      await postKasbonDiberikan(tx, { kasbonId: id, date: tanggal, amount: nominal, karyawanNama: nama, cashAccount: rekening, userId: req.user.id });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_KASBON, entityId: k.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: req.user.id,
        metadata: { kasbonNumber: k.kasbonNumber, aksi: "diberikan", employeeName: nama, amount: String(nominal), urgency: urgency.trim(), ...(lewatBatas && { lewatBatas: true }) },
      });
      return k;
    });

    const lengkap = await prisma.finKasbon.findUnique({ where: { id: hasil.id }, include: kasbonInclude });
    res.status(201).json(bentukKasbon(lengkap));
  } catch (e) {
    if (e.kodeBatas) return res.status(422).json({ error: e.message, kodeBatas: true });
    handleFinanceError(e, res);
  }
});

// ─── PELUNASAN ───────────────────────────────────────────────────────────
/** Catat SATU pelunasan atas satu kasbon (dipakai jalur per-kasbon dan potong-karyawan). */
async function catatPelunasan(tx, kasbonId, { date, amount, method, notes, userId }) {
  const k = await tx.finKasbon.findUnique({ where: { id: kasbonId }, include: { repayments: { where: { cancelledAt: null } } } });
  if (!k) throw err("Kasbon tidak ditemukan", 404);
  if (k.status !== "AKTIF") throw err(`Kasbon ${k.kasbonNumber} sudah ${k.status === "LUNAS" ? "lunas" : "dibatalkan"}`, 409);

  const bayar = k.repayments.length ? sumMoney(k.repayments.map((r) => r.amount)) : ZERO;
  const sisa = toMoney(k.amount).minus(bayar);
  const nominal = toMoney(amount, { field: "Nominal pelunasan" });
  if (nominal.lessThanOrEqualTo(0)) throw err("Nominal pelunasan harus lebih dari 0");
  if (nominal.greaterThan(sisa)) throw err(`Nominal melebihi kasbon yang belum dipotong pada ${k.kasbonNumber} (Rp${Number(sisa).toLocaleString("id-ID")})`);

  const tanggal = date ? toBookDate(date) : todayBookDateWIB();
  const rep = await tx.finKasbonRepayment.create({
    data: { kasbonId, date: tanggal, amount: nominal, method, notes: notes?.trim() || null, createdById: userId },
  });
  await postKasbonPelunasan(tx, { repaymentId: rep.id, date: tanggal, amount: nominal, karyawanNama: k.employeeName, method, userId });
  if (sisa.minus(nominal).lessThanOrEqualTo(0)) await tx.finKasbon.update({ where: { id: kasbonId }, data: { status: "LUNAS" } });

  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_KASBON, entityId: kasbonId, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
    metadata: { kasbonNumber: k.kasbonNumber, aksi: "pelunasan", method, amount: String(nominal) },
  });
  return { kasbonNumber: k.kasbonNumber, amount: moneyToNumber(nominal) };
}

function cekMetode(method) {
  if (!METODE.includes(method)) throw err("Kasbon hanya bisa dilunasi dengan potong gaji");
}

// Potong/kembalikan untuk SATU karyawan lintas kasbon: dialokasikan ke kasbon
// TERTUA dulu (FIFO) — cara orang gajian memang memotong.
financeKasbonRouter.post("/kasbon/pelunasan-karyawan", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { employeeName, amount, date, method, notes } = req.body;
    cekMetode(method);
    if (!employeeName?.trim()) throw err("Nama karyawan wajib diisi");
    const total = toMoney(amount, { field: "Nominal pelunasan" });
    if (total.lessThanOrEqualTo(0)) throw err("Nominal pelunasan harus lebih dari 0");

    const hasil = await prisma.$transaction(async (tx) => {
      const daftar = await tx.finKasbon.findMany({
        where: { employeeName: { equals: employeeName.trim(), mode: "insensitive" }, status: "AKTIF" },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        include: { repayments: { where: { cancelledAt: null } } },
      });
      if (daftar.length === 0) throw err(`${employeeName} tidak punya kasbon aktif`, 404);
      const sisaTotal = daftar.reduce((acc, k) => acc.plus(toMoney(k.amount).minus(k.repayments.length ? sumMoney(k.repayments.map((r) => r.amount)) : ZERO)), ZERO);
      if (total.greaterThan(sisaTotal)) throw err(`Nominal melebihi total kasbon yang belum dipotong (Rp${Number(sisaTotal).toLocaleString("id-ID")})`);

      let sisaUang = total;
      const dialokasikan = [];
      for (const k of daftar) {
        if (sisaUang.lessThanOrEqualTo(0)) break;
        const bayar = k.repayments.length ? sumMoney(k.repayments.map((r) => r.amount)) : ZERO;
        const sisaKasbon = toMoney(k.amount).minus(bayar);
        const bagian = sisaUang.lessThan(sisaKasbon) ? sisaUang : sisaKasbon;
        dialokasikan.push(await catatPelunasan(tx, k.id, { date, amount: bagian, method, notes, userId: req.user.id }));
        sisaUang = sisaUang.minus(bagian);
      }
      return dialokasikan;
    });
    res.status(201).json({ dialokasikan: hasil });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

financeKasbonRouter.post("/kasbon/:id/pelunasan", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    cekMetode(req.body?.method);
    const hasil = await prisma.$transaction((tx) => catatPelunasan(tx, req.params.id, { ...req.body, userId: req.user.id }));
    const lengkap = await prisma.finKasbon.findUnique({ where: { id: req.params.id }, include: kasbonInclude });
    res.status(201).json({ ...hasil, kasbon: bentukKasbon(lengkap) });
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// Batalkan satu pelunasan (salah input) — jurnalnya dibalik, kasbon aktif lagi.
financeKasbonRouter.post("/kasbon/:id/pelunasan/:rid/batal", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");
    await prisma.$transaction(async (tx) => {
      const rep = await tx.finKasbonRepayment.findUnique({ where: { id: req.params.rid }, include: { kasbon: true } });
      if (!rep || rep.kasbonId !== req.params.id) throw err("Pelunasan tidak ditemukan", 404);
      if (rep.cancelledAt) throw err("Pelunasan ini sudah dibatalkan", 409);

      const entry = await findEntryByKey(tx, KASBON_KEY.kasbonPelunasan(rep.id));
      if (entry && entry.status === "POSTED") {
        await reverseJournal(tx, { entryId: entry.id, reason: `Pelunasan kasbon ${rep.kasbon.kasbonNumber} dibatalkan — ${reason}`, userId: req.user.id });
      }
      await tx.finKasbonRepayment.update({ where: { id: rep.id }, data: { cancelledAt: new Date(), cancelReason: reason } });
      if (rep.kasbon.status === "LUNAS") await tx.finKasbon.update({ where: { id: rep.kasbonId }, data: { status: "AKTIF" } });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_KASBON, entityId: rep.kasbonId, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id,
        metadata: { kasbonNumber: rep.kasbon.kasbonNumber, aksi: "batal_pelunasan", reason, amount: String(rep.amount) },
      });
    });
    const lengkap = await prisma.finKasbon.findUnique({ where: { id: req.params.id }, include: kasbonInclude });
    res.json(bentukKasbon(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ─── BATALKAN KASBON ─────────────────────────────────────────────────────
financeKasbonRouter.post("/kasbon/:id/batal", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan pembatalan wajib diisi");
    await prisma.$transaction(async (tx) => {
      const k = await tx.finKasbon.findUnique({ where: { id: req.params.id }, include: { repayments: { where: { cancelledAt: null } } } });
      if (!k) throw err("Kasbon tidak ditemukan", 404);
      if (k.status === "DIBATALKAN") throw err("Kasbon ini sudah dibatalkan", 409);
      if (k.repayments.length > 0) throw err("Kasbon ini sudah ada pelunasannya — batalkan pelunasannya dulu", 409);

      if (!k.historis && k.journalRef) {
        const entry = await findEntryByKey(tx, KASBON_KEY.kasbonDiberikan(k.journalRef));
        if (entry && entry.status === "POSTED") {
          await reverseJournal(tx, { entryId: entry.id, reason: `Kasbon ${k.kasbonNumber} dibatalkan — ${reason}`, userId: req.user.id });
        }
      }
      await tx.finKasbon.update({ where: { id: k.id }, data: { status: "DIBATALKAN", cancelledAt: new Date(), cancelReason: reason } });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_KASBON, entityId: k.id, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: req.user.id,
        metadata: { kasbonNumber: k.kasbonNumber, reason, amount: String(k.amount) },
      });
    });
    const lengkap = await prisma.finKasbon.findUnique({ where: { id: req.params.id }, include: kasbonInclude });
    res.json(bentukKasbon(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});

// ─── EDIT (data non-uang) ────────────────────────────────────────────────
// Nominal/tanggal/rekening TIDAK diedit di sini — itu menyentuh jurnal, jadi
// jalurnya batalkan lalu catat ulang. Yang boleh: nama, urgensi, catatan, bukti.
financeKasbonRouter.patch("/kasbon/:id", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw err("Alasan perubahan wajib diisi");
    const hasil = await prisma.$transaction(async (tx) => {
      const k = await tx.finKasbon.findUnique({ where: { id: req.params.id } });
      if (!k) throw err("Kasbon tidak ditemukan", 404);
      if (k.status === "DIBATALKAN") throw err("Kasbon yang dibatalkan tidak bisa diubah", 409);

      const usul = {};
      if (req.body.employeeName !== undefined) {
        const nama = rapikanNama(req.body.employeeName);
        if (!nama) throw err("Nama karyawan wajib diisi");
        usul.employeeName = nama;
      }
      if (req.body.urgency !== undefined) usul.urgency = req.body.urgency?.trim() || null;
      if (req.body.notes !== undefined) usul.notes = req.body.notes?.trim() || null;
      if (req.body.receiptUrl !== undefined) {
        if (req.body.receiptUrl && !String(req.body.receiptUrl).startsWith(`${RECEIPTS_URL_PREFIX}/`)) throw err("Bukti harus diunggah lewat fitur upload");
        usul.receiptUrl = req.body.receiptUrl || null;
      }
      const beda = Object.fromEntries(Object.entries(usul).filter(([f, v]) => (k[f] ?? null) !== (v ?? null)));
      if (Object.keys(beda).length === 0) throw err("Tidak ada perubahan yang dikirim");

      const updated = await tx.finKasbon.update({ where: { id: k.id }, data: beda });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_KASBON, entityId: k.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { kasbonNumber: k.kasbonNumber, reason, changes: Object.fromEntries(Object.keys(beda).map((f) => [f, { from: k[f], to: beda[f] }])) },
      });
      return updated;
    });
    const lengkap = await prisma.finKasbon.findUnique({ where: { id: hasil.id }, include: kasbonInclude });
    res.json(bentukKasbon(lengkap));
  } catch (e) {
    handleFinanceError(e, res);
  }
});
