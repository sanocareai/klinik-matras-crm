// PENJUALAN KARYAWAN (PKR) — DITAMPILKAN TERPISAH (BACA-SAJA).
//
// PKR = dokumen penjualan kepada kerabat karyawan yang piutangnya ditanggung karyawan penjual (potong gaji). Diakui sebagai pendapatan 4-1250 SAAT DOKUMEN DIBUAT
// (posting/penjualanKaryawan.js) — berbeda dari order Sales yang diakui saat diserahkan. Order CRM operasional yang tertaut ke PKR bernilai Rp0 dan TIDAK dijumlahkan lagi
// (pendapatan ganda dicegah di postRevenueRecognition). Modul ini hanya MENAMPILKAN dokumen, pembayaran, sisa piutang, dan status pemenuhan — tidak menyimpulkan serah.
//
// BASIS KONTROL PARITY "PKR: ledger = dokumen" (diperbaiki 23 Okt 2026): kedua sisi memakai TANGGAL BUKU dan NETO terhadap pembatalan.
//   Sisi ledger  : Σ efek baris 4-1250 pada [from,to] dari jurnal PKR ASLI/PENGGANTI (sumber PENJUALAN_KARYAWAN, status POSTED atau REVERSED) DAN jurnal PEMBALIK-nya
//                  (sumber REVERSAL yang membalik jurnal PKR). Jurnal asli berstatus REVERSED tetap dihitung di bulan buku-nya; pembaliknya dihitung di bulan buku-nya sendiri.
//   Sisi dokumen : Σ total dokumen yang tanggal dokumennya (= tanggal buku jurnal) pada periode  −  Σ total dokumen DIBATALKAN yang tanggal batalnya (WIB) pada periode.
//                  Dokumen batal TIDAK lagi dikeluarkan begitu saja (itu yang membuat selisih) — ia masuk di bulan dibuat dan dibalik di bulan dibatalkan, persis seperti jurnalnya.
// Koreksi nilai (jurnal asli dibalik + pengganti, bertanggal sama) otomatis netto = total dokumen sekarang. Rumus Laba Rugi baku TIDAK berubah; ini hanya read-model kontrol.
const JURNAL_PKR = "PENJUALAN_KARYAWAN";
export const adalahBarisPkr = (r) => r.akunTipe === "PENDAPATAN" && (r.sumber === JURNAL_PKR || (r.sumber === "REVERSAL" && r.membalik?.sumber === JURNAL_PKR));

import { sumMoney, moneyToNumber, toMoney } from "../money.js";
import { todayBookDateWIB } from "../journal.js";
import { WIB_OFFSET_MS } from "../../../utils/wib.js";

const rp = (d) => moneyToNumber(d);
const tgl = (d) => new Date(d).toISOString().slice(0, 10);

export async function hitungPkr(tx, { from, to, baris }) {
  // Rentang INSTAN untuk cancelledAt: tanggal buku [from,to] (UTC tengah malam, inklusif) = [from − 7 jam, to + 1 hari − 7 jam) menurut WIB.
  const awalBatal = new Date(from.getTime() - WIB_OFFSET_MS); const akhirBatal = new Date(to.getTime() + 24 * 3600 * 1000 - WIB_OFFSET_MS);
  const dokumen = await tx.finPenjualanKaryawan.findMany({
    where: { OR: [{ date: { gte: from, lte: to } }, { payments: { some: { date: { gte: from, lte: to } } } }, { status: "DIBATALKAN", cancelledAt: { gte: awalBatal, lt: akhirBatal } }] },
    orderBy: [{ date: "asc" }, { nomor: "asc" }],
    select: {
      id: true, nomor: true, date: true, total: true, status: true, cancelledAt: true, buyerName: true, seller: { select: { name: true } },
      items: { select: { name: true, quantity: true, unitPrice: true, fulfillment: true } },
      payments: { select: { id: true, date: true, amount: true, method: true, cancelledAt: true } },
      orderCrm: { select: { orderNumber: true, status: true, value: true, _count: { select: { units: true } } } },
    },
  });
  const barisPkr = baris.filter(adalahBarisPkr);
  const jurnalPer = new Map();
  for (const r of barisPkr) { if (r.sumber !== JURNAL_PKR) continue; const a = jurnalPer.get(r.sourceId) ?? []; a.push(r.nomorJurnal); jurnalPer.set(r.sourceId, a); } // daftar jurnal per dokumen = jurnal pendapatan (bukan pembalik)
  const pendapatanLedger = rp(sumMoney(barisPkr.map((r) => r.efek)));

  const lihat = dokumen.map((d) => {
    const dibayar = sumMoney(d.payments.filter((p) => !p.cancelledAt).map((p) => p.amount));
    const dalamPeriode = d.date >= from && d.date <= to;
    const tanggalBatal = d.status === "DIBATALKAN" && d.cancelledAt ? todayBookDateWIB(d.cancelledAt) : null; // tanggal buku pembatalan (WIB)
    const dibatalkanPadaPeriode = !!tanggalBatal && tanggalBatal >= from && tanggalBatal <= to;
    const bayarPeriode = sumMoney(d.payments.filter((p) => !p.cancelledAt && p.date >= from && p.date <= to).map((p) => p.amount));
    const crm = d.orderCrm;
    const status = d.status !== "AKTIF" ? "DIBATALKAN" : !crm ? "TANPA_ORDER_CRM" : crm.status === "DELIVERED" ? "DISERAHKAN" : "BELUM_DISERAHKAN";
    return {
      nomor: d.nomor, tanggal: tgl(d.date), status: d.status, penjual: d.seller?.name ?? "", pembeli: d.buyerName,
      total: rp(toMoney(d.total)), dibayar: rp(dibayar), dibayarPeriode: rp(bayarPeriode), sisa: rp(toMoney(d.total).minus(dibayar)),
      dalamPeriode, tanggalBatal: tanggalBatal ? tgl(tanggalBatal) : null, dibatalkanPadaPeriode, jurnalPendapatan: jurnalPer.get(d.id) ?? [],
      item: d.items.map((i) => `${i.quantity}× ${i.name}`).join("; "), pemenuhan: [...new Set(d.items.map((i) => i.fulfillment))].join(", "),
      orderCrm: crm ? { nomor: crm.orderNumber, status: crm.status, unit: crm._count.units, nilai: rp(toMoney(crm.value)) } : null,
      statusPemenuhan: status,
      catatan: status === "DIBATALKAN" ? `Dibatalkan ${tanggalBatal ? tgl(tanggalBatal) : ""}: pendapatan dibalik pada tanggal batal${dalamPeriode && !dibatalkanPadaPeriode ? " (di periode berbeda)" : ""}.` : status === "TANPA_ORDER_CRM" ? "Tidak tertaut order CRM — status serah tidak dapat dibuktikan dari sistem." : status === "BELUM_DISERAHKAN" ? "Pendapatan sudah diakui saat dokumen dibuat, order operasional belum diserahkan." : "",
    };
  });
  const aktifPeriode = lihat.filter((d) => d.dalamPeriode && d.status === "AKTIF");
  const penjualanDokumen = rp(sumMoney(aktifPeriode.map((d) => d.total)));
  // Basis TANGGAL BUKU, neto pembatalan — sisi dokumen kontrol parity (lihat kepala berkas).
  const dibukukan = lihat.filter((d) => d.dalamPeriode);
  const dibalik = lihat.filter((d) => d.dibatalkanPadaPeriode);
  const dibukukanDokumen = rp(sumMoney(dibukukan.map((d) => d.total)));
  const dibalikDokumen = rp(sumMoney(dibalik.map((d) => d.total)));
  const penjualanDokumenBuku = rp(toMoney(dibukukanDokumen).minus(dibalikDokumen));
  return {
    dokumen: lihat,
    ringkasan: {
      jumlahDokumen: aktifPeriode.length, penjualanDokumen, pendapatanLedger,
      dibukukanDokumen, dibalikDokumen, jumlahDibalik: dibalik.length, penjualanDokumenBuku, selisih: rp(toMoney(pendapatanLedger).minus(penjualanDokumenBuku)),
      pembayaranPeriode: rp(sumMoney(lihat.map((d) => d.dibayarPeriode))), sisaPiutang: rp(sumMoney(aktifPeriode.map((d) => d.sisa))),
      belumDiserahkan: aktifPeriode.filter((d) => d.statusPemenuhan === "BELUM_DISERAHKAN").length,
      tanpaOrderCrm: aktifPeriode.filter((d) => d.statusPemenuhan === "TANPA_ORDER_CRM").length,
      nilaiBelumDiserahkan: rp(sumMoney(aktifPeriode.filter((d) => d.statusPemenuhan === "BELUM_DISERAHKAN").map((d) => d.total))),
      nilaiTanpaOrderCrm: rp(sumMoney(aktifPeriode.filter((d) => d.statusPemenuhan === "TANPA_ORDER_CRM").map((d) => d.total))),
    },
    kebijakan: "Diakui saat dokumen dibuat (4-1250), bukan saat serah; dokumen yang dibatalkan dibalik pada tanggal batalnya (neto). Order CRM tertaut bernilai Rp0 dan tidak dijumlah lagi. Kebijakan ini berbeda dari order Sales (diakui saat diserahkan).",
  };
}
