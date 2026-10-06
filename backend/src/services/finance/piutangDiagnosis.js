// DIAGNOSIS PIUTANG — menjelaskan KENAPA tiap order punya saldo di akun Piutang Usaha dan apa yang harus dilakukan. Hanya MEMBACA (tidak menulis apa pun).
//
// Kenapa ada: umurPiutang() (reports.js) hanya memperlihatkan order yang berstatus belum lunas di CRM; order LUNAS-di-CRM yang saldonya masih terbuka
// hanya muncul sebagai satu angka "menungguVerifikasi", dan order bersaldo KREDIT tidak muncul sama sekali — jadi saldo neraca tidak bisa dijelaskan
// baris demi baris. Fungsi ini mengelompokkan SEMUA order bersaldo (positif maupun negatif) ke satu kategori dengan alasan + tindakan, dan menjumlahkannya
// kembali ke saldo neraca (rekonsiliasi). Kontrak umurPiutang() TIDAK diubah — dipakai export, dashboard, dan klien mobile.
//
// KATEGORI (urutan prioritas):
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

export const KATEGORI_PIUTANG = Object.freeze({
  TAGIHAN_SAH: { label: "Tagihan sah", tingkat: "tagih" },
  LUNAS_TANPA_PAYMENT: { label: "Lunas di CRM, belum ada pembayaran", tingkat: "periksa" },
  PAYMENT_BELUM_MENUTUP: { label: "Pembayaran belum menutup piutang", tingkat: "periksa" },
  NILAI_BEDA_PENGAKUAN: { label: "Nilai order berubah setelah diakui", tingkat: "koreksi" },
  KREDIT_LAINNYA: { label: "Saldo kredit", tingkat: "periksa" },
});

const rp = (n) => `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
const hariAntara = (a, b) => Math.floor((a - b) / 86400000);

/** Kategori + penjelasan + tindakan untuk SATU order. Murni (tanpa DB) supaya bisa dites langsung. */
export function jelaskanPiutangOrder({ saldo, diakui, tagihan, paymentStatus, bayarAktif, bayarSebelumSaldoAwal, cutoffTeks }) {
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

const kosongAngka = () => Object.fromEntries(Object.keys(KATEGORI_PIUTANG).map((k) => [k, { jumlah: 0, total: 0 }]));

export async function diagnosisPiutang(db, { to: batas = todayBookDateWIB() } = {}) {
  const to = todayBookDateWIB(batas instanceof Date ? batas : new Date(batas));
  const akun = await db.finAccount.findUnique({ where: { systemKey: "PIUTANG_USAHA" }, select: { id: true } });
  const cutoff = await tanggalCutoff(db);
  const cutoffTeks = tampilCutoff(cutoff);
  const catatan = await catatanLaporan(db);
  const kosong = { perTanggal: to, neraca: 0, rekonsiliasi: { perKategori: kosongAngka(), selisih: 0 }, baris: [], belumDiakui: { jumlah: 0, total: 0, perStatus: [], sudahDiserahBelumDiakui: [] }, kategori: KATEGORI_PIUTANG, catatan };
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

  const [orders, pengakuan, payments] = ids.length ? await Promise.all([
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
  ]) : [[], [], []];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const pengakuanById = new Map(pengakuan.map((e) => [e.sourceId, { tanggal: e.date, diakui: e.lines.reduce((s, l) => s + Number(l.debit), 0) }]));
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
      saldo, diakui: bandingkan ? pg.diakui : null, tagihan, paymentStatus: o?.paymentStatus,
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
    where: { paymentStatus: { in: ["BELUM_BAYAR", "DP"] }, status: { not: "CANCELLED" } },
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
    kategori: KATEGORI_PIUTANG,
    catatan,
  };
}
