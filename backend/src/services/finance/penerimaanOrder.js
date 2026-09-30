// PENERIMAAN ORDER — "sales klik Lunas" → finance memverifikasi.
//
// MASALAH ASLI (19 Sep 2026): sales menandai order LUNAS lewat dropdown di CRM
// (PATCH /orders/:id, paymentStatus) tanpa membuat catatan pembayaran. Dari 362
// order berstatus LUNAS, hanya 1 yang punya Payment. Akibatnya (1) halaman
// Pembayaran & Verifikasi kosong — tidak ada yang bisa diverifikasi — dan
// (2) buku besar tetap menganggap order itu piutang (pendapatan sudah diakui,
// uangnya tidak pernah dijurnal), jadi order lunas masih muncul di Piutang.
//
// DESAINNYA — alur sales TIDAK diubah sama sekali (status & paidAt, dasar
// komisi, tetap seperti sekarang). Yang ditambahkan: antrean TURUNAN dari data
// ("LUNAS di CRM tapi uang masuknya belum tercatat"), tanpa menyalin status ke
// tabel lain. Finance memverifikasinya: pilih rekening tujuan (SANOBANK Kemal /
// PT Sano / …), lampirkan foto bukti, dan sistem membuat Payment + verifikasi +
// jurnal dalam SATU transaksi. Kalau uangnya ternyata belum masuk, finance
// menolak dan status order dikembalikan (komisi ikut batal karena paidAt null).
//
// DUA JALUR JURNAL:
//  • REKENING (uang diterima SETELAH tanggal saldo awal): jalur normal —
//    Dr Kas/Bank, Cr Piutang (atau Uang Muka kalau belum diserahkan).
//  • SEBELUM_SALDO_AWAL (uang diterima sebelum 18 Sep 2026): kas bank asli
//    sudah mengandung uang itu dan saldo sistem sudah disamakan lewat
//    penyesuaian SALDO_AWAL (lawannya Laba Ditahan). Menjurnalnya ke rekening
//    lagi akan menggandakan kas, jadi piutangnya diselesaikan LANGSUNG ke Laba
//    Ditahan: Dr Laba Ditahan, Cr Piutang/Uang Muka. Kas tidak berubah.
//    KHUSUS order yang SUDAH diserahkan tapi pendapatannya TIDAK PERNAH diakui
//    di buku (riwayat sebelum pembukuan dimulai — 329 order, Rp824 juta per 19
//    Sep 2026): tidak ada piutang yang perlu ditutup dan menjurnalnya ke Uang
//    Muka akan menciptakan kewajiban palsu. Pembayarannya tetap dicatat &
//    terverifikasi, TANPA jurnal.

import { recomputeOrderPaymentStatus } from "../paymentLedger.js";
import { kunciKanonis } from "./urutanKunci.js";
import { PILIH_TAGIHAN, dasarStatusBayar } from "./tagihanOrder.js";
import { paidForOrder } from "./allocation.js";
import { getVerificationGate } from "./settings.js";
import { tanggalCutoff, tanggalWIB } from "./cutoff.js";
import { bukukanPembayaran } from "./hooks.js";
import { postJournal, findEntryByKey, toBookDate } from "./journal.js";
import { resolveAccount, SYSTEM_KEYS } from "./accounts.js";
import { toMoney, moneyToNumber, ZERO } from "./money.js";
import { KEY as KEY_ORDER, STATUS_PENGAKUAN } from "./posting/orderRevenue.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";
import { resiPembayaranAktif, pastikanBukanAnakResiAktif } from "../resiPembayaran.js";

function err(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export { tanggalCutoff };

/**
 * Order LUNAS di CRM yang uang masuknya belum (penuh) tercatat sebagai Payment.
 * `sisa` = nilai order dikurangi yang sudah tercatat (rumus yang SAMA dengan
 * status bayar di CRM: paidForOrder — alokasi, gerbang, dan refund ikut).
 */
export async function daftarLunasBelumDicatat(db) {
  // Resi Gabungan Fase 3A: saat pembayaran Resi AKTIF, child dari Resi BARU tampil sebagai SATU antrean Resi (penerimaanResi.js), bukan baris per order.
  // Flag MATI / groupId NULL / group BACKFILL_BUNDLE: daftar ini IDENTIK dengan perilaku lama.
  const resiOn = await resiPembayaranAktif(db);
  const [orders, gate, cutoff] = await Promise.all([
    db.order.findMany({
      where: { paymentStatus: "LUNAS", value: { gt: 0 }, status: { not: "CANCELLED" }, ...(resiOn && { OR: [{ groupId: null }, { group: { source: { not: "BARU" } } }] }) },
      select: {
        ...PILIH_TAGIHAN,
        id: true, orderNumber: true, value: true, paidAt: true, status: true, createdAt: true,
        customer: { select: { id: true, name: true, assignedSales: { select: { id: true, name: true } } } },
        _count: { select: { payments: true } },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      take: 2000,
    }),
    getVerificationGate(db),
    tanggalCutoff(db),
  ]);

  const ids = orders.map((o) => o.id);
  const adaAlokasi = new Set(
    (await db.finPaymentAllocation.findMany({ where: { orderId: { in: ids } }, select: { orderId: true }, distinct: ["orderId"] }))
      .map((a) => a.orderId)
  );

  // Permintaan bukti terbaru dari Finance per order (event BUKTI_DIMINTA). Hanya yang lebih baru dari saat order ditandai lunas yang berlaku.
  const eventBukti = ids.length
    ? await db.activityEvent.findMany({
      where: { entityType: ENTITY_TYPES.ORDER, eventType: EVENT_TYPES.BUKTI_DIMINTA, entityId: { in: ids } },
      orderBy: { createdAt: "desc" }, select: { entityId: true, createdAt: true, metadata: true, actorId: true },
    })
    : [];
  const buktiTerbaru = new Map();
  for (const ev of eventBukti) if (!buktiTerbaru.has(ev.entityId)) buktiTerbaru.set(ev.entityId, ev);

  const items = [];
  for (const o of orders) {
    let dibayar = ZERO;
    // Order tanpa Payment & tanpa alokasi pasti Rp0 — lewati query per-order.
    if (o._count.payments > 0 || adaAlokasi.has(o.id)) dibayar = await paidForOrder(db, o.id, gate);
    // Pembanding KANONIS (services/finance/tagihanOrder.js): order tunggal = value (tidak berubah); child Resi BARU = value + ongkir anchor.
    const sisa = toMoney(dasarStatusBayar(o)).minus(dibayar);
    if (sisa.lessThanOrEqualTo(0)) continue;

    const tglLunas = o.paidAt ? tanggalWIB(o.paidAt) : null;
    items.push({
      orderId: o.id, orderNumber: o.orderNumber, orderStatus: o.status,
      customerId: o.customer?.id || null, customerName: o.customer?.name || "—",
      salesName: o.customer?.assignedSales?.name || null,
      nilaiOrder: dasarStatusBayar(o), sudahDicatat: moneyToNumber(dibayar), sisa: moneyToNumber(sisa),
      lunasSejak: tglLunas,
      // Tanpa paidAt (order lama sebelum 30 Agt 2026) tidak ada bukti kapan
      // uangnya masuk — perlakukan sebagai lama.
      kelompok: !tglLunas || tglLunas < cutoff ? "LAMA" : "BARU",
      buktiDiminta: (() => {
        const ev = buktiTerbaru.get(o.id);
        if (!ev || (o.paidAt && ev.createdAt < o.paidAt)) return null; // sales menandai lunas lagi setelah permintaan → permintaan lama tidak berlaku
        return { pada: ev.createdAt.toISOString(), catatan: ev.metadata?.catatan ?? null };
      })(),
    });
  }

  const ringkas = (baris) => ({ jumlah: baris.length, total: baris.reduce((s, i) => s + i.sisa, 0) });
  return {
    cutoff,
    items,
    semua: ringkas(items),
    baru: ringkas(items.filter((i) => i.kelompok === "BARU")),
    lama: ringkas(items.filter((i) => i.kelompok === "LAMA")),
  };
}

/**
 * FINANCE MEMINTA BUKTI atas klaim "Lunas" dari Sales. Hanya penanda + jejak audit (event BUKTI_DIMINTA); TIDAK mengubah status order,
 * tidak membuat Payment, tidak menyentuh jurnal/saldo. Klaim tetap ada di Perlu Verifikasi Finance dengan penanda "Bukti diminta".
 */
export async function mintaBukti(tx, { orderId, catatan = null, userId }) {
  await pastikanBukanAnakResiAktif(tx, orderId); // child Resi (flag aktif) diproses lewat alur Resi
  await kunciKanonis(tx, { orderIds: [orderId] }); // urutan kunci kanonis: grup → order
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { ...PILIH_TAGIHAN, orderNumber: true, paymentStatus: true } });
  if (!order) throw err("Order tidak ditemukan", 404);
  if (order.paymentStatus !== "LUNAS") throw err(`Order ${order.orderNumber} tidak lagi berstatus Lunas di CRM — tidak ada klaim yang perlu bukti`, 409);
  const gate = await getVerificationGate(tx);
  const dibayar = await paidForOrder(tx, orderId, gate);
  if (toMoney(order.value).greaterThan(0) && dibayar.greaterThanOrEqualTo(toMoney(dasarStatusBayar(order)))) {
    throw err(`Order ${order.orderNumber} sudah tercatat lunas oleh pembayaran terverifikasi — tidak perlu meminta bukti`, 409);
  }
  const teks = String(catatan ?? "").trim().slice(0, 300) || null;
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.BUKTI_DIMINTA, actorId: userId,
    metadata: { aksi: "minta_bukti", orderNumber: order.orderNumber, catatan: teks },
  });
  return { orderNumber: order.orderNumber, catatan: teks };
}

async function pendapatanSudahDiakui(tx, orderId) {
  const e = await findEntryByKey(tx, KEY_ORDER.revenue(orderId));
  return !!e && e.status === "POSTED";
}

/**
 * Verifikasi penerimaan uang untuk satu order LUNAS: buat Payment, tandai
 * terverifikasi, dan jurnalkan. SATU transaksi — kalau salah satu gagal, tidak
 * ada yang tersisa setengah jalan.
 *
 *   mode "REKENING"            butuh cashAccountId; jurnal ke kas/bank.
 *   mode "SEBELUM_SALDO_AWAL"  tanpa rekening; jurnal ke Laba Ditahan.
 */
export async function verifikasiPenerimaan(tx, { orderId, mode, method = "TRANSFER", cashAccountId = null, date = null, amount = null, proofPhotoUrl = null, proofPhotoUrls = null, verifierId }) {
  // Bukti bisa BANYAK foto (30 Sep 2026): daftar unik, foto pertama juga disimpan di proofPhotoUrl (kompatibilitas pembaca lama).
  const bukti = [...new Set([proofPhotoUrl, ...(Array.isArray(proofPhotoUrls) ? proofPhotoUrls : [])].filter(Boolean))];
  if (!["REKENING", "SEBELUM_SALDO_AWAL"].includes(mode)) throw err("Pilihan \"uangnya masuk ke mana\" tidak dikenali");
  if (!["CASH", "TRANSFER", "QRIS", "CARD"].includes(method)) throw err("Cara bayar tidak dikenali");
  await pastikanBukanAnakResiAktif(tx, orderId); // child Resi (flag aktif) diproses lewat alur Resi

  // S5: kunci baris order SEBELUM membaca sisa. Tanpa ini dua verifikasi paralel (dua tap / dua perangkat / kunci
  // idempotensi berbeda) sama-sama melihat sisa penuh dan membuat DUA Payment untuk satu order lunas.
  await kunciKanonis(tx, { orderIds: [orderId] }); // urutan kunci kanonis: grup → order (payment baru dibuat sesudahnya)
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      ...PILIH_TAGIHAN,
      id: true, orderNumber: true, value: true, paymentStatus: true, paidAt: true, customerId: true, status: true,
      customer: { select: { name: true, assignedSalesId: true } },
    },
  });
  if (!order) throw err("Order tidak ditemukan", 404);
  if (order.paymentStatus !== "LUNAS") throw err(`Order ${order.orderNumber} sudah tidak berstatus Lunas di CRM (mungkin baru diubah sales). Muat ulang halaman ini.`, 409);

  const gate = await getVerificationGate(tx);
  const sisa = toMoney(dasarStatusBayar(order)).minus(await paidForOrder(tx, orderId, gate));
  if (sisa.lessThanOrEqualTo(0)) throw err(`Order ${order.orderNumber} sudah tercatat lunas penuh, tidak ada yang perlu diverifikasi lagi`, 409);
  const nominal = amount === null || amount === "" || amount === undefined ? sisa : toMoney(amount, { field: "Nominal" });
  if (nominal.lessThanOrEqualTo(0)) throw err("Nominal harus lebih dari 0");
  if (nominal.greaterThan(sisa)) throw err(`Nominal terlalu besar. Yang masih perlu dicek untuk order ini hanya Rp${Number(sisa).toLocaleString("id-ID")}`);

  const tglStr = date || (order.paidAt ? tanggalWIB(order.paidAt) : tanggalWIB(new Date()));
  // Uang yang diterima SEBELUM tanggal saldo awal sudah ada di saldo bank asli (lewat penyesuaian SALDO_AWAL). Menjurnalnya ke rekening
  // lagi menggandakan kas — kasus nyata: Wilson (3 Sep, PT Sano) & 1 lain. Jadi pembayaran lama SELALU diperlakukan "sebelum saldo awal"
  // di server, apa pun mode yang dikirim klien (verifikasi massal, klien lama, salah pilih). Verifikasi tidak boleh mengubah saldo.
  const cutoff = await tanggalCutoff(tx);
  const dialihkan = mode === "REKENING" && tglStr < cutoff;
  const modeEfektif = dialihkan ? "SEBELUM_SALDO_AWAL" : mode;

  // Rekening WAJIB untuk mode Rekening. Untuk "sebelum saldo awal" rekening OPSIONAL: hanya dicatat pada Payment sebagai KETERANGAN (rekening mana yang
  // menerima uangnya dulu) — tidak ada jurnal Bank/Kas, saldo tidak berubah (permintaan Owner 30 Sep 2026: order sebelum 18 Sep tidak pernah punya rekening).
  let rekening = null;
  if (modeEfektif === "REKENING" && !cashAccountId) throw err("Pilih dulu uangnya masuk ke rekening mana");
  if (cashAccountId) {
    rekening = await tx.finCashAccount.findUnique({ where: { id: cashAccountId }, select: { id: true, name: true, accountId: true, active: true } });
    if (!rekening || !rekening.active) throw err("Rekening itu tidak ditemukan atau sudah tidak dipakai", 404);
  }

  const tanggal = toBookDate(tglStr);
  // createdAt = tanggal uang diterima (jam 12 WIB): postPaymentReceived memakainya
  // sebagai tanggal buku, jadi uang kemarin tetap masuk buku kemarin.
  const createdAt = new Date(Date.UTC(tanggal.getUTCFullYear(), tanggal.getUTCMonth(), tanggal.getUTCDate(), 5));

  const payment = await tx.payment.create({
    data: {
      orderId, amount: Math.round(Number(nominal)), method,
      proofPhotoUrl: bukti[0] || null,
      proofPhotoUrls: bukti,
      cashAccountId: rekening?.id || null,
      // Yang mencatat = sales pemilik lead (dialah yang melapor lunas); finance
      // yang memverifikasi. Dua orang berbeda = kontrol yang berarti.
      recordedById: order.customer?.assignedSalesId || verifierId,
      createdAt,
    },
  });
  await tx.paymentVerification.create({ data: { paymentId: payment.id, verifiedById: verifierId } });
  const hasilStatus = await recomputeOrderPaymentStatus(tx, orderId, { paidAtSinkron: true }); // tanggal lunas final = tanggal Payment terverifikasi (paymentLedger.js)
  if (hasilStatus?.paidAtDisinkron) {
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: verifierId,
      metadata: { aksi: "paid_at_disinkron", sebab: "verifikasi_penerimaan", paymentId: payment.id, dari: hasilStatus.paidAtDisinkron.dari, ke: hasilStatus.paidAtDisinkron.ke, pindahBulan: hasilStatus.paidAtDisinkron.pindahBulan },
    });
  }
  let jurnalDilewati = false;

  if (modeEfektif === "REKENING") {
    const hasil = await bukukanPembayaran(tx, { paymentId: payment.id, userId: verifierId });
    if (!hasil.posted) {
      throw err("Pembayaran ini belum bisa dicatat karena ada pengaturan akun keuangan yang belum lengkap (lihat menu Data Belum Lengkap). Belum ada yang tersimpan.", 422);
    }
  } else {
    const diakui = await pendapatanSudahDiakui(tx, orderId);
    const praPembukuan = !diakui && STATUS_PENGAKUAN.includes(order.status);
    if (praPembukuan) {
      jurnalDilewati = true;
    } else {
    const [laba, piutang, uangMuka] = await Promise.all([
      resolveAccount(tx, SYSTEM_KEYS.LABA_DITAHAN),
      resolveAccount(tx, SYSTEM_KEYS.PIUTANG_USAHA),
      resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_PELANGGAN),
    ]);
    await postJournal(tx, {
      date: tanggal,
      description: `Pelunasan order ${order.orderNumber} — ${order.customer?.name || ""} (diterima sebelum saldo awal)`.trim(),
      source: "PEMBAYARAN_ORDER",
      sourceId: payment.id,
      // Kunci yang SAMA dengan jurnal pembayaran biasa: pembatalan pembayaran
      // (batalkanJurnalPembayaran) otomatis membalik jurnal ini juga.
      idempotencyKey: `PEMBAYARAN_ORDER:${payment.id}`,
      userId: verifierId,
      lines: [
        { accountId: laba.id, debit: nominal, description: "Kas sudah tercermin di saldo awal (penyesuaian 18 Sep 2026)", orderId },
        {
          accountId: diakui ? piutang.id : uangMuka.id, credit: nominal, orderId, customerId: order.customerId,
          description: diakui ? `Pelunasan piutang order ${order.orderNumber}` : `Uang muka pelanggan — order ${order.orderNumber}`,
        },
      ],
    });
    }
  }

  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: verifierId,
    metadata: {
      aksi: "verifikasi_penerimaan", mode: modeEfektif, ...(dialihkan && { modeDikirim: mode, dialihkan: "tanggal uang diterima sebelum saldo awal — tidak menambah saldo" }), orderNumber: order.orderNumber, amount: String(nominal),
      method, cashAccount: rekening?.name || null, paymentId: payment.id,
      ...(jurnalDilewati && { tanpaJurnal: "pendapatan order ini tidak pernah diakui di buku (pra-pembukuan)" }),
    },
  });
  return { paymentId: payment.id, orderNumber: order.orderNumber, amount: moneyToNumber(nominal), tanpaJurnal: jurnalDilewati, sebelumSaldoAwal: modeEfektif === "SEBELUM_SALDO_AWAL", dialihkan };
}

/**
 * Finance menyatakan uangnya BELUM masuk: status order dikembalikan (DP kalau
 * sudah ada pembayaran tercatat, kalau tidak Belum Bayar) dan paidAt dikosongkan
 * — komisi sales atas order ini ikut batal karena dasarnya paidAt.
 */
export async function tolakLunas(tx, { orderId, reason, userId }) {
  if (!reason?.trim()) throw err("Alasan wajib diisi");
  await pastikanBukanAnakResiAktif(tx, orderId); // child Resi (flag aktif) diproses lewat alur Resi
  await kunciKanonis(tx, { orderIds: [orderId] }); // S5: serialkan dengan verifikasi paralel — urutan kunci kanonis grup → order
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { ...PILIH_TAGIHAN, orderNumber: true, paymentStatus: true } });
  if (!order) throw err("Order tidak ditemukan", 404);
  if (order.paymentStatus !== "LUNAS") throw err(`Order ${order.orderNumber} sudah tidak berstatus Lunas di CRM`, 409);

  const gate = await getVerificationGate(tx);
  const dibayar = await paidForOrder(tx, orderId, gate);
  // S5: kalau buku sudah mencatat pembayaran yang melunasi order (mis. baru saja diverifikasi Finance lain), menandainya
  // "belum lunas" membuat status CRM bertentangan dengan ledger. Yang salah dibatalkan/ditolak adalah Payment-nya.
  if (toMoney(order.value).greaterThan(0) && dibayar.greaterThanOrEqualTo(toMoney(dasarStatusBayar(order)))) {
    throw err(`Order ${order.orderNumber} sudah tercatat lunas penuh oleh pembayaran yang terverifikasi. Untuk membatalkan, tolak pembayarannya.`, 409);
  }
  const baru = dibayar.greaterThan(0) ? "DP" : "BELUM_BAYAR";
  await tx.order.update({ where: { id: orderId }, data: { paymentStatus: baru, paidAt: null } });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.DOCUMENT_REJECTED, actorId: userId,
    metadata: { aksi: "tolak_lunas", orderNumber: order.orderNumber, reason: reason.trim(), statusBaru: baru },
  });
  return { orderNumber: order.orderNumber, statusBaru: baru };
}

/** Hitung ringkas untuk dashboard (tanpa memuat seluruh daftar ke UI). */
export async function ringkasLunasBelumDicatat(db) {
  const d = await daftarLunasBelumDicatat(db);
  return { jumlah: d.semua.jumlah, total: d.semua.total, baru: d.baru, lama: d.lama, cutoff: d.cutoff };
}
