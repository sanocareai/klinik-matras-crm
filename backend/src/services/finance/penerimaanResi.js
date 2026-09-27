// PENERIMAAN RESI — Finance memverifikasi klaim "Lunas" Sales yang dibuat SEKALI di level Resi (Fase 3A).
//
// Satu antrean per Resi (dengan rincian child), bukan N baris per order. Verifikasi membuat SATU Payment pada order anchor + alokasi otomatis
// proporsional ke child aktif (dihitung server), memverifikasinya, dan menjurnalkan lewat postPaymentReceived (baris per child).
// Hanya mode REKENING (uang masuk ke rekening kas/bank). "SEBELUM_SALDO_AWAL" hanya untuk riwayat sebelum 18 Sep 2026 — Resi baru tidak relevan.
// Semua fungsi menolak 403 bila RESI_PEMBAYARAN_AKTIF mati. Order tunggal / groupId NULL / group BACKFILL_BUNDLE tidak ikut alur ini.

import { paidForOrder } from "./allocation.js";
import { toBookDate } from "./journal.js";
import { bukukanPembayaran } from "./hooks.js";
import { moneyToNumber } from "./money.js";
import {
  ResiBayarError, resiPembayaranAktif, muatGrupResi, pastikanGrupLayak, hitungAlokasiResi, tulisPembayaranResi, tagihanAnak, TIPE_BAYAR,
} from "../resiPembayaran.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

const GATE_MATI = Object.freeze({ enabled: false });
const METODE = ["CASH", "TRANSFER", "QRIS", "CARD"];

const tanggalWIB = (instant) => new Date(new Date(instant).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
async function pastikanAktif(db) {
  if (!(await resiPembayaranAktif(db))) throw new ResiBayarError("Pembayaran Resi belum diaktifkan", 403, "RESI_PEMBAYARAN_MATI");
}
const sudahDibayar = async (db, id) => moneyToNumber(await paidForOrder(db, id, GATE_MATI));

/** Antrean Finance: Resi (group BARU) yang sudah diklaim Lunas oleh Sales tetapi uang masuknya belum (penuh) tercatat. */
export async function daftarKlaimLunasResi(db) {
  if (!(await resiPembayaranAktif(db))) return { aktif: false, items: [], jumlah: 0, total: 0 };
  const grupList = await db.orderGroup.findMany({
    where: { source: "BARU", orders: { some: { paymentStatus: "LUNAS", status: { not: "CANCELLED" } } } },
    select: {
      id: true, anchorOrderId: true, dpTarget: true,
      customer: { select: { id: true, name: true, assignedSales: { select: { name: true } } } },
      orders: { select: { id: true, orderNumber: true, status: true, value: true, ongkir: true, paymentStatus: true, paidAt: true } },
    },
    take: 500,
  });
  const items = [];
  for (const g of grupList) {
    const aktif = g.orders.filter((o) => o.status !== "CANCELLED").sort((a, b) => (a.id < b.id ? -1 : 1));
    const anak = [];
    for (const o of aktif) {
      const dibayar = await sudahDibayar(db, o.id);
      anak.push({ orderId: o.id, orderNumber: o.orderNumber, tagihan: tagihanAnak(o), sudahDicatat: dibayar, sisa: Math.max(tagihanAnak(o) - dibayar, 0), paymentStatus: o.paymentStatus, paidAt: o.paidAt });
    }
    const sisa = anak.reduce((s, a) => s + a.sisa, 0);
    if (sisa <= 0) continue;
    const berharga = aktif.filter((o) => (Number(o.value) || 0) > 0);
    const paidAts = anak.map((a) => a.paidAt).filter(Boolean).sort((a, b) => a - b);
    const anchor = aktif.find((o) => o.id === g.anchorOrderId) || aktif[0];
    items.push({
      tipe: "RESI", groupId: g.id, anchorOrderNumber: anchor?.orderNumber ?? null,
      customerId: g.customer?.id ?? null, customerName: g.customer?.name ?? "—", salesName: g.customer?.assignedSales?.name ?? null,
      nilaiTagihan: anak.reduce((s, a) => s + a.tagihan, 0), sudahDicatat: anak.reduce((s, a) => s + a.sudahDicatat, 0), sisa,
      lengkap: berharga.length > 0 && berharga.every((o) => o.paymentStatus === "LUNAS"), // false = klaim Lunas belum di level Resi penuh
      lunasSejak: paidAts[0] ? tanggalWIB(paidAts[0]) : null,
      anak: anak.map(({ paidAt, ...sisaKolom }) => sisaKolom),
    });
  }
  return { aktif: true, items, jumlah: items.length, total: items.reduce((s, i) => s + i.sisa, 0) };
}

/** Pratinjau alokasi verifikasi (BACA-SAJA). Nominal default = seluruh sisa tagihan Resi. */
export async function pratinjauVerifikasiResi(db, { groupId, amount = null }) {
  await pastikanAktif(db);
  const { grup, anak } = await muatGrupResi(db, groupId);
  const { aktif } = pastikanGrupLayak(grup, anak);
  const dibayar = new Map();
  for (const o of aktif) dibayar.set(o.id, await sudahDibayar(db, o.id));
  const hitung = hitungAlokasiResi({ anak: aktif, dibayar, tipe: TIPE_BAYAR.TAGIHAN, nominal: amount });
  return {
    groupId: grup.id, customerName: grup.customer?.name ?? null, nominal: hitung.nominal,
    ringkasan: { totalTagihan: hitung.totalTagihan, dibayarSebelum: hitung.totalDibayarSebelum, sisa: hitung.totalSisa },
    alokasi: hitung.alokasi.map((a) => ({ orderId: a.orderId, orderNumber: a.orderNumber, tagihan: a.tagihan, dibayar: a.dibayar, sisa: a.sisa, alokasi: a.alokasi, sisaSesudah: a.sisa - a.alokasi })),
    dibaca: "pratinjau",
  };
}

/** Verifikasi penerimaan uang Resi: SATU transaksi, kunci group + child urut, hitung ulang di bawah kunci. Alokasi dari klien TIDAK dipakai. */
export async function verifikasiPenerimaanResi(tx, { groupId, mode = "REKENING", method = "TRANSFER", cashAccountId = null, date = null, amount = null, proofPhotoUrl = null, verifierId }) {
  await pastikanAktif(tx);
  if (mode !== "REKENING") throw new ResiBayarError("Verifikasi Resi hanya mendukung uang masuk ke rekening (REKENING)", 422, "MODE_TIDAK_DIDUKUNG");
  if (!METODE.includes(method)) throw new ResiBayarError("Cara bayar tidak dikenali", 400, "METODE_TIDAK_VALID");
  if (!cashAccountId) throw new ResiBayarError("Pilih dulu uangnya masuk ke rekening mana", 400, "REKENING_WAJIB");
  const rekening = await tx.finCashAccount.findUnique({ where: { id: cashAccountId }, select: { id: true, name: true, active: true } });
  if (!rekening || !rekening.active) throw new ResiBayarError("Rekening itu tidak ditemukan atau sudah tidak dipakai", 404, "REKENING_TIDAK_VALID");

  const { grup, anak } = await muatGrupResi(tx, groupId, { kunci: true });
  const { anchor, aktif } = pastikanGrupLayak(grup, anak);
  const berharga = aktif.filter((o) => (Number(o.value) || 0) > 0);
  if (berharga.length === 0 || !berharga.every((o) => o.paymentStatus === "LUNAS")) {
    throw new ResiBayarError("Klaim Lunas belum berada di level Resi penuh (ada order yang belum berstatus Lunas). Minta Sales menandai Lunas dari Resi, atau muat ulang.", 409, "KLAIM_BELUM_LENGKAP");
  }
  const dibayar = new Map();
  for (const o of aktif) dibayar.set(o.id, await sudahDibayar(tx, o.id));
  const hitung = hitungAlokasiResi({ anak: aktif, dibayar, tipe: TIPE_BAYAR.TAGIHAN, nominal: amount });

  const paidAts = aktif.map((o) => o.paidAt).filter(Boolean).sort((a, b) => a - b);
  const tanggal = toBookDate(date || (paidAts[0] ? tanggalWIB(paidAts[0]) : tanggalWIB(new Date())));
  // createdAt = tanggal uang diterima (jam 12 WIB): postPaymentReceived memakainya sebagai tanggal buku.
  const createdAt = new Date(Date.UTC(tanggal.getUTCFullYear(), tanggal.getUTCMonth(), tanggal.getUTCDate(), 5));

  const tulis = await tulisPembayaranResi(tx, {
    grup, anchor, aktif, hitung, method, cashAccountId: rekening.id, proofPhotoUrl,
    recordedById: grup.customer?.assignedSalesId || verifierId, verifierId, createdAt,
  });
  const jurnal = await bukukanPembayaran(tx, { paymentId: tulis.payment.id, userId: verifierId });
  if (!jurnal.posted) {
    throw new ResiBayarError("Pembayaran ini belum bisa dicatat karena ada pengaturan akun keuangan yang belum lengkap (lihat menu Data Belum Lengkap). Belum ada yang tersimpan.", 422, "JURNAL_BELUM_BISA");
  }
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: anchor.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: verifierId,
    metadata: { aksi: "verifikasi_penerimaan_resi", groupId: grup.id, mode, amount: String(hitung.nominal), method, cashAccount: rekening.name, paymentId: tulis.payment.id, child: hitung.tulis.length },
  });
  return {
    paymentId: tulis.payment.id, groupId: grup.id, amount: hitung.nominal,
    alokasi: hitung.tulis.map((a) => ({ orderId: a.orderId, orderNumber: a.orderNumber, jumlah: a.alokasi })),
    status: tulis.status,
  };
}

/** Finance menyatakan uang Resi BELUM masuk: kembalikan status child (DP bila sudah ada pembayaran tercatat, jika tidak Belum Bayar). */
export async function tolakLunasResi(tx, { groupId, reason, userId }) {
  await pastikanAktif(tx);
  if (!String(reason ?? "").trim()) throw new ResiBayarError("Alasan wajib diisi", 400, "ALASAN_WAJIB");
  const { grup, anak } = await muatGrupResi(tx, groupId, { kunci: true });
  const { aktif } = pastikanGrupLayak(grup, anak);
  const hasil = [];
  for (const o of aktif) {
    if (o.paymentStatus !== "LUNAS") continue;
    const dibayar = await sudahDibayar(tx, o.id);
    // Sama dengan tolakLunas per order: child yang SUDAH lunas penuh menurut ledger tidak bisa "ditolak" — yang ditolak adalah Payment-nya.
    if ((Number(o.value) || 0) > 0 && dibayar >= (Number(o.value) || 0)) continue;
    const baru = dibayar > 0 ? "DP" : "BELUM_BAYAR";
    await tx.order.update({ where: { id: o.id }, data: { paymentStatus: baru, paidAt: null } });
    hasil.push({ orderId: o.id, orderNumber: o.orderNumber, statusBaru: baru });
  }
  if (hasil.length === 0) throw new ResiBayarError("Tidak ada klaim Lunas yang bisa ditolak (Resi sudah lunas menurut pembayaran tercatat, atau belum diklaim)", 409, "TIDAK_ADA_KLAIM");
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: grup.anchorOrderId, eventType: EVENT_TYPES.DOCUMENT_REJECTED, actorId: userId,
    metadata: { aksi: "tolak_lunas_resi", groupId: grup.id, reason: String(reason).trim(), child: hasil },
  });
  return { groupId: grup.id, child: hasil };
}

/** Finance meminta bukti ke Sales atas klaim Lunas Resi: hanya penanda + audit per child yang masih diklaim dan belum lunas tercatat. */
export async function mintaBuktiResi(tx, { groupId, catatan = null, userId }) {
  await pastikanAktif(tx);
  const { grup, anak } = await muatGrupResi(tx, groupId, { kunci: true });
  const { aktif } = pastikanGrupLayak(grup, anak);
  const teks = String(catatan ?? "").trim().slice(0, 300) || null;
  const dicatat = [];
  for (const o of aktif) {
    if (o.paymentStatus !== "LUNAS") continue;
    const dibayar = await sudahDibayar(tx, o.id);
    if ((Number(o.value) || 0) > 0 && dibayar >= tagihanAnak(o)) continue;
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: o.id, eventType: EVENT_TYPES.BUKTI_DIMINTA, actorId: userId,
      metadata: { aksi: "minta_bukti", orderNumber: o.orderNumber, catatan: teks, groupId: grup.id },
    });
    dicatat.push(o.orderNumber || o.id);
  }
  if (dicatat.length === 0) throw new ResiBayarError("Tidak ada klaim Lunas Resi yang perlu bukti", 409, "TIDAK_ADA_KLAIM");
  return { groupId: grup.id, orders: dicatat, catatan: teks };
}
