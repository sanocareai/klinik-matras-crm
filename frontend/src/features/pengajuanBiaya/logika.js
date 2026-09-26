// Logika murni halaman Pengajuan Biaya Produksi & Gudang (C1) — tanpa React supaya dites langsung
// (tests/pengajuanBiayaWorkspace.test.js). Aturan yang SEBENARNYA ditegakkan server
// (backend/src/services/expenseSubmission/*); di sini hanya agar form cepat diisi dan tidak menyimpan yang pasti ditolak.

export const WORKSPACES_UI = {
  PRODUKSI: {
    judul: "Pengajuan Biaya Produksi", division: "PRODUKSI", jalur: "/bengkel/pengajuan-biaya", singkat: "Produksi",
    ringkas: "Servis mesin, alat kerja kecil, jasa vendor/tukang, lembur, dan kebutuhan produksi mendesak yang bukan stok.",
    tautan: ["order", "unit", "machine"],
  },
  WAREHOUSE: {
    judul: "Pengajuan Biaya Gudang", division: "GUDANG", jalur: "/warehouse/pengajuan-biaya", singkat: "Gudang",
    ringkas: "Bongkar muat, kurir/logistik, perlengkapan gudang non-stok, perawatan fasilitas, dan biaya operasional mendesak.",
    tautan: ["warehouse", "material", "document"],
  },
  MARKETING: {
    judul: "Pengajuan Biaya Marketing", division: "MARKETING", jalur: "/marketing/pengajuan-biaya", singkat: "Marketing",
    ringkas: "Iklan & promosi, produksi konten, event/aktivasi, cetak materi promosi, tools/langganan marketing, dan transportasi/representasi kegiatan marketing.",
    tautan: [],
  },
  MANAGEMENT: {
    judul: "Pengajuan Biaya Management", division: "MANAGEMENT", jalur: "/kendali/pengajuan-biaya", singkat: "Management",
    ringkas: "Meeting dan representasi, perjalanan dinas, konsultan/jasa profesional, legal/perizinan, langganan manajemen, dan kebutuhan operasional khusus.",
    tautan: [],
  },
  HR_GA: {
    judul: "Pengajuan Biaya HR & GA", division: "HR_GA", jalur: "/kendali/pengajuan-hrga", singkat: "HR & GA",
    ringkas: "Rekrutmen, pelatihan, kesejahteraan karyawan, ATK dan kebutuhan kantor non-stok, perawatan fasilitas, serta perizinan dan administrasi.",
    tautan: [],
  },
};

/** Daftar kunci workspace untuk hub Finance (urutan tampil). */
export const URUTAN_WORKSPACE = ["PRODUKSI", "WAREHOUSE", "MARKETING", "MANAGEMENT", "HR_GA"];


export const FORM_KOSONG = {
  expenseType: "", date: "", amount: "", vendorName: "", sumberDana: "", advanceId: "",
  workCenterId: "", unitId: "", orderId: "", warehouseId: "", materialId: "", documentRef: "",
  picUserId: "", requestedById: "", requestedAt: "", sourceNote: "", urgentReason: "",
  description: "", notes: "", metadata: {},
};

// Terima "450000", "450.000" (pemisah ribuan Indonesia), dan "450.000,50".
const ANGKA = (v) => {
  const s = String(v ?? "").trim().replace(/\s/g, "");
  const norm = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  return Number(norm.replace(/[^\d.-]/g, ""));
};

/** Kolom relasi yang BOLEH dikirim untuk workspace ini (yang lain dibuang supaya server tidak menolak). */
const KOLOM_TAUTAN = { order: "orderId", unit: "unitId", machine: "workCenterId", warehouse: "warehouseId", material: "materialId", document: "documentRef" };

export function bentukPayload(form, cfg, workspace) {
  const izin = new Set(cfg?.relations || []);
  const p = {
    workspace, expenseType: form.expenseType, date: form.date, amount: ANGKA(form.amount),
    vendorName: form.vendorName || null, sumberDana: form.sumberDana || null,
    advanceId: form.sumberDana === "UANG_MUKA_OPERASIONAL" ? (form.advanceId || null) : null,
    picUserId: form.picUserId || null, description: form.description || undefined, notes: form.notes || null,
    urgentReason: form.urgentReason || null, sourceNote: form.sourceNote || null, requestedAt: form.requestedAt || null,
    metadata: form.metadata || {},
  };
  if (form.requestedById) p.requestedById = form.requestedById;
  for (const [nama, kolom] of Object.entries(KOLOM_TAUTAN)) if (izin.has(nama)) p[kolom] = form[kolom] || null;
  return p;
}

/** Galat yang sudah pasti ditolak server — ditampilkan sebelum dikirim. Kembalikan teks Indonesia atau null. */
export function galatForm(form, cfg) {
  if (!form.expenseType) return "Jenis biaya wajib dipilih";
  if (!form.date) return "Tanggal wajib diisi";
  if (!(ANGKA(form.amount) > 0)) return "Nominal harus lebih dari 0";
  if (form.sumberDana === "UANG_MUKA_OPERASIONAL" && !form.advanceId) return "Pilih uang muka aktif untuk sumber dana Uang muka operasional";
  return null;
}

/** Kekurangan yang menghalangi AJUKAN (draf boleh belum lengkap). */
export function kekuranganAjukan(row, cfg) {
  const k = [];
  const meta = row.metadata || {};
  for (const f of (cfg?.metadataFieldsByType?.[row.expenseType] || [])) {
    if (f.required && String(meta[f.key] ?? "").trim() === "") k.push(`${f.label} belum diisi`);
  }
  const wajib = { machine: "workCenterId", warehouse: "warehouseId", material: "materialId", unit: "unitId", order: "orderId" };
  for (const rel of (cfg?.relasiWajib?.[row.expenseType] || [])) if (!row[wajib[rel]]) k.push(`${rel === "machine" ? "Mesin" : rel} belum dipilih`);
  if ((cfg?.wajibAlasanMendesak || []).includes(row.expenseType) && String(row.urgentReason || "").trim().length < 5) k.push("Alasan mendesak belum diisi");
  if (row.sumberDana === "UANG_MUKA_OPERASIONAL" && !row.advanceId) k.push("Uang muka aktif belum dipilih");
  if (!(row.proofs || []).length) k.push("Foto nota belum diunggah (dibutuhkan Finance untuk menyetujui)");
  return k;
}

/** Ringkasan konteks khusus divisi dari metadata (campaign, channel, tujuan, kegiatan, lokasi, peserta) — cerminan server (config.konteksMetadata). */
export function ringkasKonteksMetadata(cfg, metadata) {
  const m = metadata && typeof metadata === "object" ? metadata : {};
  return (cfg?.konteksMetadata || []).map((f) => {
    const v = m[f.key];
    if (v === undefined || v === null || String(v).trim() === "") return null;
    return `${f.label} ${f.tanggal ? String(v).slice(0, 10) : v}${f.satuan ? ` ${f.satuan}` : ""}`;
  }).filter(Boolean).join(" · ");
}

/** Teks konteks satu pengajuan: unit/mesin/gudang/material/dokumen + konteks divisi dari metadata (bila `cfg` diberikan). */
export function konteksLabel(r, cfg = null) {
  return [
    r.unit && `Unit ${r.unit.unitCode}`, r.order && !r.unit && `Order ${r.order.orderNumber}`, r.workCenter && `Mesin ${r.workCenter.name}`,
    r.warehouse && `Gudang ${r.warehouse.name}`, r.material && `Material ${r.material.code}`, r.documentRef && `Dokumen ${r.documentRef}`,
    cfg && ringkasKonteksMetadata(cfg, r.metadata),
  ].filter(Boolean).join(" · ");
}

/** Template disimpan TANPA tanggal, nominal, dan bukti — yang berulang saja. */
export function payloadTemplate(form) {
  const { date, amount, advanceId, requestedAt, description, ...sisa } = form; // eslint-disable-line no-unused-vars
  return { ...sisa, date: "", amount: "" };
}

export function terapkanTemplate(payload) {
  return { ...FORM_KOSONG, ...(payload || {}), metadata: { ...(payload?.metadata || {}) }, date: "", amount: "" };
}

/** Isian dari "pilihan terakhir" (chip di atas form). */
export function terapkanPilihanTerakhir(form, jenis, nilai) {
  const peta = { mesin: "workCenterId", gudang: "warehouseId", material: "materialId", unit: "unitId", pic: "picUserId", sumberDana: "sumberDana", jenisBiaya: "expenseType" };
  const kolom = peta[jenis];
  return kolom ? { ...form, [kolom]: nilai, ...(kolom === "expenseType" ? { metadata: {} } : {}) } : form;
}

/** Peringatan duplikat (bukan blokir): satu baris Indonesia per kandidat. */
export function teksDuplikat(k) {
  const tgl = String(k.date || "").slice(0, 10);
  const bagian = [`${k.submissionNumber}`, tgl, `Rp${Number(k.amount || 0).toLocaleString("id-ID")}`];
  if (k.picNameSnapshot || k.pemohon) bagian.push(`PIC/pemohon ${k.picNameSnapshot || k.pemohon}`);
  if (k.konteks) bagian.push(k.konteks);
  bagian.push(k.adaBukti ? "bukti ada" : "belum ada bukti");
  return bagian.join(" · ");
}

export const LABEL_SUMBER_DANA = {
  REKENING_PERUSAHAAN: "Rekening perusahaan (Finance yang membayar)",
  UANG_MUKA_OPERASIONAL: "Uang muka operasional",
  TALANGAN_PRIBADI: "Talangan pribadi (diganti Finance)",
  BELUM_DIBAYAR: "Belum dibayar (utang ke vendor)",
};

export const PESAN_BUKAN_ASET_PAYROLL = "Bukan untuk pembelian aset tetap, tagihan supplier/persediaan, gaji/THR/bonus (payroll), pinjaman/kasbon karyawan, atau transaksi antarbank — itu tetap lewat modulnya masing-masing agar tidak terhitung dua kali.";

/** Pesan pengecualian sesuai workspace (Produksi/Gudang: stok; divisi lain: aset/payroll/kasbon/antarbank). */
export function pesanBukan(workspace) {
  return workspace === "PRODUKSI" || workspace === "WAREHOUSE" ? PESAN_BUKAN_STOK : PESAN_BUKAN_ASET_PAYROLL;
}

export const PESAN_BUKAN_STOK = "Bukan untuk pembelian bahan/stok, penerimaan barang, pemakaian bahan, transfer stok, atau penyesuaian stok — itu tetap lewat modul Gudang, Pembelian, dan Tagihan Supplier agar tidak terhitung dua kali.";
