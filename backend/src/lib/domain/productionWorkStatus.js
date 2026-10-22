// ADOPSI ADMIN — kontrak TIGA SUMBU status unit di Order Produksi (fungsi MURNI, tanpa DB; diuji node --test).
//
//   1. STATUS ORDER   — apa yang dilihat Sales/Delivery: Pengambilan · Diproses · Siap Kirim · Terkirim · Dibatalkan. Sumber: Unit.status (diubah HANYA lewat ubahStatusUnitInTx / jalur Sales-Delivery yang sama).
//   2. POSISI UNIT    — fakta fisik dari DOKUMEN: menunggu dijemput · dalam penjemputan · sudah dijemput tetapi belum diterima workshop · di workshop (dasar bukti) · dalam pengiriman · di pelanggan.
//   3. STATUS KERJA   — pekerjaan Produksi: Belum dijadwalkan · Dijadwalkan · Dikerjakan · Tertunda · Menunggu QC · Dikerjakan ulang · Selesai · Dibatalkan.
//
// Ketiganya TIDAK boleh saling menimpa. Contoh kasus yang membingungkan sebelumnya: pickup selesai (Unit RECEIVED) tetapi penerimaan workshop belum tercatat → Status order "Diproses",
// Posisi "Sudah dijemput · belum diterima workshop", Status kerja "Belum dijadwalkan". Itu BUKAN tiga status yang bertentangan, melainkan tiga fakta berbeda.
//
// STATUS KERJA EFEKTIF — satu unit hanya punya SATU:
//   urutan sumber: DIBATALKAN (unit batal) > BUKTI APLIKASI (log tahap V1 / operasi V2 non-lewati) > status order Siap Kirim ke atas (= Selesai; catatan manual tidak boleh bertentangan dengan status order) > CATATAN MANUAL Admin terakhir > jadwal (rencana bermeja) > belum dijadwalkan.
//   Admin TIDAK boleh mencatat status manual selagi bukti aplikasi ada (ditolak 409 KERJA_DIPEGANG_APLIKASI) — jadi catatan manual dan bukti aplikasi tidak pernah bersaing. Bila bukti aplikasi MUNCUL sesudah catatan manual,
//   catatan terakhir tetap di riwayat dan ditandai "digantikan bukti aplikasi sejak <waktu>"; status efektif beralih ke bukti aplikasi. Catatan manual tidak pernah membuat tahap, QC, foto, penerimaan Gudang, atau pemakaian bahan.

export const WORK_STATUS = Object.freeze({
  BELUM_DIJADWALKAN: Object.freeze({ key: "BELUM_DIJADWALKAN", label: "Belum dijadwalkan", tone: "neutral" }),
  DIJADWALKAN: Object.freeze({ key: "DIJADWALKAN", label: "Dijadwalkan", tone: "accent" }),
  DIKERJAKAN: Object.freeze({ key: "DIKERJAKAN", label: "Sudah dikerjakan", tone: "accent" }), // satu-satunya status "dikerjakan" (tanpa "Sedang dikerjakan"); BUKAN selesai QC / siap serah Gudang / siap kirim
  TERTUNDA: Object.freeze({ key: "TERTUNDA", label: "Tertunda", tone: "orange" }),
  MENUNGGU_QC: Object.freeze({ key: "MENUNGGU_QC", label: "Menunggu QC", tone: "orange" }),
  DIKERJAKAN_ULANG: Object.freeze({ key: "DIKERJAKAN_ULANG", label: "Dikerjakan ulang", tone: "orange" }),
  SELESAI: Object.freeze({ key: "SELESAI", label: "Selesai", tone: "green" }),
  DIBATALKAN: Object.freeze({ key: "DIBATALKAN", label: "Dibatalkan", tone: "neutral" }),
});
/** Nilai yang boleh dicatat manual oleh Admin/Lead (urutan = urutan tampil). */
export const MANUAL_STATUSES = Object.freeze(["BELUM_DIJADWALKAN", "DIJADWALKAN", "DIKERJAKAN", "TERTUNDA", "SELESAI"]);
export const WORK_SOURCE = Object.freeze({ APLIKASI: "APLIKASI", MANUAL: "MANUAL", STATUS_ORDER: "STATUS_ORDER", JADWAL: "JADWAL", PEMAKAIAN_BAHAN: "PEMAKAIAN_BAHAN" });
export const WORK_SOURCE_LABEL = Object.freeze({
  APLIKASI: "Dari aplikasi Produksi", MANUAL: "Dicatat manual", STATUS_ORDER: "Mengikuti status order", JADWAL: "Dari jadwal", PEMAKAIAN_BAHAN: "Otomatis dari pemakaian bahan",
});

const COMPLETE_UNIT_STATUSES = new Set(["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"]);
const APP_MAP = Object.freeze({ IN_PROGRESS: "DIKERJAKAN", PAUSED: "TERTUNDA", BLOCKED: "TERTUNDA", WAITING_QC: "MENUNGGU_QC", REWORK: "DIKERJAKAN_ULANG", COMPLETED: "SELESAI", QUEUED: "DIKERJAKAN", NOT_STARTED: "DIKERJAKAN" });

const pick = (key) => WORK_STATUS[key];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "20 Okt 2026, 10.30 WIB" — WIB = UTC+7, tanpa bergantung zona server. */
export function waktuWibText(v) {
  if (!v) return null; const t = new Date(v).getTime(); if (Number.isNaN(t)) return null;
  const d = new Date(t + 7 * 3600 * 1000); const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}.${p(d.getUTCMinutes())} WIB`;
}
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);

/**
 * Status kerja EFEKTIF satu unit.
 * @param {object} p
 * @param {string} p.unitStatus   Unit.status
 * @param {string|null} [p.productionStatus] turunan log tahap (productionState.js)
 * @param {boolean} [p.appStarted] ada bukti pekerjaan aplikasi (V1 log non-SKIP / V2 operasi atau bukti non-lewati)
 * @param {boolean} [p.scheduled] rencana punya meja
 * @param {{status:string,note?:string|null,actor?:{id?:string,name?:string|null}|null,createdAt:Date|string}|null} [p.manual] catatan manual TERAKHIR
 * @param {{terakhirAt:Date|string,pertamaAt?:Date|string|null}|null} [p.pemakaian] pemakaian aktual yang BERHASIL tercatat: bahan baru (pergerakan ISSUE bertaut unit, termasuk lewat dokumen Gudang) atau komponen lama berhasil 'dipakai kembali'.
 *   Rencana bahan, jadwal, dan komponen lama yang dikembalikan/disimpan/dibuang TIDAK dihitung. Koreksi/pengembalian/pembatalan TIDAK menghapusnya (baris asal tetap ada) — fakta historis 'pekerjaan pernah dilakukan' tidak hilang.
 * @param {boolean} [p.punyaJadwal] ada jadwal (Rencana Admin atau rencana Meja) — hanya untuk fakta 'Dikerjakan tanpa jadwal'; TIDAK mengubah status (tidak ada jadwal fiktif)
 * @returns {{key,label,tone,source,sourceLabel,detail,manual:null|{status,by,at,note}}}
 */
export function effectiveWorkStatus({ unitStatus, productionStatus = null, appStarted = false, scheduled = false, manual = null, pemakaian = null, punyaJadwal = null } = {}) {
  const manualOut = manual ? { status: manual.status, by: manual.actor?.name ?? null, at: iso(manual.createdAt), note: manual.note ?? null } : null;
  const adaJadwal = punyaJadwal ?? scheduled;
  const out = (key, source, detail = null) => ({ ...pick(key), source, sourceLabel: WORK_SOURCE_LABEL[source], detail, manual: manualOut, tanpaJadwal: key === "DIKERJAKAN" && !adaJadwal, faktaJadwal: key === "DIKERJAKAN" && !adaJadwal ? "Dikerjakan tanpa jadwal" : null });
  if (unitStatus === "CANCELLED") return out("DIBATALKAN", WORK_SOURCE.STATUS_ORDER, "Order/unit dibatalkan");
  if (appStarted) {
    const key = APP_MAP[productionStatus] || "DIKERJAKAN";
    return out(key, WORK_SOURCE.APLIKASI, manualOut ? "Menggantikan catatan manual terakhir" : null);
  }
  // Status order Siap Kirim (atau sesudahnya) = pekerjaan Produksi SUDAH selesai: tidak boleh tampil "Dikerjakan" di samping "Siap Kirim". Catatan manual tetap di riwayat; bila status order dimundurkan, catatan itu berlaku lagi.
  if (COMPLETE_UNIT_STATUSES.has(unitStatus)) return out("SELESAI", WORK_SOURCE.STATUS_ORDER, manualOut ? "Mengikuti status order (Siap Kirim atau sesudahnya); catatan manual sebelumnya tetap di riwayat" : "Mengikuti status order (Siap Kirim atau sesudahnya)");
  // Pemakaian aktual berhasil tercatat → "Sudah dikerjakan" (status kerja administratif), tanpa syarat rencana/jadwal/Run/Meja/dokumentasi/QC. Catatan manual yang LEBIH BARU tetap berlaku (Admin boleh menunda/menandai selesai);
  // SELESAI manual tidak diturunkan; DIKERJAKAN manual tetap atas nama pencatatnya (sumber Manual). Pemakaian BARU sesudah catatan manual (mis. Tertunda) menjadikan unit "Sudah dikerjakan" lagi.
  const manualMs = manual ? new Date(manual.createdAt).getTime() : null; const pakaiMs = pemakaian?.terakhirAt ? new Date(pemakaian.terakhirAt).getTime() : null;
  if (pakaiMs !== null && !Number.isNaN(pakaiMs) && !(manual && (manual.status === "SELESAI" || manual.status === "DIKERJAKAN")) && !(manualMs !== null && manual.status !== "BELUM_DIJADWALKAN" && manualMs >= pakaiMs)) {
    return out("DIKERJAKAN", WORK_SOURCE.PEMAKAIAN_BAHAN, `Pemakaian bahan aktual tercatat${pemakaian.pertamaAt ? ` sejak ${waktuWibText(pemakaian.pertamaAt)}` : ""}; belum berarti selesai QC, siap serah Gudang, atau siap kirim`);
  }
  if (manual && manual.status !== "BELUM_DIJADWALKAN" && MANUAL_STATUSES.includes(manual.status)) {
    const by = manualOut.by ? ` oleh ${manualOut.by}` : "";
    return out(manual.status, WORK_SOURCE.MANUAL, `Dicatat manual${by}${manualOut.at ? `, ${waktuWibText(manualOut.at)}` : ""}`);
  }
  return scheduled ? out("DIJADWALKAN", WORK_SOURCE.JADWAL, "Sudah punya jadwal di Rencana Produksi") : out("BELUM_DIJADWALKAN", WORK_SOURCE.JADWAL, null);
}

/** Riwayat catatan manual (urut lama→baru). Catatan TERAKHIR sebelum bukti aplikasi pertama ditandai digantikan; tidak ada catatan manual setelah bukti (ditolak saat tulis). */
export function riwayatKerjaManual(entries, { firstEvidenceAt = null } = {}) {
  const sorted = [...(entries || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const evidenceMs = firstEvidenceAt ? new Date(firstEvidenceAt).getTime() : null;
  let lastBefore = -1;
  if (evidenceMs != null) sorted.forEach((e, i) => { if (new Date(e.createdAt).getTime() <= evidenceMs) lastBefore = i; });
  return sorted.map((e, i) => ({
    id: e.id, status: e.status, label: WORK_STATUS[e.status]?.label ?? e.status, note: e.note ?? null, by: e.actor?.name ?? null, at: iso(e.createdAt),
    digantikanBuktiAplikasi: evidenceMs != null && i === lastBefore ? iso(firstEvidenceAt) : null,
  }));
}

// ───────────────────────────── POSISI UNIT (fakta fisik dari dokumen) ─────────────────────────────
const POS = (key, label, tone, detail = null) => ({ key, label, tone, detail });
export function posisiUnitOf({ unitStatus, receivedBasis = null, receivedBasisLabel = null, pickupCompleted = false, pickupInProgress = false, started = false } = {}) {
  switch (unitStatus) {
    case "CANCELLED": return POS("DIBATALKAN", "Dibatalkan", "neutral");
    case "DELIVERED": return POS("DI_PELANGGAN", "Sudah di pelanggan", "green", "Dokumen pengiriman selesai");
    case "IN_TRANSIT_OUT": return POS("DALAM_PENGIRIMAN", "Dalam pengiriman", "accent", "Job pengiriman sedang berjalan");
    case "READY_FOR_DELIVERY": return POS("DI_WORKSHOP_SIAP", "Di workshop · siap diambil", "green");
    case "READY_ON_CUSTOMER_HOLD": return POS("DI_WORKSHOP_SIAP", "Di workshop · ditahan pelanggan", "orange");
    case "AWAITING_PICKUP": return pickupInProgress ? POS("DALAM_PENJEMPUTAN", "Dalam penjemputan", "accent", "Job pickup sedang berjalan") : POS("MENUNGGU_DIJEMPUT", "Menunggu dijemput", "neutral");
    case "IN_TRANSIT_IN": return POS("DALAM_PENJEMPUTAN", "Dalam perjalanan ke workshop", "accent");
    case "RECEIVED":
    case "IN_PRODUCTION":
      if (receivedBasis) return POS("DI_WORKSHOP", "Di workshop", "green", receivedBasisLabel || "Penerimaan tercatat");
      if (started || unitStatus === "IN_PRODUCTION") return POS("DI_WORKSHOP_TANPA_BUKTI", "Di workshop · penerimaan belum tercatat", "orange", "Pekerjaan sudah berjalan, tetapi konfirmasi terima di workshop belum dicatat");
      return POS("SUDAH_DIJEMPUT", "Sudah dijemput · belum diterima workshop", "orange", pickupCompleted ? "Pickup selesai; menunggu Terima Unit di Workshop" : "Konfirmasi terima di workshop belum tercatat");
    default: return POS("TIDAK_DIKETAHUI", "—", "neutral");
  }
}

// ───────────────────────────── PENGHALANG STATUS ORDER ─────────────────────────────
/**
 * Mengapa status ORDER Sales masih Pengambilan padahal pickup unit ini sudah selesai (unit RECEIVED/IN_PRODUCTION)? null = tidak ada penghalang.
 * Jujur dan tidak otomatis: hanya MENJELASKAN penyebab dan menandai apakah akun berizin boleh mengubahnya lewat jalur status Sales yang sama (PATCH /api/orders/:id).
 * @param {{ orderStatus:string, statusLocked?:boolean, unitStatus:string, unitLainBelumDijemput?:number, pengunci?:{nama?:string|null,at?:Date|string|null,note?:string|null}|null }} p
 */
export function penghalangStatusOrder({ orderStatus, statusLocked = false, unitStatus, unitLainBelumDijemput = 0, pengunci = null } = {}) {
  if (!["PENDING", "PICKUP"].includes(orderStatus)) return null;
  if (!["RECEIVED", "IN_PRODUCTION"].includes(unitStatus)) return null;
  const dari = orderStatus === "PENDING" ? "Belum diambil" : "Pengambilan";
  if (statusLocked) {
    const siapa = pengunci?.nama ? ` oleh ${pengunci.nama}` : "";
    const kapan = pengunci?.at ? `, ${waktuWibText(pengunci.at)}` : "";
    const catatan = pengunci?.note ? ` (catatan: "${pengunci.note}")` : "";
    return { kode: "ORDER_TERKUNCI_PENGAMBILAN", bolehUbahKeDiproses: true, teks: `Status order ${dari} dikunci manual${siapa}${kapan}${catatan}, jadi sistem tidak memindahkannya ke Diproses sendiri walau pickup unit ini sudah selesai.` };
  }
  if (unitLainBelumDijemput > 0) {
    return { kode: "UNIT_LAIN_BELUM_DIJEMPUT", bolehUbahKeDiproses: false, teks: `Status order mengikuti unit yang paling tertinggal: ${unitLainBelumDijemput} unit lain di order ini belum selesai dijemput.` };
  }
  return { kode: "ORDER_BELUM_DISINKRONKAN", bolehUbahKeDiproses: true, teks: `Status order masih ${dari} padahal pickup unit ini sudah selesai dan tidak ada penguncian manual. Ubah ke Diproses agar unit muncul di Rencana Produksi.` };
}

// ───────────────────────────── TINDAKAN BERIKUTNYA ─────────────────────────────
export const AKSI = Object.freeze({ NONE: "NONE", CONFIRM_ARRIVAL: "CONFIRM_ARRIVAL", UBAH_ORDER_DIPROSES: "UBAH_ORDER_DIPROSES", SET_TARGET: "SET_TARGET", OPEN_PLAN: "OPEN_PLAN", PLAN_MATERIAL: "PLAN_MATERIAL", OPEN_WORK: "OPEN_WORK", RECORD_MATERIAL: "RECORD_MATERIAL", FINISH_WORK: "FINISH_WORK", RESOLVE_DELAY: "RESOLVE_DELAY", MARK_READY: "MARK_READY", WAIT: "WAIT" });
/**
 * Satu tindakan berikutnya per unit (label + siapa pelakunya + jenis aksi untuk tombol utama). Murni dan deterministik.
 * @param {{ unitStatus:string, posisi:{key:string}, kerja:{key:string,source?:string}, adaTarget?:boolean, rencanaBahanAda?:boolean, aktualAda?:boolean }} p
 */
export function tindakanBerikutnya({ unitStatus, posisi, kerja, adaTarget = false, rencanaBahanAda = false, aktualAda = false, penghalang = null } = {}) {
  const t = (aksi, label, aktor, detail = null) => ({ aksi, label, aktor, detail, ...(penghalang ? { penghalang } : {}) });
  switch (unitStatus) {
    case "CANCELLED": return t(AKSI.NONE, "Tidak ada tindakan", "—", "Order/unit dibatalkan");
    case "DELIVERED": return t(AKSI.NONE, "Tidak ada tindakan", "—", "Sudah terkirim");
    case "IN_TRANSIT_OUT": return t(AKSI.WAIT, "Menunggu konfirmasi terkirim", "Delivery");
    case "READY_FOR_DELIVERY": return t(AKSI.WAIT, "Menunggu pengiriman", "Delivery", "Unit sudah Siap Kirim");
    case "READY_ON_CUSTOMER_HOLD": return t(AKSI.WAIT, "Menunggu pelanggan", "Sales", "Ditahan pelanggan");
    case "AWAITING_PICKUP":
    case "IN_TRANSIT_IN": return t(AKSI.WAIT, "Menunggu unit dijemput", "Delivery");
    default: break;
  }
  const k = kerja?.key;
  if (posisi?.key === "SUDAH_DIJEMPUT") return t(AKSI.CONFIRM_ARRIVAL, "Konfirmasi unit diterima di workshop", "Gudang", "Pickup selesai, penerimaan belum tercatat");
  // Unit sudah diterima, tetapi status ORDER Sales masih Pengambilan (mis. dikunci manual): Rencana Produksi hanya memuat order Diproses — jelaskan penyebabnya, tawarkan perubahan lewat jalur Sales.
  if (penghalang?.bolehUbahKeDiproses) return t(AKSI.UBAH_ORDER_DIPROSES, "Ubah status order ke Diproses", "Admin", penghalang.teks);
  if (k === "TERTUNDA") return t(AKSI.RESOLVE_DELAY, "Selesaikan hambatan, lalu lanjutkan", "Admin / PIC");
  if (k === "MENUNGGU_QC") return t(AKSI.WAIT, "Menunggu keputusan QC", "QC");
  if (k === "DIKERJAKAN_ULANG") return t(AKSI.WAIT, "Pengerjaan ulang berjalan", "PIC Meja");
  if (k === "SELESAI") return t(AKSI.MARK_READY, "Tandai Siap Kirim", "Admin", "Pekerjaan sudah selesai; status order masih Diproses");
  if (k === "DIKERJAKAN") return aktualAda || !rencanaBahanAda
    ? t(AKSI.FINISH_WORK, "Catat pekerjaan selesai", "Admin / PIC", aktualAda ? "Bahan sudah dicatat" : null)
    : t(AKSI.RECORD_MATERIAL, "Catat bahan yang benar-benar dipakai", "PIC Bahan", "Rencana bahan sudah ada, pemakaian aktual belum");
  // Target selesai dan rencana bahan OPSIONAL: tidak pernah menjadi langkah yang menahan unit berjadwal. Satu tindakan yang sama dengan atau tanpa keduanya; keduanya hanya disebut sebagai tambahan.
  // OPEN_WORK = MEMBUKA Ruang Kerja Unit (bagian Pekerjaan). Membuka halaman TIDAK mengubah status apa pun; "Sudah dikerjakan" baru tercatat lewat pemakaian bahan aktual (otomatis) atau tombol manual berkonfirmasi.
  if (k === "DIJADWALKAN") return t(AKSI.OPEN_WORK, "Buka pekerjaan", "Admin / PIC", "Membuka halaman tidak mengubah status. Sudah dikerjakan tercatat otomatis saat pemakaian bahan dicatat, atau tandai manual bila pekerjaan memang sudah dilakukan. Target selesai dan rencana bahan opsional.");
  // BELUM_DIJADWALKAN (atau tidak dikenal)
  return t(AKSI.OPEN_PLAN, "Jadwalkan di Rencana Produksi", "Admin", "Target selesai opsional. Boleh juga langsung catat pemakaian bahan (otomatis Sudah dikerjakan) atau tandai sudah dikerjakan secara manual bila pekerjaan memang sudah dilakukan, tanpa aplikasi Meja");
}
