// RESI GABUNGAN — FASE 3B: batalkan SATU child dari Resi tanpa merusak payment/alokasi/invoice/pendapatan/child lain.
//
// PRINSIP (keputusan owner, dokumen: docs/RESI-GABUNGAN-FASE3.md):
//  - Flag RESI_PEMBATALAN_AKTIF (default MATI, fail-closed) — semua fungsi publik menolak 403 bila mati. Hanya group source BARU;
//    BACKFILL_BUNDLE dan order tunggal TIDAK tersentuh (tombol/alur ini tidak berlaku untuk keduanya).
//  - JALUR BARU DAN TERPISAH dari tombol "Batalkan Order"/dropdown status lama: checkCancelBlockers (routes/orders.js) TIDAK diubah dan
//    TETAP memblokir child beralokasi lewat jalur lama itu, tanpa memandang flag ini — supaya tidak ada dua pintu yang berperilaku beda
//    untuk aksi yang sama (jalur lama = "salah input", jalur ini = "pembatalan sadar-uang dengan realokasi/refund").
//  - TIDAK ADA Payment/FinPaymentAllocation/jurnal LAMA yang diedit atau dihapus. Koreksi HANYA lewat penulisan/rollback resmi:
//      • Uang yang masih outstanding di child lain → REALOKASI (setAllocations menulis ULANG baris alokasi payment yang bersangkutan;
//        Payment itu sendiri, dan baris alokasi child LAIN yang tidak disentuh, tidak berubah).
//      • Kelebihan yang tidak tertampung child aktif lain → FinRefund BARU (MENUNGGU_APPROVAL) ke order yang dibatalkan — memakai jalur
//        approve/posting Finance YANG SUDAH ADA (POST /api/finance/refunds/:id/approve), TIDAK diposting otomatis di sini. `sisaBisaDirefund`
//        = paidForOrder(child) memakai baris alokasi yang SENGAJA belum dipindah untuk porsi kelebihan (lihat batalkanChildResi).
//  - Revenue LAMA tidak pernah dihapus/dibalik di sini: kalau pendapatan child sudah diakui, postRefund (jalur approve yang sudah ada)
//    otomatis men-debit Retur & Potongan Penjualan (akun kontra-pendapatan) alih-alih Uang Muka — itulah "workflow pembatalan pendapatan
//    existing" yang dimaksud; tidak ada kode tambahan yang dibutuhkan di sini untuk itu.
//  - Anchor & ongkir: kalau child yang dibatalkan adalah ANCHOR, child aktif berikutnya (id naik, deterministik) jadi anchor baru; Ongkir
//    Tambahan (Order.ongkir) dipindah TEPAT SEKALI; invoice bundle primary ikut dipindah dalam transaksi yang sama.
//  - DP target grup + tiap child aktif dihitung ULANG dari total child aktif + ongkir tambahan (largest-remainder, sama pola Fase 1);
//    Payment yang SUDAH ADA tidak pernah disentuh oleh recompute ini.
//  - Urutan kunci: grup → child (id naik) → payment → refund/posting — SAMA dengan Fase 3A (services/finance/urutanKunci.js,
//    resiPembayaran.js#muatGrupResi). `versi` (updatedAt grup) dicocokkan ulang di bawah kunci untuk exactly-once (pola hardening 2).

import { prisma } from "../db.js";
import { bagiProporsional, DP_PERSEN } from "./resi.js";
import { paidForOrder, setAllocations, AllocationError } from "./finance/allocation.js";
import { getSettingRaw, parseBool, SETTING_KEYS } from "./finance/settings.js";
import { moneyToNumber, toMoney } from "./finance/money.js";
import { toBookDate, generateDocumentNumber, findEntryByKey, reverseJournal } from "./finance/journal.js";
import { bukukanUlangAlokasi } from "./finance/posting/reallocate.js";
import { recomputeOrderPaymentStatus } from "./paymentLedger.js";
import { tagihanOrder } from "./finance/tagihanOrder.js";
import {
  ResiBayarError, muatGrupResi, pastikanGrupLayak, versiGrup, muatDibayar,
} from "./resiPembayaran.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { KEY as KEY_ORDER } from "./finance/posting/orderRevenue.js";

export async function resiPembatalanAktif(db = prisma) {
  return parseBool(await getSettingRaw(db, SETTING_KEYS.RESI_PEMBATALAN_AKTIF));
}

async function pastikanAktif(db) {
  if (!(await resiPembatalanAktif(db))) throw new ResiBayarError("Pembatalan item Resi belum diaktifkan", 403, "RESI_PEMBATALAN_MATI");
}

/** Anak Resi ini SUDAH mengakui pendapatan (jurnal PENGAKUAN_PENDAPATAN terposting)? Informasi transparansi saja — tidak mengubah apa pun. */
async function pendapatanSudahDiakui(db, orderId) {
  const e = await findEntryByKey(db, KEY_ORDER.revenue(orderId));
  return !!e && e.status === "POSTED";
}

/** Order penerima seperti SETELAH pembatalan: anchor baru memegang Ongkir Tambahan grup (Order.ongkir), yang lain tidak berubah. */
function orderSetelahPembatalan(o, grup, anchorBaruId) {
  return anchorBaruId && o.id === anchorBaruId ? { ...o, ongkir: Number(grup.ongkirTambahan) || 0 } : o;
}

/**
 * Hitung dampak pembatalan SATU child — MURNI (tanpa menulis DB), dipakai BERSAMA oleh preview (baca-saja) dan eksekusi (di bawah kunci).
 * `dibayar` = Map orderId → Rupiah sudah tercatat (dari muatDibayar, TANPA gerbang verifikasi — sama konservatifnya dengan Fase 3A).
 */
export function hitungDampakPembatalan({ grup, anak, dibayar, childId }) {
  const aktif = anak.filter((o) => o.status !== "CANCELLED");
  const child = aktif.find((o) => o.id === childId);
  if (!child) throw new ResiBayarError("Order ini bukan child aktif dari Resi ini", 404, "CHILD_TIDAK_DITEMUKAN");

  const lain = aktif.filter((o) => o.id !== childId); // sudah terurut id naik (dari muatGrupResi)
  const tagihanChild = tagihanOrder(child, grup);
  const dibayarChild = Math.max(Number(dibayar.get(child.id)) || 0, 0);

  // Tagihan child TERSISA dihitung SETELAH pembatalan: bila child ini anchor, Ongkir Tambahan pindah ke anchor baru (child aktif berikutnya)
  // — kapasitas & tagihannya harus sudah memuatnya (tagihanOrder membaca Order.ongkir anchor). Tagihan child yang dibatalkan memakai keadaan ASLI.
  const isAnchor0 = child.id === grup.anchorOrderId;
  const grupSetelah = { ...grup, anchorOrderId: isAnchor0 ? (lain[0]?.id ?? null) : grup.anchorOrderId };
  const lainS = lain.map((o) => orderSetelahPembatalan(o, grup, isAnchor0 ? lain[0]?.id : null));
  const kapasitas = lainS.map((o) => ({
    orderId: o.id, orderNumber: o.orderNumber,
    cap: Math.max(tagihanOrder(o, grupSetelah) - Math.max(Number(dibayar.get(o.id)) || 0, 0), 0),
  }));
  const totalKapasitas = kapasitas.reduce((s, k) => s + k.cap, 0);
  const moveAmt = Math.min(dibayarChild, totalKapasitas);
  const kelebihan = dibayarChild - moveAmt;
  const bagi = bagiProporsional(moveAmt, kapasitas.map((k) => k.cap));
  const realokasi = kapasitas.map((k, i) => ({ ...k, tambahan: bagi[i] })).filter((r) => r.tambahan > 0);

  const isAnchor = child.id === grup.anchorOrderId;
  const anchorBaru = isAnchor ? (lain[0] ?? null) : null;
  const ongkirTambahan = Number(grup.ongkirTambahan) || 0;

  // Total & DP grup SETELAH pembatalan — dihitung ulang dari child aktif TERSISA (largest-remainder, pola sama Fase 1: resi.js#hitungRingkasanResi).
  // Ongkir tambahan tetap melekat pada tagihan anchor (baru atau lama, tergantung siapa anchor SETELAH pembatalan).
  const sisaAnchorId = anchorBaru?.id ?? (isAnchor ? null : grup.anchorOrderId);
  const nilaiLain = lain.map((o) => Number(o.value) || 0);
  const subtotalBaru = nilaiLain.reduce((s, v) => s + v, 0);
  const totalResiBaru = subtotalBaru + (lain.length > 0 ? ongkirTambahan : 0);
  const dpTargetBaru = Math.round((totalResiBaru * DP_PERSEN) / 100);
  const tagihanPerItemBaru = lain.map((o) => (Number(o.value) || 0) + (o.id === sisaAnchorId ? ongkirTambahan : 0));
  const dpPerItemBaru = bagiProporsional(dpTargetBaru, tagihanPerItemBaru);
  const dpChildBaru = lain.map((o, i) => ({ orderId: o.id, orderNumber: o.orderNumber, dpTarget: dpPerItemBaru[i] }));

  return {
    groupId: grup.id, childId: child.id, childOrderNumber: child.orderNumber,
    tagihanChild, dibayarChild, isAnchor,
    realokasi, totalDirealokasikan: moveAmt, kelebihan,
    anchorBaru: anchorBaru ? { orderId: anchorBaru.id, orderNumber: anchorBaru.orderNumber } : null,
    ongkirDipindah: isAnchor && anchorBaru ? ongkirTambahan : 0,
    grupKosong: lain.length === 0,
    totalResiBaru, dpTargetBaru, ongkirTambahan, dpChildBaru,
    anakAktifTersisa: lainS.map((o) => ({ orderId: o.id, orderNumber: o.orderNumber, tagihan: tagihanOrder(o, grupSetelah), dpTargetBaru: dpChildBaru.find((d) => d.orderId === o.id)?.dpTarget ?? 0 })),
  };
}

/** Pratinjau BACA-SAJA (tanpa kunci) untuk UI Finance/Admin — dampak lengkap SEBELUM konfirmasi. Server menghitung; frontend tidak menghitung sendiri. */
export async function pratinjauPembatalanResi(db, { orderId }) {
  await pastikanAktif(db);
  const order = await db.order.findUnique({ where: { id: orderId }, select: { groupId: true, group: { select: { source: true } } } });
  if (!order?.groupId || order.group?.source !== "BARU") {
    throw new ResiBayarError("Order ini bukan child Resi (group BARU) — pembatalan lewat jalur ini tidak berlaku, pakai tombol Batalkan Order biasa", 409, "BUKAN_CHILD_RESI_BARU");
  }
  const { grup, anak } = await muatGrupResi(db, order.groupId);
  pastikanGrupLayak(grup, anak);
  const dibayar = await muatDibayar(db, anak.filter((o) => o.status !== "CANCELLED"));
  const dampak = hitungDampakPembatalan({ grup, anak, dibayar, childId: orderId });
  const diakui = await pendapatanSudahDiakui(db, orderId);
  return { ...dampak, versi: versiGrup(grup), pendapatanSudahDiakui: diakui, dibaca: "pratinjau" };
}

/** Pindahkan invoice PRIMARY bundle ke `invoiceId` (anggota lama, termasuk primary lama, ikut dipindah menunjuk ke sini). No-op bila sudah primary. */
async function jadikanInvoicePrimary(tx, invoiceId) {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, combinedIntoId: true } });
  if (!inv || !inv.combinedIntoId) return; // sudah primary (atau berdiri sendiri) — tidak ada yang perlu dipindah
  const primaryLamaId = inv.combinedIntoId;
  const primaryLama = await tx.invoice.findUnique({ where: { id: primaryLamaId }, select: { bundledInvoices: { select: { id: true } } } });
  await tx.invoice.update({ where: { id: inv.id }, data: { combinedIntoId: null } });
  const lain = (primaryLama?.bundledInvoices ?? []).map((b) => b.id).filter((id) => id !== inv.id);
  await tx.invoice.updateMany({ where: { id: { in: [primaryLamaId, ...lain] } }, data: { combinedIntoId: inv.id } });
}

/**
 * Batalkan SATU child dari Resi: realokasi + refund + anchor/ongkir/invoice + DP target, dalam SATU transaksi. Pemanggil (route) WAJIB
 * menjalankan ini di dalam `db.$transaction` ATAU meneruskan `tx` — fungsi ini SENDIRI membuka transaksinya sendiri kalau `db` bukan tx aktif.
 */
export async function batalkanChildResi(db, { orderId, userId, alasan, refundCashAccountId = null, versi = null }) {
  await pastikanAktif(db);
  const teksAlasan = String(alasan ?? "").trim();
  if (!teksAlasan) throw new ResiBayarError("Alasan pembatalan wajib diisi", 400, "ALASAN_WAJIB");

  const order0 = await db.order.findUnique({ where: { id: orderId }, select: { groupId: true, group: { select: { source: true } }, status: true } });
  if (!order0?.groupId || order0.group?.source !== "BARU") {
    throw new ResiBayarError("Order ini bukan child Resi (group BARU) — pembatalan lewat jalur ini tidak berlaku, pakai tombol Batalkan Order biasa", 409, "BUKAN_CHILD_RESI_BARU");
  }

  return db.$transaction(async (tx) => {
    const { grup, anak } = await muatGrupResi(tx, order0.groupId, { kunci: true });
    if (versi != null && String(versi) !== String(versiGrup(grup))) {
      throw new ResiBayarError("Resi ini baru saja berubah dari tempat lain (mis. dua klik hampir bersamaan) — muat ulang lalu coba lagi.", 409, "VERSI_BERUBAH");
    }
    const { aktif } = pastikanGrupLayak(grup, anak);
    const child = aktif.find((o) => o.id === orderId);
    if (!child) throw new ResiBayarError("Order ini sudah dibatalkan atau bukan lagi child aktif Resi ini", 409, "CHILD_TIDAK_AKTIF");
    if (aktif.filter((o) => o.value > 0).length === 0) throw new ResiBayarError("Resi ini tidak punya order aktif bernilai", 409, "RESI_TANPA_ORDER_AKTIF");
    if (grup.lunasDiklaimPada) {
      throw new ResiBayarError("Resi ini sedang diklaim Lunas dan menunggu verifikasi Finance — tolak atau verifikasi klaimnya dulu sebelum membatalkan item", 409, "KLAIM_LUNAS_AKTIF");
    }

    const dibayar = await muatDibayar(tx, aktif);
    const dampak = hitungDampakPembatalan({ grup, anak, dibayar, childId: orderId });

    const anchorBaruId = dampak.isAnchor ? (dampak.anchorBaru?.orderId ?? null) : null;
    const grupSetelah = { ...grup, anchorOrderId: dampak.isAnchor ? anchorBaruId : grup.anchorOrderId };

    // ── 1) Realokasi: pindahkan bagian yang MASIH bisa ditampung child aktif lain, per Payment yang menyentuh child ini ──────────────────
    if (dampak.totalDirealokasikan > 0) {
      const alokasiChild = await tx.finPaymentAllocation.findMany({
        where: { orderId, payment: { cancelledAt: null } },
        select: { paymentId: true, amount: true },
        orderBy: { paymentId: "asc" }, // deterministik
      });
      let sisaDipindah = dampak.totalDirealokasikan;
      // Kapasitas LIVE per child aktif lain — dipakai bersama lintas payment dalam loop ini supaya tidak ada child yang menerima dua kali
      // untuk kapasitas yang sama (dihitung ULANG dari ledger tiap iterasi, mencerminkan setAllocations payment SEBELUMNYA di loop ini).
      for (const a of alokasiChild) {
        if (sisaDipindah <= 0) break;
        const amtDariPayment = Math.min(moneyToNumber(a.amount), sisaDipindah);
        if (amtDariPayment <= 0) continue;
        const kapasitasLive = [];
        for (const o of aktif) {
          if (o.id === orderId) continue;
          const dibayarLive = moneyToNumber(await paidForOrder(tx, o.id, { enabled: false }));
          kapasitasLive.push({ orderId: o.id, cap: Math.max(tagihanOrder(orderSetelahPembatalan(o, grup, anchorBaruId), grupSetelah) - dibayarLive, 0) });
        }
        const totalCapLive = kapasitasLive.reduce((s, k) => s + k.cap, 0);
        const dipindahDariPaymentIni = Math.min(amtDariPayment, totalCapLive);
        if (dipindahDariPaymentIni <= 0) continue;
        const bagiLive = bagiProporsional(dipindahDariPaymentIni, kapasitasLive.map((k) => k.cap));

        const rowsLama = await tx.finPaymentAllocation.findMany({ where: { paymentId: a.paymentId }, select: { orderId: true, amount: true } });
        const peta = new Map(rowsLama.map((r) => [r.orderId, moneyToNumber(r.amount)]));
        const amountAslikeChild = peta.get(orderId) || 0;
        const sisaDiChild = Math.max(amountAslikeChild - dipindahDariPaymentIni, 0); // porsi payment INI yang TETAP di child (kelebihan, ditangani refund)
        peta.set(orderId, sisaDiChild); // dikurangi, TIDAK dihapus — porsi kelebihan tetap tercatat di child agar sisaBisaDirefund tetap benar
        kapasitasLive.forEach((k, i) => { if (bagiLive[i] > 0) peta.set(k.orderId, (peta.get(k.orderId) || 0) + bagiLive[i]); });
        const alokasiBaru = [...peta.entries()].filter(([, amt]) => amt > 0).map(([oid, amt]) => ({ orderId: oid, amount: amt }));
        try {
          await setAllocations(tx, { paymentId: a.paymentId, allocations: alokasiBaru, userId });
        } catch (e) {
          if (e instanceof AllocationError) throw new ResiBayarError(e.message, e.statusCode || 409, "REALOKASI_DITOLAK");
          throw e;
        }
        // Jurnal penerimaan payment ini memuat Cr per alokasi (Piutang/Uang Muka per order) — ikuti alokasi BARU lewat reversal + posting ulang
        // resmi (pola rute realokasi manual); jurnal lama tidak diedit, hanya berstatus REVERSED.
        const jurnalLama = await findEntryByKey(tx, KEY_ORDER.payment(a.paymentId));
        if (jurnalLama && jurnalLama.status === "POSTED") {
          await reverseJournal(tx, { entryId: jurnalLama.id, reason: `Realokasi pembatalan item Resi — ${teksAlasan}`.slice(0, 500), userId });
          await bukukanUlangAlokasi(tx, { paymentId: a.paymentId, userId });
        }
        sisaDipindah -= dipindahDariPaymentIni;
      }
    }

    // ── 2) Kelebihan yang tidak tertampung → FinRefund BARU (MENUNGGU_APPROVAL). Baris alokasi child untuk porsi ini SENGAJA tidak
    //    dihapus (lihat langkah 1) — paidForOrder(child) tetap mencerminkan porsi ini sampai refund disetujui (postRefund via approve
    //    yang sudah ada), setelahnya paidForOrder otomatis nol karena refund DISETUJUI ikut dikurangkan (allocation.js#paidForOrder).
    let refund = null;
    if (dampak.kelebihan > 0) {
      if (!refundCashAccountId) {
        throw new ResiBayarError(`Ada kelebihan Rp${dampak.kelebihan.toLocaleString("id-ID")} yang tidak bisa dipindahkan ke order lain — pilih rekening sumber pengembalian`, 400, "REKENING_REFUND_WAJIB");
      }
      const rekening = await tx.finCashAccount.findUnique({ where: { id: String(refundCashAccountId) }, select: { id: true, active: true } });
      if (!rekening || !rekening.active) throw new ResiBayarError("Rekening sumber pengembalian tidak valid atau sudah nonaktif", 400, "REKENING_TIDAK_VALID");
      const tgl = toBookDate(new Date().toISOString().slice(0, 10));
      refund = await tx.finRefund.create({
        data: {
          refundNumber: await generateDocumentNumber(tx, "RFD", tgl),
          orderId, date: tgl, amount: toMoney(dampak.kelebihan), reason: `Pembatalan item Resi — ${teksAlasan}`.slice(0, 500),
          cashAccountId: rekening.id, status: "MENUNGGU_APPROVAL", createdById: userId,
        },
      });
    }

    // ── 3) Anchor & ongkir & invoice bundle ─────────────────────────────────────────────────────────────────────────────────────────────
    if (dampak.isAnchor) {
      if (dampak.anchorBaru) {
        await tx.order.update({ where: { id: dampak.anchorBaru.orderId }, data: { ongkir: dampak.ongkirDipindah } });
        await tx.order.update({ where: { id: orderId }, data: { ongkir: null } });
        const anchorLamaInvoice = await tx.invoice.findUnique({ where: { orderId }, select: { id: true } });
        const anchorBaruInvoice = await tx.invoice.findUnique({ where: { orderId: dampak.anchorBaru.orderId }, select: { id: true } });
        if (anchorLamaInvoice && anchorBaruInvoice) await jadikanInvoicePrimary(tx, anchorBaruInvoice.id);
      }
      await tx.orderGroup.update({ where: { id: grup.id }, data: { anchorOrderId: anchorBaruId } });
    }

    // ── 4) DP target grup + child aktif tersisa (recompute; Payment yang sudah ada TIDAK disentuh) ────────────────────────────────────
    await tx.orderGroup.update({ where: { id: grup.id }, data: { dpTarget: dampak.dpTargetBaru } });
    for (const d of dampak.dpChildBaru) {
      await tx.order.update({ where: { id: d.orderId }, data: { dpTarget: d.dpTarget } });
    }

    // ── 5) Batalkan child (status TERAKHIR — semua penghitungan di atas memakai status AKTIF child ini) ────────────────────────────────
    await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED", statusLocked: true, statusOverrideById: userId, statusOverrideAt: new Date(), statusOverrideNote: `Batal item Resi — ${teksAlasan}`.slice(0, 500) },
    });
    await tx.orderStatusTransition.create({ data: { orderId, fromStatus: child.status, toStatus: "CANCELLED", changedById: userId } });

    // Status bayar/paidAt child penerima dihitung ulang SETELAH anchor/ongkir/DP final (dasar status = tagihan anchor baru); dasar komisi ikut benar.
    for (const o of aktif) if (o.id !== orderId) await recomputeOrderPaymentStatus(tx, o.id);

    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: userId,
      metadata: {
        aksi: "batal_item_resi", groupId: grup.id, reason: teksAlasan, dibayarChild: String(dampak.dibayarChild),
        direalokasikan: String(dampak.totalDirealokasikan), kelebihan: String(dampak.kelebihan), refundId: refund?.id ?? null,
        anchorBaru: dampak.anchorBaru?.orderId ?? null, grupKosong: dampak.grupKosong,
      },
    });

    const grupBaru = await tx.orderGroup.findUnique({ where: { id: grup.id }, select: { updatedAt: true } });
    return {
      orderId, groupId: grup.id, versi: grupBaru ? versiGrup(grupBaru) : null,
      realokasi: dampak.realokasi, totalDirealokasikan: dampak.totalDirealokasikan,
      kelebihan: dampak.kelebihan, refundId: refund?.id ?? null, refundNumber: refund?.refundNumber ?? null,
      anchorBaru: dampak.anchorBaru, ongkirDipindah: dampak.ongkirDipindah, grupKosong: dampak.grupKosong,
      totalResiBaru: dampak.totalResiBaru, dpTargetBaru: dampak.dpTargetBaru, dpChildBaru: dampak.dpChildBaru,
    };
  }, { maxWait: 15_000, timeout: 60_000 });
}
