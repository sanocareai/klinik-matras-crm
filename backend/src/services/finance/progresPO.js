// PROGRES PENERIMAAN PO — SATU-SATUNYA tempat angka progres dihitung (Okt 2026).
// Dipakai API Finance & Gudang (daftar/kartu/detail), batas jumlah datang di Catat Barang Tiba, dan ringkasan PO. Frontend TIDAK menghitung ulang — ia hanya menampilkan angka & definisi dari sini.
//
// Definisi (urutan tampil). Tiap angka per baris PO, satuan utama PO:
//   Dipesan            jumlah di PO.
//   Datang             total yang TERCATAT TIBA di semua pengiriman (penerimaan berstatus Tiba/Diperiksa/Siap Disimpan/Sudah Masuk Stok), termasuk yang kemudian ditolak.
//   Belum datang       Dipesan − Datang aktif. "Datang aktif" = datang dikurangi yang ditolak (barang ditolak harus dikirim ulang, jadi kembali menjadi belum datang).
//   Belum diperiksa    sudah tiba, tetapi hasil baik/ditolak belum diisi Gudang.
//   Ditolak            hasil pemeriksaan: ditolak.
//   Baik belum disimpan hasil pemeriksaan baik, tetapi Simpan ke Stok belum ditekan.
//   Masuk stok         baik yang SUDAH disimpan ke stok (satu-satunya yang menambah stok).
//   Belum masuk stok   Dipesan − Masuk stok.
// Invarian (data wajar): Datang = Belum diperiksa + Ditolak + Baik belum disimpan + Masuk stok.
// Jumlah pendamping (mis. lembar) hanya informasi: dijumlah apa adanya, tidak ikut hitungan di atas.
//
// Murni baca. Tidak ada tulis stok/jurnal di sini.

const k = (v) => Math.round(Number(v ?? 0) * 1000);
const dariK = (n) => n / 1000;

const STATUS_SUDAH_TIBA = ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"];
const STATUS_BELUM_DISIMPAN = ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"];

/** Daftar kolom progres + definisinya — dikirim server supaya semua layar memakai label & arti yang sama. */
export const DEFINISI_PROGRES = Object.freeze([
  { kunci: "dipesan", label: "Dipesan", definisi: "Jumlah yang dipesan di PO." },
  { kunci: "datang", label: "Datang", definisi: "Total yang tercatat tiba di semua pengiriman, termasuk yang kemudian ditolak." },
  { kunci: "belumDatang", label: "Belum datang", definisi: "Dipesan dikurangi datang aktif (datang dikurangi yang ditolak). Barang yang ditolak dihitung belum datang karena harus dikirim ulang." },
  { kunci: "belumDiperiksa", label: "Belum diperiksa", definisi: "Sudah tiba, tetapi hasil baik/ditolak belum diisi Gudang." },
  { kunci: "ditolak", label: "Ditolak", definisi: "Hasil pemeriksaan: barang yang ditolak." },
  { kunci: "baikBelumDisimpan", label: "Baik belum disimpan", definisi: "Lolos pemeriksaan, tetapi Simpan ke Stok belum dilakukan." },
  { kunci: "masukStok", label: "Masuk stok", definisi: "Barang baik yang sudah disimpan ke stok. Hanya ini yang menambah stok." },
  { kunci: "belumMasukStok", label: "Belum masuk stok", definisi: "Dipesan dikurangi masuk stok." },
]);

/** Progres per baris PO: Map<purchaseOrderLineId, { dipesan, datang, belumDatang, belumDiperiksa, ditolak, baikBelumDisimpan, masukStok, belumMasukStok, pendampingAktual }>. */
export async function hitungProgresPO(db, poId) {
  const po = await db.finPurchaseOrder.findUnique({ where: { id: poId }, select: { lines: { select: { id: true, qty: true } } } });
  if (!po) return new Map();
  const baris = await db.goodsReceiptLine.findMany({
    where: { purchaseOrderLine: { purchaseOrderId: poId } },
    select: { purchaseOrderLineId: true, receivedQty: true, acceptedQty: true, rejectedQty: true, companionQty: true, goodsReceipt: { select: { status: true } } },
  });
  const peta = new Map(po.lines.map((l) => [l.id, { dipesanK: k(l.qty), datangK: 0, aktifK: 0, belumDiperiksaK: 0, ditolakK: 0, baikBelumDisimpanK: 0, masukStokK: 0, pendampingK: 0, adaPendamping: false }]));
  for (const b of baris) {
    const a = peta.get(b.purchaseOrderLineId);
    if (!a) continue;
    const st = b.goodsReceipt.status;
    if (!STATUS_SUDAH_TIBA.includes(st)) continue;
    const datang = k(b.receivedQty); const baik = k(b.acceptedQty); const tolak = k(b.rejectedQty);
    a.datangK += datang; a.ditolakK += tolak;
    if (b.companionQty !== null && b.companionQty !== undefined) { a.pendampingK += k(b.companionQty); a.adaPendamping = true; }
    if (st === "COMPLETED") { a.masukStokK += baik; a.aktifK += baik; } // yang sudah disimpan: baik-lah yang dihitung datang aktif
    else {
      a.aktifK += Math.max(0, datang - tolak);
      a.baikBelumDisimpanK += baik;
      if (STATUS_BELUM_DISIMPAN.includes(st) && st !== "READY_FOR_PUTAWAY") a.belumDiperiksaK += Math.max(0, datang - baik - tolak);
    }
  }
  const hasil = new Map();
  for (const [id, a] of peta) {
    hasil.set(id, {
      dipesan: dariK(a.dipesanK), datang: dariK(a.datangK), belumDatang: dariK(Math.max(0, a.dipesanK - a.aktifK)),
      belumDiperiksa: dariK(a.belumDiperiksaK), ditolak: dariK(a.ditolakK), baikBelumDisimpan: dariK(a.baikBelumDisimpanK),
      masukStok: dariK(a.masukStokK), belumMasukStok: dariK(Math.max(0, a.dipesanK - a.masukStokK)),
      pendampingAktual: a.adaPendamping ? dariK(a.pendampingK) : null,
    });
  }
  return hasil;
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
    const total = Object.fromEntries(DEFINISI_PROGRES.map((d) => [d.kunci, jum(d.kunci)]));
    const persenMasukStok = total.dipesan > 0 ? Math.min(100, Math.round((Math.min(total.masukStok, total.dipesan) / total.dipesan) * 100)) : 0;
    return { satuan: satuan[0], dijumlah: true, total, persenMasukStok, teks: `${teksAngka(total.masukStok)} / ${teksAngka(total.dipesan)} ${satuan[0]} masuk stok · ${teksAngka(total.datang)} sudah datang` };
  }
  const terpenuhi = lines.filter((l) => k(l.belumMasukStok) <= 0).length;
  const persen = lines.length ? Math.round((lines.reduce((s, l) => s + (l.dipesan > 0 ? Math.min(1, l.masukStok / l.dipesan) : 0), 0) / lines.length) * 100) : 0;
  return { satuan: null, dijumlah: false, total: null, persenMasukStok: persen, teks: `${terpenuhi}/${lines.length} baris sudah masuk stok` };
}

/** Batas yang masih boleh dicatat datang untuk satu baris (sama dengan "Belum datang"). */
export const sisaBolehDatang = (q) => q.belumDatang;
