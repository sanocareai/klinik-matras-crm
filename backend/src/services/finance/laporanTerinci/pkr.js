// PENJUALAN KARYAWAN (PKR) — DITAMPILKAN TERPISAH (BACA-SAJA).
//
// PKR = dokumen penjualan kepada kerabat karyawan yang piutangnya ditanggung karyawan penjual (potong gaji). Diakui sebagai pendapatan 4-1250 SAAT DOKUMEN DIBUAT
// (posting/penjualanKaryawan.js) — berbeda dari order Sales yang diakui saat diserahkan. Order CRM operasional yang tertaut ke PKR bernilai Rp0 dan TIDAK dijumlahkan lagi
// (pendapatan ganda dicegah di postRevenueRecognition). Modul ini hanya MENAMPILKAN dokumen, pembayaran, sisa piutang, dan status pemenuhan — tidak menyimpulkan serah.

import { sumMoney, moneyToNumber, toMoney } from "../money.js";

const rp = (d) => moneyToNumber(d);
const tgl = (d) => new Date(d).toISOString().slice(0, 10);

export async function hitungPkr(tx, { from, to, baris }) {
  const dokumen = await tx.finPenjualanKaryawan.findMany({
    where: { OR: [{ date: { gte: from, lte: to } }, { payments: { some: { date: { gte: from, lte: to } } } }] },
    orderBy: [{ date: "asc" }, { nomor: "asc" }],
    select: {
      id: true, nomor: true, date: true, total: true, status: true, buyerName: true, seller: { select: { name: true } },
      items: { select: { name: true, quantity: true, unitPrice: true, fulfillment: true } },
      payments: { select: { id: true, date: true, amount: true, method: true, cancelledAt: true } },
      orderCrm: { select: { orderNumber: true, status: true, value: true, _count: { select: { units: true } } } },
    },
  });
  const barisPkr = baris.filter((r) => r.sumber === "PENJUALAN_KARYAWAN" && r.akunTipe === "PENDAPATAN");
  const jurnalPer = new Map();
  for (const r of barisPkr) { const a = jurnalPer.get(r.sourceId) ?? []; a.push(r.nomorJurnal); jurnalPer.set(r.sourceId, a); }
  const pendapatanLedger = rp(sumMoney(barisPkr.map((r) => r.efek)));

  const lihat = dokumen.map((d) => {
    const dibayar = sumMoney(d.payments.filter((p) => !p.cancelledAt).map((p) => p.amount));
    const dalamPeriode = d.date >= from && d.date <= to;
    const bayarPeriode = sumMoney(d.payments.filter((p) => !p.cancelledAt && p.date >= from && p.date <= to).map((p) => p.amount));
    const crm = d.orderCrm;
    const status = d.status !== "AKTIF" ? "DIBATALKAN" : !crm ? "TANPA_ORDER_CRM" : crm.status === "DELIVERED" ? "DISERAHKAN" : "BELUM_DISERAHKAN";
    return {
      nomor: d.nomor, tanggal: tgl(d.date), status: d.status, penjual: d.seller?.name ?? "", pembeli: d.buyerName,
      total: rp(toMoney(d.total)), dibayar: rp(dibayar), dibayarPeriode: rp(bayarPeriode), sisa: rp(toMoney(d.total).minus(dibayar)),
      dalamPeriode, jurnalPendapatan: jurnalPer.get(d.id) ?? [],
      item: d.items.map((i) => `${i.quantity}× ${i.name}`).join("; "), pemenuhan: [...new Set(d.items.map((i) => i.fulfillment))].join(", "),
      orderCrm: crm ? { nomor: crm.orderNumber, status: crm.status, unit: crm._count.units, nilai: rp(toMoney(crm.value)) } : null,
      statusPemenuhan: status,
      catatan: status === "TANPA_ORDER_CRM" ? "Tidak tertaut order CRM — status serah tidak dapat dibuktikan dari sistem." : status === "BELUM_DISERAHKAN" ? "Pendapatan sudah diakui saat dokumen dibuat, order operasional belum diserahkan." : "",
    };
  });
  const aktifPeriode = lihat.filter((d) => d.dalamPeriode && d.status === "AKTIF");
  const penjualanDokumen = rp(sumMoney(aktifPeriode.map((d) => d.total)));
  return {
    dokumen: lihat,
    ringkasan: {
      jumlahDokumen: aktifPeriode.length, penjualanDokumen, pendapatanLedger, selisih: rp(toMoney(pendapatanLedger).minus(penjualanDokumen)),
      pembayaranPeriode: rp(sumMoney(lihat.map((d) => d.dibayarPeriode))), sisaPiutang: rp(sumMoney(aktifPeriode.map((d) => d.sisa))),
      belumDiserahkan: aktifPeriode.filter((d) => d.statusPemenuhan === "BELUM_DISERAHKAN").length,
      tanpaOrderCrm: aktifPeriode.filter((d) => d.statusPemenuhan === "TANPA_ORDER_CRM").length,
      nilaiBelumDiserahkan: rp(sumMoney(aktifPeriode.filter((d) => d.statusPemenuhan === "BELUM_DISERAHKAN").map((d) => d.total))),
      nilaiTanpaOrderCrm: rp(sumMoney(aktifPeriode.filter((d) => d.statusPemenuhan === "TANPA_ORDER_CRM").map((d) => d.total))),
    },
    kebijakan: "Diakui saat dokumen dibuat (4-1250), bukan saat serah. Order CRM tertaut bernilai Rp0 dan tidak dijumlah lagi. Kebijakan ini berbeda dari order Sales (diakui saat diserahkan).",
  };
}
