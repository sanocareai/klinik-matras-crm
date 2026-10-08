// Logika murni layar Purchase Order bahan baku (tanpa React) — supaya aturan tampilan bisa dites tanpa browser.
// Angka kuantitas (dipesan, diterima baik, ditolak, belum diterima, ditagih) SELALU dari server; di sini hanya pemformatan dan validasi isian.

export const STATUS_PO = {
  DRAFT: { label: "Draf", variant: "neutral" },
  DISETUJUI: { label: "Disetujui", variant: "accent" },
  DITERIMA_SEBAGIAN: { label: "Diterima Sebagian", variant: "orange" },
  SELESAI: { label: "Selesai", variant: "green" },
  DIBATALKAN: { label: "Dibatalkan", variant: "red" },
};

// Tab daftar: nilai `status` dikirim ke server (boleh beberapa dipisah koma).
export const TAB_PO = [
  { key: "", label: "Semua" },
  { key: "DRAFT", label: "Draf" },
  { key: "DISETUJUI,DITERIMA_SEBAGIAN", label: "Berjalan" },
  { key: "SELESAI", label: "Selesai" },
  { key: "DIBATALKAN", label: "Dibatalkan" },
];

export const NAMA_EVENT_PO = {
  DIBUAT: "PO dibuat",
  DIUBAH: "Draf diubah",
  DISETUJUI: "PO disetujui",
  DIBATALKAN: "PO dibatalkan",
  REVISI_JUMLAH: "Jumlah direvisi",
  PENERIMAAN_DITEMPATKAN: "Penerimaan ditempatkan ke stok",
  STATUS_BERUBAH: "Status berubah",
};

export const LABEL_STATUS_PENERIMAAN = {
  DRAFT: "Draft", SCHEDULED: "Dijadwalkan", ARRIVED: "Tiba", INSPECTION: "Pemeriksaan",
  READY_FOR_PUTAWAY: "Siap Ditempatkan", COMPLETED: "Selesai", REJECTED: "Ditolak",
};

export const baris0 = () => ({ materialId: "", qty: "", unitPrice: "" });

/** Format jumlah: tanpa nol berlebih, maksimal 3 desimal, pemisah Indonesia. */
export function teksJumlah(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("id-ID", { maximumFractionDigits: 3 });
}

/** Subtotal baris isian (rupiah). Isian kosong/tak valid = 0. */
export function subtotal(l) {
  const q = Number(l.qty); const h = Number(l.unitPrice);
  return Number.isFinite(q) && Number.isFinite(h) ? Math.round(q * h * 100) / 100 : 0;
}
export const totalIsian = (lines) => lines.reduce((s, l) => s + subtotal(l), 0);

/** Pesan galat per baris isian; null = valid. Aturan sama dengan server (server tetap yang memutuskan). */
export function galatBaris(l) {
  if (!l.materialId) return "Pilih item";
  const q = Number(l.qty);
  if (!(q > 0)) return "Jumlah harus lebih dari 0";
  if (Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) return "Jumlah maksimal 3 angka di belakang koma";
  const h = Number(l.unitPrice);
  if (!Number.isInteger(h) || h <= 0) return "Harga satuan harus rupiah bulat lebih dari 0";
  return null;
}

/** Galat keseluruhan formulir PO; null = boleh disimpan. */
export function galatFormulir(f) {
  if (!f.supplierId) return "Pilih supplier";
  if (!f.orderDate) return "Isi tanggal PO";
  if (f.expectedDate && f.expectedDate < f.orderDate) return "Estimasi kedatangan tidak boleh sebelum tanggal PO";
  if (f.lines.length === 0) return "Tambahkan minimal satu item";
  const ganda = new Set();
  for (const [i, l] of f.lines.entries()) {
    const g = galatBaris(l);
    if (g) return `Baris ${i + 1}: ${g}`;
    if (ganda.has(l.materialId)) return `Baris ${i + 1}: item yang sama sudah ada — gabungkan jadi satu baris`;
    ganda.add(l.materialId);
  }
  return null;
}

/** Isian formulir dari PO yang ada (mengedit draf). */
export function formDariPO(po) {
  return {
    supplierId: po.supplier.id,
    orderDate: String(po.orderDate).slice(0, 10),
    expectedDate: po.expectedDate ? String(po.expectedDate).slice(0, 10) : "",
    notes: po.notes || "",
    lines: po.lines.map((l) => ({ materialId: l.materialId, qty: String(l.dipesan), unitPrice: String(l.hargaSatuan) })),
  };
}

export function bodyDariForm(f) {
  return {
    supplierId: f.supplierId, orderDate: f.orderDate, expectedDate: f.expectedDate || null, notes: f.notes.trim() || null,
    lines: f.lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
  };
}

/** Ringkasan progres satu PO untuk daftar: total diterima baik vs dipesan per baris (dijumlah hanya bila satuannya sama). */
export function ringkasProgres(po) {
  const satuan = new Set(po.lines.map((l) => l.satuan));
  if (satuan.size !== 1) return { teks: `${po.lines.filter((l) => l.belumDiterima <= 0).length}/${po.lines.length} baris terpenuhi`, persen: persenBaris(po) };
  const dipesan = po.lines.reduce((s, l) => s + l.dipesan, 0);
  const diterima = po.lines.reduce((s, l) => s + Math.min(l.diterimaBaik, l.dipesan), 0);
  return { teks: `${teksJumlah(diterima)} / ${teksJumlah(dipesan)} ${[...satuan][0]}`, persen: dipesan > 0 ? Math.min(100, Math.round((diterima / dipesan) * 100)) : 0 };
}
function persenBaris(po) {
  const bagian = po.lines.map((l) => (l.dipesan > 0 ? Math.min(1, l.diterimaBaik / l.dipesan) : 0));
  return bagian.length ? Math.round((bagian.reduce((a, b) => a + b, 0) / bagian.length) * 100) : 0;
}

/** Nilai barang yang masih ditunggu (belum diterima × harga) untuk PO yang berjalan. */
export function nilaiBelumDiterima(po) {
  if (!["DISETUJUI", "DITERIMA_SEBAGIAN"].includes(po.status)) return 0;
  return po.lines.reduce((s, l) => s + l.belumDiterima * (l.hargaSatuan ?? 0), 0);
}

/** Aksi yang masuk akal per status. Server tetap menegakkan izin; ini hanya menyembunyikan tombol yang pasti ditolak. */
export function aksiPO(po) {
  switch (po.status) {
    case "DRAFT": return { ubah: true, setujui: true, batalkan: true, revisi: false };
    case "DISETUJUI": return { ubah: false, setujui: false, batalkan: true, revisi: true };
    case "DITERIMA_SEBAGIAN": return { ubah: false, setujui: false, batalkan: false, revisi: true };
    default: return { ubah: false, setujui: false, batalkan: false, revisi: false };
  }
}

/** Kalimat riwayat untuk tampilan (aktor + waktu ditampilkan terpisah oleh UI). */
export function kalimatEvent(e) {
  const m = e.metadata || {};
  switch (e.type) {
    case "REVISI_JUMLAH": return `Jumlah direvisi ${teksJumlah(m.sebelum)} → ${teksJumlah(m.sesudah)}${e.note ? ` — ${e.note}` : ""}`;
    case "DIBATALKAN": return `PO dibatalkan${e.note ? ` — ${e.note}` : ""}`;
    case "PENERIMAAN_DITEMPATKAN": return `Penerimaan ${e.note || ""} ditempatkan ke stok`.replace("  ", " ");
    case "STATUS_BERUBAH": return `Status ${STATUS_PO[m.dari]?.label || m.dari} → ${STATUS_PO[m.ke]?.label || m.ke}`;
    default: return NAMA_EVENT_PO[e.type] || e.type;
  }
}
