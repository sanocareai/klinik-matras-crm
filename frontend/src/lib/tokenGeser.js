// Sesi geser: kapan token dari header X-Refreshed-Token boleh menggantikan token aktif.
//
// KENAPA tidak cukup memeriksa "token yang dikirim masih aktif" (laporan 14 Okt 2026 sore): untuk respons 304
// (ETag) browser memberikan ke fetch() respons gabungan dari entri cache lama — termasuk header
// X-Refreshed-Token yang tersimpan dari 200 beberapa hari lalu. Setelah login ulang, /api/auth/me yang dijawab
// 304 "menyuntikkan" token geser lama (sudah kedaluwarsa) menimpa token baru; request berikutnya 401
// TOKEN_INVALID → dialog "Sesi Berakhir" lagi, berulang. "Login Kembali" tidak membersihkan cache HTTP.
//
// Aturan: token geser sah HANYA bila milik pengguna yang sama DAN umurnya LEBIH PANJANG (exp lebih besar)
// daripada token aktif. Token geser asli selalu diterbitkan sekarang (exp lebih besar); salinan lama dari cache
// selalu lebih tua. Token tak terbaca → ditolak (gagal tertutup: paling buruk sesi tidak diperpanjang otomatis).
// Hanya membaca klaim (tanpa verifikasi tanda tangan) — server tetap satu-satunya penentu keabsahan.
export function klaimToken(token) {
  try {
    const bagian = String(token || "").split(".");
    if (bagian.length !== 3) return null;
    const b64 = bagian[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const p = JSON.parse(decodeURIComponent(Array.from(json, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

export function bolehAdopsiTokenGeser(tokenAktif, tokenBaru) {
  if (!tokenAktif || !tokenBaru || tokenAktif === tokenBaru) return false;
  const a = klaimToken(tokenAktif);
  const b = klaimToken(tokenBaru);
  if (!a || !b) return false;
  if (!Number.isFinite(a.exp) || !Number.isFinite(b.exp)) return false;
  if (a.id == null || a.id !== b.id) return false;
  return b.exp > a.exp;
}
