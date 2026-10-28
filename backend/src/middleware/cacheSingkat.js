// Cache respons GET berumur pendek, in-memory, per pengguna + URL lengkap.
//
// KENAPA (27 Oktober 2026): satu klien web mengulang /analytics/sales-report
// 127x saat halaman Laporan "loading terus" — tiap ulangan menghitung ulang
// seluruh laporan dari nol dan ikut menghabiskan pool koneksi Prisma, jadi
// SELURUH SANSS ikut lemot. Laporan periode tidak perlu detik-ke-detik:
// angka boleh basi paling lama `ttlMs`.
//
// Kunci menyertakan req.user.id — cache TIDAK pernah dibagi antar akun,
// walau handler-nya saat ini tidak membedakan pengguna. Hanya respons 2xx
// yang disimpan. JANGAN dipakai untuk data operasional (Inbox, stok, kas).
export function cacheSingkat(ttlMs) {
  const store = new Map();
  return (req, res, next) => {
    const key = `${req.user?.id ?? "-"}|${req.originalUrl}`;
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.exp > now) return res.json(hit.body);

    const kirim = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (store.size >= 500) {
          for (const [k, v] of store) if (v.exp <= now) store.delete(k);
          if (store.size >= 500) store.clear();
        }
        store.set(key, { body, exp: Date.now() + ttlMs });
      }
      return kirim(body);
    };
    next();
  };
}
