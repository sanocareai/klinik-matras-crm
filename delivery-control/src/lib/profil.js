// Logika murni Profil (tanpa React Native) — dapat diuji di Node.
// Sumber kebenaran = SERVER (akun yang sama dengan web): GET /auth/me (nama, peran, divisi efektif, foto) dan GET /users/me (email).
// Aplikasi TIDAK menyimpan profil lokal; hanya field yang diizinkan server yang bisa diubah (nama, email, foto).

const LABEL_PERAN = {
  OWNER: "Owner", ADMIN: "Admin", DISPATCHER: "Dispatcher", DRIVER: "Driver", HELPER: "Helper", LEADER_DRIVER: "Leader Driver",
  FINANCE: "Finance", ACCOUNTANT: "Akuntan", APPROVER: "Approver", SALES: "Sales", GUDANG: "Gudang", PRODUKSI: "Produksi", QC: "QC",
};
const LABEL_DIVISI = {
  SALES: "Sales", PRODUKSI: "Produksi", GUDANG: "Gudang", DELIVERY: "Delivery", DIGITAL_TECHNOLOGY: "Digital & Technology",
  OFFICE: "Office", MANAGEMENT: "Management", UMUM: "Umum", MARKETING: "Marketing", HRGA: "HR & GA",
};

const rapikan = (kode) => String(kode || "").toLowerCase().split("_").filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1)).join(" ");
export const labelPeran = (k) => LABEL_PERAN[k] || rapikan(k) || "-";
export const labelDivisi = (k) => LABEL_DIVISI[k] || rapikan(k) || "-";

export function inisial(nama) {
  return String(nama || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || "").join("") || "?";
}

/** Gabungkan /auth/me dan /users/me menjadi satu profil (hanya data dari server). */
export function bentukProfil(auth, users) {
  const a = auth || {}; const u = users || {};
  const roles = Array.isArray(a.roles) && a.roles.length ? a.roles : (a.role ? [a.role] : []);
  return {
    id: a.id || u.id || null,
    nama: a.name || u.name || "",
    email: u.email || a.email || "",
    roles,
    divisi: Array.isArray(a.divisions) ? a.divisions : [],
    avatarUrl: a.avatarUrl || u.avatarUrl || null,
    bergabung: u.createdAt || null,
  };
}

const POLA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Validasi ringan di HP; validasi yang menentukan tetap di server. */
export function validasiProfil({ nama, email }) {
  const errors = {};
  if (!String(nama || "").trim()) errors.nama = "Nama tidak boleh kosong";
  else if (String(nama).trim().length > 100) errors.nama = "Nama terlalu panjang";
  if (!String(email || "").trim()) errors.email = "Email tidak boleh kosong";
  else if (!POLA_EMAIL.test(String(email).trim())) errors.email = "Format email tidak valid";
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Hanya field yang benar-benar berubah yang dikirim (PATCH /users/me menerima name/email). */
export function perubahanProfil(asli, baru) {
  const body = {};
  if (String(baru.nama ?? "").trim() !== String(asli.nama ?? "").trim()) body.name = String(baru.nama).trim();
  if (String(baru.email ?? "").trim().toLowerCase() !== String(asli.email ?? "").trim().toLowerCase()) body.email = String(baru.email).trim().toLowerCase();
  return body;
}

/** Waktu kedaluwarsa (epoch ms) dari klaim `exp` JWT; null bila tidak terbaca. Tidak memverifikasi tanda tangan (itu tugas server). */
export function kedaluwarsaToken(token) {
  try {
    const bagian = String(token || "").split(".");
    if (bagian.length !== 3) return null;
    const b64 = bagian[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
    const exp = JSON.parse(decodeURIComponent(escape(json))).exp;
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}
