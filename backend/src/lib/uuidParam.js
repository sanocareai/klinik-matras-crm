// VALIDASI PARAMETER UUID DI PINTU MASUK ROUTE — satu-satunya helper kanonis.
//
// Akar masalah (ditemukan sapuan 12 Okt 2026): kolom `@db.Uuid` di Prisma menolak string yang bukan UUID (mis. id berformat cuid milik Order/Customer)
// dengan "Error creating UUID" → 500 dan pesan galat membocorkan nama pemanggilan Prisma. Jawaban yang benar: 400 `ID_TIDAK_VALID`.
//
// ⚠️ URUTAN WAJIB: autentikasi (401) → izin (403) → validasi id (400) → handler (404 / 200). Karena itu helper ini dipasang PER ROUTE
// SETELAH requirePermission/requireAnyPermission — BUKAN `router.param()` (yang berjalan sebelum middleware izin per-route sehingga
// peran terlarang melihat 400, bukan 403, dan membocorkan bentuk id yang valid).
//
// Pakai hanya untuk parameter yang MEMANG bertipe UUID di skema. Jangan dipasang berdasarkan nama `:id` saja — sebagian id di sistem ini cuid/format lain.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

/** Badan respons 400 — persis dua kunci; tidak memuat nilai yang dikirim klien. */
export const GALAT_ID_TIDAK_VALID = Object.freeze({ code: "ID_TIDAK_VALID", message: "ID tidak valid." });

/**
 * Middleware Express: tolak 400 bila salah satu parameter route bukan UUID. Tanpa argumen = `:id`.
 *   router.get("/:id", requirePermission(P.X), wajibUuid(), handler)
 *   router.patch("/:id/lines/:lineId", requirePermission(P.X), wajibUuid("id", "lineId"), handler)
 */
export function wajibUuid(...nama) {
  const daftar = nama.length ? nama : ["id"];
  return function wajibUuidParam(req, res, next) {
    for (const n of daftar) {
      if (!isUuid(req.params?.[n])) return res.status(400).json({ ...GALAT_ID_TIDAK_VALID });
    }
    return next();
  };
}
