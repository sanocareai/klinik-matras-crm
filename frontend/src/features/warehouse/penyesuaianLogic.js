// Logika tampilan Penyesuaian Stok (Okt 2026, pemisahan tugas): pengajuan → persetujuan ORANG LAIN → posting.
// Cermin aturan server (backend/src/services/inventorySegregation.js); server tetap yang memutuskan — ini hanya mencegah tombol yang pasti ditolak.
// Role penyetuju = permission inventory:adjustment_approve (OWNER, FINANCE). Penulis ledger = inventory:write (WAREHOUSE, ADMIN, OWNER).

export const ROLE_PENYETUJU = Object.freeze(["OWNER", "FINANCE"]);
export const ROLE_PENULIS = Object.freeze(["WAREHOUSE", "ADMIN", "OWNER"]);

export const punyaRole = (roles, daftar) => Array.isArray(roles) && roles.some((r) => daftar.includes(r));
export const bolehMenyetujui = (roles) => punyaRole(roles, ROLE_PENYETUJU);
export const bolehMenulis = (roles) => punyaRole(roles, ROLE_PENULIS);

const r4 = (x) => Math.round(x * 10000) / 10000;

/** Hasil hitung fisik (absolut) → selisih (±) terhadap saldo catatan saat ini. Kolom kosong/nol-tanpa-sengaja tidak diterima diam-diam. */
export function hitungSelisihPengajuan(saldo, hasilHitung) {
  const s = Number(saldo);
  const h = hasilHitung === "" || hasilHitung === null || hasilHitung === undefined ? NaN : Number(hasilHitung);
  if (!Number.isFinite(h) || h < 0) return { ok: false, pesan: "Hasil hitung fisik wajib angka 0 atau lebih" };
  if (!Number.isFinite(s)) return { ok: false, pesan: "Saldo catatan tidak terbaca" };
  const selisih = r4(h - s);
  if (Math.abs(selisih) < 1e-6) return { ok: false, pesan: "Tidak ada selisih — hasil hitung sama dengan catatan sistem" };
  return { ok: true, selisih, saldo: s, hasil: h };
}

/** Tombol yang boleh tampil untuk satu permintaan, menurut status + role + siapa pemohonnya. */
export function aksiPermintaan({ status, roles, userId, requestedById }) {
  const hasil = { majukan: false, setujui: false, posting: false, batalkan: false, catatan: "" };
  const tulis = bolehMenulis(roles);
  const setuju = bolehMenyetujui(roles);
  if (status === "POSTED" || status === "CANCELLED") return hasil;
  hasil.batalkan = tulis;
  if (status === "DRAFT") { hasil.majukan = tulis; if (!tulis) hasil.catatan = "Hanya Gudang/Admin/Owner yang dapat mengajukan."; }
  else if (status === "WAITING_APPROVAL") {
    if (!setuju) hasil.catatan = "Menunggu persetujuan Owner atau Finance.";
    else if (userId && requestedById && userId === requestedById) hasil.catatan = "Anda pemohon permintaan ini — persetujuan harus oleh orang lain.";
    else hasil.setujui = true;
  } else if (status === "APPROVED") {
    hasil.posting = tulis;
    if (!tulis) hasil.catatan = "Posting dilakukan oleh petugas Gudang/Admin/Owner.";
  }
  return hasil;
}

export const PESAN_DIAJUKAN = "Penyesuaian diajukan dan menunggu persetujuan Owner/Finance. Stok belum berubah sampai disetujui orang lain dan diposting.";
