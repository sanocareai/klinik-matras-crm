// Logika murni layar Pengecualian Tanggal Lunas. Server menegakkan ulang semuanya (alasan minimal 10 karakter, izin Admin/Owner, satu pengecualian aktif per order).
export const ALASAN_MINIMAL = 10;
export const alasanCukup = (alasan) => String(alasan ?? "").trim().length >= ALASAN_MINIMAL;
