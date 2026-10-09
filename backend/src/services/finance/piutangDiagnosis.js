// DIAGNOSIS PIUTANG — menjelaskan KENAPA tiap order punya saldo di akun Piutang Usaha dan apa yang harus dilakukan. Hanya MEMBACA (tidak menulis apa pun).
//
// Kenapa ada: umurPiutang() (reports.js) hanya memperlihatkan order yang berstatus belum lunas di CRM; order LUNAS-di-CRM yang saldonya masih terbuka
// hanya muncul sebagai satu angka "menungguVerifikasi", dan order bersaldo KREDIT tidak muncul sama sekali — jadi saldo neraca tidak bisa dijelaskan
// baris demi baris. Fungsi ini mengelompokkan SEMUA order bersaldo (positif maupun negatif) ke satu kategori dengan alasan + tindakan, dan menjumlahkannya
// kembali ke saldo neraca (rekonsiliasi). Kontrak umurPiutang() TIDAK diubah — dipakai export, dashboard, dan klien mobile.
//
// KATEGORI (urutan prioritas):
//   ORDER_DIBATALKAN         order sudah DIBATALKAN tetapi jurnal pengakuannya belum dibalik → piutang semu (normalnya otomatis dibalik saat pembatalan; ini sisa pembatalan lama).
//   NILAI_BEDA_PENGAKUAN     pendapatan diakui SEKALI saat order diserahkan (postRevenueRecognition idempoten); kalau nilai order diedit sesudahnya, jurnal
//                            TIDAK ikut berubah → saldo piutang menyimpang sebesar selisih nilai.
//   KREDIT_LAINNYA           saldo kredit tanpa selisih nilai (lebih bayar / refund / alokasi) — perlu diperiksa manual.
//   LUNAS_TANPA_PAYMENT      CRM menandai LUNAS, belum ada Payment aktif sama sekali; pendapatan sudah diakui → buku masih mencatat piutang.
//   PAYMENT_BELUM_MENUTUP    Payment aktif ada (≥ nilai) tetapi tidak ada jurnal yang menutup piutang order ini.
//   TAGIHAN_SAH              belum bayar / DP; pendapatan sudah diakui → memang tagihan yang harus ditagih.
import { STATUS_DIHITUNG, todayBookDateWIB } from "./journal.js";
import { toMoney, moneyToNumber } from "./money.js";
import { PILIH_TAGIHAN, tagihanOrder, resiBaru } from "./tagihanOrder.js";
import { STATUS_PENGAKUAN } from "./posting/orderRevenue.js";
import { tanggalCutoff, sebelumCutoff, tampilCutoff } from "./cutoff.js";
import { catatanLaporan } from "./reports.js";

/** Kunci idempoten jurnal penyesuaian pengakuan pendapatan (scripts/penyesuaianPengakuanPendapatan.js): "<prefix><orderId>:<tagihan>". Ikut dihitung sebagai "diakui". */
export const PREFIX_KUNCI_PENYESUAIAN = "PENYESUAIAN_PENGAKUAN:";

export const KATEGORI_PIUTANG = Object.freeze({
  ORDER_DIBATALKAN: { label: "Order dibatalkan, piutang belum dibalik", tingkat: "koreksi" },
  TAGIHAN_SAH: { label: "Tagihan sah", tingkat: "tagih" },
  LUNAS_TANPA_PAYMENT: { label: "Lunas di CRM, belum ada pembayaran", tingkat: "periksa" },
  PAYMENT_BELUM_MENUTUP: { label: "Pembayaran belum menutup piutang", tingkat: "periksa" },
  NILAI_BEDA_PENGAKUAN: { label: "Nilai order berubah setelah diakui", tingkat: "koreksi" },
  KREDIT_LAINNYA: { label: "Saldo kredit", tingkat: "periksa" },
});

const rp = (n) => `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
const hariAntara = (a, b) => Math.floor((a - b) / 86400000);

/** Kategori + penjelasan + tindakan untuk SATU order. Murni (tanpa DB) supaya bisa dites langsung. */
export function jelaskanPiutangOrder({ saldo, diakui, tagihan, paymentStatus, bayarAktif, bayarSebelumSaldoAwal, cutoffTeks, dibatalkan = false }) {
  if (dibatalkan) {
    return {
      kategori: "ORDER_DIBATALKAN",
      penjelasan: `Order ini sudah DIBATALKAN, tetapi jurnal pengakuan pendapatannya belum dibalik sehingga ${saldo >= 0 ? "piutang" : "saldo kredit"} ${rp(Math.abs(saldo))} masih tercatat di buku. Tidak ditagihkan ke pelanggan.`,
      tindakan: "Balik jurnal pengakuannya (Finance Admin, skrip koreksi pembatalan). Pembatalan order yang baru otomatis membalik jurnalnya.",
    };
  }
  const selisih = diakui == null ? 0 : tagihan - diakui;
  if (diakui != null && Math.abs(selisih) >= 1) {
    return {
      kategori: "NILAI_BEDA_PENGAKUAN",
      penjelasan: `Pendapatan diakui ${rp(diakui)} saat order diserahkan, tetapi nilai tagihan order sekarang ${rp(tagihan)} (${selisih > 0 ? "kurang diakui" : "kelebihan diakui"} ${rp(Math.abs(selisih))}). Nilai order diubah setelah pendapatan diakui, dan sistem tidak menyesuaikan jurnalnya otomatis.`,
      tindakan: "Pastikan nilai order yang benar, lalu minta Admin Keuangan membuat jurnal penyesuaian pengakuan pendapatan sebesar selisih.",
    };
  }
  if (saldo < 0) {
    return {
      kategori: "KREDIT_LAINNYA",
      penjelasan: `Saldo piutang order ini kredit ${rp(Math.abs(saldo))}: uang yang tercatat melebihi tagihan yang diakui, padahal nilai order tidak berubah.`,
      tindakan: "Periksa pembayaran, refund, dan alokasi order ini (kemungkinan lebih bayar atau pembayaran terhitung dua kali).",
    };
  }
  if (paymentStatus === "LUNAS" && bayarAktif.total === 0) {
    return {
      kategori: "LUNAS_TANPA_PAYMENT",
      penjelasan: "CRM menandai order ini LUNAS, tetapi belum ada catatan pembayaran. Pendapatan sudah diakui sehingga buku masih mencatat piutang.",
      tindakan: `Finance mencatat pembayarannya lewat tab "Lunas di CRM" di Pembayaran & Verifikasi, dengan bukti. Bila uangnya masuk sebelum saldo awal (${cutoffTeks}), pilih mode "tidak menambah saldo".`,
    };
  }
  if (paymentStatus === "LUNAS") {
    return {
      kategori: "PAYMENT_BELUM_MENUTUP",
      penjelasan: `Pembayaran ${rp(bayarAktif.total)} sudah tercatat, tetapi tidak ada jurnal yang menutup piutang order ini${bayarSebelumSaldoAwal ? ` (uang diterima sebelum saldo awal ${cutoffTeks}; pendapatan baru diakui sesudahnya)` : ""}.`,
      tindakan: bayarSebelumSaldoAwal
        ? "Jalankan penuntasan pembayaran historis untuk Payment ini (jurnal non-kas: Laba Ditahan / Piutang; Kas/Bank tidak disentuh)."
        : "Periksa jurnal pembayaran Payment ini — kemungkinan tidak terposting.",
    };
  }
  return {
    kategori: "TAGIHAN_SAH",
    penjelasan: "Pendapatan sudah diakui karena order diserahkan, tetapi pembayaran belum diterima lengkap. Ini piutang yang sah.",
    tindakan: "Tagih pelanggan. Pembayaran dicatat dan diverifikasi lewat Pembayaran & Verifikasi.",
  };
}

/**
 * KERINGANAN LUNAS (Pengecualian Tgl Lunas, keputusan Owner): order yang DIHITUNG lunas untuk target Sales padahal uang pelanggan belum (seluruhnya) diterima. Dari
 * sisi uang itu tetap TAGIHAN ke pelanggan, tetapi tidak pernah tampil sebagai piutang karena (a) status CRM-nya LUNAS dan (b) order yang diserahkan sebelum pembukuan
 * tidak punya jurnal pendapatan/piutang sama sekali. Bagian ini menjumlahkan sisa tagihan riilnya dan menyebut apakah sudah tercatat di buku.
 */
async function keringananLunas(db, saldoPerOrder) {
  const rows = await db.orderPaidAtPengecualian.findMany({
    where: { dicabutAt: null },
    select: { alasan: true, order: { select: { ...PILIH_TAGIHAN, orderNumber: true, paymentStatus: true, customer: { select: { name: true, assignedSales: { select: { name: true } } } } } } },
  });
  const ids = rows.map((r) => r.order.id);
  const bayar = ids.length ? await db.payment.groupBy({ by: ["orderId"], where: { orderId: { in: ids }, cancelledAt: null, verifications: { some: {} } }, _sum: { amount: true } }) : [];
  const dibayar = new Map(bayar.map((b) => [b.orderId, b._sum.amount ?? 0]));
  const diakui = new Set(ids.length ? (await db.finJournalEntry.findMany({ where: { source: "PENGAKUAN_PENDAPATAN", status: "POSTED", sourceId: { in: ids } }, select: { sourceId: true } })).map((e) => e.sourceId) : []);
  const baris = rows.map((r) => {
    const o = r.order;
    const tagihan = tagihanOrder(o);
    const terbayar = dibayar.get(o.id) ?? 0;
    const sisa = Math.max(tagihan - terbayar, 0);
    const saldoBuku = saldoPerOrder.get(o.id) ?? 0;
    const diserahkan = STATUS_PENGAKUAN.includes(o.status);
    const posisiBuku = !diserahkan ? "BELUM_DISERAHKAN" : diakui.has(o.id) && saldoBuku > 0 ? "SUDAH_DI_BUKU" : diakui.has(o.id) ? "DIAKUI_TANPA_SALDO" : "BELUM_DI_BUKU";
    return {
      orderId: o.id, orderNumber: o.orderNumber, customerName: o.customer?.name ?? "—", salesName: o.customer?.assignedSales?.name ?? null, orderStatus: o.status,
      nilaiTagihan: tagihan, terbayarTerverifikasi: terbayar, sisaTagihan: sisa, saldoPiutangBuku: saldoBuku, posisiBuku, alasan: r.alasan,
    };
  }).filter((b) => b.sisaTagihan > 0).sort((a, b) => b.sisaTagihan - a.sisaTagihan);
  const jumlahPer = (k) => baris.filter((b) => b.posisiBuku === k).reduce((s, b) => s + b.sisaTagihan, 0);
  return {
    jumlah: baris.length,
    totalSisa: baris.reduce((s, b) => s + b.sisaTagihan, 0),
    totalBelumDiBuku: jumlahPer("BELUM_DI_BUKU"),
    totalSudahDiBuku: jumlahPer("SUDAH_DI_BUKU"),
    totalBelumDiserahkan: jumlahPer("BELUM_DISERAHKAN"),
    baris,
  };
}

const kosongAngka = () => Object.fromEntries(Object.keys(KATEGORI_PIUTANG).map((k) => [k, { jumlah: 0, total: 0 }]));

export async function diagnosisPiutang(db, { to: batas = todayBookDateWIB() } = {}) {
  const to = todayBookDateWIB(batas instanceof Date ? batas : new Date(batas));
  const akun = await db.finAccount.findUnique({ where: { systemKey: "PIUTANG_USAHA" }, select: { id: true } });
  const cutoff = await tanggalCutoff(db);
  const cutoffTeks = tampilCutoff(cutoff);
  const catatan = await catatanLaporan(db);
  const kosong = { perTanggal: to, neraca: 0, rekonsiliasi: { perKategori: kosongAngka(), selisih: 0 }, baris: [], belumDiakui: { jumlah: 0, total: 0, perStatus: [], sudahDiserahBelumDiakui: [] }, keringananLunas: { jumlah: 0, totalSisa: 0, totalBelumDiBuku: 0, totalSudahDiBuku: 0, totalBelumDiserahkan: 0, baris: [] }, kategori: KATEGORI_PIUTANG, catatan };
  if (!akun) return kosong;

  const grouped = await db.finJournalLine.groupBy({
    by: ["orderId"],
    where: { accountId: akun.id, orderId: { not: null }, entry: { status: { in: STATUS_DIHITUNG }, date: { lte: to } } },
    _sum: { debit: true, credit: true },
  });
  const bersaldo = grouped
    .map((g) => ({ orderId: g.orderId, saldo: toMoney(g._sum.debit || 0).minus(toMoney(g._sum.credit || 0)) }))
    .filter((g) => !g.saldo.isZero());
  const ids = bersaldo.map((b) => b.orderId);

  const [orders, pengakuan, payments, penyesuaian] = ids.length ? await Promise.all([
    db.order.findMany({
      where: { id: { in: ids } },
      select: { ...PILIH_TAGIHAN, orderNumber: true, paymentStatus: true, paidAt: true, customer: { select: { id: true, name: true, assignedSales: { select: { name: true } } } } },
    }),
    // Pengakuan pendapatan yang masih POSTED: total tagihan yang diakui = Σ debit piutang pada jurnal itu (satu jurnal per order).
    db.finJournalEntry.findMany({
      where: { source: "PENGAKUAN_PENDAPATAN", status: "POSTED", sourceId: { in: ids } },
      select: { sourceId: true, date: true, lines: { where: { accountId: akun.id }, select: { debit: true } } },
    }),
    db.payment.findMany({ where: { orderId: { in: ids }, cancelledAt: null }, select: { orderId: true, amount: true, createdAt: true, verifications: { select: { id: true } } } }),
    // Penyesuaian pengakuan pendapatan (nilai order diedit sesudah diakui): net debit−kredit piutang per order menambah/mengurangi total yang dianggap diakui.
    db.finJournalLine.findMany({ where: { accountId: akun.id, orderId: { in: ids }, entry: { status: "POSTED", idempotencyKey: { startsWith: PREFIX_KUNCI_PENYESUAIAN } } }, select: { orderId: true, debit: true, credit: true } }),
  ]) : [[], [], [], []];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const pengakuanById = new Map(pengakuan.map((e) => [e.sourceId, { tanggal: e.date, diakui: e.lines.reduce((s, l) => s + Number(l.debit), 0) }]));
  for (const l of penyesuaian) { const p = pengakuanById.get(l.orderId); if (p) p.diakui += Number(l.debit) - Number(l.credit); }
  const bayarById = new Map();
  for (const p of payments) {
    const b = bayarById.get(p.orderId) ?? { total: 0, jumlah: 0, terverifikasi: 0, paling_awal: null };
    b.total += p.amount; b.jumlah += 1; if (p.verifications.length) b.terverifikasi += p.amount;
    if (!b.paling_awal || p.createdAt < b.paling_awal) b.paling_awal = p.createdAt;
    bayarById.set(p.orderId, b);
  }

  const sekarang = new Date(to);
  const perKategori = kosongAngka();
  const baris = bersaldo.map((b) => {
    const o = orderById.get(b.orderId);
    const saldo = moneyToNumber(b.saldo);
    const pg = pengakuanById.get(b.orderId) ?? null;
    const bayarAktif = bayarById.get(b.orderId) ?? { total: 0, jumlah: 0, terverifikasi: 0, paling_awal: null };
    const tagihan = o ? tagihanOrder(o) : 0;
    // Resi Gabungan: tagihan per order tidak sebanding dengan jurnal per order → jangan menuduh "nilai berubah".
    const bandingkan = o && !resiBaru(o) && pg;
    const j = jelaskanPiutangOrder({
      saldo, diakui: bandingkan ? pg.diakui : null, tagihan, paymentStatus: o?.paymentStatus, dibatalkan: o?.status === "CANCELLED",
      bayarAktif, bayarSebelumSaldoAwal: bayarAktif.paling_awal ? sebelumCutoff(bayarAktif.paling_awal, cutoff) : false, cutoffTeks,
    });
    perKategori[j.kategori].jumlah += 1;
    perKategori[j.kategori].total += saldo;
    return {
      orderId: b.orderId, orderNumber: o?.orderNumber ?? null, customerName: o?.customer?.name ?? "—", salesName: o?.customer?.assignedSales?.name ?? null,
      orderStatus: o?.status ?? null, paymentStatus: o?.paymentStatus ?? null, nilaiTagihan: tagihan, diakui: pg?.diakui ?? null, tanggalPengakuan: pg?.tanggal ?? null,
      hariSejakPengakuan: pg?.tanggal ? hariAntara(sekarang, new Date(pg.tanggal)) : null,
      saldoPiutang: saldo, pembayaranAktif: { jumlah: bayarAktif.jumlah, total: bayarAktif.total, terverifikasi: bayarAktif.terverifikasi },
      kategori: j.kategori, tingkat: KATEGORI_PIUTANG[j.kategori].tingkat, penjelasan: j.penjelasan, tindakan: j.tindakan,
    };
  }).sort((a, b) => Math.abs(b.saldoPiutang) - Math.abs(a.saldoPiutang));

  const neraca = baris.reduce((s, r) => s + r.saldoPiutang, 0);
  const totalKategori = Object.values(perKategori).reduce((s, k) => s + k.total, 0);

  // Order yang BELUM punya pengakuan pendapatan sama sekali — bukan piutang menurut buku (belum diserahkan); yang sudah diserahkan tapi belum diakui perlu dicek.
  const kandidat = await db.order.findMany({
    where: { paymentStatus: { in: ["BELUM_BAYAR", "DP"] }, status: { not: "CANCELLED" }, penjualanKaryawanId: null }, // order Penjualan Karyawan: tidak punya pengakuan/piutang order (dikelola PKR)
    select: { id: true, orderNumber: true, status: true, value: true, ongkir: true, groupId: true, group: { select: { id: true, source: true, anchorOrderId: true } }, customer: { select: { name: true } } },
  });
  const sudahDiakui = new Set((await db.finJournalEntry.findMany({ where: { source: "PENGAKUAN_PENDAPATAN", status: "POSTED", sourceId: { in: kandidat.map((k) => k.id) } }, select: { sourceId: true } })).map((e) => e.sourceId));
  const belum = kandidat.filter((k) => !sudahDiakui.has(k.id));
  const perStatusMap = new Map();
  for (const k of belum) {
    const s = perStatusMap.get(k.status) ?? { status: k.status, jumlah: 0, total: 0 };
    s.jumlah += 1; s.total += tagihanOrder(k);
    perStatusMap.set(k.status, s);
  }

  return {
    perTanggal: to,
    neraca,
    rekonsiliasi: { perKategori, selisih: Math.round((neraca - totalKategori) * 100) / 100 },
    baris,
    belumDiakui: {
      jumlah: belum.length,
      total: belum.reduce((s, k) => s + tagihanOrder(k), 0),
      perStatus: [...perStatusMap.values()].sort((a, b) => b.total - a.total),
      sudahDiserahBelumDiakui: belum.filter((k) => STATUS_PENGAKUAN.includes(k.status))
        .map((k) => ({ orderId: k.id, orderNumber: k.orderNumber, customerName: k.customer?.name ?? "—", orderStatus: k.status, nilaiTagihan: tagihanOrder(k) })),
    },
    keringananLunas: await keringananLunas(db, new Map(baris.map((b) => [b.orderId, b.saldoPiutang]))),
    kategori: KATEGORI_PIUTANG,
    catatan,
  };
}
