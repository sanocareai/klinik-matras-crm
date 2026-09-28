// Logika murni Pengambilan Bahan Produksi (Production Workshop + Warehouse V2, P4). Dipisah dari halaman JSX supaya
// bisa diuji dengan node --test biasa. Cermin aturan backend (productionMaterialIssueCommandService.js) — bila backend
// berubah, sesuaikan sadar di sini; server tetap menegakkan ulang semuanya.

export const PICKUP_TABS = Object.freeze([
  { key: "READY_TO_PICK", label: "Menunggu Diserahkan" },
  { key: "ISSUED", label: "Sudah Diserahkan" },
  { key: "CANCELLED", label: "Dibatalkan" },
]);

export const PICKUP_STATUS_BADGE = Object.freeze({
  READY_TO_PICK: { variant: "warning", label: "Menunggu Diserahkan" },
  ISSUED: { variant: "success", label: "Sudah Diserahkan" },
  CANCELLED: { variant: "danger", label: "Dibatalkan" },
});

export function pickupStatusBadgeFor(status) {
  return PICKUP_STATUS_BADGE[status] || { variant: "neutral", label: status || "—" };
}

// Gudang hanya bisa menyerahkan yang READY_TO_PICK; batal hanya sebelum diserahkan (setelahnya: return/adjustment).
export function canPickRequest(request) { return request?.status === "READY_TO_PICK"; }
export function canCancelRequest(request) { return request?.status === "READY_TO_PICK"; }
// Produksi boleh mengajukan hanya dari plan Bahan Direservasi yang belum punya permintaan aktif/selesai.
export function canRequestPickup(plan, requests = []) {
  if (!plan || plan.status !== "MATERIAL_RESERVED") return false;
  return !requests.some((r) => r.planId === plan.id && ["READY_TO_PICK", "ISSUED"].includes(r.status));
}

// Perbandingan per baris: rencana vs reservasi vs diserahkan (angka dari server; UI tidak menghitung stok).
export function lineComparison(line) {
  const planned = Number(line?.planned ?? 0);
  const reserved = Number(line?.reserved ?? 0);
  const picked = Number(line?.picked ?? 0);
  return { planned, reserved, picked, remaining: Math.max(0, planned - picked), consistent: planned === reserved };
}

export function requestSummary(request) {
  const lines = (request?.lines || []).map(lineComparison);
  return {
    lineCount: lines.length,
    totalPlanned: lines.reduce((s, l) => s + l.planned, 0),
    totalPicked: lines.reduce((s, l) => s + l.picked, 0),
    allConsistent: lines.every((l) => l.consistent),
  };
}

// Pesan galat Indonesia untuk kode server yang relevan (409/503) — sisanya memakai pesan server apa adanya.
export function pickErrorMessage(error) {
  switch (error?.code) {
    case "MATERIAL_ISSUE_REVISION_CONFLICT": return "Data sudah berubah (mungkin diproses petugas lain) — muat ulang antrean.";
    case "MATERIAL_ISSUE_ALREADY_PICKED": return "Bahan sudah diserahkan sebelumnya.";
    case "MATERIAL_ISSUE_CANCELLED": return "Permintaan ini sudah dibatalkan.";
    case "MATERIAL_ISSUE_SHORTAGE": return `Stok fisik tidak cukup — tidak ada bahan yang dikeluarkan. ${error.message || ""}`.trim();
    case "MATERIAL_ISSUE_WRITER_OFF": return "Pengambilan bahan V2 belum aktif untuk unit ini.";
    default: return error?.message || "Gagal memproses permintaan";
  }
}

export function emptyStateCopy({ readerMode, tabKey }) {
  if (readerMode === "OFF") {
    return {
      title: "Pengambilan bahan produksi belum diaktifkan",
      description: "Fitur ini sedang dalam tahap uji coba (canary). Hubungi Admin bila Anda seharusnya sudah melihat antrean di sini.",
      belumAktif: true,
    };
  }
  const label = PICKUP_TABS.find((t) => t.key === tabKey)?.label?.toLowerCase() || "tab ini";
  return { title: `Tidak ada permintaan di tab ${label}`, description: "Permintaan dari Produksi akan muncul di sini.", belumAktif: false };
}
