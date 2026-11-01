// Logika tampilan murni (tanpa React) untuk layar Pesanan Pembelian (PO) — diuji di tests/poRedesignLogika.test.js.
// HANYA presentasi: semua angka (dipesan, datang, masuk stok, ditagih) dihitung SERVER (services/finance/progresPO.js, purchaseOrder.js).
// Di sini tidak ada rumus baru, tidak ada konversi satuan, dan tidak ada penjumlahan lintas satuan.

import { nilaiBelumDiterima, teksJumlah, labelSatuan } from "../purchaseOrderLogic.js";

const BATAS_DAFTAR = 300; // services/finance/purchaseOrder.js daftarPO: take 300 (terbaru dulu)

/**
 * Cermin sisi klien dari izin server (constants/permissions.js). Server tetap penentu akhir (403); UI hanya menjelaskan.
 *   catat   = finance:post     → PO baru, ubah draf, batalkan draf, catat faktur, bayar uang muka, catat kedatangan
 *   setujui = finance:approve  → setujui PO, revisi jumlah
 *   admin   = finance:admin    → batalkan PO yang SUDAH disetujui, buat barang baru dari PO, ganti termin
 */
export function izinPO(user) {
  const roles = Array.isArray(user?.roles) && user.roles.length ? user.roles : (user?.role ? [user.role] : []);
  const ada = (...p) => roles.some((r) => p.includes(r));
  return { catat: ada("ADMIN", "OWNER", "FINANCE", "ACCOUNTANT"), setujui: ada("ADMIN", "OWNER", "FINANCE", "APPROVER"), admin: ada("ADMIN", "OWNER") };
}
export const ALASAN_IZIN = Object.freeze({
  catat: "Akun Anda tidak punya izin mencatat PO (Finance/Akuntan).",
  setujui: "Akun Anda tidak punya izin menyetujui (Finance/Approver).",
  admin: "Butuh Admin Keuangan — akun Anda tidak punya izin ini.",
});

/** Status PO. `arti` = kalimat pendek untuk Rincian; sengaja membedakan "masuk stok" dari "diterima" dan dari "sudah dibayar". */
export const STATUS_TAMPIL = Object.freeze({
  DRAFT: { label: "Draf", nada: "neutral", arti: "Belum disetujui. Gudang belum bisa membuat penerimaan dari PO ini." },
  DISETUJUI: { label: "Disetujui", nada: "biru", arti: "Sudah menjadi komitmen ke supplier. Menunggu barang masuk stok lewat Gudang." },
  DITERIMA_SEBAGIAN: { label: "Diterima Sebagian", nada: "orange", arti: "Sebagian barang baik sudah disimpan ke stok; sisanya belum." },
  SELESAI: { label: "Selesai", nada: "green", arti: "Semua jumlah yang dipesan sudah masuk stok. Ini tidak berarti faktur sudah dibayar." },
  DIBATALKAN: { label: "Dibatalkan", nada: "red", arti: "PO dibatalkan. Tidak bisa dibuatkan penerimaan lagi." },
});
export const statusTampil = (s) => STATUS_TAMPIL[s] || { label: s || "—", nada: "neutral", arti: "" };

/** Tab status — nilai `key` = parameter status ke server (sama dengan TAB_PO lama). */
export const TAB_PO_TAMPIL = Object.freeze([
  { key: "", label: "Semua" },
  { key: "DRAFT", label: "Draf" },
  { key: "DISETUJUI,DITERIMA_SEBAGIAN", label: "Berjalan" },
  { key: "SELESAI", label: "Selesai" },
  { key: "DIBATALKAN", label: "Dibatalkan" },
]);

/** Tiga KPI. Rumus & populasi SAMA dengan layar lama: dihitung dari daftar yang sedang dimuat (ikut tab status & pencarian). */
export function kpiPO(daftar) {
  const berjalan = (daftar || []).filter((p) => ["DISETUJUI", "DITERIMA_SEBAGIAN"].includes(p.status));
  return {
    berjalan: berjalan.length,
    draf: (daftar || []).filter((p) => p.status === "DRAFT").length,
    nilaiBelumMasukStok: berjalan.reduce((s, p) => s + nilaiBelumDiterima(p), 0),
  };
}

/** Keterangan cakupan angka KPI, supaya jelas bahwa angka ikut filter daftar (bukan seluruh PO). */
export function kalimatCakupan({ tab = "", q = "", jumlah = 0 }) {
  const sebut = [];
  const t = TAB_PO_TAMPIL.find((x) => x.key === tab);
  if (tab && t) sebut.push(`tahap ${t.label}`);
  if (String(q || "").trim()) sebut.push(`pencarian “${String(q).trim()}”`);
  const penuh = jumlah >= BATAS_DAFTAR ? ` Batas sudah tercapai: PO yang lebih lama tidak ikut dimuat dan tidak ikut dihitung.` : "";
  const dasar = `Daftar memuat maksimal ${BATAS_DAFTAR} PO terbaru, jadi ini bukan total seluruh PO.`;
  const ikut = sebut.length ? `Angka KPI mengikuti daftar yang dimuat (${sebut.join(", ")}).` : "Angka KPI mengikuti PO yang dimuat dan saringan yang sedang aktif.";
  return `${dasar} ${ikut}${penuh}`;
}

export function kalimatHasil({ jumlah = 0, tab = "", q = "" }) {
  const n = Number(jumlah).toLocaleString("id-ID");
  const t = TAB_PO_TAMPIL.find((x) => x.key === tab);
  const cari = String(q || "").trim();
  if (jumlah === 0) return cari || tab ? "Tidak ada PO yang cocok dengan saringan ini." : "Belum ada PO.";
  const dasar = `Menampilkan ${n} PO`;
  const ket = [tab && t ? t.label : null, cari ? `“${cari}”` : null].filter(Boolean).join(" · ");
  const batas = jumlah >= BATAS_DAFTAR ? ` (maksimal ${BATAS_DAFTAR} PO terbaru)` : "";
  return `${dasar}${ket ? ` · ${ket}` : ""}${batas}`;
}

/**
 * Ringkasan penerimaan satu PO untuk kolom daftar. Tiga angka dibedakan: DIPESAN, SUDAH DATANG (fisik, termasuk yang ditolak), MASUK STOK (baik & sudah disimpan).
 *   • semua baris satu satuan → jumlah aktual + satuan (angka dari po.progres.total, hasil server).
 *   • satuan campuran         → tidak dijumlah; "n dari m baris masuk stok penuh" + satu segmen per baris (tiap segmen = persentase barisnya sendiri).
 * Bentuk: { jenis: "satuan"|"campuran"|"draf"|"batal"|"kosong", judul, sub?, persen?, segmen?, selesai?, total? }
 */
export function ringkasPenerimaan(po) {
  const lines = po?.lines || [];
  if (po?.status === "DRAFT") return { jenis: "draf", judul: "Belum bisa diterima Gudang", sub: "Setujui PO dulu", persen: 0 };
  if (po?.status === "DIBATALKAN") return { jenis: "batal", judul: "Dibatalkan", sub: "Tidak ada penerimaan lagi", persen: 0 };
  if (lines.length === 0) return { jenis: "kosong", judul: "Tidak ada item", persen: 0 };
  const g = po.progres;
  const jumlahItem = lines.length;
  const itemTeks = jumlahItem > 1 ? ` · ${jumlahItem} item` : "";
  if (g?.dijumlah && g.total) {
    const t = g.total;
    const bagian = [];
    if (t.datang > 0) bagian.push(`tiba ${teksJumlah(t.datang)}`); else bagian.push("belum ada yang tiba");
    if (t.ditolak > 0) bagian.push(`ditolak ${teksJumlah(t.ditolak)}`);
    if (t.diretur > 0) bagian.push(`diretur ${teksJumlah(t.diretur)}`);
    return {
      jenis: "satuan",
      judul: `${teksJumlah(t.masukStok)} / ${teksJumlah(t.dipesan)} ${labelSatuan(g.satuan)} masuk stok`,
      sub: `${bagian.join(" · ")}${itemTeks}`,
      persen: Math.max(0, Math.min(100, Number(g.persenMasukStok) || 0)),
      total: t,
    };
  }
  const segmen = lines.map((l) => {
    const p = l.progres || {};
    const dipesan = Number(p.dipesan ?? l.dipesan ?? 0);
    const frac = dipesan > 0 ? Math.max(0, Math.min(1, Number(p.masukStok || 0) / dipesan)) : 0;
    return { frac, penuh: Number(p.belumMasukStok ?? 1) <= 0 && dipesan > 0, nama: l.kode || l.nama || "" };
  });
  const selesai = segmen.filter((s) => s.penuh).length;
  const satuan = [...new Set(lines.map((l) => l.satuan))];
  return {
    jenis: "campuran",
    judul: `${selesai} dari ${jumlahItem} baris masuk stok penuh`,
    sub: `Satuan berbeda (${satuan.map((u) => labelSatuan(u)).join(", ")}) — jumlah tidak dijumlahkan`,
    persen: null, segmen, selesai,
  };
}

/** Ringkasan satu baris PO untuk tabel Rincian: lima angka yang dibedakan, semua dari server. */
export function angkaBaris(l) {
  const p = l?.progres || {};
  return {
    dipesan: Number(l?.dipesan ?? p.dipesan ?? 0), sudahDatang: Number(p.datang ?? 0), masukStok: Number(p.masukStok ?? 0), belumMasukStok: Number(p.belumMasukStok ?? 0),
    belumDatang: Number(p.belumDatang ?? 0), menungguPengganti: Number(p.menungguPengganti ?? 0), diretur: Number(p.diretur ?? 0), diterimaBersih: Number(p.diterimaBersih ?? p.masukStok ?? 0),
    ditagih: Number(l?.ditagih ?? 0),
  };
}

/** Langkah di "Alur pembelian". Kalimat mengikuti perilaku aktual kode (purchaseOrder.js, hargaDariPO.js). */
export const ALUR_PEMBELIAN = Object.freeze([
  { no: 1, judul: "Buat PO sebagai draf", isi: "Finance memilih supplier dan bahan. Menyimpan draf tidak menambah stok dan tidak membuat jurnal. Namun harga bahan yang berubah langsung menjadi Harga Berlaku (HPP operasional) sejak PO disimpan, termasuk saat masih draf." },
  { no: 2, judul: "Setujui PO", isi: "PO menjadi komitmen ke supplier dan muncul di Gudang sebagai Barang Akan Datang. Setelah disetujui isi PO tidak bisa diubah; selisih jumlah ditangani lewat Revisi jumlah. Menyetujui tidak menulis harga lagi." },
  { no: 3, judul: "Catat barang tiba", isi: "Finance atau Gudang mencatat kedatangan lewat Catat Barang Tiba. Setiap pengiriman menjadi satu penerimaan sendiri; mencatat kedatangan belum menambah stok." },
  { no: 4, judul: "Periksa lalu Simpan ke Stok", isi: "Gudang memeriksa jumlah baik dan ditolak, lalu menekan Simpan ke Stok. Hanya langkah ini yang menambah stok dan persediaan (dengan jurnal)." },
  { no: 5, judul: "Faktur supplier dan pembayaran", isi: "Faktur dicatat dan dicocokkan per baris dengan barang baik yang sudah masuk stok. Faktur yang disetujui menjadi utang; pembayaran adalah langkah terpisah. PO berstatus Selesai tidak berarti faktur sudah dibayar." },
]);
export const CATATAN_TANPA_PO = "Penerimaan tanpa PO tetap bisa dibuat Gudang, tetapi ditandai Tanpa PO dan tidak ada pencocokan jumlah maupun harga.";

/** Dampak Harga Berlaku — kalimat tetap (perilaku aktual hargaDariPO.js), dipakai di dekat tombol simpan. */
export const DAMPAK_HARGA_SINGKAT = "Saat PO disimpan (termasuk sebagai draf), harga bahan yang berubah langsung menjadi Harga Berlaku untuk HPP operasional, bukan jurnal atau nilai persediaan Finance. Membatalkan PO tidak mengembalikan harga.";
export const DAMPAK_HARGA_RINCI = Object.freeze([
  "Berlaku sejak saat PO berhasil disimpan, tanpa tanggal mundur. Isian yang belum disimpan tidak mengubah harga; bila penyimpanan gagal, tidak ada harga yang berubah.",
  "Hanya baris yang harga, satuan, atau faktor konversinya berubah yang menulis harga. Mengubah jumlah saja, atau menyimpan ulang isi yang sama, tidak menulis harga.",
  "Dicatat per satuan stok dengan sumber nomor PO, baris, revisi, dan pelaku. Dipakai sebagai HPP operasional (Biaya Bahan per Unit, pemakaian bahan Gudang/Produksi).",
  "Tidak menambah stok, tidak mengubah nilai persediaan/jurnal Finance, dan tidak menghitung ulang pemakaian lama.",
  "Menyetujui atau membatalkan PO tidak menulis dan tidak mengembalikan harga. Mengubahnya kembali dilakukan manual di Stok → bahan → Ubah harga.",
]);

/** Pesan satu kalimat tentang apa yang menunggu di Gudang, tergantung status (untuk Rincian). */
export function langkahBerikut(po) {
  switch (po?.status) {
    case "DRAFT": return "Langkah berikut: periksa isi lalu Setujui, atau Ubah draf.";
    case "DISETUJUI": return "Langkah berikut: barang tiba, Gudang memeriksa dan Simpan ke Stok.";
    case "DITERIMA_SEBAGIAN": return "Langkah berikut: sisa barang tiba, atau Revisi jumlah bila sisanya tidak akan dikirim.";
    case "SELESAI": return "Pastikan fakturnya tercatat dan dibayar sesuai termin.";
    case "DIBATALKAN": return "PO dibatalkan.";
    default: return "";
  }
}

/** Aksi yang tersedia per status DAN izin. `alasan` terisi bila ditampilkan tetapi tidak aktif karena izin. Aturan status sama dengan aksiPO lama. */
export function aksiRincian(po, izin) {
  const s = po?.status;
  const baru = (cond, perlu, kunci) => (cond ? { tampil: true, aktif: izin[perlu], alasan: izin[perlu] ? null : ALASAN_IZIN[kunci || perlu] } : { tampil: false });
  return {
    ubah: baru(s === "DRAFT", "catat"),
    setujui: baru(s === "DRAFT", "setujui"),
    batalkan: s === "DRAFT" ? baru(true, "catat") : s === "DISETUJUI" ? baru(true, "admin") : { tampil: false },
    revisi: baru(s === "DISETUJUI" || s === "DITERIMA_SEBAGIAN", "setujui"),
    faktur: baru(["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"].includes(s), "catat"),
  };
}

/** Keterangan termin di Rincian. Jatuh tempo TIDAK ada di PO: dihitung per penerimaan (dari tanggal barang tiba) bila termin hari/tunai, atau diisi saat faktur dicatat. */
export function keteranganTermin(termin) {
  if (!termin) return "Belum ada termin di PO ini. Jatuh tempo diisi saat faktur dicatat.";
  if (termin.jenis === "TANGGAL_KHUSUS") return "Tanggal khusus: tanggalnya diisi saat faktur dicatat.";
  const dasar = "Jatuh tempo dihitung per penerimaan, dari tanggal barang tiba.";
  return termin.alasan ? "Diganti: " + termin.alasan + ". " + dasar : dasar;
}

// ── Nomor faktur supplier (atribut TAGIHAN/faktur, bukan header PO) ─────────────────────────────────────────────────────────────────────────
// Kolom yang dipakai: fin_supplier_bills.supplier_ref ("Nomor faktur/invoice menurut SUPPLIER", tidak unik global). Nomor internal = billNumber (BILL-…); nomor PO = poNumber (PO-…).
// Tidak ada fitur Nomor Faktur Pajak di sistem. Aturan "bermakna" sama dengan server (jenisTagihan.nomorFakturBermakna): isian pengisi seperti "---" bukan nomor faktur.
export const nomorSupplierBermakna = (ref) => { const t = String(ref ?? "").trim(); return /[\p{L}\p{N}]/u.test(t) ? t : null; };
export const STATUS_FAKTUR_AKTIF = Object.freeze(["DRAFT", "MENUNGGU_APPROVAL", "DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"]);
export const NOMOR_SUPPLIER_MAKS = 100; // sama dengan server (koreksiLanjutan.normalisasiInfoTagihan)
export const TEKS_NOMOR_BELUM_DIISI = "Nomor supplier belum diisi";
export const ALASAN_LENGKAPI = "Melengkapi nomor faktur supplier yang belum diisi";

/**
 * Semua faktur/tagihan yang terhubung ke PO ini, satu baris per dokumen:
 *   • faktur atas PO (po.faktur; purchaseOrderId = PO ini), dan
 *   • tagihan LAMA yang tertaut lewat penerimaan barang PO ini (goodsReceiptId) tetapi tidak punya purchaseOrderId.
 * Tidak ada penautan otomatis berdasarkan nominal/nama: hanya hubungan yang tersimpan di data.
 */
export function daftarFakturPO(po) {
  const hasil = new Map();
  for (const f of po?.faktur || []) {
    hasil.set(f.id, { id: f.id, nomorInternal: f.billNumber, nomorSupplier: nomorSupplierBermakna(f.supplierRef), mentah: f.supplierRef ?? "", status: f.status, nilai: f.amount ?? null, sumber: "PO", penerimaan: null });
  }
  for (const r of po?.penerimaan || []) {
    for (const t of r.finSupplierBills || []) {
      if (hasil.has(t.id) || t.lewatPO) continue;
      hasil.set(t.id, { id: t.id, nomorInternal: t.billNumber, nomorSupplier: nomorSupplierBermakna(t.supplierRef), mentah: t.supplierRef ?? "", status: t.status, nilai: t.amount ?? null, sumber: "PENERIMAAN", penerimaan: r.receiptNumber });
    }
  }
  return [...hasil.values()];
}

export function ringkasKelengkapanFaktur(daftar) {
  const aktif = daftar.filter((d) => !["DITOLAK", "DIBATALKAN"].includes(d.status));
  const belum = aktif.filter((d) => !d.nomorSupplier).length;
  return { jumlah: daftar.length, aktif: aktif.length, belumBernomor: belum, lengkap: daftar.length > 0 && belum === 0 };
}

/** Validasi isian nomor. Nilai dipertahankan apa adanya (nol di depan, garis miring, tanda hubung); hanya spasi luar dipangkas. */
export function periksaNomorSupplier(isian, awal = "") {
  const nilai = String(isian ?? "").trim();
  if (!nilai) return { nilai, galat: "Isi nomor faktur supplier." };
  if (!nomorSupplierBermakna(nilai)) return { nilai, galat: "Isi nomor yang tertera di faktur supplier (memuat huruf atau angka)." };
  if (nilai.length > NOMOR_SUPPLIER_MAKS) return { nilai, galat: `Terlalu panjang (maksimal ${NOMOR_SUPPLIER_MAKS} karakter).` };
  if (nilai === String(awal ?? "").trim()) return { nilai, galat: null, sama: true };
  return { nilai, galat: null, sama: false };
}

/** Faktur lain dari SUPPLIER YANG SAMA dengan nomor yang sama (tanpa membedakan huruf besar/kecil) yang masih aktif — aturan yang sama dengan server saat menyimpan/menyetujui. Dokumen itu sendiri tidak dihitung. */
export function cariDuplikatNomor({ tagihan, supplierId, nomor, kecualiId = null }) {
  const n = nomorSupplierBermakna(nomor)?.toLowerCase();
  if (!n) return [];
  return (tagihan || []).filter((b) => b.id !== kecualiId && (b.supplierId ?? b.supplier?.id) === supplierId && String(b.supplierRef ?? "").trim().toLowerCase() === n && STATUS_FAKTUR_AKTIF.includes(b.status));
}
