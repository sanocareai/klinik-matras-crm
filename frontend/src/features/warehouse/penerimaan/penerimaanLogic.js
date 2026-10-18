// Logika murni layar Penerimaan Barang (Okt 2026). Status, tahap, dan aksi yang relevan datang dari SERVER (`tampilan` pada penerimaan); di sini hanya merangkai tampilan:
// identitas dokumen (nomor penerimaan, nomor PO, supplier, pembuat, tanggal), matriks per item (pesan · dijadwalkan · tiba · diterima · masuk stok), filter tahap, dan peringatan jadwal ganda.
// Dua penerimaan untuk bahan yang sama TIDAK pernah digabung atau disimpulkan duplikat: hanya ditampilkan berdampingan dengan identitasnya masing-masing.

export const TAHAP_FILTER = Object.freeze([
  { key: "", label: "Semua" },
  { key: "jadwal", label: "Terjadwal & draf", statuses: ["DRAFT", "SCHEDULED"] },
  { key: "belum-masuk-stok", label: "Belum masuk stok", statuses: ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"] },
  { key: "selesai", label: "Sudah masuk stok", statuses: ["COMPLETED"] },
  { key: "ditutup", label: "Dibatalkan / ditolak", statuses: ["REJECTED"] },
]);

export const filterTahap = (rows, key) => {
  const t = TAHAP_FILTER.find((x) => x.key === key);
  return !t || !t.statuses ? rows : rows.filter((r) => t.statuses.includes(r.status));
};
export const hitungPerTahap = (rows) => Object.fromEntries(TAHAP_FILTER.map((t) => [t.key, t.statuses ? rows.filter((r) => t.statuses.includes(r.status)).length : rows.length]));

const tgl = (d) => (d ? String(d).slice(0, 10) : null);
export const tanggalPendek = (d) => (d ? new Date(`${tgl(d)}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** Identitas yang selalu tampil bersama dokumen — mencegah dua dokumen untuk bahan yang sama tertukar. */
export function identitasPenerimaan(r) {
  return {
    nomor: r.receiptNumber, nomorPO: r.purchaseOrder?.poNumber ?? null, supplier: r.supplier ?? null,
    pembuat: r.createdBy?.name ?? null, dibuat: r.createdAt ? new Date(r.createdAt).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null,
    jadwal: tgl(r.expectedDate), sumber: r.purchaseOrderId ? "Dari PO" : "Tanpa PO", jumlahItem: r.lines?.length ?? 0,
  };
}

/** Penerimaan lain yang masih aktif (belum final) untuk PO yang SAMA — hanya informasi, bukan kesimpulan duplikat. */
export function penerimaanLainSamaPO(r, semua) {
  if (!r?.purchaseOrderId) return [];
  return (semua ?? []).filter((x) => x.id !== r.id && x.purchaseOrderId === r.purchaseOrderId && !["REJECTED", "COMPLETED"].includes(x.status));
}

const angka = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
export const teksAngka = (v, satuan = "") => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("id-ID", { maximumFractionDigits: 3 })}${satuan ? ` ${satuan}` : ""}`);

/**
 * Baris matriks per item untuk SATU penerimaan. "—" = belum diisi (bukan nol). Satuan = satuan beli PO bila ada, selain itu satuan stok.
 * Kolom: dipesan (PO) · dijadwalkan (dokumen ini) · tiba · diterima baik · ditolak · masuk stok (dokumen ini) · sisa PO.
 */
export function barisPerItem(r) {
  const selesai = r.status === "COMPLETED";
  return (r.lines ?? []).map((l) => {
    const q = r.poRingkas?.lines?.find((b) => b.id === l.purchaseOrderLineId)?.progres ?? null;
    const satuan = l.purchaseOrderLine?.purchaseUnit || l.purchaseOrderLine?.unit || l.material?.unit || "";
    const faktor = l.purchaseOrderLine?.purchaseUnit ? Number(l.purchaseOrderLine.conversionFactor) || 1 : 1;
    const baik = angka(l.acceptedQty);
    return {
      id: l.id, kode: l.material?.code ?? "—", nama: l.material?.name ?? "", satuan, satuanStok: l.material?.unit ?? "", faktor,
      dipesan: q ? q.dipesan : null, dijadwalkan: angka(l.orderedQty), tiba: angka(l.receivedQty), baik, ditolak: angka(l.rejectedQty),
      masukStok: selesai ? (baik ?? 0) : 0, masukStokStok: selesai && baik != null ? Math.round(baik * faktor * 1e4) / 1e4 : 0,
      sisaPO: q ? q.belumDatang : null, dariPO: !!l.purchaseOrderLineId,
      kondisi: l.condition ?? "", catatan: l.notes ?? "",
    };
  });
}

/** Ringkas satu baris matriks menjadi kalimat untuk layar sempit. */
export function kalimatBaris(b) {
  const bagian = [];
  if (b.dipesan !== null) bagian.push(`pesan ${teksAngka(b.dipesan)}`);
  bagian.push(`jadwal ${teksAngka(b.dijadwalkan)}`);
  bagian.push(`tiba ${teksAngka(b.tiba)}`);
  bagian.push(`baik ${teksAngka(b.baik)}`);
  if (b.ditolak) bagian.push(`ditolak ${teksAngka(b.ditolak)}`);
  bagian.push(`masuk stok ${teksAngka(b.masukStok)}`);
  return `${bagian.join(" · ")} ${b.satuan}`.trim();
}

/** Peringatan ringan (informasi) di baris: tiba melebihi jadwal, baik+ditolak melebihi tiba. Tidak memblokir — server yang memutuskan. */
export function catatanBaris(b) {
  const c = [];
  if (b.tiba !== null && b.dijadwalkan !== null && b.tiba > b.dijadwalkan) c.push("Tiba lebih banyak dari yang dijadwalkan");
  if (b.tiba !== null && (b.baik ?? 0) + (b.ditolak ?? 0) > b.tiba) c.push("Baik + ditolak melebihi jumlah tiba");
  return c;
}

/** Validasi dini isian pemeriksaan (angka ≥ 0, maks 3 desimal); "" = lolos. */
export function galatIsianPemeriksaan(nilai) {
  for (const [k, v] of Object.entries(nilai)) {
    if (v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return "Jumlah harus angka 0 atau lebih";
    if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) return "Jumlah maksimal 3 angka di belakang koma";
    void k;
  }
  return "";
}

/** Aksi → bagaimana UI menangani. `inline`: panel kecil di halaman; `langsung`: satu klik; `dialog`: formulir resmi yang sudah ada. */
export const CARA_AKSI = Object.freeze({
  UBAH_JADWAL: "inline", KEMBALI_DRAFT: "inline", BATALKAN_JADWAL: "inline", TOLAK: "inline",
  BATALKAN_TIBA: "inline", PULIHKAN: "inline", BUAT_ULANG: "inline",
  JADWALKAN: "langsung", MAJUKAN: "langsung", SIMPAN_KE_STOK: "langsung", ISI_PEMERIKSAAN: "inline",
  CATAT_TIBA: "dialog", TANDAI_TIBA: "langsung", KOREKSI_KEDATANGAN: "dialog", KOREKSI_PENERIMAAN: "dialog",
});
export const aksiRelevan = (tampilan, dukungan = Object.keys(CARA_AKSI)) => (tampilan?.aksi ?? []).filter((a) => dukungan.includes(a.kode));
export const aksiUtama = (tampilan) => (tampilan?.aksi ?? []).find((a) => a.jenis === "maju") ?? null;
