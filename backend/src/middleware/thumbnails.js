import path from "path";
import fs from "fs";
import sharp from "sharp";

// Thumbnail on-demand untuk foto chat: GET /uploads/<file>.jpg?w=480 → WebP kecil
// (di-cache di disk). Daftar chat/bubble memuat thumbnail, bukan foto kamera
// resolusi penuh (4–12 MP) yang harus di-decode HP tiap kali bubble muncul.
// File asli tidak berubah — klik foto tetap membuka versi penuh.
export const THUMB_WIDTHS = [160, 320, 480, 720];
const IMG_EXT = /\.(jpe?g|png|webp)$/i;

const inflight = new Map(); // key → Promise<string> (hindari generate ganda utk file yang sama)

export function thumbnailMiddleware(uploadsDir) {
  const root = path.resolve(uploadsDir);
  const cacheDir = path.join(root, ".thumbs");
  fs.mkdirSync(cacheDir, { recursive: true });

  return async function thumbs(req, res, next) {
    const w = Number(req.query.w);
    if (!w || !THUMB_WIDTHS.includes(w) || !IMG_EXT.test(req.path)) return next();
    try {
      // Path traversal: hasil resolve harus tetap di dalam uploadsDir.
      const src = path.resolve(root, "." + decodeURIComponent(req.path));
      if (!src.startsWith(root + path.sep) || src.startsWith(cacheDir)) return next();
      const st = await fs.promises.stat(src).catch(() => null);
      if (!st?.isFile()) return next();

      const key = `${w}-${st.mtimeMs}-${req.path.replace(/[^\w.-]+/g, "_")}.webp`;
      const out = path.join(cacheDir, key);
      if (!fs.existsSync(out)) {
        if (!inflight.has(out)) {
          const job = sharp(src, { failOn: "none", limitInputPixels: 268_000_000 })
            .rotate() // hormati orientasi EXIF sebelum dikecilkan
            .resize({ width: w, withoutEnlargement: true })
            .webp({ quality: 72 })
            .toFile(out + ".tmp")
            .then(() => fs.promises.rename(out + ".tmp", out))
            .finally(() => inflight.delete(out));
          inflight.set(out, job);
        }
        await inflight.get(out);
      }
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      res.type("image/webp");
      return fs.createReadStream(out).on("error", () => next()).pipe(res);
    } catch {
      return next(); // gagal thumbnail → layani file asli seperti biasa
    }
  };
}
