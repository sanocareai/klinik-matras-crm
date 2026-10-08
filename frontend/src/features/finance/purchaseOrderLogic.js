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

// ── Faktur supplier atas PO (Fase 2) ─────────────────────────────────────
// Angka tersedia/sudah ditagih/diterima baik dihitung SERVER; layar ini hanya memberi petunjuk dini (peringatan "akan tertahan") — keputusan tertahan ada di server.

export const LABEL_STATUS_FAKTUR = { MENUNGGU_APPROVAL: "Menunggu Persetujuan", DRAFT: "Draf", DISETUJUI: "Disetujui", DIBAYAR_SEBAGIAN: "Dibayar Sebagian", LUNAS: "Lunas", DITOLAK: "Ditolak", DIBATALKAN: "Dibatalkan" };
export const FAKTUR_TERBUKA = ["DRAFT", "MENUNGGU_APPROVAL"];

/** Isian awal formulir faktur dari pandangan penagihan PO: tiap baris yang masih punya barang baik belum ditagih terisi sejumlah tersedia pada harga PO. */
export function formFakturAwal(p, hariIni) {
  return {
    supplierRef: "", billDate: hariIni, dueDate: "", description: "", reason: "", receiptIds: [],
    lines: p.barisPO.map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, pakai: l.tersedia > 0, qty: l.tersedia > 0 ? String(l.tersedia) : "", unitPrice: String(l.hargaPO) })),
  };
}

/** Isian formulir dari evaluasi faktur yang sudah ada (mengubah faktur yang belum disetujui). */
export function formFakturDariEvaluasi(ev, pandangan) {
  const ada = new Map(ev.barisFaktur.map((b) => [b.purchaseOrderLineId, b]));
  return {
    supplierRef: ev.supplierRef || "", billDate: ev.billDate ? String(ev.billDate).slice(0, 10) : "", dueDate: "", description: "", reason: "", receiptIds: ev.penerimaanTerpilih || [],
    lines: pandangan.barisPO.map((l) => {
      const b = ada.get(l.purchaseOrderLineId);
      return { purchaseOrderLineId: l.purchaseOrderLineId, pakai: !!b, qty: b ? String(b.diajukanIni) : "", unitPrice: b ? String(b.hargaFaktur) : String(l.hargaPO) };
    }),
  };
}

const dua = (v) => Math.abs(Number(v) * 100 - Math.round(Number(v) * 100)) < 1e-6;
const tiga = (v) => Math.abs(Number(v) * 1000 - Math.round(Number(v) * 1000)) < 1e-6;

/** Galat satu baris faktur yang dipakai; null = valid. */
export function galatBarisFaktur(l) {
  const q = Number(l.qty); const h = Number(l.unitPrice);
  if (!(q > 0)) return "Jumlah faktur harus lebih dari 0";
  if (!tiga(q)) return "Jumlah maksimal 3 angka di belakang koma";
  if (!(h > 0)) return "Harga faktur harus lebih dari 0";
  if (!dua(h)) return "Harga faktur maksimal 2 angka di belakang koma";
  return null;
}

export function galatFaktur(f, { edit = false } = {}) {
  if (!f.supplierRef.trim()) return "Isi nomor faktur supplier";
  if (!f.billDate) return "Isi tanggal faktur";
  if (f.dueDate && f.dueDate < f.billDate) return "Jatuh tempo tidak boleh sebelum tanggal faktur";
  const dipakai = f.lines.filter((l) => l.pakai);
  if (dipakai.length === 0) return "Pilih minimal satu baris yang difakturkan";
  for (const l of dipakai) { const g = galatBarisFaktur(l); if (g) return g; }
  if (edit && f.reason.trim().length < 3) return "Isi alasan perubahan";
  return null;
}

export const subtotalFaktur = (l) => (l.pakai ? Math.round(Number(l.qty || 0) * Number(l.unitPrice || 0) * 100) / 100 : 0);
export const totalFaktur = (lines) => lines.reduce((s, l) => s + subtotalFaktur(l), 0);

/** Petunjuk dini per baris: jumlah > tersedia = akan tertahan; harga ≠ harga PO = perlu tinjauan harga. */
export function petunjukBaris(l, baris) {
  if (!l.pakai) return null;
  const petunjuk = [];
  if (Number(l.qty) > baris.tersedia + 1e-9) petunjuk.push({ jenis: "tertahan", teks: `Melebihi barang baik yang belum ditagih (${teksJumlah(baris.tersedia)}) — faktur akan tertahan` });
  if (Number(l.unitPrice) !== baris.hargaPO && Number(l.unitPrice) > 0) petunjuk.push({ jenis: "harga", teks: `Beda dari harga PO (${baris.hargaPO}) — perlu tinjauan Finance` });
  return petunjuk;
}

export function bodyFaktur(f, { edit = false } = {}) {
  return {
    supplierRef: f.supplierRef.trim(), billDate: f.billDate, dueDate: f.dueDate || undefined, description: f.description.trim() || undefined,
    receiptIds: f.receiptIds,
    lines: f.lines.filter((l) => l.pakai).map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
    ...(edit && { reason: f.reason.trim() }),
  };
}

/** Status tampilan satu faktur dari evaluasi server. */
export function statusFaktur(ev) {
  if (!ev) return { label: "—", variant: "neutral" };
  if (FAKTUR_TERBUKA.includes(ev.status)) {
    if (ev.tertahan) return { label: "Tertahan", variant: "red" };
    if (ev.perluTinjauanHarga) return { label: "Perlu tinjauan harga", variant: "orange" };
    return { label: "Siap disetujui", variant: "green" };
  }
  return { label: LABEL_STATUS_FAKTUR[ev.status] || ev.status, variant: ev.status === "DIBATALKAN" || ev.status === "DITOLAK" ? "neutral" : "accent" };
}
