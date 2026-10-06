// KLAIM LUNAS SALES — logika murni (tanpa React) supaya bisa dites. Cermin dari aturan server (backend/src/services/finance/klaimLunas.js,
// kekuranganKlaim): UI hanya MEMBANTU — penegak sebenarnya tetap server, yang menolak pengajuan tidak lengkap walau UI dilewati.

export const METODE_KLAIM = Object.freeze([
  { value: "TRANSFER", label: "Transfer" },
  { value: "QRIS", label: "QRIS" },
  { value: "CASH", label: "Tunai" },
  { value: "CARD", label: "Kartu" },
]);

export const STATUS_KLAIM_LABEL = Object.freeze({
  DRAFT: "Draft (belum diajukan)",
  SUBMITTED: "Menunggu verifikasi Finance",
  EVIDENCE_REQUESTED: "Finance meminta bukti tambahan",
  REJECTED: "Ditolak Finance",
  VERIFIED: "Terverifikasi",
  CANCELLED: "Ditarik",
});

/** Status klaim yang masih boleh diisi Sales (sebelum diajukan / setelah diminta lengkapi / ditolak). */
export const STATUS_BISA_DIEDIT = Object.freeze(["DRAFT", "EVIDENCE_REQUESTED", "REJECTED"]);

export const MAKS_BUKTI = 10;
export const MAKS_UKURAN_MB = 8;
export const TIPE_BUKTI_DITERIMA = "image/jpeg,image/png,image/webp,application/pdf";

/**
 * Opsi "Lunas" TIDAK ditawarkan di dropdown status bayar untuk SIAPA PUN (termasuk Admin/Owner) — server menolaknya 409 (LUNAS_HANYA_DARI_LEDGER):
 * LUNAS hanya dihasilkan sistem setelah pembayaran terverifikasi mencapai tagihan. Order yang SUDAH Lunas tetap menampilkan nilainya.
 * Parameter ketiga dipertahankan agar pemanggil lama tidak rusak, tetapi tidak lagi berpengaruh.
 */
export function opsiStatusBayar(semuaStatus, _nilaiSekarang, _isAdmin, _gateAktif = true) {
  // Opsi "Lunas" SELALU tampil (target yang dikenal Sales). Memilihnya tidak mengubah status — lihat lunasDicegat(): pengguna diarahkan mencatat pembayaran dulu.
  return semuaStatus;
}

/**
 * Memilih "Lunas" TIDAK menetapkan status; harus lewat catatan pembayaran (nominal, metode, rekening, bukti) yang diverifikasi Finance.
 * Dicegat untuk: semua peran saat gerbang AKTIF (server menolak LUNAS langsung), dan non-Admin saat gerbang MATI. Admin saat MATI tetap boleh (perilaku lama).
 */
export function lunasDicegat({ isAdmin, gateAktif }) {
  return !!gateAktif || !isAdmin;
}

export const PESAN_LUNAS_BUTUH_PEMBAYARAN =
  "Catat pembayaran dulu.\n\nStatus Lunas muncul setelah ada catatan pembayaran: nominal, metode, rekening tujuan, dan bukti pembayaran. Status Lunas tidak bisa dipilih langsung.";

/**
 * Kekurangan isian klaim. `bukti` = daftar { status: "mengunggah" | "tersimpan" | "gagal" }. Mengembalikan daftar { field, pesan }.
 * Bukti dihitung SAH hanya yang statusnya "tersimpan" (server sudah mengonfirmasi berkas tersimpan) — bukan yang masih diunggah / gagal.
 */
export function kekuranganForm(form, bukti = [], { sisa = null } = {}) {
  const k = [];
  const nominal = Number(form?.amount);
  if (!form?.paymentDate) k.push({ field: "paymentDate", pesan: "Tanggal pembayaran wajib diisi" });
  if (!Number.isInteger(nominal) || nominal <= 0) k.push({ field: "amount", pesan: "Nominal yang diklaim wajib diisi" });
  else if (sisa != null && sisa > 0 && nominal > sisa) k.push({ field: "amount", pesan: "Nominal melebihi sisa tagihan" });
  if (!form?.method) k.push({ field: "method", pesan: "Metode pembayaran wajib dipilih" });
  if (form?.method === "TRANSFER" && !form?.cashAccountId) k.push({ field: "cashAccountId", pesan: "Rekening tujuan wajib dipilih untuk pembayaran Transfer" });
  if (!form?.note || form.note.trim().length < 3) k.push({ field: "note", pesan: "Catatan pembayaran wajib diisi" });
  if (!bukti.some((b) => b.status === "tersimpan")) k.push({ field: "evidence", pesan: "Unggah minimal satu Bukti Pembayaran" });
  return k;
}

/** Tombol "Ajukan Klaim Lunas" aktif HANYA bila isian lengkap, tidak ada unggahan yang masih berjalan, tidak sedang mengirim, dan Sales sudah menyatakan memverifikasi. */
export function bisaDiajukan(form, bukti = [], { mengirim = false, sisa = null, sudahVerifikasi = false } = {}) {
  if (mengirim) return false;
  if (bukti.some((b) => b.status === "mengunggah")) return false;
  if (kekuranganForm(form, bukti, { sisa }).length !== 0) return false;
  return sudahVerifikasi === true;
}

/** Alasan singkat mengapa tombol nonaktif (untuk teks bantu di bawah tombol). null = aktif. */
export function alasanNonaktif(form, bukti = [], { mengirim = false, sisa = null, sudahVerifikasi = false } = {}) {
  if (mengirim) return "Sedang mengirim…";
  if (bukti.some((b) => b.status === "mengunggah")) return "Menunggu unggahan bukti selesai…";
  const k = kekuranganForm(form, bukti, { sisa });
  if (k.length) return k[0].pesan;
  return sudahVerifikasi === true ? null : PESAN_BELUM_VERIFIKASI;
}

// ── KONFIRMASI VERIFIKASI SALES (6 Okt 2026) ─────────────────────────────────────────────────────────────────────────
// Sales WAJIB menyatakan sudah memverifikasi pembayarannya sebelum mengajukan: nominal & tanggal dicocokkan dengan mutasi rekening / uang tunai benar-benar
// diterima. Murni gerbang UI (server tidak punya kolom untuk ini dan tetap menegakkan semua aturan klaim) — tujuannya mencegah pengajuan "asal ajukan" dari
// foto bukti di chat tanpa dicek. Kosong di awal setiap dialog dibuka dan DIKOSONGKAN lagi bila nominal/tanggal/metode/rekening berubah (yang dicek harus
// angka final yang diajukan).
export const LABEL_VERIFIKASI_UANG = "Saya sudah mencocokkan nominal dan tanggal dengan mutasi rekening / catatan pembayaran";
export const LABEL_VERIFIKASI_TUNAI = "Saya sudah memastikan uang tunai ini benar-benar diterima";
export const PESAN_BELUM_VERIFIKASI = "Centang konfirmasi bahwa pembayaran sudah Anda verifikasi";
export const labelVerifikasi = (method) => (method === "CASH" ? LABEL_VERIFIKASI_TUNAI : LABEL_VERIFIKASI_UANG);
/** Field yang bila berubah membatalkan konfirmasi verifikasi. */
export const FIELD_PEMBATAL_VERIFIKASI = Object.freeze(["amount", "paymentDate", "method", "cashAccountId"]);


/** Berkas yang diizinkan diunggah (cermin batas server: JPG/PNG/WEBP/PDF, maks 8 MB). Mengembalikan pesan galat atau null. */
export function cekBerkas(file) {
  if (!file) return "Berkas tidak ditemukan";
  const ok = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type || "") || /\.(jpe?g|png|webp|pdf)$/i.test(file.name || "");
  if (!ok) return "Jenis berkas tidak diizinkan. Gunakan foto (JPG, PNG, WEBP) atau PDF.";
  if (file.size > MAKS_UKURAN_MB * 1024 * 1024) return `Ukuran berkas maksimal ${MAKS_UKURAN_MB} MB`;
  return null;
}


// ── JENIS PEMBAYARAN: DP atau Pelunasan (1 Okt 2026) ─────────────────────────────────────────────────────────────────
// Server TIDAK punya kolom "jenis": klaim berisi nominal ≤ sisa tagihan; setelah Finance memverifikasi, order jadi DP (nominal < sisa) atau Lunas (nominal ≥ sisa).
// "Jenis" di sini murni bantuan UI (mengisi nominal otomatis + teks yang jujur soal dampaknya), tidak dikirim ke server.
export const JENIS_BAYAR = Object.freeze([
  { value: "DP", label: "DP" },
  { value: "PELUNASAN", label: "Pelunasan" },
]);

/** Nominal otomatis per jenis. Pelunasan = sisa tagihan. DP = kekurangan terhadap "DP disepakati" (dpTarget), maksimal sisa; kosong bila DP belum disepakati / sudah terpenuhi. */
export function nominalOtomatis(jenis, { sisa = 0, dpTarget = null, dibayar = 0 } = {}) {
  if (jenis === "PELUNASAN") return sisa > 0 ? String(sisa) : "";
  const kurang = dpTarget > 0 ? Math.min(Math.max(dpTarget - dibayar, 0), sisa) : 0;
  return kurang > 0 ? String(kurang) : "";
}

/** Jenis awal klaim baru: DP bila DP disepakati belum terpenuhi, selain itu Pelunasan (perilaku lama). */
export function jenisAwal({ dpTarget = null, dibayar = 0, sisa = 0 } = {}) {
  return dpTarget > dibayar && sisa > 0 ? "DP" : "PELUNASAN";
}

/** Jenis dari nominal: di bawah sisa = DP; sama dengan sisa (atau lebih) = Pelunasan. */
export function jenisDariNominal(amount, { sisa = 0 } = {}) {
  const n = Number(amount);
  return n > 0 && sisa > 0 && n < sisa ? "DP" : "PELUNASAN";
}

/** Dampak nominal terhadap status pembayaran (setelah Finance memverifikasi) — teks jujur untuk Sales. null = nominal belum valid. */
export function dampakNominal(amount, { sisa = 0 } = {}) {
  const n = Number(amount);
  if (!(n > 0) || !(sisa > 0)) return null;
  const rp = (v) => "Rp" + Math.round(v).toLocaleString("id-ID");
  if (n > sisa) return { tingkat: "galat", teks: `Nominal melebihi sisa tagihan (${rp(sisa)}) — tidak bisa diajukan.` };
  if (n < sisa) return { tingkat: "info", teks: `Setelah diverifikasi Finance, tercatat sebagai DP. Sisa tagihan menjadi ${rp(sisa - n)}.` };
  return { tingkat: "info", teks: "Setelah diverifikasi Finance, order berstatus Lunas." };
}

/** Isi form dari klaim di server (atau default klaim baru: tanggal hari ini WIB; DP bila DP disepakati belum terpenuhi → nominal = kekurangan DP, selain itu Pelunasan → nominal = sisa tagihan). */
export function formDariKlaim(klaim, { sisa = 0, hariIni, dpTarget = null, dibayar = 0 } = {}) {
  const jenis = klaim?.amount != null ? jenisDariNominal(klaim.amount, { sisa }) : jenisAwal({ dpTarget, dibayar, sisa });
  return {
    jenis,
    paymentDate: klaim?.paymentDate || hariIni || "",
    amount: klaim?.amount != null ? String(klaim.amount) : nominalOtomatis(jenis, { sisa, dpTarget, dibayar }),
    method: klaim?.method || "TRANSFER",
    cashAccountId: klaim?.cashAccountId || "",
    note: klaim?.note || "",
  };
}

export const buktiDariKlaim = (klaim) => (klaim?.bukti || []).map((b) => ({ key: b.id, id: b.id, nama: b.nama, mime: b.mime, url: b.url, status: "tersimpan" }));

export function hariIniWIB(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
