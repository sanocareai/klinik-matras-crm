// STATUS & AKSI DOKUMEN GUDANG DALAM BAHASA PETUGAS — Pengeluaran Material dan Transfer Stok (UX Tahap 2, Okt 2026). SATU sumber untuk label, tahap alur, pengaruh ke stok, penjelasan, dan aksi yang relevan per status
// (pola sama dengan services/penerimaanStatus.js). Murni (tanpa DB) kecuali `ketersediaanBaris` / `jejakDokumenGudang` yang membaca. TIDAK mengubah aturan bisnis: aksi hanya memetakan endpoint yang SUDAH ada
// (PATCH status maju satu langkah, issue/dispatch/receive, cancel) + "Buat ulang" (dokumen baru dari dokumen dibatalkan, memakai aturan pembuatan yang sama).
//
// pengaruhStok: BELUM (belum memengaruhi stok) · DICADANG (stok dicadangkan, saldo belum berkurang) · BERKURANG (saldo sudah berkurang di sistem, barang belum sampai tujuan) · SUDAH (stok sudah berubah final) · TIDAK (dibatalkan).

export const AKSI_DOK = Object.freeze({
  UBAH: { kode: "UBAH", label: "Ubah data", jenis: "ubah" },
  ATUR_LOKASI: { kode: "ATUR_LOKASI", label: "Simpan lokasi sumber", jenis: "ubah" },
  AJUKAN: { kode: "AJUKAN", label: "Ajukan persetujuan", jenis: "maju" },
  SETUJUI: { kode: "SETUJUI", label: "Setujui", jenis: "maju" },
  SIAPKAN: { kode: "SIAPKAN", label: "Siap diambil", jenis: "maju" },
  TANDAI_DIAMBIL: { kode: "TANDAI_DIAMBIL", label: "Tandai sudah diambil", jenis: "maju" },
  KONFIRMASI_KELUAR: { kode: "KONFIRMASI_KELUAR", label: "Konfirmasi keluar", jenis: "maju" },
  KIRIM: { kode: "KIRIM", label: "Kirim barang", jenis: "maju" },
  TERIMA: { kode: "TERIMA", label: "Terima barang", jenis: "maju" },
  BATALKAN: { kode: "BATALKAN", label: "Batalkan", jenis: "batal" },
  BUAT_ULANG: { kode: "BUAT_ULANG", label: "Buat permintaan baru dari dokumen ini", jenis: "maju" },
  BUAT_ULANG_TRANSFER: { kode: "BUAT_ULANG_TRANSFER", label: "Buat transfer baru dari dokumen ini", jenis: "maju" },
});

const TAHAP_MI = Object.freeze([
  { kode: "DRAF", label: "Draf" }, { kode: "MENUNGGU", label: "Menunggu persetujuan" }, { kode: "DISETUJUI", label: "Disetujui" },
  { kode: "SIAP", label: "Siap diambil" }, { kode: "DIAMBIL", label: "Sudah diambil" }, { kode: "KELUAR", label: "Dikeluarkan" },
]);
const IDX_MI = { DRAFT: 0, WAITING_APPROVAL: 1, APPROVED: 2, READY_TO_PICK: 3, PICKED: 4, ISSUED: 5 };
const TAHAP_ST = Object.freeze([
  { kode: "DRAF", label: "Draf" }, { kode: "MENUNGGU", label: "Menunggu persetujuan" }, { kode: "DISETUJUI", label: "Disetujui" },
  { kode: "DIAMBIL", label: "Sudah diambil" }, { kode: "JALAN", label: "Dalam perjalanan" }, { kode: "SELESAI", label: "Selesai" },
]);
const IDX_ST = { DRAFT: 0, WAITING_APPROVAL: 1, APPROVED: 2, PICKED: 3, IN_TRANSIT: 4, COMPLETED: 5 };

const bentuk = (tahap, idx, status) => (kode, label, warna, penjelasan, pengaruhStok, aksi, extra = {}) => ({ kode, status, label, warna, tahap, tahapIndeks: idx[status] ?? null, pengaruhStok, penjelasan, aksi: aksi.map((a) => ({ ...a })), ...extra });

/** Pengeluaran Material. @param r { status, productionPlanId } */
export function tampilanMaterialIssue(r) {
  const status = String(r?.status ?? "");
  const d = bentuk(TAHAP_MI, IDX_MI, status);
  if (r?.productionPlanId) return d("V2", "Dikelola Produksi V2", "neutral", "Permintaan ini dimiliki alur Produksi (Planned BOM/reservasi). Gudang tidak mengubahnya dari sini; ikuti antrean bahan Produksi.", status === "ISSUED" ? "SUDAH" : "DICADANG", []);
  const ubah = AKSI_DOK.UBAH; const batal = AKSI_DOK.BATALKAN;
  switch (status) {
    case "DRAFT": return d("DRAF", "Draf", "neutral", "Belum diajukan. Belum memengaruhi stok. Data boleh diperbaiki; setelah diajukan, jumlah tidak bisa diubah (batalkan lalu buat permintaan baru).", "BELUM", [AKSI_DOK.AJUKAN, ubah, batal]);
    case "WAITING_APPROVAL": return d("MENUNGGU", "Menunggu persetujuan", "orange", "Menunggu orang yang berwenang menyetujui. Belum memengaruhi stok; stok baru dicadangkan setelah disetujui.", "BELUM", [AKSI_DOK.SETUJUI, ubah, batal]);
    case "APPROVED": return d("DISETUJUI", "Disetujui — stok dicadangkan", "accent", "Jumlah yang diminta dicadangkan: saldo belum berkurang, tetapi tidak tersedia untuk permintaan lain. Lanjutkan dengan menyiapkan barang.", "DICADANG", [AKSI_DOK.SIAPKAN, ubah, batal]);
    case "READY_TO_PICK": return d("SIAP", "Siap diambil", "accent", "Barang siap diambil. Stok masih dicadangkan (saldo belum berkurang). Isi lokasi sumber bila perlu, lalu tandai sudah diambil.", "DICADANG", [AKSI_DOK.TANDAI_DIAMBIL, AKSI_DOK.ATUR_LOKASI, ubah, batal]);
    case "PICKED": return d("DIAMBIL", "Sudah diambil — tinggal konfirmasi keluar", "accent", "Barang sudah diambil. Stok baru BERKURANG saat Konfirmasi keluar; periksa jumlah keluar tiap item dulu.", "DICADANG", [AKSI_DOK.KONFIRMASI_KELUAR, AKSI_DOK.ATUR_LOKASI, ubah, batal]);
    case "ISSUED": return d("DIKELUARKAN", "Sudah dikeluarkan", "green", "Stok sudah berkurang. Catatan tidak dihapus; bila ada salah input, pakai jalur koreksi resmi di bawah (pengembalian bahan / penyesuaian) — dampaknya ditampilkan dulu.", "SUDAH", []);
    case "CANCELLED": return d("DIBATALKAN", "Dibatalkan", "neutral", "Permintaan dibatalkan; pencadangan stok (bila ada) dilepas. Dokumen tidak dihapus. Bila masih perlu, buat permintaan baru dari dokumen ini.", "TIDAK", [AKSI_DOK.BUAT_ULANG]);
    default: return d("TIDAK_DIKENAL", status || "—", "neutral", "Status tidak dikenal.", "TIDAK", []);
  }
}

/** Transfer Stok. @param r { status } */
export function tampilanTransfer(r) {
  const status = String(r?.status ?? "");
  const d = bentuk(TAHAP_ST, IDX_ST, status);
  const ubah = { ...AKSI_DOK.UBAH, label: "Ubah catatan" }; const batal = AKSI_DOK.BATALKAN;
  switch (status) {
    case "DRAFT": return d("DRAF", "Draf", "neutral", "Belum diajukan. Belum memengaruhi stok. Catatan boleh diperbaiki; item, jumlah, dan lokasi tidak bisa diubah (batalkan lalu buat transfer baru).", "BELUM", [AKSI_DOK.AJUKAN, ubah, batal]);
    case "WAITING_APPROVAL": return d("MENUNGGU", "Menunggu persetujuan", "orange", "Menunggu persetujuan. Belum memengaruhi stok.", "BELUM", [AKSI_DOK.SETUJUI, ubah, batal]);
    case "APPROVED": return d("DISETUJUI", "Disetujui", "accent", "Disetujui, belum ada barang yang berpindah. Stok belum berubah. Lanjutkan saat barang sudah diambil.", "BELUM", [AKSI_DOK.TANDAI_DIAMBIL, ubah, batal]);
    case "PICKED": return d("DIAMBIL", "Sudah diambil — siap dikirim", "accent", "Barang sudah diambil. Stok BERKURANG saat Kirim barang (saldo dikurangi di sistem sampai barang diterima di tujuan).", "BELUM", [AKSI_DOK.KIRIM, ubah, batal]);
    case "IN_TRANSIT": return d("DALAM_PERJALANAN", "Dalam perjalanan", "orange", "Saldo SUDAH dikurangi di sistem saat dikirim; baru bertambah lagi saat diterima. Selisih jumlah diterima dari yang dikirim tetap hilang dari saldo — catat lewat penyesuaian/Barang Rusak bila perlu. Tidak bisa dibatalkan di sini.", "BERKURANG", [AKSI_DOK.TERIMA]);
    case "COMPLETED": return d("SELESAI", "Selesai diterima", "green", "Barang sudah diterima dan saldo dibukukan. Catatan tidak dihapus; bila ada salah input, pakai jalur koreksi resmi di bawah.", "SUDAH", []);
    case "CANCELLED": return d("DIBATALKAN", "Dibatalkan", "neutral", "Dibatalkan sebelum barang dikirim. Tidak memengaruhi stok. Dokumen tidak dihapus; bila masih perlu, buat transfer baru dari dokumen ini.", "TIDAK", [AKSI_DOK.BUAT_ULANG_TRANSFER]);
    default: return d("TIDAK_DIKENAL", status || "—", "neutral", "Status tidak dikenal.", "TIDAK", []);
  }
}

/** Ketersediaan stok per baris (baca-saja). `dokumenMencadang` = dokumen ini sendiri sedang mencadangkan (APPROVED..PICKED): cadangannya TIDAK dikurangkan dari "tersedia untuk dokumen ini".
 *  Saldo = total semua lokasi (sistem tidak menyimpan saldo per lokasi). */
export function ketersediaanBaris(snapshot, baris, { dokumenMencadang = false, kunciJumlah = "requestedQty" } = {}) {
  const peta = new Map(snapshot.map((s) => [s.materialId, s]));
  return baris.map((l) => {
    const s = peta.get(l.materialId); const diminta = Number(l[kunciJumlah] ?? 0);
    if (!s) return { lineId: l.id, saldo: null, dicadangLain: null, tersedia: null, cukup: null };
    const dicadangLain = Math.max(0, s.reserved - (dokumenMencadang ? diminta : 0));
    const tersedia = Math.round((s.balance - dicadangLain) * 10000) / 10000;
    return { lineId: l.id, saldo: s.balance, dicadangLain, tersedia, cukup: diminta <= tersedia };
  });
}

const FIELD_LABEL = { status: "Status", notes: "Catatan", department: "Departemen", requiredDate: "Dibutuhkan", priority: "Prioritas", sourceReference: "Referensi", unitId: "Unit produksi", sourceLocation: "Lokasi sumber" };
const STATUS_LABEL = { DRAFT: "Draf", WAITING_APPROVAL: "Menunggu persetujuan", APPROVED: "Disetujui", READY_TO_PICK: "Siap diambil", PICKED: "Sudah diambil", ISSUED: "Dikeluarkan", IN_TRANSIT: "Dalam perjalanan", COMPLETED: "Selesai", CANCELLED: "Dibatalkan" };
const PRIORITAS = { LOW: "Rendah", NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Mendesak" };
const nilaiTeks = (k, v) => (v === null || v === undefined || v === "" ? "kosong" : k === "status" ? STATUS_LABEL[v] ?? v : k === "priority" ? PRIORITAS[v] ?? v : k === "requiredDate" ? String(v).slice(0, 10) : String(v));

/** Kalimat ringkas perubahan draf: "Departemen: Gudang → Bengkel". */
export function kalimatPerubahan(sebelum = {}, sesudah = {}) {
  return Object.keys(sesudah).map((k) => `${FIELD_LABEL[k] ?? k}: ${nilaiTeks(k, sebelum[k])} → ${nilaiTeks(k, sesudah[k])}`).join("; ");
}

/** Jejak ringan dokumen (baca-saja) dari log aktivitas + penanda dokumen dibuat. */
export async function jejakDokumenGudang(db, { entityType, id, dibuatOleh = null, dibuatPada = null, nomor = "" }) {
  const ev = await db.activityEvent.findMany({ where: { entityType, entityId: id }, orderBy: { createdAt: "asc" }, take: 80 });
  const pelaku = new Map((await db.user.findMany({ where: { id: { in: [...new Set(ev.map((e) => e.actorId).filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const baris = [];
  if (dibuatPada) baris.push({ id: "dibuat", aksi: "DIBUAT", teks: "Dokumen dibuat", oleh: dibuatOleh, waktu: dibuatPada, alasan: null, tautan: null });
  for (const e of ev) {
    const m = e.metadata ?? {}; const oleh = pelaku.get(e.actorId) ?? null; let teks = null; let aksi = null; let alasan = null; let tautan = null;
    if (e.eventType === "DOCUMENT_APPROVED") { aksi = "DISETUJUI"; teks = "Disetujui"; }
    else if (e.eventType === "DOCUMENT_POSTED") { aksi = m.step === "dispatch" ? "DIKIRIM" : m.step === "receive" ? "DITERIMA" : "DIKELUARKAN"; teks = m.step === "dispatch" ? "Barang dikirim (saldo dikurangi)" : m.step === "receive" ? "Barang diterima (saldo dibukukan)" : "Barang dikeluarkan (saldo berkurang)"; }
    else if (e.eventType === "DOCUMENT_CANCELLED") { aksi = "DIBATALKAN"; teks = "Dibatalkan"; alasan = m.reason ?? null; }
    else if (e.eventType === "DOCUMENT_EDITED" && m.aksi === "DRAF_DIUBAH") { aksi = "DIUBAH"; teks = `Diubah${m.bagian && m.bagian !== "dokumen" ? ` (${m.bagian})` : ""}: ${kalimatPerubahan(m.sebelum, m.sesudah)}`; }
    else if (e.eventType === "DOCUMENT_EDITED" && m.aksi === "DIBUAT_ULANG_DARI") { aksi = "DIBUAT_ULANG_DARI"; teks = "Dibuat ulang dari dokumen lama"; alasan = m.alasan ?? null; tautan = { id: m.dariId, nomor: m.dariNomor }; }
    else if (e.eventType === "DOCUMENT_EDITED" && m.aksi === "DIBUAT_ULANG_MENJADI") { aksi = "DIBUAT_ULANG_MENJADI"; teks = "Dibuatkan dokumen baru"; alasan = m.alasan ?? null; tautan = { id: m.keId, nomor: m.keNomor }; }
    if (teks) baris.push({ id: e.id, aksi, teks, oleh, waktu: e.createdAt, alasan, tautan });
  }
  void nomor; return baris;
}
