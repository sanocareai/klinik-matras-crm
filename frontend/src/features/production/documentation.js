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
  if (code === "DOC_WRITER_OFF") return "Dokumentasi unit ini belum aktif — belum bisa dikirim. Hubungi Production Lead.";
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

// ---------------------------------------------------------------------------------------------------------------------------------------
// P12D — desain modern Aplikasi Dokumentasi (mode aplikasi, mobile-first). Hanya logika TAMPILAN murni di bawah; kontrak matriks/minimum/kekurangan
// tetap milik backend (categories, missing, docs, totals dibaca apa adanya dari server). Tidak ada penyimpanan/antrean baru.
// Bottom navigation: MAKSIMAL 4 (diuji). Urutan = urutan tampil.
export const DOC_NAV_TABS = Object.freeze([
  Object.freeze({ key: "unit", label: "Unit", icon: "Layers" }),
  Object.freeze({ key: "kamera", label: "Kamera", icon: "Camera" }),
  Object.freeze({ key: "draf", label: "Draf", icon: "CloudUpload" }),
  Object.freeze({ key: "akun", label: "Akun", icon: "User" }),
]);
export const DOC_TAB_KEYS = Object.freeze(DOC_NAV_TABS.map((t) => t.key));
export const docTabOf = (raw) => (DOC_TAB_KEYS.includes(raw) ? raw : "unit");
export const DOC_GROUP_KEYS = Object.freeze(["BEFORE", "PROCESS", "AFTER"]);
export const docGroupOf = (raw) => (DOC_GROUP_KEYS.includes(raw) ? raw : "BEFORE");

export const fmtDocTime = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const missingTotal = (missing) => (missing || []).reduce((n, m) => n + (Number(m.missing) || 0), 0);

// Persentase kelengkapan dari angka SERVER (docs.satisfied / docs.required) — tidak dihitung ulang dari daftar kategori.
export function docCompleteness(docs) {
  const required = Number(docs?.required) || 0; const satisfied = Number(docs?.satisfied) || 0;
  return { required, satisfied, pct: required > 0 ? Math.min(100, Math.round((satisfied / required) * 100)) : 0 };
}
// Chip status kartu unit: lengkap / kurang N / belum dimulai / berjalan (semua dari flag + missing server).
export function docStatusChip(item) {
  const flags = item?.docs?.flags || {}; const miss = missingTotal(item?.docs?.missing);
  if (flags.lengkap) return { key: "LENGKAP", label: "Lengkap", tone: "green" };
  if (miss > 0) return { key: "KURANG", label: `Kurang ${miss} foto`, tone: "red" };
  if (flags.belumDimulai) return { key: "BELUM", label: "Belum dimulai", tone: "neutral" };
  return { key: "BERJALAN", label: "Berjalan", tone: "accent" };
}
// Ringkasan satu kelompok (Before/Proses/After) dari kategori server: untuk segmen & tanda kurang.
export function groupStats(categories, group) {
  const cats = (categories || []).filter((c) => c.group === group && c.applicable);
  return { applicable: cats.length, missing: cats.reduce((n, c) => n + (Number(c.missing) || 0), 0), photos: cats.reduce((n, c) => n + (Number(c.count) || 0), 0) };
}
// Kategori yang disarankan untuk "Ambil Foto": yang KURANG pertama di kelompok terpilih; kalau tidak ada, kategori berlaku pertama di kelompok;
// kalau kelompok itu kosong, kekurangan pertama di mana pun. Mengembalikan null bila tidak ada kategori yang berlaku.
export function suggestCategory(categories, group) {
  const all = (categories || []).filter((c) => c.applicable);
  const inGroup = all.filter((c) => c.group === group);
  return inGroup.find((c) => c.status === "KURANG") || inGroup[0] || all.find((c) => c.status === "KURANG") || all[0] || null;
}
// Keterangan thumbnail: sumber, waktu, pengunggah — dari item matriks server apa adanya.
export function thumbMeta(item) {
  return { source: DOC_SOURCE_LABEL[item?.source] || item?.source || "—", time: fmtDocTime(item?.createdAt), actor: item?.actorName || "—" };
}
// Unit yang paling butuh foto lebih dulu (kurang terbanyak), lalu yang belum lengkap; urutan server dipertahankan untuk yang sama.
export function sortForCamera(items) {
  return [...(items || [])].map((it, i) => ({ it, i, m: missingTotal(it.docs?.missing) })).sort((a, b) => b.m - a.m || a.i - b.i).map((x) => x.it);
}
