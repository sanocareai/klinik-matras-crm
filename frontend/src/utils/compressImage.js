// Kompres gambar di browser sebelum upload (canvas, client-side).
// Diekstrak dari Products.jsx supaya bisa dipakai ulang di kiosk Bengkel
// (foto wajib per tahap produksi) tanpa duplikasi logika.
export async function compressImage(file, maxWidth = 1600, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" })),
        "image/jpeg",
        quality
      );
    };
    img.src = URL.createObjectURL(file);
  });
}
