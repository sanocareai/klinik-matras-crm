// LOGIKA MURNI KOREKSI PER DOKUMEN (tanpa React/DOM). Semua aturan, bukti, dan angka dihitung SERVER; di sini hanya pelabelan dan penyusunan permintaan.
// JANGAN menebak harga/tanggal di klien: pilihan tanggal datang dari bukti server, harga hanya dari isian manusia.

export const KELAS_LABEL = Object.freeze({
  PERLU_KEPUTUSAN: "Perlu keputusan", NILAI_NOL: "Harga belum diisi (Rp0)", RIWAYAT_PRA_BUKU: "Riwayat sebelum buku besar", LAIN: "Lain-lain", SUDAH_DIAKUI: "Sudah diakui",
});
export const KELAS_NADA = Object.freeze({ PERLU_KEPUTUSAN: "orange", NILAI_NOL: "red", RIWAYAT_PRA_BUKU: "neutral", LAIN: "neutral", SUDAH_DIAKUI: "green" });

export const PENYEBAB_LABEL = Object.freeze({
  NILAI_NOL: "Harga order Rp0", STATUS_DITETAPKAN_SAAT_DIBUAT: "Status serah ditetapkan saat order dibuat", SEBELUM_BUKU_BESAR: "Diserahkan sebelum buku besar mulai",
  STATUS_DIATUR_MANUAL: "Status dikunci/diatur manual", TIDAK_TERBUKTI: "Penyebab tidak terbukti dari data", PENGAKUAN_DIBALIK: "Pengakuan sebelumnya dibalik",
});

export const TAHAN_LABEL = Object.freeze({
  SUDAH_DIAKUI: "Sudah diakui", PENJUALAN_KARYAWAN: "Order operasional PKR", ORDER_DIGABUNG: "Order digabung", STATUS_BELUM_DISERAHKAN: "Belum diserahkan", NILAI_ORDER_NOL: "Nilai Rp0",
  LUNAS_TANPA_PEMBAYARAN: "Lunas tanpa pembayaran", DISERAHKAN_SEBELUM_CUTOFF: "Diserahkan sebelum cutoff", SERAH_TIDAK_TERBUKTI: "Penyerahan tidak terbukti",
});

/** Dasar tanggal yang BERBUKTI dan tersedia; Keputusan Owner selalu ada tetapi butuh bukti referensi. */
export function pilihanTanggalTersedia(detail) {
  return (detail?.pilihanTanggal ?? []).filter((p) => p.tersedia);
}

/** Dasar bawaan: bukti POD → bukti status → (tidak ada: kosong; manusia harus memilih sadar). Tidak pernah menebak tanggal hari ini. */
export function dasarBawaan(detail) {
  const p = detail?.pilihanTanggal ?? [];
  const pod = p.find((x) => x.dasar === "TANGGAL_SERAH_POD" && x.tersedia);
  if (pod) return pod.dasar;
  const st = p.find((x) => x.dasar === "TANGGAL_STATUS_DISERAHKAN" && x.tersedia);
  return st ? st.dasar : "";
}

/** Tanggal terisi otomatis HANYA dari bukti; untuk Keputusan Owner kosong (diisi manusia). */
export function tanggalDariDasar(detail, dasar) {
  if (!dasar || dasar === "KEPUTUSAN_OWNER") return "";
  return (detail?.pilihanTanggal ?? []).find((x) => x.dasar === dasar)?.tanggal ?? "";
}

/** Body permintaan pengakuan. Mengembalikan { body, galat } — galat = alasan tombol dinonaktifkan (null bila siap). */
export function susunBodyAkui(detail, f) {
  const galat = (() => {
    if (!detail) return "Detail belum dimuat";
    const keras = detail.tahan?.find((t) => !t.lunakDenganPersetujuan);
    if (keras) return keras.pesan ?? "Order ditahan";
    if (!f.dasarTanggal) return "Pilih dasar tanggal";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.tanggal || "")) return "Tanggal pengakuan wajib diisi";
    if ((f.alasan || "").trim().length < 10) return "Alasan minimal 10 karakter";
    if (f.dasarTanggal === "KEPUTUSAN_OWNER" && (f.buktiReferensi || "").trim().length < 8) return "Bukti referensi Keputusan Owner minimal 8 karakter";
    if (detail.praCutoff && !f.akuiPraCutoff) return "Order diserahkan sebelum cutoff: centang persetujuan eksplisit";
    return null;
  })();
  const body = {
    dasarTanggal: f.dasarTanggal, tanggal: f.tanggal, alasan: (f.alasan || "").trim(),
    ...(f.dasarTanggal === "KEPUTUSAN_OWNER" ? { buktiReferensi: (f.buktiReferensi || "").trim() } : {}),
    ...(f.akuiPraCutoff ? { akuiPraCutoff: true } : {}),
  };
  return { body, galat };
}

/** Body penetapan harga: hanya item Rp0 dengan harga yang DIISI manusia (bilangan bulat > 0). */
export function susunBodyHarga(detail, isian, f) {
  const harga = (detail?.items ?? []).filter((i) => !i.harga).map((i) => ({ itemId: i.id, harga: Number(isian?.[i.id]) })).filter((h) => h.harga > 0);
  const nol = (detail?.items ?? []).filter((i) => !i.harga);
  const galat = !nol.length ? "Tidak ada item berharga Rp0"
    : harga.length === 0 || harga.some((h) => !Number.isInteger(h.harga)) ? "Isi harga minimal satu item (bilangan bulat Rupiah)"
      : (f.buktiHarga || "").trim().length < 8 ? "Bukti harga minimal 8 karakter (nomor penawaran/pesan/kesepakatan)"
        : (f.alasan || "").trim().length < 10 ? "Alasan minimal 10 karakter" : null;
  return { body: { harga, buktiHarga: (f.buktiHarga || "").trim(), alasan: (f.alasan || "").trim() }, galat };
}

export function susunBodyAtribusi(scope, alasan) {
  const galat = !scope ? "Pilih divisi" : (alasan || "").trim().length < 10 ? "Alasan minimal 10 karakter (jelaskan bukti)" : null;
  return { body: { scope, alasan: (alasan || "").trim() }, galat };
}

/** Ringkasan satu baris dampak untuk pratinjau pengakuan. */
export function ringkasDampak(d) {
  if (!d) return [];
  const rp = (n) => `Rp${Math.abs(Math.round(n)).toLocaleString("id-ID")}`;
  const out = [];
  if (d.pendapatanBertambah) out.push(`Pendapatan ${d.pendapatanBertambah > 0 ? "bertambah" : "berkurang"} ${rp(d.pendapatanBertambah)}`);
  if (d.piutangUsahaBerubah) out.push(`Piutang usaha ${d.piutangUsahaBerubah > 0 ? "bertambah" : "berkurang"} ${rp(d.piutangUsahaBerubah)}`);
  if (d.uangMukaPelangganBerubah) out.push(`Uang muka pelanggan ${d.uangMukaPelangganBerubah > 0 ? "bertambah" : "berkurang"} ${rp(d.uangMukaPelangganBerubah)}`);
  return out;
}

export const kunciBaruKoreksi = (awalan) => `${awalan}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
