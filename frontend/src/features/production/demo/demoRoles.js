// P12B.2 — Mode Latihan (sebelumnya "Mode Demo"): siapa boleh, halaman apa yang boleh dilihat per peran, dan panduan checklist per peran.
// Logika MURNI (tanpa JSX/jaringan) supaya diuji `node --test`. Server tetap penegak akses (GET /production-v2/demo/access → 403 untuk peran
// di luar daftar ini); data tetap sintetis & client-only, semua aksi ubah data diblokir demoGate.js. Checklist hanya panduan baca-saja.
export const TRAINING_LABEL = "MODE LATIHAN — bukan data operasional";
export const TRAINING_ROLES = Object.freeze(["ADMIN", "OWNER", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE", "PRODUCTION_DOCUMENTER"]);
export const TRAINING_DENIED_ROLES = Object.freeze(["SALES", "FINANCE", "DRIVER", "HELPER", "DISPATCHER", "LEADER_DRIVER", "APPROVER"]);

export const canUseTraining = (roles = []) => (roles || []).some((r) => TRAINING_ROLES.includes(r));
const FULL = (roles) => (roles || []).some((r) => r === "ADMIN" || r === "OWNER");

// Seluruh halaman yang punya data latihan. `roles` = peran yang menurut izin backend memang boleh membuka halaman itu.
export const TRAINING_PAGES = Object.freeze([
  { label: "Ringkasan", to: "/bengkel/ringkasan", roles: ["ADMIN", "OWNER", "PRODUCTION_LEAD"] },
  { label: "Status Produksi", to: "/bengkel/production-v2", roles: ["ADMIN", "OWNER", "PRODUCTION_LEAD", "QC_LEAD"] },
  { label: "Rencana Produksi", to: "/bengkel/rencana-produksi", roles: ["ADMIN", "OWNER", "PRODUCTION_LEAD"] },
  { label: "Quality Control", to: "/bengkel/quality-control", roles: ["ADMIN", "OWNER", "PRODUCTION_LEAD", "QC_LEAD"] },
  { label: "KPI & Laporan", to: "/bengkel/kpi", roles: ["ADMIN", "OWNER", "PRODUCTION_LEAD"] },
  { label: "Aplikasi Meja", to: "/produksi/meja", roles: ["ADMIN", "OWNER", "PRODUCTION_LEAD", "PRODUCTION_WORKER"] },
  { label: "Aplikasi Corner", to: "/produksi/corner", roles: ["ADMIN", "OWNER", "PRODUCTION_LEAD", "PRODUCTION_WORKER"] },
  { label: "Aplikasi Dokumentasi", to: "/produksi/dokumentasi", roles: ["ADMIN", "OWNER", "PRODUCTION_LEAD", "PRODUCTION_DOCUMENTER"] },
  { label: "Aplikasi PIC QC", to: "/produksi/qc", roles: ["ADMIN", "OWNER", "QC_LEAD"] },
  { label: "Antrean Gudang", to: "/warehouse/antrean-produksi", roles: ["ADMIN", "OWNER", "WAREHOUSE"] },
  { label: "KPI Gudang", to: "/warehouse/kpi", roles: ["ADMIN", "OWNER", "PRODUCTION_LEAD", "WAREHOUSE"] },
]);

export function pagesForRoles(roles = []) {
  return TRAINING_PAGES.filter((p) => (roles || []).some((r) => p.roles.includes(r)));
}
// Gerbang halaman: ADMIN/OWNER boleh semua; peran lain hanya halaman dalam daftarnya. Path tidak dikenal → ditolak (fail-closed).
export function pageAllowedForTraining(roles = [], pathname = "") {
  if (!canUseTraining(roles)) return false;
  if (FULL(roles)) return true;
  const base = String(pathname).split("?")[0];
  return pagesForRoles(roles).some((p) => p.to === base);
}

// Checklist panduan (BACA-SAJA). Tiap item = kalimat singkat; tidak ada tombol/centang/aksi.
export const TRAINING_CHECKLISTS = Object.freeze({
  PRODUCTION_LEAD: { title: "Production Lead", items: [
    "Jadwal — tempatkan unit ke meja dan tanggal di Rencana Produksi (geser kartu; di Mode Latihan hanya simulasi lokal).",
    "Prioritas — pahami urutan Normal / Tinggi / Komplain dan baca peringatan bila urutan manual membalik prioritas.",
    "Meja — periksa isi tiap meja (maksimal 3 unit) dan urutan manual yang menang atas prioritas.",
    "Target — lihat target harian di Pengaturan → Target Produksi (hanya Admin/Owner yang mengubahnya).",
  ] },
  PRODUCTION_WORKER: { title: "Operator Meja", items: [
    "Antrean — buka Aplikasi Meja dan kenali unit yang ditugaskan kepada Anda.",
    "Diagnosis — isi hasil bongkar, temuan, dan foto/video pada tahap diagnosis.",
    "Bahan — periksa bahan yang diserahkan Gudang; laporkan kekurangan lewat Tunda Pekerjaan (Menunggu bahan).",
    "Bukti — lengkapi foto/video yang diminta tiap tahap sebelum menandai selesai.",
  ] },
  CORNER: { title: "PIC Corner", items: [
    "Tahap 9–12 — kerjakan finishing di Aplikasi Corner sesuai urutan tahap.",
    "Bukti — lengkapi foto hasil tiap tahap Corner sebelum lanjut.",
    "Serah — pastikan tahap 12 selesai agar unit lanjut ke QC / Gudang.",
  ] },
  QC_LEAD: { title: "Quality Control", items: [
    "PASS — unit memenuhi semua poin periksa; catat hasil dan lanjutkan ke Corner/Gudang.",
    "FAIL — catat alasan dan bukti; unit kembali ke tahap perbaikan.",
    "Rework — pantau unit yang diulang dan pastikan QC ulang tercatat.",
  ] },
  WAREHOUSE: { title: "Gudang", items: [
    "Unit tiba — konfirmasi unit yang datang di Penerimaan Unit.",
    "Bahan — siapkan dan serahkan bahan sesuai antrean permintaan.",
    "Retur — terima sisa bahan yang dikembalikan dan cocokkan jumlahnya.",
    "Barang jadi — terima unit selesai dari produksi sebelum dikirim.",
  ] },
  PRODUCTION_DOCUMENTER: { title: "Dokumenter", items: [
    "Kategori foto — kenali 12 kategori foto dan mana yang wajib untuk tiap unit.",
    "Draf offline — foto tersimpan di HP saat tanpa sinyal dan terkirim otomatis saat online.",
    "Kirim — periksa kelengkapan sebelum Kirim; pengiriman tidak pernah dobel.",
  ] },
});

// Daftar checklist yang tampil untuk seperangkat peran. Admin/Owner melihat semuanya; Operator juga melihat checklist PIC Corner.
export function checklistsForRoles(roles = []) {
  const r = roles || [];
  if (FULL(r)) return ["PRODUCTION_LEAD", "PRODUCTION_WORKER", "CORNER", "QC_LEAD", "WAREHOUSE", "PRODUCTION_DOCUMENTER"].map((k) => ({ key: k, ...TRAINING_CHECKLISTS[k] }));
  const keys = [];
  if (r.includes("PRODUCTION_LEAD")) keys.push("PRODUCTION_LEAD");
  if (r.includes("PRODUCTION_WORKER")) keys.push("PRODUCTION_WORKER", "CORNER");
  if (r.includes("QC_LEAD")) keys.push("QC_LEAD");
  if (r.includes("WAREHOUSE")) keys.push("WAREHOUSE");
  if (r.includes("PRODUCTION_DOCUMENTER")) keys.push("PRODUCTION_DOCUMENTER");
  return [...new Set(keys)].map((k) => ({ key: k, ...TRAINING_CHECKLISTS[k] }));
}
