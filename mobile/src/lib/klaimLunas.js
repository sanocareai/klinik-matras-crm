// Logika MURNI Klaim Lunas untuk aplikasi Sales (tanpa React/RN supaya bisa dites dengan node --test). Cermin aturan web
// (frontend/src/features/klaim/klaimLunasLogic.js) dan server (backend/src/services/finance/klaimLunas.js): UI hanya MEMBANTU — penegak
// sebenarnya server, yang menolak pengajuan tidak lengkap walau UI dilewati.
//
// OFFLINE: draf (isian form + foto yang belum terunggah) boleh disimpan lokal di perangkat; PENGAJUAN hanya boleh saat SEMUA bukti sudah
// terunggah dan dikonfirmasi tersimpan oleh server (status "tersimpan"). Bukti yang masih antre / gagal tidak pernah dihitung sebagai bukti.

export const METODE_KLAIM = [
  { value: "TRANSFER", label: "Transfer" },
  { value: "QRIS", label: "QRIS" },
  { value: "CASH", label: "Tunai" },
  { value: "CARD", label: "Kartu" },
];

export const STATUS_KLAIM_LABEL = {
  DRAFT: "Draft (belum diajukan)",
  SUBMITTED: "Menunggu verifikasi Finance",
  EVIDENCE_REQUESTED: "Finance meminta bukti tambahan",
  REJECTED: "Ditolak Finance",
  VERIFIED: "Terverifikasi",
  CANCELLED: "Ditarik",
};

export const STATUS_BISA_DIEDIT = ["DRAFT", "EVIDENCE_REQUESTED", "REJECTED"];
export const MAKS_BUKTI = 10;
export const MAKS_UKURAN_MB = 8;

/** Status bukti: "antre" (belum dikirim / offline), "mengunggah", "tersimpan" (dikonfirmasi server), "gagal". */
export const STATUS_BUKTI = { ANTRE: "antre", MENGUNGGAH: "mengunggah", TERSIMPAN: "tersimpan", GAGAL: "gagal" };

/** "Lunas" tidak ditawarkan di pilihan status bayar untuk SIAPA PUN (server menolaknya 409: LUNAS hanya dihasilkan sistem dari pembayaran terverifikasi). Nilai aktif Lunas tetap tampil. */
export function opsiStatusBayar(semuaStatus, nilaiSekarang, _isAdmin, gateAktif = true) {
  if (!gateAktif) return semuaStatus; // sakelar rollout MATI → daftar lama apa adanya
  return semuaStatus.filter((s) => s !== "LUNAS" || nilaiSekarang === "LUNAS");
}

export function kekuranganForm(form, bukti = []) {
  const k = [];
  const nominal = Number(form?.amount);
  if (!form?.paymentDate) k.push({ field: "paymentDate", pesan: "Tanggal pembayaran wajib diisi" });
  if (!Number.isInteger(nominal) || nominal <= 0) k.push({ field: "amount", pesan: "Nominal yang diklaim wajib diisi" });
  if (!form?.method) k.push({ field: "method", pesan: "Metode pembayaran wajib dipilih" });
  if (form?.method === "TRANSFER" && !form?.cashAccountId) k.push({ field: "cashAccountId", pesan: "Rekening tujuan wajib dipilih untuk pembayaran Transfer" });
  if (!form?.note || form.note.trim().length < 3) k.push({ field: "note", pesan: "Catatan pembayaran wajib diisi" });
  if (!bukti.some((b) => b.status === STATUS_BUKTI.TERSIMPAN)) k.push({ field: "evidence", pesan: "Unggah minimal satu Bukti Pembayaran" });
  return k;
}

/** Aktif HANYA bila isian lengkap, tidak ada bukti yang masih antre/mengunggah, tidak sedang mengirim, dan perangkat online. */
export function bisaDiajukan(form, bukti = [], { mengirim = false, online = true } = {}) {
  if (mengirim || !online) return false;
  if (bukti.some((b) => b.status === STATUS_BUKTI.MENGUNGGAH || b.status === STATUS_BUKTI.ANTRE)) return false;
  return kekuranganForm(form, bukti).length === 0;
}

export function alasanNonaktif(form, bukti = [], { mengirim = false, online = true } = {}) {
  if (mengirim) return "Sedang mengirim…";
  if (!online) return "Tidak ada koneksi — draf tersimpan di perangkat, ajukan setelah online";
  if (bukti.some((b) => b.status === STATUS_BUKTI.MENGUNGGAH)) return "Menunggu unggahan bukti selesai…";
  if (bukti.some((b) => b.status === STATUS_BUKTI.ANTRE)) return "Ada bukti yang belum terunggah — tunggu sampai selesai";
  const k = kekuranganForm(form, bukti);
  return k.length ? k[0].pesan : null;
}

export function cekBerkas({ name = "", type = "", size = 0 } = {}) {
  const ok = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(type) || /\.(jpe?g|png|webp|pdf)$/i.test(name);
  if (!ok) return "Jenis berkas tidak diizinkan. Gunakan foto (JPG, PNG, WEBP) atau PDF.";
  if (size && size > MAKS_UKURAN_MB * 1024 * 1024) return `Ukuran berkas maksimal ${MAKS_UKURAN_MB} MB`;
  return null;
}

export function hariIniWIB(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export function formDariKlaim(klaim, { sisa = 0, hariIni = hariIniWIB() } = {}) {
  return {
    paymentDate: klaim?.paymentDate || hariIni,
    amount: klaim?.amount != null ? String(klaim.amount) : sisa > 0 ? String(sisa) : "",
    method: klaim?.method || "TRANSFER",
    cashAccountId: klaim?.cashAccountId || "",
    note: klaim?.note || "",
  };
}

export const buktiDariKlaim = (klaim) =>
  (klaim?.bukti || []).map((b) => ({ key: b.id, id: b.id, nama: b.nama, mime: b.mime, url: b.url, status: STATUS_BUKTI.TERSIMPAN }));

/** Body PATCH/POST ke server dari form (nilai kosong → null supaya draf parsial tetap valid di server). */
export function bodyDariForm(form) {
  return {
    paymentDate: form.paymentDate || null,
    amount: form.amount === "" || form.amount == null ? null : Number(form.amount),
    method: form.method || null,
    cashAccountId: form.cashAccountId || null,
    note: form.note ?? "",
  };
}

// ── draf lokal (offline) ─────────────────────────────────────────────────────────────────────────────────────────────
// Disimpan per order: { form, foto: [{ uri, name, type }] } — HANYA isian dan foto yang belum terunggah. Bukti yang sudah dikonfirmasi server hidup
// di server (bukan di draf lokal). `store` = { getString, set, delete } (lib/storage.js); diinjeksi supaya bisa dites.
const kunciDraf = (orderId) => `klaim-lunas-draf:${orderId}`;

export function simpanDrafLokal(store, orderId, { form, foto = [] }) {
  store.set(kunciDraf(orderId), JSON.stringify({ v: 1, form, foto: foto.map((f) => ({ uri: f.uri, name: f.name, type: f.type })), simpanPada: Date.now() }));
}

export function bacaDrafLokal(store, orderId) {
  try {
    const raw = store.getString(kunciDraf(orderId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || typeof d.form !== "object" || d.form === null) return null;
    return { form: d.form, foto: Array.isArray(d.foto) ? d.foto.filter((f) => f && typeof f.uri === "string") : [], simpanPada: d.simpanPada || null };
  } catch { return null; }
}

export function hapusDrafLokal(store, orderId) { store.delete(kunciDraf(orderId)); }
