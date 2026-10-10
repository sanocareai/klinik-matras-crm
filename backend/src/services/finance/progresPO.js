// PROGRES PENERIMAAN PO — SATU-SATUNYA tempat angka progres dihitung (Okt 2026).
// Dipakai API Finance & Gudang (daftar/kartu/detail), batas jumlah datang di Catat Barang Tiba, dan ringkasan PO. Frontend TIDAK menghitung ulang — ia hanya menampilkan angka & definisi dari sini.
//
// Definisi (urutan tampil). Tiap angka per baris PO, satuan utama PO:
//   Dipesan              jumlah di PO.
//   Datang (fisik)       total yang BENAR-BENAR TIBA di semua pengiriman (Tiba/Diperiksa/Siap Disimpan/Sudah Masuk Stok), termasuk yang kemudian ditolak dan termasuk pengiriman pengganti.
//   Belum datang         Dipesan − datang pengiriman ASLI. Barang ditolak TETAP terhitung sudah datang secara fisik; pengiriman pengganti tidak mengurangi "belum datang"
//                        (ia tidak menambah pasokan baru, hanya menutup penolakan) — jadi batas PO tidak naik.
//   Belum diperiksa      sudah tiba, hasil baik/ditolak belum diisi Gudang.
//   Ditolak              hasil pemeriksaan: ditolak (riwayat; tidak berkurang saat pengganti tiba).
//   Menunggu pengganti   Ditolak (asli + pengganti yang ditolak) − pengganti yang sudah tiba. Pengganti yang diterima baik menutupnya; pengganti yang ditolak lagi membukanya lagi.
//   Baik belum disimpan  jumlah baik − masuk stok.
//   Masuk stok           baik yang SUDAH disimpan ke stok (BRUTO — satu-satunya yang menambah stok; tidak berkurang karena retur).
//   Diretur ke supplier  barang yang sudah masuk stok lalu KELUAR lagi lewat Retur Supplier untuk kredit (barang sudah keluar gudang; retur draf/dibatalkan tidak dihitung).
//   Stok bersih PO       Masuk stok − Diretur: barang dari PO ini yang masih menjadi stok (sebelum dipakai Produksi). Retur TIDAK membuka lagi "Belum datang" / "Belum dipenuhi
//                        supplier" — retur untuk kredit mengurangi tagihan, bukan meminta pengganti.
//   Belum dipenuhi supplier  Belum datang + Menunggu pengganti = yang masih harus dikirim supplier agar barang baik mencapai jumlah dipesan.
//   Belum masuk stok     Dipesan − masuk stok.
// Invarian (data wajar): Datang = Belum diperiksa + Ditolak + Baik belum disimpan + Masuk stok.
// Jumlah pendamping (mis. lembar) hanya informasi: dijumlah apa adanya, tidak ikut hitungan di atas.
//
// Murni baca. Tidak ada tulis stok/jurnal di sini.

const k = (v) => Math.round(Number(v ?? 0) * 1000);
const dariK = (n) => n / 1000;

const STATUS_SUDAH_TIBA = ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"];

/** Daftar kolom progres + definisinya — dikirim server supaya semua layar memakai label & arti yang sama. */
export const DEFINISI_PROGRES = Object.freeze([
  { kunci: "dipesan", label: "Dipesan", definisi: "Jumlah yang dipesan di PO." },
  { kunci: "datangAsli", label: "Pengiriman asli tiba", definisi: "Total yang tiba pada pengiriman asli (bukan pengganti), termasuk yang kemudian ditolak. Inilah yang dihitung terhadap jumlah dipesan." },
  { kunci: "pengganti", label: "Pengganti tiba", definisi: "Total yang tiba sebagai pengiriman pengganti barang yang ditolak. Tidak menambah pasokan baru dan tidak menaikkan batas PO." },
  { kunci: "datang", label: "Total fisik tiba", definisi: "Pengiriman asli tiba + pengganti tiba: seluruh barang yang pernah tiba secara fisik, termasuk yang ditolak." },
  { kunci: "belumDatang", label: "Belum datang", definisi: "Dipesan dikurangi datang pada pengiriman asli. Barang ditolak tetap dihitung sudah datang; pengiriman pengganti tidak mengurangi angka ini dan tidak menaikkan batas PO." },
  { kunci: "belumDiperiksa", label: "Belum diperiksa", definisi: "Sudah tiba, tetapi hasil baik/ditolak belum diisi Gudang." },
  { kunci: "ditolak", label: "Ditolak", definisi: "Hasil pemeriksaan: barang yang ditolak. Tetap tercatat sebagai riwayat setelah pengganti tiba." },
  { kunci: "menungguPengganti", label: "Menunggu pengganti", definisi: "Jumlah ditolak yang belum diganti supplier. Pengganti yang diterima baik menutupnya; pengganti yang ditolak lagi membukanya lagi." },
  { kunci: "baikBelumDisimpan", label: "Baik belum disimpan", definisi: "Jumlah baik dikurangi masuk stok: lolos pemeriksaan, tetapi Simpan ke Stok belum ditekan." },
  { kunci: "masukStok", label: "Masuk stok", definisi: "Barang baik yang sudah disimpan ke stok (bruto: tidak berkurang karena retur). Hanya ini yang menambah stok." },
  { kunci: "diretur", label: "Diretur ke supplier", definisi: "Barang yang sudah masuk stok lalu dikeluarkan lagi lewat Retur Supplier untuk kredit (barang benar-benar sudah keluar dari gudang). Tidak membuka lagi \"Belum datang\"." },
  { kunci: "stokBersih", label: "Stok bersih PO", definisi: "Masuk stok dikurangi diretur: barang dari PO ini yang masih menjadi stok, sebelum dipakai Produksi." },
  { kunci: "belumDipenuhiSupplier", label: "Belum dipenuhi supplier", definisi: "Belum datang ditambah menunggu pengganti: yang masih harus dikirim supplier agar barang baik mencapai jumlah dipesan." },
  { kunci: "belumMasukStok", label: "Belum masuk stok", definisi: "Dipesan dikurangi masuk stok." },
]);

const KUNCI_ANGKA = DEFINISI_PROGRES.map((d) => d.kunci);

/**
 * Progres per baris PO: Map<purchaseOrderLineId, { dipesan, datangAsli, pengganti, datang (total fisik), belumDatang, belumDiperiksa, ditolak, menungguPengganti, baikBelumDisimpan, masukStok,
 *   belumDipenuhiSupplier, belumMasukStok, pendampingAktual }>. Bridge: datang = datangAsli + pengganti; masuk stok maksimum = dipesan.
 */
export async function hitungProgresPO(db, poId) {
  const po = await db.finPurchaseOrder.findUnique({ where: { id: poId }, select: { lines: { select: { id: true, qty: true } } } });
  if (!po) return new Map();
  const baris = await db.goodsReceiptLine.findMany({
    where: { purchaseOrderLine: { purchaseOrderId: poId } },
    select: { purchaseOrderLineId: true, receivedQty: true, acceptedQty: true, rejectedQty: true, companionQty: true, replacementForLineId: true, goodsReceipt: { select: { status: true } } },
  });
  // Retur untuk kredit yang barangnya SUDAH keluar gudang (status KELUAR/SELESAI); draf & dibatalkan tidak mengurangi stok.
  const retur = await db.supplierReturnLine.findMany({
    where: { purchaseOrderLine: { purchaseOrderId: poId }, supplierReturn: { status: { in: ["KELUAR", "SELESAI"] } } },
    select: { purchaseOrderLineId: true, qty: true },
  });
  const peta = new Map(po.lines.map((l) => [l.id, { dipesanK: k(l.qty), datangK: 0, asliK: 0, penggantiK: 0, belumDiperiksaK: 0, ditolakK: 0, baikK: 0, masukStokK: 0, returK: 0, pendampingK: 0, adaPendamping: false }]));
  for (const r of retur) { const a = peta.get(r.purchaseOrderLineId); if (a) a.returK += k(r.qty); }
  for (const b of baris) {
    const a = peta.get(b.purchaseOrderLineId);
    if (!a) continue;
    const st = b.goodsReceipt.status;
    if (!STATUS_SUDAH_TIBA.includes(st)) continue;
    const datang = k(b.receivedQty); const baik = k(b.acceptedQty); const tolak = k(b.rejectedQty);
    a.datangK += datang; a.ditolakK += tolak; a.baikK += baik;
    if (b.replacementForLineId) a.penggantiK += datang; else a.asliK += datang;
    if (b.companionQty !== null && b.companionQty !== undefined) { a.pendampingK += k(b.companionQty); a.adaPendamping = true; }
    if (st === "COMPLETED") a.masukStokK += baik;
    else if (st !== "READY_FOR_PUTAWAY") a.belumDiperiksaK += Math.max(0, datang - baik - tolak); // ARRIVED / INSPECTION
  }
  const hasil = new Map();
  for (const [id, a] of peta) {
    const belumDatangK = Math.max(0, a.dipesanK - a.asliK);
    const menungguK = Math.max(0, a.ditolakK - a.penggantiK);
    hasil.set(id, {
      dipesan: dariK(a.dipesanK), datangAsli: dariK(a.asliK), pengganti: dariK(a.penggantiK), datang: dariK(a.datangK), belumDatang: dariK(belumDatangK),
      belumDiperiksa: dariK(a.belumDiperiksaK), ditolak: dariK(a.ditolakK), menungguPengganti: dariK(menungguK),
      baikBelumDisimpan: dariK(Math.max(0, a.baikK - a.masukStokK)), masukStok: dariK(a.masukStokK),
      diretur: dariK(a.returK), stokBersih: dariK(Math.max(0, a.masukStokK - a.returK)),
      belumDipenuhiSupplier: dariK(belumDatangK + menungguK), belumMasukStok: dariK(Math.max(0, a.dipesanK - a.masukStokK)),
      pendampingAktual: a.adaPendamping ? dariK(a.pendampingK) : null,
    });
  }
  return hasil;
}

/**
 * Baris penolakan yang masih menunggu pengganti untuk SATU baris PO, tertua dulu: [{ lineId, receiptId, receiptNumber, sisa }].
 * sisa = rejectedQty baris asal − jumlah pengganti (sudah tiba) yang menunjuk ke baris itu. Hanya baris pada penerimaan yang sudah tiba (bukan REJECTED).
 */
export async function asalPenggantiTerbuka(db, purchaseOrderLineId) {
  const asal = await db.goodsReceiptLine.findMany({
    where: { purchaseOrderLineId, rejectedQty: { gt: 0 }, goodsReceipt: { status: { in: ["INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"] } } },
    select: { id: true, rejectedQty: true, goodsReceiptId: true, goodsReceipt: { select: { receiptNumber: true, arrivedDate: true, createdAt: true } }, replacementLines: { select: { receivedQty: true, goodsReceipt: { select: { status: true } } } } },
  });
  return asal
    .map((a) => {
      const diganti = a.replacementLines.filter((r) => STATUS_SUDAH_TIBA.includes(r.goodsReceipt.status)).reduce((s, r) => s + k(r.receivedQty), 0);
      return { lineId: a.id, receiptId: a.goodsReceiptId, receiptNumber: a.goodsReceipt.receiptNumber, sisa: dariK(Math.max(0, k(a.rejectedQty) - diganti)), urut: String(a.goodsReceipt.arrivedDate ?? a.goodsReceipt.createdAt) + a.goodsReceipt.receiptNumber };
    })
    .filter((a) => k(a.sisa) > 0)
    .sort((x, y) => x.urut.localeCompare(y.urut))
    .map(({ urut, ...r }) => r);
}

/**
 * Ringkasan satu PO dari progres per baris — dipakai kartu/daftar. Dijumlah hanya bila semua baris satu satuan; selain itu dihitung per baris terpenuhi.
 * `lines` = [{ satuan, dipesan, datang, belumDatang, ... }] (keluaran hitungProgresPO + satuan).
 */
export function ringkasProgresPO(lines) {
  const satuan = [...new Set(lines.map((l) => l.satuan))];
  const jum = (f) => dariK(lines.reduce((s, l) => s + k(l[f]), 0));
  const teksAngka = (n) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });
  if (satuan.length === 1) {
    const total = Object.fromEntries(KUNCI_ANGKA.map((kunci) => [kunci, jum(kunci)]));
    const persenMasukStok = total.dipesan > 0 ? Math.min(100, Math.round((Math.min(total.masukStok, total.dipesan) / total.dipesan) * 100)) : 0;
    return { satuan: satuan[0], dijumlah: true, total, persenMasukStok, teks: `${teksAngka(total.masukStok)} / ${teksAngka(total.dipesan)} ${satuan[0]} masuk stok · ${teksAngka(total.datang)} sudah datang${total.diretur > 0 ? ` · ${teksAngka(total.diretur)} diretur (stok bersih ${teksAngka(total.stokBersih)})` : ""}` };
  }
  const terpenuhi = lines.filter((l) => k(l.belumMasukStok) <= 0).length;
  const persen = lines.length ? Math.round((lines.reduce((s, l) => s + (l.dipesan > 0 ? Math.min(1, l.masukStok / l.dipesan) : 0), 0) / lines.length) * 100) : 0;
  return { satuan: null, dijumlah: false, total: null, persenMasukStok: persen, teks: `${terpenuhi}/${lines.length} baris sudah masuk stok` };
}
