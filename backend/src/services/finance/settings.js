// Pengaturan Finance — SATU tempat definisi kunci, tipe, dan NILAI DEFAULT.
//
// Nilai disimpan sebagai string di tabel fin_settings (lihat model
// FinSetting). Parsing & default ada di sini supaya tidak ada route yang
// menebak sendiri arti "true"/"1"/"" — kelas bug yang selalu muncul di
// tabel key/value yang dibaca dari banyak tempat.

export const SETTING_KEYS = Object.freeze({
  // Gerbang verifikasi (lihat komentar panjang di services/paymentLedger.js).
  // Kalau true, Order.paymentStatus hanya menghitung Payment yang SUDAH
  // diverifikasi finance — untuk payment yang dibuat SEJAK tanggal gerbang
  // aktif. Payment sebelum tanggal itu SELALU dihitung apa adanya.
  PAYMENT_VERIFICATION_GATE: "payment_verification_gate",
  // Tanggal (ISO) mulai berlakunya gerbang di atas. TIDAK PERNAH mundur ke
  // masa lalu secara otomatis — diisi sekali saat gerbang dinyalakan.
  PAYMENT_VERIFICATION_GATE_SINCE: "payment_verification_gate_since",
  // Tanggal mulai pembukuan. Laporan menyebut ini apa adanya ("sejak ...")
  // alih-alih berpura-pura punya data sejak perusahaan berdiri.
  BOOK_START_DATE: "book_start_date",
  // Jatuh tempo invoice default (hari) kalau sales tidak mengisi manual.
  DEFAULT_INVOICE_DUE_DAYS: "default_invoice_due_days",
  // Ambang nominal pengeluaran yang WAJIB lewat approval. Di bawah ini,
  // pengeluaran yang dibuat pemegang finance:post langsung DISETUJUI.
  EXPENSE_APPROVAL_THRESHOLD: "expense_approval_threshold",
  // Kebijakan bukti/nota (lihat services/finance/receipts.js). Pengeluaran
  // NON-reimbursement di/atas nominal ini wajib punya foto nota sebelum
  // disetujui (Pembelian & Reimbursement selalu wajib, berapa pun).
  RECEIPT_REQUIRED_THRESHOLD: "receipt_required_threshold",
  // Tanggal (YYYY-MM-DD) mulai berlakunya antrean tinjau bukti — transaksi
  // yang dibuat SEBELUM tanggal ini (data impor historis) tidak pernah masuk
  // antrean "tanpa bukti".
  RECEIPT_POLICY_SINCE: "receipt_policy_since",
  // Batas total kasbon AKTIF per karyawan (Rp). 0 = tidak dibatasi. Kasbon
  // yang melewati batas ditolak kecuali admin sengaja mengizinkan.
  KASBON_BATAS_AKTIF: "kasbon_batas_aktif",

  // ── Pemetaan metode pembayaran → rekening kas/bank ──────────────────────
  // Payment.method (CASH/TRANSFER/QRIS) sudah ada sejak lama dan TIDAK
  // diubah, tapi ia tidak tahu UANGNYA MASUK KE REKENING MANA — dan buku
  // besar wajib tahu itu. Tiga pengaturan di bawah yang menjawabnya.
  //
  // Kosong = BELUM DIPETAKAN. Konsekuensinya sengaja LUNAK: pembayaran
  // tetap tercatat seperti biasa di CRM/Armada (fitur existing tidak boleh
  // berhenti gara-gara finance belum disiapkan), tapi jurnalnya TIDAK
  // dibuat — sebagai gantinya lahir baris FinPostingGap yang tampil di
  // workspace Finance sebagai pekerjaan yang harus dibereskan. Menebak
  // rekening sendiri (mis. "ambil rekening bank pertama yang aktif") akan
  // menaruh uang di rekening yang salah dan baru ketahuan saat rekonsiliasi
  // bank tidak pernah cocok.
  CASH_ACCOUNT_CASH: "cash_account_cash",
  CASH_ACCOUNT_TRANSFER: "cash_account_transfer",
  CASH_ACCOUNT_QRIS: "cash_account_qris",
});

const DEFAULTS = Object.freeze({
  // DEFAULT FALSE — DISENGAJA, dan ini keputusan migrasi yang penting.
  //
  // Perilaku hari ini: SEMUA payment (terverifikasi atau belum) menentukan
  // Order.paymentStatus. Menyalakan gerbang langsung di hari deploy berarti
  // ratusan order yang sales anggap "sudah DP" mendadak balik jadi "Belum
  // Bayar" sampai finance sempat memverifikasi satu per satu — perubahan
  // perilaku mendadak untuk orang yang sedang bekerja.
  //
  // Jalur aman yang dipakai: mekanismenya DIBANGUN PENUH & teruji (lihat
  // paymentLedger.js + tests), antrean verifikasi tersedia di workspace
  // Finance, dan penyalaannya jadi SATU KLIK oleh admin di Finance >
  // Pengaturan kapan pun tim siap. Saat dinyalakan, hanya payment BARU yang
  // terkena gerbang (lihat *_SINCE) — riwayat tidak pernah berubah surut.
  [SETTING_KEYS.PAYMENT_VERIFICATION_GATE]: "false",
  [SETTING_KEYS.PAYMENT_VERIFICATION_GATE_SINCE]: "",
  [SETTING_KEYS.BOOK_START_DATE]: "",
  [SETTING_KEYS.DEFAULT_INVOICE_DUE_DAYS]: "14",
  [SETTING_KEYS.EXPENSE_APPROVAL_THRESHOLD]: "1000000",
  [SETTING_KEYS.RECEIPT_REQUIRED_THRESHOLD]: "500000",
  [SETTING_KEYS.RECEIPT_POLICY_SINCE]: "2026-09-19",
  [SETTING_KEYS.KASBON_BATAS_AKTIF]: "0",
  [SETTING_KEYS.CASH_ACCOUNT_CASH]: "",
  [SETTING_KEYS.CASH_ACCOUNT_TRANSFER]: "",
  [SETTING_KEYS.CASH_ACCOUNT_QRIS]: "",
});

// Payment.method → kunci pengaturan rekening tujuannya. SATU tempat, supaya
// mesin posting & halaman pengaturan tidak bisa memakai pemetaan berbeda.
export const METHOD_SETTING_KEY = Object.freeze({
  CASH: SETTING_KEYS.CASH_ACCOUNT_CASH,
  TRANSFER: SETTING_KEYS.CASH_ACCOUNT_TRANSFER,
  QRIS: SETTING_KEYS.CASH_ACCOUNT_QRIS,
});

/**
 * Rekening kas/bank untuk sebuah metode pembayaran, atau null kalau belum
 * dipetakan / rekeningnya sudah dinonaktifkan. Pemanggil WAJIB menangani
 * null dengan mencatat FinPostingGap — JANGAN memilih rekening cadangan
 * sendiri (lihat alasan di SETTING_KEYS di atas).
 */
export async function resolveCashAccountForMethod(db, method) {
  const key = METHOD_SETTING_KEY[method];
  if (!key) return null;
  const id = await getSettingRaw(db, key);
  if (!id) return null;
  const akun = await db.finCashAccount.findUnique({
    where: { id },
    select: { id: true, name: true, accountId: true, active: true },
  });
  if (!akun || !akun.active) return null;
  return akun;
}

/** Baca satu setting (string mentah + default). */
export async function getSettingRaw(db, key) {
  const row = await db.finSetting.findUnique({ where: { key } });
  return row ? row.value : (DEFAULTS[key] ?? "");
}

export async function getAllSettings(db) {
  const rows = await db.finSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {};
  for (const key of Object.values(SETTING_KEYS)) {
    out[key] = byKey.has(key) ? byKey.get(key) : (DEFAULTS[key] ?? "");
  }
  return out;
}

export function parseBool(value) {
  return value === "true" || value === "1";
}

export function parseIntOr(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Status gerbang verifikasi dalam satu objek siap pakai.
 * `since` = null artinya gerbang MATI (atau belum pernah dinyalakan) —
 * pemanggil memperlakukan semua payment sebagai "dihitung", persis
 * perilaku sebelum fitur ini ada.
 */
export async function getVerificationGate(db) {
  const [enabledRaw, sinceRaw] = await Promise.all([
    getSettingRaw(db, SETTING_KEYS.PAYMENT_VERIFICATION_GATE),
    getSettingRaw(db, SETTING_KEYS.PAYMENT_VERIFICATION_GATE_SINCE),
  ]);
  const enabled = parseBool(enabledRaw);
  if (!enabled) return { enabled: false, since: null };
  const since = sinceRaw ? new Date(sinceRaw) : null;
  return { enabled: true, since: since && !Number.isNaN(since.getTime()) ? since : null };
}

export async function setSetting(db, key, value, userId = null) {
  if (!Object.values(SETTING_KEYS).includes(key)) {
    throw Object.assign(new Error(`Pengaturan "${key}" tidak dikenal`), { statusCode: 400 });
  }
  return db.finSetting.upsert({
    where: { key },
    update: { value: String(value), updatedById: userId },
    create: { key, value: String(value), updatedById: userId },
  });
}

export { DEFAULTS as SETTING_DEFAULTS };
