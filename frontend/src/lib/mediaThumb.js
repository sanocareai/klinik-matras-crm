// URL thumbnail untuk foto chat (server: backend/src/middleware/thumbnails.js).
// Hanya foto milik server sendiri (/uploads/*.jpg|png|webp) yang diubah; URL
// eksternal/blob/data dibiarkan. Lebar harus salah satu dari THUMB_WIDTHS server.
const IMG_EXT = /\.(jpe?g|png|webp)(\?.*)?$/i;
export function thumbUrl(url, width = 480) {
  if (typeof url !== "string" || !url.includes("/uploads/") || !IMG_EXT.test(url) || url.includes("?")) return url;
  if (/^(blob|data):/i.test(url)) return url;
  return `${url}?w=${width}`;
}
