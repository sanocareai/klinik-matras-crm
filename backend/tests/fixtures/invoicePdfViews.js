// Fixture view invoice untuk tes snapshot PDF (bukan dari DB): bentuk SAMA dengan keluaran buildInvoiceView (services/invoice.js). Dipakai membuktikan bahwa
// refactor komponen dokumen bersama TIDAK mengubah tampilan invoice lama (hash konten halaman = golden yang diambil SEBELUM refactor).
const T = new Date("2026-09-12T03:00:00Z");
const dasar = () => ({
  invoice: { invoiceNumber: "INV-12092026-001", createdAt: T, namaTujuan: null, alamatTujuan: null, dueDate: null },
  order: { orderNumber: "RES-12092026-001", deliveryAddress: "Jl. Melati No. 5, RT 02/03, Beji", deliveryCity: "Depok", ukuranKasur: "160 × 200 cm" },
  orders: [{ orderNumber: "RES-12092026-001", ukuranKasur: "160 × 200 cm" }],
  customer: { nama: "Ibu Sari Wulandari", phone: "0812 3456 7890" },
  items: [{ nama: "Upgrade Fondasi Matras Sehat", harga: 2_500_000, orderNumber: "RES-12092026-001" }, { nama: "Ganti Kain Premium", harga: 1_250_000, orderNumber: "RES-12092026-001" }],
  nominal: { totalLayanan: 3_750_000, hargaSebelumDiskon: 3_750_000, diskonPersen: 0, nilaiDiskon: 0, ongkir: 0, totalTagihan: 3_750_000, dibayar: 0, sisa: 3_750_000, dpTarget: 0, bisaDP: false, modeDP: false, sumber: "ledger" },
  payments: [],
});
export const VIEWS = {
  sederhana: dasar(),
  diskonOngkirDibayar: (() => { const v = dasar(); v.nominal = { ...v.nominal, hargaSebelumDiskon: 4_000_000, diskonPersen: 10, nilaiDiskon: 400_000, promoCode: "SEHAT10", totalLayanan: 3_600_000, ongkir: 150_000, totalTagihan: 3_750_000, dibayar: 1_000_000, sisa: 2_750_000 }; v.invoice.dueDate = new Date("2026-09-30T00:00:00Z"); v.payments = [{ createdAt: T, method: "TRANSFER", amount: 500_000 }, { createdAt: new Date("2026-09-14T03:00:00Z"), method: "CASH", amount: 500_000 }]; return v; })(),
  modeDP: (() => { const v = dasar(); v.nominal = { ...v.nominal, modeDP: true, dpTarget: 1_000_000, dpKurang: 1_000_000, dibayar: 0 }; return v; })(),
  gabungan: (() => { const v = dasar(); v.orders = [{ orderNumber: "RES-12092026-001", ukuranKasur: "160 × 200 cm" }, { orderNumber: "RES-12092026-002", ukuranKasur: "180 × 200 cm" }]; v.items = [...v.items, { nama: "Sanitasi Kasur", harga: 300_000, orderNumber: "RES-12092026-002" }]; v.invoice.namaTujuan = "Hotel Discovery Ancol"; v.invoice.alamatTujuan = "Jl. Lodan Timur No. 7, Taman Impian Jaya Ancol, Pademangan, Jakarta Utara, DKI Jakarta 14430, Indonesia (lobi belakang, pintu service)"; return v; })(),
  panjangMultiHalaman: (() => { const v = dasar(); v.items = Array.from({ length: 24 }, (_, i) => ({ nama: `Layanan ${i + 1} — ${["Upgrade Fondasi", "Ganti Lapisan Busa", "Kain Cover Premium", "Sanitasi Steam"][i % 4]} paket lengkap kamar tipe ${i + 1}`, harga: 500_000 + i * 25_000, orderNumber: "RES-12092026-001" })); const total = v.items.reduce((a, x) => a + x.harga, 0); v.nominal = { ...v.nominal, totalLayanan: total, hargaSebelumDiskon: total, totalTagihan: total, sisa: total }; return v; })(),
};
