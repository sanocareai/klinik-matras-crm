// Logika murni Koreksi Dokumen Gudang (tanpa React/jaringan): label, penyusunan isi koreksi, validasi dini, dan teks dampak.
// SEMUA keputusan sah/tidak, dampak, dan penghalang dihitung SERVER; di sini hanya merangkai tampilan dan mencegah isian yang jelas keliru.

export const JALUR_TAMPIL = Object.freeze({
  EDIT_DRAF: { label: "Boleh diedit", warna: "green", ikon: "edit" },
  KOREKSI_UI: { label: "Koreksi bertaut", warna: "accent", ikon: "koreksi" },
  ALUR_RESMI: { label: "Pakai alur resmi", warna: "orange", ikon: "alur" },
  DIBLOKIR: { label: "Diblokir", warna: "red", ikon: "blokir" },
  FINAL: { label: "Final", warna: "neutral", ikon: "final" },
});

export const STATUS_KOREKSI = Object.freeze({
  PENDING_APPROVAL: { label: "Menunggu persetujuan", warna: "orange" },
  POSTED: { label: "Sudah diterapkan", warna: "green" },
  REJECTED: { label: "Ditolak", warna: "red" },
  CANCELLED: { label: "Dibatalkan", warna: "neutral" },
});

export const JENIS_KOREKSI = Object.freeze({ METADATA: "Koreksi data (stok tidak berubah)", STOCK: "Koreksi stok (jumlah/bahan/lokasi)" });
export const JENIS_OPERASI = Object.freeze({ PEMBALIK: "Pembalik (mengurangi)", SELISIH_TAMBAH: "Selisih tambah", MASUK_BARU: "Masuk pada bahan/lokasi baru" });
export const LABEL_BIDANG = Object.freeze({ supplier: "Supplier/pengirim", sourceReference: "Referensi", deliveryNote: "Surat jalan", notes: "Catatan", receivedDate: "Tanggal dokumen" });

const teks = (v) => (v === null || v === undefined ? "" : String(v));

/** Nilai awal formulir dari keadaan server (GET .../keadaan). */
export function formKoreksiAwal(keadaan) {
  const p = keadaan?.penerimaan ?? {};
  return {
    alasan: "",
    metadata: { supplier: teks(p.supplier), sourceReference: teks(p.sourceReference), deliveryNote: teks(p.deliveryNote), notes: teks(p.notes), receivedDate: teks(p.receivedDate) },
    baris: (keadaan?.baris ?? []).map((b) => ({ barisId: b.id, kode: b.kode, nama: b.nama, satuan: b.satuan, bisaUbahStok: !!b.bisaUbahStok, bahanId: b.bahanId, jumlahBaik: teks(b.jumlahBersih), lokasi: teks(b.lokasi), kondisi: teks(b.kondisi), catatan: teks(b.catatan) })),
  };
}

const nilaiSama = (a, b) => teks(a).trim() === teks(b).trim();

/** Isi `perubahan` untuk server: HANYA bidang yang berbeda dari keadaan (server menolak bila tidak ada yang berubah). */
export function bodyPerubahan(form, keadaan) {
  const p = keadaan?.penerimaan ?? {};
  const metadata = {};
  for (const k of keadaan?.bidangMetadata ?? []) if (!nilaiSama(form.metadata[k], p[k])) metadata[k] = form.metadata[k].trim() === "" ? null : form.metadata[k].trim();
  const baris = [];
  for (const f of form.baris) {
    const b = (keadaan?.baris ?? []).find((x) => x.id === f.barisId);
    if (!b) continue;
    const o = { barisId: f.barisId };
    if (f.bisaUbahStok) {
      if (!nilaiSama(f.jumlahBaik, b.jumlahBersih)) o.jumlahBaik = Number(f.jumlahBaik);
      if (f.bahanId && f.bahanId !== b.bahanId) o.bahanId = f.bahanId;
      if (!nilaiSama(f.lokasi, b.lokasi)) o.lokasi = f.lokasi.trim();
    }
    if (!nilaiSama(f.kondisi, b.kondisi)) o.kondisi = f.kondisi.trim() === "" ? null : f.kondisi.trim();
    if (!nilaiSama(f.catatan, b.catatan)) o.catatan = f.catatan.trim() === "" ? null : f.catatan.trim();
    if (Object.keys(o).length > 1) baris.push(o);
  }
  return { ...(Object.keys(metadata).length > 0 && { metadata }), ...(baris.length > 0 && { baris }) };
}

export const adaPerubahan = (perubahan) => Object.keys(perubahan?.metadata ?? {}).length > 0 || (perubahan?.baris ?? []).length > 0;
export const mengubahStok = (perubahan) => (perubahan?.baris ?? []).some((b) => b.jumlahBaik !== undefined || b.bahanId !== undefined || b.lokasi !== undefined);

/** Galat dini (sebelum ke server). "" = lolos. Server tetap pemutus akhir. */
export function galatForm(form, keadaan) {
  const perubahan = bodyPerubahan(form, keadaan);
  if (!adaPerubahan(perubahan)) return "Belum ada yang diubah";
  for (const b of perubahan.baris ?? []) {
    if (b.jumlahBaik !== undefined && (!Number.isFinite(b.jumlahBaik) || b.jumlahBaik < 0)) return "Jumlah baik baru harus angka 0 atau lebih";
    if (b.jumlahBaik !== undefined && Math.abs(b.jumlahBaik * 10000 - Math.round(b.jumlahBaik * 10000)) > 1e-6) return "Jumlah baik baru maksimal 4 desimal";
    if (b.lokasi !== undefined && (!b.lokasi || b.lokasi.length > 60)) return "Lokasi baru wajib diisi (maksimal 60 karakter)";
  }
  const tgl = perubahan.metadata?.receivedDate;
  if (tgl !== undefined && (!tgl || !/^\d{4}-\d{2}-\d{2}$/.test(tgl))) return "Tanggal dokumen wajib diisi dengan format yang benar";
  if (form.alasan.trim().length < 5) return "Alasan koreksi wajib diisi (minimal 5 karakter)";
  if (form.alasan.trim().length > 500) return "Alasan koreksi maksimal 500 karakter";
  return "";
}

export function ringkasNilai(v) { return v === null || v === undefined || v === "" ? "—" : String(v); }

/** Kalimat dampak dari hasil pratinjau server. */
export function kalimatDampak(hasil) {
  if (!hasil) return "";
  if (!hasil.boleh) return `Diblokir: ${hasil.penghalang?.[0]?.pesan ?? "tidak bisa dikoreksi"}`;
  return hasil.dampak?.butuhPersetujuan
    ? `Mengubah stok — menunggu persetujuan orang lain. ${hasil.dampak.pergerakanBaru} pergerakan baru akan bertaut ke penerimaan ini; catatan asal tetap.`
    : "Hanya data dokumen — langsung dicatat. Stok, jurnal, pembayaran, dan Produksi tidak berubah.";
}

/** Daftar baris sebelum–sesudah untuk tampilan perubahan (dari `changes` koreksi tersimpan atau pratinjau). */
export function barisPerubahan(changes) {
  const hasil = [];
  for (const [k, v] of Object.entries(changes?.metadata?.sesudah ?? {})) hasil.push({ bagian: "Dokumen", bidang: LABEL_BIDANG[k] ?? k, sebelum: ringkasNilai(changes.metadata.sebelum?.[k]), sesudah: ringkasNilai(v) });
  for (const b of changes?.baris ?? []) {
    const s = b.sesudah ?? {}; const a = b.sebelum ?? {};
    if (s.jumlahBaik !== undefined && s.jumlahBaik !== a.jumlahBaik) hasil.push({ bagian: b.kode, bidang: "Jumlah baik", sebelum: ringkasNilai(a.jumlahBaik), sesudah: ringkasNilai(s.jumlahBaik) });
    if (s.bahan !== undefined && s.bahan !== a.bahan) hasil.push({ bagian: b.kode, bidang: "Bahan", sebelum: ringkasNilai(a.bahan), sesudah: ringkasNilai(s.bahan) });
    if (s.lokasi !== undefined && s.lokasi !== a.lokasi) hasil.push({ bagian: b.kode, bidang: "Lokasi", sebelum: ringkasNilai(a.lokasi), sesudah: ringkasNilai(s.lokasi) });
    if (s.kondisi !== undefined && s.kondisi !== a.kondisi) hasil.push({ bagian: b.kode, bidang: "Kondisi", sebelum: ringkasNilai(a.kondisi), sesudah: ringkasNilai(s.kondisi) });
    if (s.catatan !== undefined && s.catatan !== a.catatan) hasil.push({ bagian: b.kode, bidang: "Catatan baris", sebelum: ringkasNilai(a.catatan), sesudah: ringkasNilai(s.catatan) });
  }
  return hasil;
}

export const bolehSetujui = (koreksi, userId) => koreksi?.status === "PENDING_APPROVAL" && !!userId && koreksi.pemohon?.id !== userId;
export const bolehBatal = (koreksi, userId) => koreksi?.status === "PENDING_APPROVAL" && !!userId && koreksi.pemohon?.id === userId;
export const alasanTidakBolehSetujui = (koreksi, userId) => (koreksi?.pemohon?.id === userId ? "Pemohon tidak boleh menyetujui koreksinya sendiri — minta penyetuju lain." : "");
