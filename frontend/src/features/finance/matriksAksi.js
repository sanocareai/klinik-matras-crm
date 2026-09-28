// MATRIKS AKSI FINANCE (B3.2) — SATU sumber kebenaran untuk apa yang muncul di menu Aksi tiap transaksi.
// Murni (tanpa React) supaya bisa dites. Halaman hanya memasang handler ke deskriptor ini (features/finance/aksiMenu.jsx).
// Cermin dari docs/FINANCE-EDIT-KOREKSI-MATRIKS.md. Server tetap penentu akhir izin & aturan (403/409); UI hanya menjelaskan.
//
// Aturan UX: tidak ada tindakan yang HILANG tanpa penjelasan. Kalau tidak bisa: item tetap tampil, disabled, dengan `alasan` Bahasa Indonesia.
// Deskriptor: { key, aksi: "edit"|"koreksi"|"batal"|"tolak"|"riwayat"|"kembali"|"catatUlang", label, aktif, alasan?, destructive?, konfirmasi? }

export const ALASAN_ADMIN = "Butuh Admin Keuangan — akun Anda tidak punya izin ini";

/** Cermin sisi klien dari FINANCE_ADMIN (ADMIN/OWNER). Server tetap memvalidasi ulang setiap permintaan. */
export function adalahAdminKeuangan(user) {
  const roles = Array.isArray(user?.roles) && user.roles.length ? user.roles : (user?.role ? [user.role] : []);
  return roles.some((r) => r === "ADMIN" || r === "OWNER");
}

const ok = (key, aksi, label, extra = {}) => ({ key, aksi, label, aktif: true, ...extra });
const tidak = (key, aksi, label, alasan, extra = {}) => ({ key, aksi, label, aktif: false, alasan, ...extra });
const izinAdmin = (admin, deskriptor) => (admin ? deskriptor : { ...deskriptor, aktif: false, alasan: ALASAN_ADMIN });
const riwayat = () => ok("versi", "riwayat", "Riwayat perubahan");

// B3.8 — item Koreksi untuk dokumen yang SUDAH berjurnal & versi-pengganti (tagihan supplier, refund). Keadaan aktif/nonaktif + alasan
// + arah tindakan dihitung SERVER (doc.koreksi dari GET /bills & /refunds); klien tidak menyalin aturan blokir. Tanpa data server
// (mis. klien lama), item tetap aktif dan server yang menolak dengan pesan yang sama.
const gabungAlasan = (k) => [k?.alasan, k?.arah].filter(Boolean).join(" ");
function itemKoreksi(doc, admin, label, hint) {
  if (!admin) return tidak("koreksi", "koreksi", label, ALASAN_ADMIN);
  if (doc.koreksi && doc.koreksi.aktif === false) return tidak("koreksi", "koreksi", label, gabungAlasan(doc.koreksi) || "Tidak bisa dikoreksi saat ini");
  return ok("koreksi", "koreksi", label, { hint });
}

// ─── Pengeluaran & Pembelian ─────────────────────────────────────────────
const SUDAH_BERJURNAL = ["DISETUJUI", "DIBAYAR"];
const PRA_JURNAL = ["DRAFT", "MENUNGGU_APPROVAL"];

/** `namaJamak`: "pengeluaran" / "pembelian" — dipakai dalam teks alasan. */
export function aksiDokumenBiaya(doc, { admin = false, nama = "pengeluaran" } = {}) {
  const s = doc.status;
  const hasil = [];
  if (PRA_JURNAL.includes(s)) {
    hasil.push(ok("edit", "edit", "Edit"));
    hasil.push(riwayat());
    hasil.push(ok("tolak", "tolak", "Tolak", { destructive: true }));
    hasil.push(tidak("batalkan", "batal", "Batalkan", `Belum berjurnal — gunakan Tolak bila ${nama} ini tidak jadi diproses`));
  } else if (SUDAH_BERJURNAL.includes(s)) {
    hasil.push(izinAdmin(admin, ok("edit", "koreksi", "Koreksi")));
    hasil.push(riwayat());
    hasil.push(izinAdmin(admin, ok("batalkan", "batal", "Batalkan", { destructive: true, konfirmasi: true })));
  } else if (s === "DITOLAK") {
    hasil.push(tidak("edit", "edit", "Edit", `${cap(nama)} yang sudah ditolak tidak bisa diedit — buat ${nama} baru`));
    hasil.push(riwayat());
  } else {
    // DIBATALKAN (jurnal sudah dibalik) dan status lain
    hasil.push(tidak("edit", "koreksi", "Koreksi", `${cap(nama)} sudah dibatalkan dan jurnalnya sudah dibalik — catat ${nama} baru`));
    hasil.push(riwayat());
  }
  return hasil;
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ─── Tagihan supplier ────────────────────────────────────────────────────
export function aksiTagihan(b, { admin = false } = {}) {
  const s = b.status;
  const adaPembayaran = ["DIBAYAR_SEBAGIAN", "LUNAS"].includes(s) || Number(b.terbayar) > 0;
  if (["DRAFT", "MENUNGGU_APPROVAL"].includes(s)) {
    return [
      ok("edit", "edit", "Edit"),
      riwayat(),
      ok("tolak", "tolak", "Tolak", { destructive: true }),
    ];
  }
  if (["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"].includes(s)) {
    const catatUlang = adaPembayaran
      ? tidak("batalkan", "catatUlang", "Batalkan & Catat Ulang", "Memiliki pembayaran aktif — batalkan pembayarannya dulu di tab Pembayaran", { destructive: true })
      : izinAdmin(admin, ok("batalkan", "catatUlang", "Batalkan & Catat Ulang", { destructive: true, konfirmasi: true }));
    // B3.8: Edit Informasi (tanpa jurnal) + Koreksi (versi pengganti + reversal, PIN). Ada pembayaran aktif → Koreksi nonaktif dengan alasan.
    const koreksi = adaPembayaran && !b.koreksi
      ? tidak("koreksi", "koreksi", "Koreksi Tagihan", "Memiliki pembayaran aktif — batalkan pembayarannya dulu di tab Pembayaran, lalu koreksi")
      : itemKoreksi(b, admin, "Koreksi Tagihan", "Nominal, tanggal, supplier, keterangan, kategori. Jurnal lama dibalik & tagihan pengganti dibuat (butuh PIN).");
    return [
      ok("info", "edit", "Edit Informasi", { hint: "Nomor faktur supplier & jatuh tempo. Tanpa jurnal." }),
      koreksi, riwayat(), catatUlang,
    ];
  }
  if (s === "DIBATALKAN" && b.replacedBy?.billNumber) {
    return [tidak("edit", "edit", "Edit", `Sudah dikoreksi — digantikan ${b.replacedBy.billNumber}. Buka Riwayat untuk versi terbaru`), riwayat()];
  }
  return [tidak("edit", "edit", "Edit", "Tagihan yang sudah ditolak atau dibatalkan tidak bisa diedit — catat tagihan baru"), riwayat()];
}

// ─── Pembayaran supplier ─────────────────────────────────────────────────
export function aksiPembayaranSupplier(p, { admin = false } = {}) {
  const batal = !!p.cancelledAt;
  return [
    tidak("koreksi", "koreksi", "Koreksi", batal
      ? "Pembayaran sudah dibatalkan — catat pembayaran baru"
      : "Koreksi langsung tidak tersedia — Batalkan lalu catat ulang pembayarannya"),
    riwayat(),
    batal
      ? tidak("batalkan", "catatUlang", "Batalkan & Catat Ulang", "Pembayaran ini sudah dibatalkan")
      : izinAdmin(admin, ok("batalkan", "catatUlang", "Batalkan & Catat Ulang", { destructive: true, konfirmasi: true })),
  ];
}

// ─── Kasbon ──────────────────────────────────────────────────────────────
export function aksiKasbon(k, { admin = false } = {}) {
  const batal = k.status === "DIBATALKAN";
  const pelunasanAktif = (k.repayments || []).filter((r) => !r.cancelledAt).length;
  const hasil = [];
  // B3.8: Riwayat perubahan (siapa mengubah apa, alasan, rantai jurnal) SELALU ada; riwayat pemotongan gaji terpisah.
  hasil.push(ok("versi", "riwayat", "Riwayat perubahan"));
  if ((k.repayments || []).length > 0) hasil.push(ok("riwayat", "riwayat", `Riwayat pemotongan (${pelunasanAktif})`));
  hasil.push(batal
    ? tidak("edit", "edit", "Edit Data", "Kasbon yang sudah dibatalkan tidak bisa diubah")
    : ok("edit", "edit", "Edit Data", { hint: "Nama karyawan, urgensi, catatan, bukti. Nominal tidak bisa diubah di sini." }));
  if (batal) hasil.push(tidak("batalkan", "catatUlang", "Batalkan & Catat Ulang", "Kasbon ini sudah dibatalkan"));
  else if (pelunasanAktif > 0) hasil.push(tidak("batalkan", "catatUlang", "Batalkan & Catat Ulang", "Sudah ada pelunasan aktif — batalkan pelunasannya dulu. Nominal hanya bisa diubah lewat Batalkan & Catat Ulang", { destructive: true }));
  else hasil.push(izinAdmin(admin, ok("batalkan", "catatUlang", "Batalkan & Catat Ulang", { destructive: true, konfirmasi: true, hint: "Cara mengubah nominal: batalkan (jurnal dibalik) lalu catat ulang" })));
  return hasil;
}

// ─── Refund ──────────────────────────────────────────────────────────────
export function aksiRefund(r, { admin = false } = {}) {
  if (r.status === "MENUNGGU_APPROVAL") {
    return [ok("edit", "edit", "Edit"), riwayat(), ok("tolak", "tolak", "Tolak", { destructive: true })];
  }
  if (r.status === "DISETUJUI") {
    return [
      ok("info", "edit", "Edit Informasi", { hint: "Alasan refund & lampiran. Tanpa jurnal." }),
      itemKoreksi(r, admin, "Koreksi Refund", "Nominal, tanggal, rekening, biaya transfer. Jurnal lama dibalik & refund pengganti dibuat (butuh PIN)."),
      riwayat(),
      izinAdmin(admin, ok("batalkan", "catatUlang", "Batalkan & Ajukan Ulang", { destructive: true, konfirmasi: true })),
    ];
  }
  if (r.status === "DIBATALKAN" && r.replacedBy?.refundNumber) {
    return [tidak("edit", "edit", "Edit", `Sudah dikoreksi — digantikan ${r.replacedBy.refundNumber}. Buka Riwayat untuk versi terbaru`), riwayat()];
  }
  return [tidak("edit", "edit", "Edit", "Refund yang sudah ditolak atau dibatalkan tidak bisa diedit — ajukan refund baru"), riwayat()];
}

// ─── Transfer kas & Pemasukan lain ───────────────────────────────────────
export function aksiTransferAtauPemasukan(doc, { admin = false, nama = "transfer" } = {}) {
  const batal = !!doc.cancelledAt;
  return [
    batal
      ? tidak("koreksi", "koreksi", "Koreksi", `${cap(nama)} sudah dibatalkan — catat ${nama} baru`)
      : izinAdmin(admin, ok("koreksi", "koreksi", "Koreksi")),
    riwayat(),
    batal
      ? tidak("batal", "batal", "Batalkan", `${cap(nama)} ini sudah dibatalkan`)
      : izinAdmin(admin, ok("batal", "batal", "Batalkan", { destructive: true, konfirmasi: true })),
  ];
}

// ─── Uang Muka Operasional ───────────────────────────────────────────────
export function aksiUangMuka(u, { admin = false } = {}) {
  const batal = u.status === "DIBATALKAN";
  const adaSettlement = (u.settlements || []).some((s) => s.status === "ACTIVE");
  const bisaDipakai = ["AKTIF", "SEBAGIAN"].includes(u.status);
  const hasil = [
    batal
      ? tidak("edit", "edit", "Edit keterangan", "Uang muka yang sudah dibatalkan tidak bisa diubah")
      : ok("edit", "edit", "Edit keterangan", { hint: "Tujuan, tenggat, catatan, bukti, divisi." }),
    tidak("nominal", "koreksi", "Ubah nominal / rekening", batal
      ? "Uang muka ini sudah dibatalkan"
      : "Sudah masuk buku besar — pakai Batalkan & Catat Ulang"),
    riwayat(),
  ];
  if (bisaDipakai && u.saldo > 0) hasil.push(ok("kembali", "kembali", "Kembalikan sisa"));
  if (batal) hasil.push(tidak("batalkan", "catatUlang", "Batalkan & Catat Ulang", "Uang muka ini sudah dibatalkan"));
  else if (adaSettlement) hasil.push(tidak("batalkan", "catatUlang", "Batalkan & Catat Ulang", "Masih ada pertanggungjawaban/pengembalian aktif — batalkan itu dulu", { destructive: true }));
  else hasil.push(izinAdmin(admin, ok("batalkan", "catatUlang", "Batalkan & Catat Ulang", { destructive: true, konfirmasi: true })));
  return hasil;
}
