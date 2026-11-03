// Logika murni layar Penerimaan Barang (Okt 2026). Status, tahap, dan aksi yang relevan datang dari SERVER (`tampilan` pada penerimaan); di sini hanya merangkai tampilan:
// identitas dokumen (nomor penerimaan, nomor PO, supplier, pembuat, tanggal), matriks per item (pesan · dijadwalkan · tiba · diterima · masuk stok), filter tahap, dan peringatan jadwal ganda.
// Dua penerimaan untuk bahan yang sama TIDAK pernah digabung atau disimpulkan duplikat: hanya ditampilkan berdampingan dengan identitasnya masing-masing.

// PIPELINE enam tahap (UX Gudang Tahap 3), urutan sama dengan server (services/penerimaanStatus.js PIPELINE). Kunci lama (jadwal, belum-masuk-stok, selesai, ditutup) tetap dikenali agar tautan/bookmark lama berfungsi.
export const TAHAP_PIPELINE = Object.freeze([
  { key: "DRAF", label: "Draf", statuses: ["DRAFT"] }, { key: "TERJADWAL", label: "Terjadwal", statuses: ["SCHEDULED"] }, { key: "TIBA", label: "Barang tiba", statuses: ["ARRIVED"] },
  { key: "PERIKSA", label: "Pemeriksaan", statuses: ["INSPECTION"] }, { key: "SIAP", label: "Siap masuk stok", statuses: ["READY_FOR_PUTAWAY"] }, { key: "STOK", label: "Sudah masuk stok", statuses: ["COMPLETED"] },
]);
export const TAHAP_TUTUP = Object.freeze({ key: "DITUTUP", label: "Dibatalkan / ditolak", statuses: ["REJECTED"] });
export const TAHAP_FILTER = Object.freeze([
  { key: "", label: "Semua" },
  ...TAHAP_PIPELINE, TAHAP_TUTUP,
  { key: "jadwal", label: "Terjadwal & draf", statuses: ["DRAFT", "SCHEDULED"], lama: true },
  { key: "belum-masuk-stok", label: "Belum masuk stok", statuses: ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"], lama: true },
  { key: "selesai", label: "Sudah masuk stok", statuses: ["COMPLETED"], lama: true },
  { key: "ditutup", label: "Dibatalkan / ditolak", statuses: ["REJECTED"], lama: true },
]);

export const filterTahap = (rows, key) => {
  const t = TAHAP_FILTER.find((x) => x.key === key);
  return !t || !t.statuses ? rows : rows.filter((r) => t.statuses.includes(r.status));
};
/** Cari baris penerimaan: nomor GR, nomor PO, supplier, nomor sumber, kode dan nama bahan. */
export const cocokCari = (r, q) => { const k = String(q ?? "").trim().toLowerCase(); return !k || [r.receiptNumber, r.purchaseOrder?.poNumber, r.supplier, r.sourceReference, ...(r.lines ?? []).map((l) => `${l.material?.code} ${l.material?.name}`)].join(" ").toLowerCase().includes(k); };
/** Tindakan berikutnya untuk satu baris (dari server: tampilan.berikutnya) + apakah menunggu tindakan petugas Gudang (badge sidebar/pipeline). */
export const perluTindakan = (r) => ["DRAFT", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"].includes(r?.status);
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
      kondisi: l.condition ?? "", catatan: l.notes ?? "", progres: q, purchaseOrderLineId: l.purchaseOrderLineId ?? null,
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

// ── Redesain Gudang (3 Nov 2026): tab, saringan, dan penanda jadwal daftar Penerimaan. Murni tampilan: status/tahap tetap dari server; tab tidak mengubah apa pun selain baris mana yang terlihat.
/** Tab daftar. `tindakan` memakai definisi `perluTindakan` yang sama dengan penanda pipeline; `menunggu` = sudah dijadwalkan, barang belum dicatat tiba. */
export const TAB_PENERIMAAN = Object.freeze([
  { key: "tindakan", label: "Perlu tindakan", cocok: (r) => perluTindakan(r), tahap: ["DRAF", "TIBA", "PERIKSA", "SIAP"] },
  { key: "menunggu", label: "Menunggu kedatangan", cocok: (r) => r.status === "SCHEDULED", tahap: ["TERJADWAL"] },
  { key: "semua", label: "Semua", cocok: () => true, tahap: null },
  { key: "selesai", label: "Selesai", cocok: (r) => ["COMPLETED", "REJECTED"].includes(r.status), tahap: ["STOK", "DITUTUP"] },
]);
export const KUNCI_TAB = TAB_PENERIMAAN.map((t) => t.key);
/** Tab yang aktif: pilihan eksplisit bila sah; tanpa pilihan → "Semua" bila ada saringan tahap (tautan lama tetap menampilkan hasilnya), selain itu "Perlu tindakan". */
export const tabAktif = (tab, tahap) => (KUNCI_TAB.includes(tab) ? tab : tahap ? "semua" : "tindakan");
export const filterTab = (rows, tab) => { const t = TAB_PENERIMAAN.find((x) => x.key === tab) ?? TAB_PENERIMAAN[2]; return rows.filter(t.cocok); };
export const hitungPerTab = (rows) => Object.fromEntries(TAB_PENERIMAAN.map((t) => [t.key, rows.filter(t.cocok).length]));
/** Pilihan "Tahap" menyesuaikan tab (hanya tahap yang mungkin ada di tab itu). */
export const tahapUntukTab = (tab) => { const t = TAB_PENERIMAAN.find((x) => x.key === tab); const kunci = t?.tahap; const semua = [...TAHAP_PIPELINE, TAHAP_TUTUP]; return kunci ? semua.filter((x) => kunci.includes(x.key)) : semua; };

export const SARINGAN_JADWAL = Object.freeze([
  { key: "", label: "Semua jadwal" }, { key: "lewat", label: "Lewat jadwal" }, { key: "hari-ini", label: "Hari ini" }, { key: "pekan", label: "7 hari ke depan" },
]);
/** Tanggal lokal hari ini "YYYY-MM-DD". */
export const hariIni = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Jadwal lewat: dokumen yang barangnya belum dicatat tiba (draf / terjadwal) padahal tanggal jadwal sudah lewat. */
export const lewatJadwal = (r, hari = hariIni()) => ["DRAFT", "SCHEDULED"].includes(r?.status) && !!tgl(r?.expectedDate) && tgl(r.expectedDate) < hari;
export function cocokJadwal(r, kunci, hari = hariIni()) {
  if (!kunci) return true;
  const j = tgl(r.expectedDate); if (!j) return false;
  if (kunci === "lewat") return lewatJadwal(r, hari);
  if (kunci === "hari-ini") return j === hari;
  if (kunci === "pekan") { const batas = new Date(`${hari}T00:00:00`); batas.setDate(batas.getDate() + 7); return j >= hari && j <= hariIni(batas); }
  return true;
}
/** Daftar supplier unik (terurut) untuk saringan. */
export const daftarSupplier = (rows) => [...new Set((rows ?? []).map((r) => (r.supplier ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id"));

// ── Redesain Penerimaan (4 Nov 2026): rincian per item berbasis lebar panel, dialog pemeriksaan, pengiriman bertahap. Murni tampilan — angka & definisi tetap dari server (progresPO.js).
const normal = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Kode sekunder hanya bila TIDAK sekadar mengulang nama (mis. "BUSA-OCEAN-D18-120X200X2CM" untuk nama "BUSA OCEAN D18 120X200X2CM" disembunyikan). */
export const kodeSekunder = (b) => (b?.kode && b.kode !== "—" && normal(b.kode) !== normal(b.nama) ? b.kode : null);

/** Angka PO (semua penerimaan) per item untuk layar: Dipesan · Sudah datang · Belum datang · Baik belum disimpan · Sudah masuk stok (+ Menunggu pengganti bila > 0). null = tidak ada PO. */
export function progresItemPO(b) {
  const q = b?.progres; if (!q) return null;
  const sel = [["dipesan", "Dipesan", q.dipesan], ["datang", "Sudah datang", q.datangAsli ?? q.datang], ["belumDatang", "Belum datang", q.belumDatang], ["baikBelumDisimpan", "Baik belum disimpan", q.baikBelumDisimpan], ["masukStok", "Sudah masuk stok", q.masukStok]];
  if (Number(q.menungguPengganti) > 0) sel.push(["menungguPengganti", "Menunggu pengganti", q.menungguPengganti]);
  if (Number(q.ditolak) > 0) sel.push(["ditolak", "Ditolak (riwayat)", q.ditolak]);
  return sel.map(([kunci, label, nilai]) => ({ kunci, label, nilai: Number(nilai) }));
}

/** Galat per baris isian pemeriksaan: angka ≥ 0, maks 3 desimal, baik + ditolak ≤ tiba. `nilaiBaris` = isian sementara baris itu ({acceptedQty,rejectedQty,receivedQty}). "" = lolos. */
export function galatBarisPemeriksaan(b, nilaiBaris = {}) {
  const ambil = (f, awal) => (f in nilaiBaris ? nilaiBaris[f] : awal);
  const baik = ambil("acceptedQty", b.baik); const tolak = ambil("rejectedQty", b.ditolak); const tiba = ambil("receivedQty", b.tiba);
  for (const v of [baik, tolak, tiba]) {
    if (v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return "Jumlah harus angka 0 atau lebih";
    if (Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) return "Jumlah maksimal 3 angka di belakang koma";
  }
  const t = tiba === "" || tiba === null || tiba === undefined ? null : Number(tiba);
  if (t !== null && (Number(baik || 0) + Number(tolak || 0)) > t + 1e-9) return `Baik + ditolak (${teksAngka(Number(baik || 0) + Number(tolak || 0))}) melebihi jumlah tiba (${teksAngka(t)})`;
  return "";
}

/** Pengiriman LAIN untuk PO yang sama (semua status selain ditolak/dibatalkan): satu pengiriman = satu dokumen. Tiap baris memuat jumlah tiba per bahan yang juga ada di dokumen ini. */
export function pengirimanLainPO(r, semua) {
  if (!r?.purchaseOrderId) return [];
  const kodeIni = new Set((r.lines ?? []).map((l) => l.purchaseOrderLineId).filter(Boolean));
  return (semua ?? []).filter((x) => x.id !== r.id && x.purchaseOrderId === r.purchaseOrderId && x.status !== "REJECTED").map((x) => ({
    id: x.id, nomor: x.receiptNumber, status: x.status, label: x.tampilan?.label ?? x.status, tiba: x.arrivedDate ?? null, jadwal: x.expectedDate ?? null,
    baris: (x.lines ?? []).filter((l) => kodeIni.has(l.purchaseOrderLineId)).map((l) => ({ kode: l.material?.code ?? "—", nama: l.material?.name ?? "", tiba: angka(l.receivedQty), baik: angka(l.acceptedQty), jadwal: angka(l.orderedQty), satuan: l.purchaseOrderLine?.purchaseUnit || l.purchaseOrderLine?.unit || l.material?.unit || "" })),
  })).sort((a, b) => String(a.tiba ?? a.jadwal ?? "").localeCompare(String(b.tiba ?? b.jadwal ?? "")));
}

/** Tab pertama yang memuat dokumen ini (untuk "Tampilkan di daftar"). Dokumen dibatalkan/ditolak → Selesai. */
export const tabUntukDokumen = (r) => (TAB_PENERIMAAN.find((t) => t.key !== "semua" && t.cocok(r))?.key ?? "semua");
/** Dokumen terbuka tidak ikut hasil daftar yang sedang tampil (tab/saringan)? `terfilter` = baris daftar; rows belum dimuat → false (tidak menuduh). */
export const diLuarDaftar = (id, rows, terfilter) => !!id && !!rows && !!terfilter && rows.some((x) => x.id === id) && !terfilter.some((x) => x.id === id);
