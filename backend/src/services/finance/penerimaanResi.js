// PENERIMAAN RESI — Finance memverifikasi klaim "Lunas" Sales yang dibuat SEKALI di level Resi (Fase 3A).
//
// Satu antrean per Resi (dengan rincian child), bukan N baris per order. Verifikasi membuat SATU Payment pada order anchor + alokasi otomatis
// proporsional ke child aktif (dihitung server), memverifikasinya, dan menjurnalkan (baris per child).
//
// KLAIM (hardening 28 Sep 2026): klaim Sales = OrderGroup.lunasDiklaimPada. Klaim TIDAK mengubah status bayar/paidAt child; hanya verifikasi
// (Payment + alokasi + recompute ledger) yang menggerakkannya. Tolak klaim = hapus penanda klaim + audit, TANPA menyentuh status/pembayaran
// yang sah. Klaim "Lunas" per order lama (dropdown sebelum flag aktif) pada child Resi ikut ditampilkan (`sumberKlaim: PER_ORDER`) supaya tidak
// yatim; tolak mengembalikan status child itu ke angka ledger (recompute), bukan menebak.
//
// MODE UANG MASUK — sama dengan verifikasi per order (services/finance/penerimaanOrder.js), tidak dibatasi:
//  • REKENING            uang masuk ke rekening kas/bank: postPaymentReceived — Dr Kas/Bank sekali, Cr Piutang/Uang Muka per child.
//  • SEBELUM_SALDO_AWAL  uang diterima sebelum tanggal saldo awal (kas asli sudah memuatnya lewat penyesuaian SALDO_AWAL):
//                        Dr Laba Ditahan, Cr Piutang/Uang Muka per child; kas tidak berubah. Child pra-pembukuan (sudah diserahkan tapi
//                        pendapatannya tidak pernah diakui) tidak dijurnal — sama persis dengan aturan per order.
// Semua fungsi menolak 403 bila RESI_PEMBAYARAN_AKTIF mati. Order tunggal / groupId NULL / group BACKFILL_BUNDLE tidak ikut alur ini.

import { toBookDate, postJournal, findEntryByKey } from "./journal.js";
import { bukukanPembayaran } from "./hooks.js";
import { toMoney } from "./money.js";
import { resolveAccount, SYSTEM_KEYS } from "./accounts.js";
import { KEY as KEY_ORDER, STATUS_PENGAKUAN } from "./posting/orderRevenue.js";
import { recomputeOrderPaymentStatus } from "../paymentLedger.js";
import { bangunBukti } from "./pembayaran.js";
import { dasarStatusBayar } from "./tagihanOrder.js";
import { tanggalCutoff } from "./penerimaanOrder.js";
import {
  ResiBayarError, resiPembayaranAktif, pastikanAktif, muatGrupResi, pastikanGrupLayak, hitungAlokasiResi, tulisPembayaranResi, muatDibayar,
  rincianAnak, METODE_BAYAR, TIPE_BAYAR, versiGrup,
} from "../resiPembayaran.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

export const MODE_UANG_MASUK = Object.freeze(["REKENING", "SEBELUM_SALDO_AWAL"]);

const tanggalWIB = (instant) => new Date(new Date(instant).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** Child dengan klaim "Lunas" PER ORDER yang tidak didukung ledger (dropdown lama): status LUNAS tetapi dibayar < dasar status. */
function klaimPerOrder(aktif, dibayar, grup) {
  return aktif.filter((o) => o.paymentStatus === "LUNAS" && (Number(o.value) || 0) > 0 && (Number(dibayar.get(o.id)) || 0) < dasarStatusBayar(o, grup));
}

/** Pembayaran yang menyentuh Resi (Payment di child mana pun, termasuk Payment Resi di anchor) — untuk ditinjau Finance: rekening, bukti, status. */
async function pembayaranResi(db, orderIds) {
  const ps = await db.payment.findMany({
    where: { OR: [{ orderId: { in: orderIds } }, { finAllocations: { some: { orderId: { in: orderIds } } } }] },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, orderId: true, amount: true, method: true, createdAt: true, cancelledAt: true, proofPhotoUrl: true,
      cashAccount: { select: { name: true } }, recordedBy: { select: { name: true } },
      verifications: { select: { id: true } }, _count: { select: { finAllocations: true } },
    },
  });
  return ps.map((p) => ({
    id: p.id, orderId: p.orderId, amount: p.amount, method: p.method, createdAt: p.createdAt, dibatalkan: !!p.cancelledAt,
    rekening: p.cashAccount?.name ?? null, dicatatOleh: p.recordedBy?.name ?? null, terverifikasi: p.verifications.length > 0,
    pembayaranResi: p._count.finAllocations > 0, bukti: bangunBukti(p),
  }));
}

/** Permintaan bukti terbaru untuk Resi ini (event BUKTI_DIMINTA ber-groupId) yang lebih baru dari klaim. */
async function buktiDimintaResi(db, grup) {
  const ev = await db.activityEvent.findFirst({
    where: { entityType: ENTITY_TYPES.ORDER, eventType: EVENT_TYPES.BUKTI_DIMINTA, entityId: grup.anchorOrderId, metadata: { path: ["groupId"], equals: grup.id } },
    orderBy: { createdAt: "desc" }, select: { createdAt: true, metadata: true },
  });
  if (!ev || (grup.lunasDiklaimPada && ev.createdAt < grup.lunasDiklaimPada)) return null;
  return { pada: ev.createdAt.toISOString(), catatan: ev.metadata?.catatan ?? null };
}

async function bentukItem(db, grup, anak, { denganPembayaran = true } = {}) {
  const { aktif } = pastikanGrupLayak(grup, anak);
  const dibayar = await muatDibayar(db, aktif);
  const rinci = rincianAnak(aktif, dibayar, grup);
  const perOrder = klaimPerOrder(aktif, dibayar, grup);
  const total = rinci.reduce((s, r) => s + r.tagihan, 0);
  const sudah = rinci.reduce((s, r) => s + r.dibayar, 0);
  const anchor = aktif.find((o) => o.id === grup.anchorOrderId);
  return {
    tipe: "RESI", groupId: grup.id, versi: versiGrup(grup), anchorOrderId: grup.anchorOrderId, anchorOrderNumber: anchor?.orderNumber ?? null,
    customerId: grup.customerId, customerName: grup.customer?.name ?? "—", salesName: grup.salesName ?? null,
    sumberKlaim: grup.lunasDiklaimPada ? "RESI" : perOrder.length ? "PER_ORDER" : null,
    klaim: grup.lunasDiklaimPada ? { pada: grup.lunasDiklaimPada.toISOString(), oleh: grup.lunasDiklaimOleh?.name ?? null } : null,
    klaimPerOrder: perOrder.map((o) => o.orderNumber || o.id),
    lunasSejak: grup.lunasDiklaimPada ? tanggalWIB(grup.lunasDiklaimPada) : null,
    totalTagihan: total, ongkirTambahan: rinci.reduce((s, r) => s + r.ongkir, 0), sudahDicatat: sudah, sisa: Math.max(total - sudah, 0),
    anak: rinci,
    dibatalkan: anak.filter((o) => o.status === "CANCELLED").map((o) => ({ orderId: o.id, orderNumber: o.orderNumber })),
    buktiDiminta: await buktiDimintaResi(db, grup),
    ...(denganPembayaran && { pembayaran: await pembayaranResi(db, anak.map((o) => o.id)) }),
  };
}

/** Antrean Finance: Resi (group BARU) yang diklaim Lunas (level Resi, atau klaim per order lama pada child-nya) dan sisanya belum tercatat. */
export async function daftarKlaimLunasResi(db) {
  if (!(await resiPembayaranAktif(db))) return { aktif: false, items: [], jumlah: 0, total: 0 };
  const grupList = await db.orderGroup.findMany({
    where: {
      source: "BARU",
      OR: [{ lunasDiklaimPada: { not: null } }, { orders: { some: { paymentStatus: "LUNAS", status: { not: "CANCELLED" } } } }],
    },
    select: { id: true, customer: { select: { assignedSales: { select: { name: true } } } } },
    orderBy: { lunasDiklaimPada: { sort: "asc", nulls: "last" } },
    take: 500,
  });
  const items = [];
  for (const g of grupList) {
    const { grup, anak } = await muatGrupResi(db, g.id);
    let item;
    try {
      item = await bentukItem(db, { ...grup, salesName: g.customer?.assignedSales?.name ?? null }, anak);
    } catch (e) {
      if (e instanceof ResiBayarError) continue; // grup tidak layak (anchor batal, dst.) — tidak masuk antrean verifikasi
      throw e;
    }
    if (!item.sumberKlaim || item.sisa <= 0) continue;
    items.push(item);
  }
  return { aktif: true, items, jumlah: items.length, total: items.reduce((s, i) => s + i.sisa, 0) };
}

/** Detail satu Resi untuk Finance (BACA-SAJA). */
export async function detailKlaimResi(db, { groupId }) {
  await pastikanAktif(db);
  const { grup, anak } = await muatGrupResi(db, groupId);
  return bentukItem(db, grup, anak);
}

/** Pratinjau alokasi verifikasi (BACA-SAJA). Nominal default = seluruh sisa tagihan Resi. */
export async function pratinjauVerifikasiResi(db, { groupId, amount = null }) {
  await pastikanAktif(db);
  const { grup, anak } = await muatGrupResi(db, groupId);
  const { aktif } = pastikanGrupLayak(grup, anak);
  const hitung = hitungAlokasiResi({ anak: aktif, dibayar: await muatDibayar(db, aktif), tipe: TIPE_BAYAR.TAGIHAN, nominal: amount, grup });
  return {
    groupId: grup.id, versi: versiGrup(grup), customerName: grup.customer?.name ?? null, nominal: hitung.nominal,
    ringkasan: { totalTagihan: hitung.totalTagihan, dibayarSebelum: hitung.totalDibayarSebelum, sisa: hitung.totalSisa },
    alokasi: hitung.alokasi.map((a) => ({ orderId: a.orderId, orderNumber: a.orderNumber, tagihan: a.tagihan, dibayar: a.dibayar, sisa: a.sisa, alokasi: a.alokasi, sisaSesudah: a.sisa - a.alokasi })),
    dibaca: "pratinjau",
  };
}

async function pendapatanSudahDiakui(tx, orderId) {
  const e = await findEntryByKey(tx, KEY_ORDER.revenue(orderId));
  return !!e && e.status === "POSTED";
}

/** Jurnal mode SEBELUM_SALDO_AWAL untuk Payment Resi: Dr Laba Ditahan Σ, Cr Piutang/Uang Muka per child (child pra-pembukuan dilewati). */
async function jurnalSebelumSaldoAwalResi(tx, { payment, alokasi, aktif, grup, tanggal, userId }) {
  const peta = new Map(aktif.map((o) => [o.id, o]));
  const baris = [];
  const dilewati = [];
  for (const a of alokasi) {
    const o = peta.get(a.orderId);
    const diakui = await pendapatanSudahDiakui(tx, o.id);
    if (!diakui && STATUS_PENGAKUAN.includes(o.status)) { dilewati.push(o.orderNumber || o.id); continue; }
    baris.push({ o, diakui, amount: toMoney(a.amount) });
  }
  if (baris.length === 0) return { posted: false, tanpaJurnal: true, dilewati };
  const [laba, piutang, uangMuka] = await Promise.all([
    resolveAccount(tx, SYSTEM_KEYS.LABA_DITAHAN), resolveAccount(tx, SYSTEM_KEYS.PIUTANG_USAHA), resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_PELANGGAN),
  ]);
  const total = baris.reduce((s, b) => s.plus(b.amount), toMoney(0));
  const entry = await postJournal(tx, {
    date: tanggal,
    description: `Pelunasan Resi ${grup.customer?.name || ""} (diterima sebelum saldo awal)`.trim(),
    source: "PEMBAYARAN_ORDER",
    sourceId: payment.id,
    // Kunci SAMA dengan jurnal pembayaran biasa: pembatalan pembayaran (batalkanJurnalPembayaran) otomatis membalik jurnal ini juga.
    idempotencyKey: `PEMBAYARAN_ORDER:${payment.id}`,
    userId,
    lines: [
      { accountId: laba.id, debit: total, description: "Kas sudah tercermin di saldo awal", orderId: grup.anchorOrderId },
      ...baris.map((b) => ({
        accountId: b.diakui ? piutang.id : uangMuka.id, credit: b.amount, orderId: b.o.id, customerId: grup.customerId,
        description: b.diakui ? `Pelunasan piutang order ${b.o.orderNumber}` : `Uang muka pelanggan — order ${b.o.orderNumber}`,
      })),
    ],
  });
  return { posted: true, entry, dilewati };
}

/**
 * Verifikasi penerimaan uang Resi: SATU transaksi, kunci group + child urut, hitung ulang di bawah kunci. Alokasi dari klien TIDAK dipakai.
 * Setelah terverifikasi, status + paidAt child dihitung ulang dari ledger. Klaim dilepas bila Resi lunas penuh; verifikasi sebagian
 * membiarkan klaim tetap menunggu sisanya.
 *
 * EXACTLY-ONCE (hardening 2, 28 Sep 2026): `versi` opsional = angka `updatedAt` grup yang dibaca klien dari pratinjau/antrean SEBELUM
 * mengirim verifikasi. Dicocokkan ULANG di bawah kunci — request kedua yang balapan (Idempotency-Key BERBEDA, dua klik/dua perangkat) dengan
 * `versi` yang sama tapi terlambat mendapat kunci akan melihat grup SUDAH berubah (baris grup selalu ditulis ulang di akhir fungsi ini, baik
 * verifikasi penuh MAUPUN sebagian) dan ditolak 409 `VERSI_BERUBAH` — TANPA Payment/alokasi/jurnal/perubahan paidAt tambahan. Dua verifikasi
 * SEBAGIAN yang genuinely berurutan (bukan balapan) tetap berjalan normal selama klien memakai `versi` terbaru (dikembalikan di setiap respons).
 * `versi` yang tidak dikirim (null/undefined) melewati pemeriksaan ini — kompatibel dengan pemanggil lama.
 */
export async function verifikasiPenerimaanResi(tx, { groupId, mode = "REKENING", method = "TRANSFER", cashAccountId = null, date = null, amount = null, proofPhotoUrl = null, proofPhotoUrls = null, versi = null, verifierId, klaim = null }) {
  // `klaim` ({ id, createdById }) = pembayaran ini hasil verifikasi KLAIM berbukti (services/finance/klaimLunas.js): tidak butuh klaim Lunas lama
  // (lunasDiklaimPada / per-order), dan pencatatnya = Sales pengaju. Semua pengaman lain (alokasi kanonis Σ = nominal, cutoff, rekening) tetap.
  await pastikanAktif(tx);
  if (!MODE_UANG_MASUK.includes(mode)) throw new ResiBayarError("Pilihan \"uangnya masuk ke mana\" tidak dikenali", 400, "MODE_TIDAK_VALID");
  if (!METODE_BAYAR.includes(method)) throw new ResiBayarError("Cara bayar tidak dikenali", 400, "METODE_TIDAK_VALID");
  let rekening = null;
  if (mode === "REKENING") {
    if (!cashAccountId) throw new ResiBayarError("Pilih dulu uangnya masuk ke rekening mana", 400, "REKENING_WAJIB");
    rekening = await tx.finCashAccount.findUnique({ where: { id: String(cashAccountId) }, select: { id: true, name: true, active: true } });
    if (!rekening || !rekening.active) throw new ResiBayarError("Rekening itu tidak ditemukan atau sudah tidak dipakai", 404, "REKENING_TIDAK_VALID");
  }

  const { grup, anak } = await muatGrupResi(tx, groupId, { kunci: true });
  // Pemeriksaan versi DI BAWAH KUNCI, sebelum apa pun ditulis — request yang balapan dan kalah tidak pernah menyentuh Payment/alokasi/jurnal.
  if (versi != null && String(versi) !== String(versiGrup(grup))) {
    throw new ResiBayarError("Resi ini baru saja diverifikasi/ditolak dari tempat lain — muat ulang antrean lalu coba lagi.", 409, "VERSI_BERUBAH");
  }
  // SEBELUM_SALDO_AWAL hanya untuk uang yang BENAR-BENAR diterima sebelum tanggal saldo awal (data historis) — dicek terhadap tanggal Resi
  // ini DIBUAT (grup.createdAt), bukan ditebak/dipercaya begitu saja seperti alur per-order lama. Resi yang dibuat pada/setelah cutoff (dalam
  // praktiknya SEMUA Resi — fitur ini baru ada setelah cutoff) tidak relevan dengan riwayat sebelum saldo awal.
  if (mode === "SEBELUM_SALDO_AWAL") {
    const cutoff = await tanggalCutoff(tx);
    if (tanggalWIB(grup.createdAt) >= cutoff) {
      throw new ResiBayarError(
        `Resi ini dibuat pada atau setelah tanggal saldo awal (${cutoff}) — mode "sudah lunas sebelum saldo awal" hanya untuk data historis sebelum tanggal itu. Pilih mode Rekening.`,
        409, "SEBELUM_SALDO_AWAL_TIDAK_BERLAKU",
      );
    }
  }
  const { anchor, aktif } = pastikanGrupLayak(grup, anak);
  const dibayar = await muatDibayar(tx, aktif);
  if (!klaim && !grup.lunasDiklaimPada && klaimPerOrder(aktif, dibayar, grup).length === 0) {
    throw new ResiBayarError("Resi ini tidak sedang diklaim Lunas (mungkin baru ditolak atau sudah diverifikasi). Muat ulang antrean.", 409, "TIDAK_ADA_KLAIM");
  }
  const hitung = hitungAlokasiResi({ anak: aktif, dibayar, tipe: TIPE_BAYAR.TAGIHAN, nominal: amount, grup });

  const tanggal = toBookDate(date || tanggalWIB(grup.lunasDiklaimPada ?? new Date()));
  // Guard cutoff (Owner 29 Sep 2026): uang yang diterima sebelum saldo awal sudah ada di saldo riil — tidak boleh menambah rekening. Resi selalu
  // dibuat setelah cutoff, jadi tanggal terima sebelum cutoff tidak masuk akal untuk Resi dan ditolak (bukan dialihkan diam-diam).
  if (mode === "REKENING") {
    const cutoffResi = await tanggalCutoff(tx);
    if (tanggal.toISOString().slice(0, 10) < cutoffResi) {
      throw new ResiBayarError(
        `Tanggal uang diterima (${tanggal.toISOString().slice(0, 10)}) jatuh sebelum saldo awal (${cutoffResi}), sehingga tidak boleh menambah saldo rekening. Periksa tanggalnya, atau minta Finance Admin menuntaskannya sebagai pembayaran historis.`,
        409, "TANGGAL_SEBELUM_SALDO_AWAL",
      );
    }
  }
  // createdAt = tanggal uang diterima (jam 12 WIB): postPaymentReceived memakainya sebagai tanggal buku.
  const createdAt = new Date(Date.UTC(tanggal.getUTCFullYear(), tanggal.getUTCMonth(), tanggal.getUTCDate(), 5));

  const tulis = await tulisPembayaranResi(tx, {
    grup, anchor, aktif, hitung, method, cashAccountId: rekening?.id ?? null, proofPhotoUrl, proofPhotoUrls,
    recordedById: klaim?.createdById || grup.lunasDiklaimOlehId || grup.customer?.assignedSalesId || verifierId, verifierId, createdAt,
  });
  let jurnal;
  if (mode === "REKENING") {
    jurnal = await bukukanPembayaran(tx, { paymentId: tulis.payment.id, userId: verifierId });
    if (!jurnal.posted) {
      throw new ResiBayarError("Pembayaran ini belum bisa dicatat karena ada pengaturan akun keuangan yang belum lengkap (lihat menu Data Belum Lengkap). Belum ada yang tersimpan.", 422, "JURNAL_BELUM_BISA");
    }
  } else {
    jurnal = await jurnalSebelumSaldoAwalResi(tx, { payment: tulis.payment, alokasi: tulis.alokasi, aktif, grup, tanggal, userId: verifierId });
  }

  const lunasPenuh = hitung.totalSisa - hitung.nominal <= 0;
  // SELALU menulis ulang baris grup (penuh ATAU sebagian) — bukan cuma saat melepas klaim. Ini yang membuat `versi` berguna: request lain
  // yang balapan dan membawa `versi` LAMA akan gagal cocok begitu verifikasi INI selesai, walau klaimnya masih aktif menunggu sisa.
  const grupBaru = await tx.orderGroup.update({
    where: { id: grup.id },
    data: lunasPenuh && grup.lunasDiklaimPada ? { lunasDiklaimPada: null, lunasDiklaimOlehId: null } : { lunasDiklaimPada: grup.lunasDiklaimPada },
    select: { updatedAt: true },
  });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: anchor.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: verifierId,
    metadata: {
      aksi: klaim ? "verifikasi_klaim_lunas_resi" : "verifikasi_penerimaan_resi", ...(klaim && { klaimId: klaim.id }), groupId: grup.id, mode, amount: String(hitung.nominal), method, cashAccount: rekening?.name ?? null,
      paymentId: tulis.payment.id, child: hitung.tulis.length, lunasPenuh, ...(jurnal?.tanpaJurnal && { tanpaJurnal: "semua child pra-pembukuan" }),
      ...(jurnal?.dilewati?.length && { childTanpaJurnal: jurnal.dilewati }),
    },
  });
  return {
    paymentId: tulis.payment.id, groupId: grup.id, versi: versiGrup(grupBaru), amount: hitung.nominal, mode, lunasPenuh, klaimDilepas: lunasPenuh,
    alokasi: hitung.tulis.map((a) => ({ orderId: a.orderId, orderNumber: a.orderNumber, jumlah: a.alokasi })),
    status: tulis.status, tanpaJurnal: !!jurnal?.tanpaJurnal,
  };
}

/**
 * Finance menyatakan uang Resi BELUM masuk: lepas klaim Resi. TIDAK menghapus status/pembayaran yang sah — child yang statusnya didukung ledger
 * tidak disentuh. Hanya child dengan klaim "Lunas" per order lama yang TIDAK didukung ledger yang statusnya dihitung ulang dari ledger.
 */
export async function tolakLunasResi(tx, { groupId, reason, userId }) {
  await pastikanAktif(tx);
  const alasan = String(reason ?? "").trim();
  if (!alasan) throw new ResiBayarError("Alasan wajib diisi", 400, "ALASAN_WAJIB");
  const { grup, anak } = await muatGrupResi(tx, groupId, { kunci: true });
  const { aktif } = pastikanGrupLayak(grup, anak);
  const perOrder = klaimPerOrder(aktif, await muatDibayar(tx, aktif), grup);
  if (!grup.lunasDiklaimPada && perOrder.length === 0) throw new ResiBayarError("Tidak ada klaim Lunas Resi yang bisa ditolak (sudah diverifikasi atau sudah ditolak)", 409, "TIDAK_ADA_KLAIM");
  if (grup.lunasDiklaimPada) await tx.orderGroup.update({ where: { id: grup.id }, data: { lunasDiklaimPada: null, lunasDiklaimOlehId: null } });
  const dipulihkan = [];
  for (const o of perOrder) dipulihkan.push({ orderId: o.id, orderNumber: o.orderNumber, ...(await recomputeOrderPaymentStatus(tx, o.id)) });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: grup.anchorOrderId, eventType: EVENT_TYPES.DOCUMENT_REJECTED, actorId: userId,
    metadata: { aksi: "tolak_lunas_resi", groupId: grup.id, reason: alasan, klaimResi: !!grup.lunasDiklaimPada, childDipulihkan: dipulihkan.map((d) => d.orderNumber || d.orderId) },
  });
  return { groupId: grup.id, klaimDilepas: !!grup.lunasDiklaimPada, childDipulihkan: dipulihkan };
}

/** Finance meminta bukti ke Sales atas klaim Lunas Resi: penanda + audit (event BUKTI_DIMINTA ber-groupId di anchor). Tidak mengubah apa pun. */
export async function mintaBuktiResi(tx, { groupId, catatan = null, userId }) {
  await pastikanAktif(tx);
  const { grup, anak } = await muatGrupResi(tx, groupId, { kunci: true });
  const { aktif } = pastikanGrupLayak(grup, anak);
  const dibayar = await muatDibayar(tx, aktif);
  if (!grup.lunasDiklaimPada && klaimPerOrder(aktif, dibayar, grup).length === 0) throw new ResiBayarError("Tidak ada klaim Lunas Resi yang perlu bukti", 409, "TIDAK_ADA_KLAIM");
  const teks = String(catatan ?? "").trim().slice(0, 300) || null;
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: grup.anchorOrderId, eventType: EVENT_TYPES.BUKTI_DIMINTA, actorId: userId,
    metadata: { aksi: "minta_bukti", groupId: grup.id, catatan: teks, orderNumber: aktif.find((o) => o.id === grup.anchorOrderId)?.orderNumber ?? null },
  });
  return { groupId: grup.id, catatan: teks };
}
