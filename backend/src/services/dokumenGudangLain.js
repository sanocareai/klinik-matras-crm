// STATUS & AKSI DOKUMEN GUDANG LAIN (UX Tahap 2, pola sederhana): Restok · Barang Rusak · Retur · Penyesuaian Stok · Stock Opname.
// Sama dengan services/dokumenGudang.js (MI/ST): server menentukan label, tahap, pengaruh ke stok, penjelasan, dan aksi yang relevan; aturan bisnis TIDAK berubah (aksi memetakan endpoint yang SUDAH ada).
// Murni (tanpa DB).
import { AKSI_DOK } from "./dokumenGudang.js";

export const AKSI_LAIN = Object.freeze({
  ...AKSI_DOK,
  TANDAI_DIPESAN: { kode: "TANDAI_DIPESAN", label: "Tandai sudah dipesan", jenis: "maju" },
  HUBUNGKAN_PENERIMAAN: { kode: "HUBUNGKAN_PENERIMAAN", label: "Tautkan ke penerimaan", jenis: "maju" },
  TOLAK: { kode: "TOLAK", label: "Tolak", jenis: "batal" },
  MULAI_PERIKSA: { kode: "MULAI_PERIKSA", label: "Mulai periksa", jenis: "maju" },
  SELESAIKAN: { kode: "SELESAIKAN", label: "Selesaikan", jenis: "maju" },
  TERIMA_RETUR: { kode: "TERIMA_RETUR", label: "Tandai barang diterima", jenis: "maju" },
  PERIKSA_RETUR: { kode: "PERIKSA_RETUR", label: "Mulai periksa barang", jenis: "maju" },
  POSTING: { kode: "POSTING", label: "Posting ke stok", jenis: "maju" },
  MULAI_HITUNG: { kode: "MULAI_HITUNG", label: "Mulai hitung", jenis: "maju" },
  SERAHKAN_HITUNGAN: { kode: "SERAHKAN_HITUNGAN", label: "Serahkan hitungan", jenis: "maju" },
  HITUNG_ULANG: { kode: "HITUNG_ULANG", label: "Hitung ulang", jenis: "ubah" },
  PERIKSA_HITUNGAN: { kode: "PERIKSA_HITUNGAN", label: "Saya memeriksa hitungan ini", jenis: "ubah" },
  SELESAIKAN_OPNAME: { kode: "SELESAIKAN_OPNAME", label: "Selesaikan opname", jenis: "maju" },
});

const bentuk = (tahap, idx, status) => (kode, label, warna, penjelasan, pengaruhStok, aksi, extra = {}) => ({ kode, status, label, warna, tahap, tahapIndeks: idx[status] ?? null, pengaruhStok, penjelasan, aksi: aksi.map((a) => ({ ...a })), ...extra });

/** Hanya pemegang izin tulis yang ditawari aksi (server tetap menolak 403). */
export const untukIzin = (tampilan, tulis) => (tulis ? tampilan : { ...tampilan, aksi: [] });

const TAHAP_RESTOK = Object.freeze([{ kode: "DRAF", label: "Draf" }, { kode: "MENUNGGU", label: "Menunggu persetujuan" }, { kode: "DISETUJUI", label: "Disetujui" }, { kode: "DIPESAN", label: "Dipesan" }, { kode: "SELESAI", label: "Selesai" }]);
const IDX_RESTOK = { DRAFT: 0, WAITING_APPROVAL: 1, APPROVED: 2, ORDERED: 3, COMPLETED: 4 };
/** Permintaan Restok. TIDAK PERNAH menulis stok: selesai = ditautkan ke penerimaan yang stoknya masuk lewat Penerimaan Barang. */
export function tampilanRestok(r) {
  const status = String(r?.status ?? ""); const d = bentuk(TAHAP_RESTOK, IDX_RESTOK, status); const ubah = AKSI_LAIN.UBAH; const tolak = AKSI_LAIN.TOLAK;
  switch (status) {
    case "DRAFT": return d("DRAF", "Draf", "neutral", "Permintaan belum diajukan. Permintaan restok tidak mengubah stok; stok baru bertambah saat barang diterima lewat Penerimaan Barang.", "BELUM", [AKSI_LAIN.AJUKAN, ubah, tolak]);
    case "WAITING_APPROVAL": return d("MENUNGGU", "Menunggu persetujuan", "orange", "Menunggu persetujuan. Jumlah dan pemasok masih boleh diubah.", "BELUM", [AKSI_LAIN.SETUJUI, ubah, tolak]);
    case "APPROVED": return d("DISETUJUI", "Disetujui — belum dipesan", "accent", "Disetujui. Langkah berikutnya: pesan ke pemasok (lewat Finance/PO), lalu tandai sudah dipesan.", "BELUM", [AKSI_LAIN.TANDAI_DIPESAN, ubah, tolak]);
    case "ORDERED": return d("DIPESAN", "Sudah dipesan — menunggu barang", "accent", "Menunggu barang tiba. Setelah ada penerimaan barang untuk bahan ini, tautkan penerimaannya; stok masuk lewat Penerimaan Barang, bukan dari sini.", "BELUM", [AKSI_LAIN.HUBUNGKAN_PENERIMAAN, ubah, tolak]);
    case "COMPLETED": return d("SELESAI", "Selesai — tertaut ke penerimaan", "green", "Sudah ditautkan ke penerimaan barang. Stok dicatat oleh penerimaan itu.", "TIDAK", []);
    case "REJECTED": return d("DITOLAK", "Ditolak", "neutral", `Permintaan ditolak${r?.rejectedReason ? `: ${r.rejectedReason}` : ""}. Tidak memengaruhi stok.`, "TIDAK", []);
    default: return d("TIDAK_DIKENAL", status || "—", "neutral", "Status tidak dikenal.", "TIDAK", []);
  }
}

const TAHAP_RUSAK = Object.freeze([{ kode: "DILAPORKAN", label: "Dilaporkan" }, { kode: "DIPERIKSA", label: "Diperiksa" }, { kode: "SELESAI", label: "Selesai ditangani" }]);
const IDX_RUSAK = { REPORTED: 0, UNDER_INSPECTION: 1, RESOLVED: 2 };
const RESOLUSI_KELUAR = ["RETURN_TO_SUPPLIER", "DISPOSE"];
/** Barang Rusak. Hanya penyelesaian "Dibuang" / "Retur ke supplier" yang MENGURANGI stok (WASTE); lainnya hanya tercatat. */
export function tampilanRusak(r) {
  const status = String(r?.status ?? ""); const d = bentuk(TAHAP_RUSAK, IDX_RUSAK, status);
  switch (status) {
    case "REPORTED": return d("DILAPORKAN", "Dilaporkan — menunggu pemeriksaan", "orange", "Laporan barang rusak. Belum memengaruhi stok: saldo baru berkurang bila nanti diselesaikan sebagai Dibuang atau Retur ke supplier.", "BELUM", [AKSI_LAIN.MULAI_PERIKSA]);
    case "UNDER_INSPECTION": return d("DIPERIKSA", "Sedang diperiksa", "accent", "Barang sedang diperiksa. Pilih penyelesaian: Dibuang / Retur ke supplier MENGURANGI stok sebesar jumlah rusak; Perbaiki ulang / Kembalikan ke tersedia hanya dicatat.", "BELUM", [AKSI_LAIN.SELESAIKAN]);
    case "RESOLVED": { const keluar = RESOLUSI_KELUAR.includes(r?.resolution); return d("SELESAI", keluar ? "Selesai — stok berkurang" : "Selesai — stok tidak berubah", "green", keluar ? "Penyelesaian ini sudah mengurangi stok (pergerakan buang/retur tercatat). Salah input diperbaiki lewat jalur koreksi resmi." : "Penyelesaian ini hanya dicatat; saldo stok tidak berubah.", keluar ? "SUDAH" : "TIDAK", []); }
    default: return d("TIDAK_DIKENAL", status || "—", "neutral", "Status tidak dikenal.", "TIDAK", []);
  }
}

const TAHAP_RETUR = Object.freeze([{ kode: "DICATAT", label: "Dicatat" }, { kode: "DITERIMA", label: "Diterima" }, { kode: "DIPERIKSA", label: "Diperiksa" }, { kode: "SELESAI", label: "Selesai" }]);
const IDX_RETUR = { CREATED: 0, RECEIVED: 1, INSPECTION: 2, COMPLETED: 3 };
/** Retur. Hanya penyelesaian "Kembalikan ke tersedia" yang MENAMBAH stok (RETURN); lainnya hanya tercatat. */
export function tampilanRetur(r) {
  const status = String(r?.status ?? ""); const d = bentuk(TAHAP_RETUR, IDX_RETUR, status); const ubah = AKSI_LAIN.UBAH; const batal = AKSI_LAIN.BATALKAN;
  switch (status) {
    case "CREATED": return d("DICATAT", "Dicatat — barang belum diterima", "neutral", "Retur baru dicatat. Belum memengaruhi stok. Tandai diterima saat barangnya sampai di gudang.", "BELUM", [AKSI_LAIN.TERIMA_RETUR, ubah, batal]);
    case "RECEIVED": return d("DITERIMA", "Barang diterima — belum diperiksa", "accent", "Barang sudah di gudang. Belum memengaruhi stok. Lanjutkan dengan memeriksa kondisi barang.", "BELUM", [AKSI_LAIN.PERIKSA_RETUR, ubah, batal]);
    case "INSPECTION": return d("DIPERIKSA", "Sedang diperiksa", "accent", "Isi hasil pemeriksaan lalu pilih penyelesaian. Hanya \"Kembalikan ke tersedia\" yang MENAMBAH stok sebesar jumlah retur; pilihan lain hanya dicatat.", "BELUM", [AKSI_LAIN.SELESAIKAN, ubah, batal]);
    case "COMPLETED": { const tambah = r?.resolution === "RETURN_TO_AVAILABLE"; return d("SELESAI", tambah ? "Selesai — stok bertambah" : "Selesai — stok tidak berubah", "green", tambah ? "Barang dikembalikan ke stok tersedia (pergerakan retur tercatat). Salah input diperbaiki lewat jalur koreksi resmi." : "Penyelesaian ini hanya dicatat; saldo stok tidak berubah.", tambah ? "SUDAH" : "TIDAK", []); }
    case "CANCELLED": return d("DIBATALKAN", "Dibatalkan", "neutral", "Retur dibatalkan. Tidak memengaruhi stok.", "TIDAK", []);
    default: return d("TIDAK_DIKENAL", status || "—", "neutral", "Status tidak dikenal.", "TIDAK", []);
  }
}

const TAHAP_ADJ = Object.freeze([{ kode: "DRAF", label: "Draf" }, { kode: "MENUNGGU", label: "Menunggu persetujuan" }, { kode: "DISETUJUI", label: "Disetujui" }, { kode: "DIPOSTING", label: "Diposting" }]);
const IDX_ADJ = { DRAFT: 0, WAITING_APPROVAL: 1, APPROVED: 2, POSTED: 3 };
/** Penyesuaian Stok. Persetujuan WAJIB orang lain berperan penyetuju (Owner/Finance) — aturan pemisahan tugas yang berlaku; ctx menjelaskan mengapa tombol Setujui tidak tersedia. */
export function tampilanPenyesuaian(r, ctx = {}) {
  const status = String(r?.status ?? ""); const d = bentuk(TAHAP_ADJ, IDX_ADJ, status); const ubah = AKSI_LAIN.UBAH; const batal = AKSI_LAIN.BATALKAN;
  const bisaSetujui = ctx.bisaSetujui !== false; const pemohonSama = !!ctx.pemohonSama;
  const catatSetuju = !bisaSetujui ? " Anda tidak berperan penyetuju; persetujuan oleh Owner/Finance." : pemohonSama ? " Anda pemohon dokumen ini; persetujuan harus oleh orang lain." : "";
  switch (status) {
    case "DRAFT": return d("DRAF", "Draf", "neutral", "Belum diajukan. Belum memengaruhi stok. Alasan dan catatan boleh diperbaiki.", "BELUM", [AKSI_LAIN.AJUKAN, ubah, batal]);
    case "WAITING_APPROVAL": return d("MENUNGGU", "Menunggu persetujuan", "orange", `Menunggu persetujuan orang yang berwenang (bukan pemohon). Belum memengaruhi stok.${catatSetuju}`, "BELUM", [...(bisaSetujui && !pemohonSama ? [AKSI_LAIN.SETUJUI] : []), ubah, batal]);
    case "APPROVED": return d("DISETUJUI", "Disetujui — belum diposting", "accent", "Disetujui. Stok baru berubah saat diposting; sistem memeriksa saldo terbaru saat itu (saldo tidak boleh menjadi minus).", "BELUM", [AKSI_LAIN.POSTING, batal]);
    case "POSTED": return d("DIPOSTING", "Sudah diposting — stok berubah", "green", "Penyesuaian sudah masuk ke stok. Catatan tidak dihapus; salah input diperbaiki lewat jalur koreksi resmi.", "SUDAH", []);
    case "CANCELLED": return d("DIBATALKAN", "Dibatalkan", "neutral", "Penyesuaian dibatalkan. Tidak memengaruhi stok.", "TIDAK", []);
    default: return d("TIDAK_DIKENAL", status || "—", "neutral", "Status tidak dikenal.", "TIDAK", []);
  }
}

const TAHAP_OPNAME = Object.freeze([{ kode: "TERJADWAL", label: "Terjadwal" }, { kode: "DIHITUNG", label: "Sedang dihitung" }, { kode: "TINJAUAN", label: "Menunggu tinjauan" }, { kode: "SELESAI", label: "Selesai" }]);
const IDX_OPNAME = { SCHEDULED: 0, IN_PROGRESS: 1, WAITING_REVIEW: 2, COMPLETED: 3 };
/** Stock Opname. ctx: { bisaMenyetujuiSelisih, adaSelisih, bisaPeriksa }. Aturan pemisahan tugas & pergerakan sesi TIDAK diubah — hanya dijelaskan. */
export function tampilanOpname(c, ctx = {}) {
  const status = String(c?.status ?? ""); const d = bentuk(TAHAP_OPNAME, IDX_OPNAME, status); const ubah = { ...AKSI_LAIN.UBAH, label: "Ubah jadwal & catatan" }; const batal = AKSI_LAIN.BATALKAN;
  switch (status) {
    case "SCHEDULED": return d("TERJADWAL", "Terjadwal — belum dihitung", "neutral", "Belum dihitung dan belum memengaruhi stok. Saat Mulai hitung, sistem merekam saldo sistem sebagai pembanding (disembunyikan bila blind count).", "BELUM", [AKSI_LAIN.MULAI_HITUNG, ubah, batal]);
    case "IN_PROGRESS": return d("DIHITUNG", "Sedang dihitung", "accent", "Isi hasil hitung fisik tiap bahan, lalu serahkan hitungan. Belum memengaruhi stok.", "BELUM", [AKSI_LAIN.SERAHKAN_HITUNGAN, batal]);
    case "WAITING_REVIEW": {
      const aksi = [];
      if (c?.countType === "FULL_STOCK_OPNAME" && ctx.bisaPeriksa !== false) aksi.push(AKSI_LAIN.PERIKSA_HITUNGAN);
      aksi.push(AKSI_LAIN.HITUNG_ULANG);
      const boleh = !ctx.adaSelisih || ctx.bisaMenyetujuiSelisih !== false; if (boleh) aksi.push(AKSI_LAIN.SELESAIKAN_OPNAME);
      aksi.push(batal);
      const catat = ctx.adaSelisih && ctx.bisaMenyetujuiSelisih === false ? " Ada selisih: hanya penyetuju (Owner/Finance) yang bukan pembuat/penugas/pengisi hitungan yang dapat menyelesaikannya." : "";
      return d("TINJAUAN", "Menunggu tinjauan selisih", "orange", `Hitungan sudah diserahkan. Tandai pergerakan stok selama sesi, periksa selisih dan alasannya, lalu selesaikan. Stok baru berubah saat diselesaikan (satu penyesuaian per bahan berselisih).${catat}`, "BELUM", aksi);
    }
    case "COMPLETED": return d("SELESAI", "Selesai — selisih dibukukan", "green", "Selisih (bila ada) sudah dibukukan sebagai penyesuaian. Catatan tidak dihapus; salah input diperbaiki lewat jalur koreksi resmi.", "SUDAH", []);
    case "CANCELLED": return d("DIBATALKAN", "Dibatalkan", "neutral", "Opname dibatalkan. Tidak memengaruhi stok.", "TIDAK", []);
    default: return d("TIDAK_DIKENAL", status || "—", "neutral", "Status tidak dikenal.", "TIDAK", []);
  }
}
