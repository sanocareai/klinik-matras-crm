// Penjelasan sederhana tiap stage pipeline — satu sumber untuk kartu "Sales per
// Stage" (tab Ringkasan) dan tab Pipeline, supaya definisinya tidak beda-beda.
// stage = Customer.pipelineStage; mandek = tidak disentuh >=14 hari.
export const STAGE_INFO = {
  NEW: "Lead baru: orang yang baru chat masuk dan belum ada tanda jelas dia tertarik. Tugas sales: balas cepat dan gali kebutuhannya.",
  PROSPECT: "Calon pembeli: sudah ngobrol dan tertarik (tanya harga, ukuran, atau layanan), tapi belum deal dan belum ada order. Ini yang perlu terus ditindaklanjuti.",
  TRANSACTION: "Sudah deal: order sudah dibuat dan pengerjaan/pengirimannya dijadwalkan atau berjalan. Ini stage 'berhasil'.",
  REVIEWED: "Sudah selesai: barang/layanan sudah diterima dan customer sudah memberi ulasan. Stage paling akhir yang berhasil.",
  SPAM: "Bukan calon pelanggan asli (iseng, salah nomor, iklan, atau akun internal). Tidak dihitung ke omset maupun konversi.",
};
