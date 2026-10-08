// Fixture view PO untuk tes render PDF (bentuk = keluaran bangunViewPO).
const T = new Date("2026-10-08T03:00:00Z");
const baris = (i, ext = {}) => ({ kode: `BHN-${String(i).padStart(3, "0")}`, nama: ["Lem I-SR 1037 13 KG", "Busa Rebonded R50 Sheet", "Kain Knit Quilt Premium", "Pocket Spring Zona 7"][i % 4] + ` tipe ${i}`, satuan: ["KG", "SHEET", "METER", "PCS"][i % 4], catatan: null, dipesan: 10 + i, hargaSatuan: 43_290 + i * 1_000, nilaiDipesan: (10 + i) * (43_290 + i * 1_000), ...ext });
const dasar = () => {
  const lines = [baris(0), baris(1), baris(2)];
  return {
    po: { id: "x", poNumber: "PO-08102026-001", status: "DISETUJUI", orderDate: T, expectedDate: new Date("2026-10-15T00:00:00Z"), notes: "Kirim ke Gudang Utama sebelum Jumat", approvedBy: { name: "Dewi Finance" }, approvedAt: T, cancelledAt: null, cancelReason: null, lines, totalDipesan: lines.reduce((a, l) => a + l.nilaiDipesan, 0) },
    supplier: { kode: "SUP-001", nama: "PT ESA BUMINDO", alamat: "Jl. Industri Raya Blok C-12, Kawasan Industri Jatake, Tangerang, Banten 15710", telepon: "021 5551 2345", email: "penjualan@esabumindo.co.id" },
    termin: { label: "30 hari", sumber: "Mengikuti pengaturan supplier" },
    revisi: { jumlah: 0, terakhir: null },
    perusahaan: { namaPenerima: "Klinik Matras — Gudang Penerimaan", alamatPenerimaan: "Jl. Raya Keadilan, Gg Asrama Polri, No. 81, RT 5/12, Pancoran Mas, Kota Depok", whatsapp: "0851 8728 3900" },
  };
};
export const VIEWS_PO = {
  disetujui: dasar(),
  draf: (() => { const v = dasar(); v.po.status = "DRAFT"; v.po.approvedBy = null; v.po.approvedAt = null; v.termin = { label: null, sumber: null }; return v; })(),
  revisi: (() => { const v = dasar(); v.po.status = "DITERIMA_SEBAGIAN"; v.revisi = { jumlah: 2, terakhir: new Date("2026-10-10T03:00:00Z") }; v.termin = { label: "Tunai/COD", sumber: "Ditetapkan pada PO ini" }; return v; })(),
  dibatalkan: (() => { const v = dasar(); v.po.status = "DIBATALKAN"; v.po.cancelledAt = new Date("2026-10-09T03:00:00Z"); v.po.cancelReason = "Supplier kehabisan stok"; return v; })(),
  panjang: (() => { const v = dasar(); v.po.lines = Array.from({ length: 22 }, (_, i) => baris(i, i % 5 === 0 ? { catatan: "Kemasan karung 25 kg, label batch wajib" } : {})); v.po.totalDipesan = v.po.lines.reduce((a, l) => a + l.nilaiDipesan, 0); v.po.notes = "Pengiriman bertahap dua kali, kirim surat jalan bersamaan dengan barang. " + "Konfirmasi ke Gudang minimal sehari sebelum pengiriman. ".repeat(3); return v; })(),
  supplierMinim: (() => { const v = dasar(); v.supplier = { kode: "SUP-009", nama: "Toko Bahan Pak Haji Sulaiman dan Saudara Cabang Pasar Baru Bandung Utara", alamat: "", telepon: "", email: "" }; return v; })(),
};
