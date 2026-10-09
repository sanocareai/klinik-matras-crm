// Logika murni layar Purchase Order bahan baku (tanpa React) — supaya aturan tampilan bisa dites tanpa browser.
// Angka kuantitas (dipesan, diterima baik, ditolak, belum diterima, ditagih) SELALU dari server; di sini hanya pemformatan dan validasi isian.

import { bodyTermin } from "./terminLogic.js";
import { UNIT_LABEL } from "../warehouse/inventoryReal.js";
import { pendamping0, pendampingDariPO, bodyPendamping, galatPendamping } from "../kedatangan/kedatanganLogic.js";

// Termin PO: hanya mengganti termin (admin + alasan); jatuh tempo dihitung saat faktur dibuat.
const bodyTerminPO = (t) => {
  const b = bodyTermin(t);
  return t?.ganti ? { terminJenis: b.terminJenis, terminHari: b.terminHari, alasanTermin: b.alasanTermin } : {};
};

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
  PENERIMAAN_DITEMPATKAN: "Penerimaan disimpan ke stok",
  STATUS_BERUBAH: "Status berubah",
};

export const LABEL_STATUS_PENERIMAAN = {
  DRAFT: "Draft", SCHEDULED: "Dijadwalkan", ARRIVED: "Tiba", INSPECTION: "Pemeriksaan",
  READY_FOR_PUTAWAY: "Siap Disimpan", COMPLETED: "Sudah Masuk Stok", REJECTED: "Ditolak",
};

export const baris0 = () => ({ materialId: "", qty: "", unitPrice: "", pendamping: pendamping0() });

// ── SKU baru langsung dari PO + konversi satuan beli → stok ──────────────────────────────────────────
// Barang baru HANYA hidup di isian formulir (l.materialBaru) sampai PO disimpan — server membuat SKU, katalog supplier, dan PO dalam satu transaksi.
// Aturan di sini = petunjuk dini; server tetap yang memutuskan (duplikat, izin, presisi).

// Label satuan SATU sumber dengan Gudang (inventoryReal.UNIT_LABEL) supaya "dus"/"kaleng" sama di PO, Penerimaan, dan stok.
export const SATUAN_OPSI = Object.entries(UNIT_LABEL);
export const labelSatuan = (u) => SATUAN_OPSI.find(([k]) => k === u)?.[1] ?? (u || "");
export const JENIS_SKU_OPSI = [
  { key: "BAHAN_PRODUKSI", label: "Bahan Produksi", hint: "Tersedia di katalog Produksi (tidak otomatis masuk BOM mana pun)." },
  { key: "PERLENGKAPAN_STOK", label: "Perlengkapan Stok", hint: "Hanya untuk Gudang; tidak muncul sebagai bahan Produksi." },
];
export const labelJenisSku = (k) => JENIS_SKU_OPSI.find((j) => j.key === k)?.label ?? "—";
export const PESAN_NON_STOK = "Jasa dan barang non-stok tidak dibuat sebagai SKU. Catat lewat Pengeluaran, Pengajuan Biaya, atau Tagihan Supplier.";

export const materialBaru0 = () => ({
  nama: "", kategori: "", jenis: "", spesifikasi: "", satuanBeli: "", satuanStok: "", faktorKonversi: "",
  namaSupplier: "", kodeSupplier: "", moq: "", estimasiKirimHari: "", lokasi: "", catatan: "", konfirmasiMirip: false, alasanMirip: "",
});

const desimal = (v) => { const s = String(v ?? ""); const i = s.indexOf("."); return i < 0 ? 0 : s.length - i - 1; };

/** Satuan beli efektif baris: barang baru → isian modal; material yang ada → pilihan baris (kosong = satuan stok). */
export function satuanStokBaris(l, unitStok = null) { return l.materialBaru ? l.materialBaru.satuanStok : unitStok; }
export function satuanBeliBaris(l, unitStok = null) {
  const stok = satuanStokBaris(l, unitStok);
  return (l.materialBaru ? l.materialBaru.satuanBeli : l.satuanBeli) || stok || null;
}
/** { satuanBeli, satuanStok, faktor } bila baris berkonversi; null bila tanpa konversi (atau satuan stok belum diketahui). */
export function infoKonversi(l, unitStok = null) {
  const stok = satuanStokBaris(l, unitStok);
  const beli = satuanBeliBaris(l, unitStok);
  if (!stok || !beli || beli === stok) return null;
  const faktor = Number(l.materialBaru ? l.materialBaru.faktorKonversi : l.faktorKonversi);
  return { satuanBeli: beli, satuanStok: stok, faktor };
}
/** Jumlah dalam satuan stok = jumlah beli × faktor (null bila tanpa konversi / isian belum lengkap). */
export function qtyStok(l, unitStok = null) {
  const k = infoKonversi(l, unitStok);
  const q = Number(l.qty);
  if (!k || !(k.faktor > 0) || !(q > 0)) return null;
  return Math.round(q * k.faktor * 1e6) / 1e6;
}
/** Kalimat "Setara dengan 24 kaleng" untuk layar & PDF; null bila tanpa konversi. */
export function teksSetara(l, unitStok = null) {
  const n = qtyStok(l, unitStok); const k = infoKonversi(l, unitStok);
  return n == null ? null : `Setara dengan ${teksJumlah(n)} ${labelSatuan(k.satuanStok)}`;
}

/** Galat isian modal "Buat Barang Baru"; null = lengkap. */
export function galatMaterialBaru(m) {
  if (!m) return "Isi data barang baru";
  if (/^(JASA|NON_?STOK|BIAYA|LAYANAN)/i.test(String(m.jenis || ""))) return PESAN_NON_STOK;
  if (!String(m.nama || "").trim()) return "Nama barang wajib diisi";
  if (!String(m.kategori || "").trim()) return "Kategori wajib diisi";
  if (!m.jenis) return "Pilih jenis barang: Bahan Produksi atau Perlengkapan Stok";
  if (!m.satuanStok) return "Pilih satuan stok";
  const beli = m.satuanBeli || m.satuanStok;
  if (beli !== m.satuanStok) {
    const f = Number(m.faktorKonversi);
    if (!(f > 0)) return `Isi faktor konversi: 1 ${labelSatuan(beli)} = berapa ${labelSatuan(m.satuanStok)}`;
    if (desimal(m.faktorKonversi) > 4) return "Faktor konversi maksimal 4 angka di belakang koma";
  }
  if (m.moq !== "" && m.moq != null && !(Number(m.moq) > 0)) return "MOQ harus lebih dari 0";
  if (m.estimasiKirimHari !== "" && m.estimasiKirimHari != null && !(Number.isInteger(Number(m.estimasiKirimHari)) && Number(m.estimasiKirimHari) >= 0 && Number(m.estimasiKirimHari) <= 365)) return "Estimasi waktu kirim harus 0–365 hari";
  return null;
}

/** Ringkas barang baru pada formulir (untuk kalimat konfirmasi): [{ baris, nama }]. */
export const daftarBarangBaru = (lines) => lines.map((l, i) => (l.materialBaru ? { baris: i + 1, nama: l.materialBaru.nama } : null)).filter(Boolean);

/** Isian modal → bentuk body API (angka bertipe angka, kosong dibuang). */
export function bodyMaterialBaru(m) {
  const beli = m.satuanBeli || m.satuanStok;
  const o = {
    nama: m.nama.trim(), kategori: m.kategori.trim(), jenis: m.jenis, satuanStok: m.satuanStok, satuanBeli: beli,
    ...(beli !== m.satuanStok && { faktorKonversi: Number(m.faktorKonversi) }),
  };
  for (const k of ["spesifikasi", "namaSupplier", "kodeSupplier", "lokasi", "catatan"]) if (String(m[k] || "").trim()) o[k] = String(m[k]).trim();
  if (m.moq !== "" && m.moq != null) o.moq = Number(m.moq);
  if (m.estimasiKirimHari !== "" && m.estimasiKirimHari != null) o.estimasiKirimHari = Number(m.estimasiKirimHari);
  if (m.konfirmasiMirip) { o.konfirmasiMirip = true; o.alasanMirip = String(m.alasanMirip || "").trim(); }
  return o;
}

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
export function galatBaris(l, unitStok = null) {
  if (l.materialBaru) { const g = galatMaterialBaru(l.materialBaru); if (g) return g; }
  else if (!l.materialId) return "Pilih item";
  const q = Number(l.qty);
  if (!(q > 0)) return "Jumlah harus lebih dari 0";
  if (Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) return "Jumlah maksimal 3 angka di belakang koma";
  const h = Number(l.unitPrice);
  if (!Number.isInteger(h) || h <= 0) return "Harga satuan harus rupiah bulat lebih dari 0";
  // Satuan beli ≠ satuan stok: faktor wajib; jumlah stok (jumlah × faktor) maksimal 4 desimal; harga per satuan stok minimal Rp1.
  const gPend = galatPendamping(l.pendamping, { adaKonversi: !!infoKonversi(l, unitStok) });
  if (gPend) return gPend;
  if (!l.materialBaru && l.satuanBeli && unitStok && l.satuanBeli !== unitStok) {
    const f = Number(l.faktorKonversi);
    if (!(f > 0)) return `Isi faktor konversi: 1 ${labelSatuan(l.satuanBeli)} = berapa ${labelSatuan(unitStok)}`;
    if (desimal(l.faktorKonversi) > 4) return "Faktor konversi maksimal 4 angka di belakang koma";
  }
  const kv = infoKonversi(l, unitStok);
  if (kv && kv.faktor > 0) {
    const stok = Math.round(q * kv.faktor * 1e6) / 1e6;
    if (Math.abs(stok * 10000 - Math.round(stok * 10000)) > 1e-6) return "Jumlah × faktor konversi melebihi 4 angka di belakang koma — ubah jumlah atau faktor";
    if (h / kv.faktor < 1) return "Harga per satuan stok kurang dari Rp1 — periksa faktor konversi atau harga";
  }
  return null;
}

/** Galat keseluruhan formulir PO; null = boleh disimpan. */
export function galatFormulir(f, unitMap = null) {
  if (!f.supplierId) return "Pilih supplier";
  if (!f.orderDate) return "Isi tanggal PO";
  if (f.expectedDate && f.expectedDate < f.orderDate) return "Estimasi kedatangan tidak boleh sebelum tanggal PO";
  if (f.lines.length === 0) return "Tambahkan minimal satu item";
  const ganda = new Set();
  for (const [i, l] of f.lines.entries()) {
    const g = galatBaris(l, unitMap?.get?.(l.materialId) ?? null);
    if (g) return `Baris ${i + 1}: ${g}`;
    const kunci = l.materialBaru ? `baru:${l.materialBaru.nama.trim().toLowerCase().replace(/\s+/g, " ")}` : l.materialId;
    if (ganda.has(kunci)) return `Baris ${i + 1}: item yang sama sudah ada — gabungkan jadi satu baris`;
    ganda.add(kunci);
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
    lines: po.lines.map((l) => ({
      materialId: l.materialId, qty: String(l.dipesan), unitPrice: String(l.hargaSatuan), pendamping: pendampingDariPO(l),
      ...(l.konversi && { satuanBeli: l.konversi.satuanBeli, faktorKonversi: String(l.konversi.faktor) }),
      ...(l.namaSupplier && { namaSupplier: l.namaSupplier }), ...(l.kodeSupplier && { kodeSupplier: l.kodeSupplier }),
    })),
  };
}

export function bodyDariForm(f) {
  return {
    ...(f.termin ? bodyTerminPO(f.termin) : {}),
    supplierId: f.supplierId, orderDate: f.orderDate, expectedDate: f.expectedDate || null, notes: f.notes.trim() || null,
    lines: f.lines.map((l) => {
      const dasar = { qty: Number(l.qty), unitPrice: Number(l.unitPrice) };
      if (l.materialBaru) return { materialBaru: bodyMaterialBaru(l.materialBaru), ...dasar, ...(bodyPendamping(l.pendamping) && { pendamping: bodyPendamping(l.pendamping) }) };
      return {
        materialId: l.materialId, ...dasar,
        ...(bodyPendamping(l.pendamping) && { pendamping: bodyPendamping(l.pendamping) }),
        ...(l.satuanBeli && l.faktorKonversi && { satuanBeli: l.satuanBeli, faktorKonversi: Number(l.faktorKonversi) }),
        ...(l.namaSupplier && { namaSupplier: l.namaSupplier }), ...(l.kodeSupplier && { kodeSupplier: l.kodeSupplier }),
      };
    }),
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
    case "DIBUAT": return m.skuBaru?.length ? `PO dibuat · ${m.skuBaru.length} barang baru: ${m.skuBaru.map((s) => s.kode).join(", ")}` : NAMA_EVENT_PO.DIBUAT;
    case "DIUBAH": return m.skuBaru?.length ? `Draf diubah · ${m.skuBaru.length} barang baru: ${m.skuBaru.map((s) => s.kode).join(", ")}` : NAMA_EVENT_PO.DIUBAH;
    case "REVISI_JUMLAH": return `Jumlah direvisi ${teksJumlah(m.sebelum)} → ${teksJumlah(m.sesudah)}${e.note ? ` — ${e.note}` : ""}`;
    case "DIBATALKAN": return `PO dibatalkan${e.note ? ` — ${e.note}` : ""}`;
    case "PENERIMAAN_DITEMPATKAN": return `Penerimaan ${e.note || ""} disimpan ke stok`.replace("  ", " ");
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
    supplierRef: f.supplierRef.trim(), billDate: f.billDate, ...(f.termin ? bodyTermin(f.termin) : { dueDate: f.dueDate || undefined }), description: f.description.trim() || undefined,
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
