// JADWAL JATUH TEMPO FAKTUR ATAS PO — per PENERIMAAN, dasarnya TANGGAL BARANG TIBA (Okt 2026).
//
// Aturan (jangan dilanggar):
//   • Termin TIDAK berjalan saat PO dibuat dan bukan dari tanggal faktur: dasar = tanggal tiba yang dicatat pada penerimaan (goods_receipts.arrived_date). COD (TUNAI) jatuh tempo pada tanggal tiba;
//     HARI = tanggal tiba + N hari. TANGGAL_KHUSUS = tanggal yang diisi Finance pada faktur (satu tanggal untuk semua penerimaan).
//   • Satu faktur boleh mencakup beberapa penerimaan: nilai faktur DIBAGI ke penerimaan menurut alokasi barang baik (jumlah × harga faktur, bulat 2 desimal, sisa pembulatan pada alokasi terakhir
//     sehingga Σ nilai jadwal = nilai faktur PERSIS). Jadwal ini PRESENTASI: tidak membuat jurnal/utang kedua — utang tetap SATU per faktur, pembayaran tetap SATU alur.
//   • Pembayaran faktur diterapkan ke jadwal secara FIFO menurut jatuh tempo (yang paling awal lunas dulu): Σ dibayar jadwal = pembayaran faktur — tidak ada hitung ganda.
//   • Tanggal tiba kosong: penerimaan baru → "Menunggu tanggal penerimaan"; penerimaan lama yang sudah masuk stok tanpa catatan kedatangan → "Tanggal belum ditetapkan" (TIDAK ditebak, TIDAK di-backfill).
//   • Murni hitung; satu-satunya tulisan adalah sinkronJatuhTempoFakturPO (menjaga kolom fin_supplier_bills.due_date = jatuh tempo TERAWAL agar laporan lama yang membaca kolom itu tetap masuk akal).
import { toMoney, sumMoney, ZERO } from "./money.js";
import { hitungJatuhTempo } from "./termin.js";
import { nilaiBarisPenerimaan } from "./posting/supplier.js";

export const DASAR_TANGGAL_TIBA = "TANGGAL_TIBA";
const STATUS_MASUK_BUKU = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];
const STATUS_TIDAK_AKTIF = ["DIBATALKAN", "DITOLAK"];
const hariKunci = (x) => (x ? new Date(x).toISOString().slice(0, 10) : null);

export const LABEL_STATUS_JADWAL = Object.freeze({
  MENUNGGU_TANGGAL_PENERIMAAN: "Menunggu tanggal penerimaan", TANGGAL_BELUM_DITETAPKAN: "Tanggal belum ditetapkan", TERMIN_BELUM_DITETAPKAN: "Termin belum ditetapkan",
  BELUM_JATUH_TEMPO: "Belum jatuh tempo", DIBAYAR_SEBAGIAN: "Dibayar sebagian", LUNAS: "Lunas",
});

/** Bagi nilai SATU baris faktur ke penerimaan menurut qty alokasi; selisih pembulatan pada alokasi terakhir. Mengembalikan [{ receiptId, nilai }]. */
export function bagiNilaiBaris({ qty, hargaFaktur, alokasi }) {
  const total = nilaiBarisPenerimaan(qty, hargaFaktur);
  const jumlahQty = alokasi.reduce((s, a) => s + Number(a.qty), 0);
  if (alokasi.length === 0 || !(jumlahQty > 0)) return [];
  const hasil = []; let terpakai = ZERO;
  alokasi.forEach((a, i) => {
    const nilai = i === alokasi.length - 1 && Math.abs(jumlahQty - Number(qty)) < 1e-9 ? total.minus(terpakai) : toMoney(total.times(Number(a.qty)).dividedBy(Number(qty)));
    hasil.push({ receiptId: a.receiptId, nilai });
    terpakai = terpakai.plus(nilai);
  });
  return hasil;
}

/**
 * Item jadwal per penerimaan dari baris faktur + alokasi.
 *   barisFaktur : [{ id, qty, invoiceUnitPrice }]
 *   alokasi     : [{ billPoLineId, receiptId, receiptNumber, tanggalTiba, status, qty }]
 */
export function susunItemJadwal({ barisFaktur, alokasi }) {
  const perPenerimaan = new Map();
  for (const b of barisFaktur) {
    const a = alokasi.filter((x) => x.billPoLineId === b.id);
    for (const { receiptId, nilai } of bagiNilaiBaris({ qty: b.qty, hargaFaktur: b.invoiceUnitPrice, alokasi: a })) {
      const info = a.find((x) => x.receiptId === receiptId);
      const ada = perPenerimaan.get(receiptId);
      perPenerimaan.set(receiptId, ada ? { ...ada, nilai: ada.nilai.plus(nilai) } : { receiptId, receiptNumber: info.receiptNumber, tanggalTiba: info.tanggalTiba ? hariKunci(info.tanggalTiba) : null, statusPenerimaan: info.status ?? null, nilai });
    }
  }
  return [...perPenerimaan.values()].sort((x, y) => String(x.tanggalTiba ?? "9999").localeCompare(String(y.tanggalTiba ?? "9999")) || String(x.receiptNumber).localeCompare(String(y.receiptNumber)));
}

/**
 * Hitung jadwal: jatuh tempo per item + penerapan pembayaran FIFO menurut jatuh tempo.
 *   termin      : { jenis, hari } | null          (snapshot termin FAKTUR)
 *   tanggalKhusus : tanggal faktur TANGGAL_KHUSUS (satu untuk semua item) | null
 *   items       : hasil susunItemJadwal
 *   dibayar     : Money — total pembayaran aktif faktur
 *   hariIni     : 'YYYY-MM-DD' (WIB)
 */
export function hitungJadwal({ termin, tanggalKhusus = null, items, dibayar, hariIni }) {
  const dengan = items.map((it) => {
    let due = null; let status = null;
    if (!termin) status = "TERMIN_BELUM_DITETAPKAN";
    else if (termin.jenis === "TANGGAL_KHUSUS") { due = tanggalKhusus ? hariKunci(tanggalKhusus) : null; if (!due) status = "TANGGAL_BELUM_DITETAPKAN"; }
    else if (!it.tanggalTiba) status = it.statusPenerimaan === "COMPLETED" ? "TANGGAL_BELUM_DITETAPKAN" : "MENUNGGU_TANGGAL_PENERIMAAN";
    else due = hariKunci(hitungJatuhTempo(termin, it.tanggalTiba));
    return { ...it, jatuhTempo: due, statusDasar: status };
  });
  const urut = [...dengan].sort((a, b) => String(a.jatuhTempo ?? "9999-99-99").localeCompare(String(b.jatuhTempo ?? "9999-99-99")) || String(a.receiptNumber).localeCompare(String(b.receiptNumber)));
  let sisaBayar = toMoney(dibayar);
  const peta = new Map();
  for (const it of urut) {
    const bayarIni = sisaBayar.greaterThan(it.nilai) ? it.nilai : sisaBayar;
    sisaBayar = sisaBayar.minus(bayarIni);
    const sisa = it.nilai.minus(bayarIni);
    let status = it.statusDasar;
    if (!sisa.greaterThan(0)) status = "LUNAS";
    else if (bayarIni.greaterThan(0)) status = "DIBAYAR_SEBAGIAN";
    else if (!status) status = "BELUM_JATUH_TEMPO";
    peta.set(it.receiptId, { dibayar: bayarIni, sisa, status });
  }
  return dengan.map((it) => {
    const p = peta.get(it.receiptId);
    return { ...it, ...p, statusLabel: LABEL_STATUS_JADWAL[p.status] ?? p.status, terlambat: !!it.jatuhTempo && p.sisa.greaterThan(0) && it.jatuhTempo < hariIni };
  });
}

/** Jatuh tempo TERAWAL (string tanggal) dari daftar tanggal tiba menurut termin TUNAI/HARI; null bila tidak ada tanggal tiba. */
export function jatuhTempoTerawal(termin, tanggalTibaList) {
  if (!termin || !["TUNAI", "HARI"].includes(termin.jenis)) return null;
  const hari = tanggalTibaList.filter(Boolean).map((t) => hariKunci(hitungJatuhTempo(termin, t))).sort();
  return hari[0] ?? null;
}

/**
 * Jaga fin_supplier_bills.due_date faktur-faktur atas PO (dasar TANGGAL_TIBA, termin TUNAI/HARI) = jatuh tempo TERAWAL dari penerimaan terkait.
 * Dipanggil saat kedatangan dicatat/dikoreksi tanggalnya dan saat faktur dibuat/diubah/disetujui. Faktur dibatalkan/ditolak tidak disentuh.
 * Penerimaan terkait: faktur masuk buku → penerimaan pada alokasinya; faktur belum disetujui → penerimaan yang dipilih (atau semua penerimaan PO yang sudah masuk stok).
 */
export async function sinkronJatuhTempoFakturPO(tx, poId) {
  const bills = await tx.finSupplierBill.findMany({
    where: { purchaseOrderId: poId, termBasis: DASAR_TANGGAL_TIBA, termType: { in: ["TUNAI", "HARI"] }, status: { notIn: STATUS_TIDAK_AKTIF } },
    select: {
      id: true, status: true, dueDate: true, termType: true, termDays: true,
      poReceipts: { select: { goodsReceipt: { select: { arrivedDate: true } } } },
      poAllocations: { select: { goodsReceipt: { select: { arrivedDate: true } } } },
    },
  });
  if (bills.length === 0) return 0;
  const semua = await tx.goodsReceipt.findMany({ where: { purchaseOrderId: poId, status: "COMPLETED" }, select: { arrivedDate: true } });
  let berubah = 0;
  for (const b of bills) {
    const tanggal = STATUS_MASUK_BUKU.includes(b.status) ? b.poAllocations.map((a) => a.goodsReceipt.arrivedDate)
      : b.poReceipts.length ? b.poReceipts.map((r) => r.goodsReceipt.arrivedDate) : semua.map((r) => r.arrivedDate);
    const baru = jatuhTempoTerawal({ jenis: b.termType, hari: b.termDays ?? 0 }, tanggal);
    const lama = hariKunci(b.dueDate);
    if (baru !== lama) { await tx.finSupplierBill.update({ where: { id: b.id }, data: { dueDate: baru ? new Date(`${baru}T00:00:00.000Z`) : null } }); berubah += 1; }
  }
  return berubah;
}

/** Jadwal satu faktur dari data muatan (bill + poLines + poAllocations + pembayaran aktif). Murni; dipakai aging, detail, dan evaluasi. */
export function jadwalDariFaktur({ bill, alokasi, dibayar, hariIni }) {
  if (bill.termBasis !== DASAR_TANGGAL_TIBA) return null;
  const termin = bill.termType ? { jenis: bill.termType, hari: bill.termDays ?? 0 } : null;
  const items = susunItemJadwal({ barisFaktur: bill.poLines.map((l) => ({ id: l.id, qty: l.qty, invoiceUnitPrice: l.invoiceUnitPrice })), alokasi });
  if (items.length === 0) return [];
  return hitungJadwal({ termin, tanggalKhusus: bill.dueDate, items, dibayar: dibayar ?? ZERO, hariIni });
}

export { sumMoney };
