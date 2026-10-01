// Aplikasi Dokumentasi (P10B) — logika murni sisi klien. Kontrak matriks (kategori, minimum, kelompok, sumber) dimiliki BACKEND
// (backend/src/lib/domain/productionDocumentation.js); label di sini hanya cermin tampilan dan dijaga paritasnya oleh tes.
export const DOC_SOURCE_LABEL = Object.freeze({
  DRIVER_PICKUP: "Driver Pickup", PRODUKSI: "Produksi", QC: "QC", CORNER: "Corner", GUDANG: "Gudang", MANUAL: "Manual",
});
// Hue DS yang sudah ada (accent/orange/green/red/neutral) — sumber dibedakan lewat label + warna tipis, bukan warna baru.
export const DOC_SOURCE_BADGE = Object.freeze({ DRIVER_PICKUP: "neutral", PRODUKSI: "accent", QC: "orange", CORNER: "accent", GUDANG: "green", MANUAL: "neutral" });
export const DOC_GROUP_LABEL = Object.freeze({ BEFORE: "Before", PROCESS: "Proses", AFTER: "After" });
export const DOC_FILTERS = Object.freeze([
  { key: "ALL", label: "Semua" }, { key: "BELUM_DIMULAI", label: "Belum Dimulai" }, { key: "BEFORE_KURANG", label: "Before Kurang" },
  { key: "PROSES_KURANG", label: "Proses Kurang" }, { key: "AFTER_KURANG", label: "After Kurang" }, { key: "LENGKAP", label: "Lengkap" },
]);
export const DOC_STATUS = Object.freeze({
  LENGKAP: { label: "Lengkap", variant: "green" }, KURANG: { label: "Kurang", variant: "red" },
  MENUNGGU: { label: "Belum waktunya", variant: "neutral" }, NA: { label: "Tidak berlaku", variant: "neutral" },
});

// URL bertanda-tangan -> URL kanonis (tanpa ?exp&sig). Dipakai saat koreksi: item lama dikirim ulang sebagai URL kanonis.
export const rawMediaUrl = (signed) => String(signed || "").split("?")[0];

// Item draf kamera/galeri -> payload submit (hanya yang sudah terunggah; urutan = urutan di layar).
export function toSubmitItems(items) {
  return items.filter((i) => i.status === "done" && i.url).map((i, idx) => ({ url: i.url, caption: (i.caption || "").trim() || undefined, order: idx + 1 }));
}
export const isUploading = (items) => items.some((i) => i.status === "uploading");
export const hasFailed = (items) => items.some((i) => i.status === "error");
export function submitState(items, { reason = null, correcting = false } = {}) {
  const ready = toSubmitItems(items).length;
  if (isUploading(items)) return { ok: false, reason: "Tunggu unggahan selesai." };
  if (hasFailed(items)) return { ok: false, reason: "Ada unggahan gagal — coba lagi atau hapus." };
  if (ready === 0) return { ok: false, reason: "Ambil atau pilih minimal satu foto." };
  if (correcting && (reason || "").trim().length < 3) return { ok: false, reason: "Alasan koreksi wajib diisi (minimal 3 karakter)." };
  return { ok: true, count: ready };
}

// Item matriks (dari server) -> item draf untuk koreksi: foto lama ikut (sudah terunggah), bisa dihapus/ditambah/diberi keterangan baru.
export function itemsForCorrection(matrixItems, evidenceId) {
  return matrixItems.filter((i) => i.evidenceId === evidenceId && i.origin === "DOC")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((i, idx) => ({ id: `old-${evidenceId}-${idx}`, kind: i.kind || "image", status: "done", progress: 100, url: rawMediaUrl(i.url), previewUrl: i.url, caption: i.caption || "" }));
}

// Kelompokkan item doc per baris (evidenceId) untuk tombol Koreksi per pengiriman.
export function docBatches(items) {
  const by = new Map();
  for (const i of items) { if (i.origin !== "DOC") continue; if (!by.has(i.evidenceId)) by.set(i.evidenceId, { evidenceId: i.evidenceId, createdAt: i.createdAt, actorName: i.actorName, source: i.source, count: 0 }); by.get(i.evidenceId).count += 1; }
  return [...by.values()];
}

export function docFriendlyError(error) {
  const code = error?.code || "";
  if (error?.status === 0 || code === "NETWORK" || code === "TIMEOUT" || error?.name === "TypeError" || /Failed to fetch|NetworkError|Load failed/i.test(error?.message || "")) return "Koneksi terputus. Foto belum terkirim — periksa sinyal lalu tekan Kirim lagi.";
  if (code === "DOC_WRITER_OFF") return "Produksi V2 belum aktif untuk unit ini — dokumentasi belum bisa dikirim.";
  if (code === "DOC_MEDIA_ALREADY_SUBMITTED") return "Foto ini sudah tercatat di unit ini. Hapus foto yang sama lalu kirim lagi.";
  if (code === "DOC_MEDIA_OTHER_UNIT") return "Foto ini sudah dipakai sebagai bukti unit lain. Ambil foto baru.";
  if (code === "DOC_MEDIA_NOT_FOUND") return "Ada foto yang belum selesai terunggah. Unggah ulang lalu kirim.";
  if (code === "DOC_ALREADY_SUPERSEDED") return "Dokumentasi ini sudah dikoreksi orang lain. Muat ulang lalu koreksi versi terbaru.";
  if (code === "IDEMPOTENCY_CONFLICT") return "Isian berubah setelah terkirim. Tutup lalu kirim sebagai isian baru.";
  if (error?.status === 403) return "Anda tidak punya izin mengirim dokumentasi.";
  return error?.message || "Terjadi kesalahan. Coba lagi.";
}
// Kunci idempoten mengikuti NIAT kirim: dipakai ulang bila jaringan putus (isi sama), diganti setelah sukses atau ditolak server.
export const isRetryableDocError = (error) => !error?.status || error.status === 0 || error.status >= 500;
