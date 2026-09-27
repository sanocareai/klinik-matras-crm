// Logika murni halaman Antrean Penerimaan Unit (Production Workshop + Warehouse V2, P1–P2). Dipisah dari
// WarehouseUnitCustody.jsx supaya bisa diuji dengan node --test biasa (tanpa render React), pola sama dengan
// src/lib/tableLayout.js. Cermin aturan backend (unitCustodyCommandService.js) — kalau backend memperluas
// aturan, konstanta di sini harus disesuaikan sadar, bukan diam-diam ikut berubah.

export const CUSTODY_TABS = Object.freeze([
  { key: "OFFERED", label: "Menunggu" },
  { key: "ACCEPTED", label: "Diterima" },
  { key: "REJECTED", label: "Ditolak" },
  { key: "HISTORY", label: "Riwayat" },
]);

export const ALLOWED_LOCATION_TYPES = Object.freeze({
  INBOUND: Object.freeze(["RECEIVING_AREA", "WIP_AREA", "QUARANTINE_AREA"]),
  RETURN: Object.freeze(["RETURN_AREA", "FINISHED_GOODS_AREA", "DISPATCH_AREA", "QUARANTINE_AREA"]),
});

export const DIRECTION_LABEL = Object.freeze({
  INBOUND: "Masuk dari Pickup",
  RETURN: "Kembali (Gagal Kirim)",
});

export const STATUS_BADGE = Object.freeze({
  OFFERED: { variant: "warning", label: "Menunggu" },
  ACCEPTED: { variant: "success", label: "Diterima" },
  REJECTED: { variant: "danger", label: "Ditolak" },
  CANCELLED: { variant: "neutral", label: "Dibatalkan" },
  SUPERSEDED: { variant: "neutral", label: "Digantikan" },
});

export function statusBadgeFor(status) {
  return STATUS_BADGE[status] || { variant: "neutral", label: status || "—" };
}

export function isCustodyDecisionPending(status) {
  return status === "OFFERED";
}

// Lokasi aktif yang boleh dipilih untuk menerima unit dengan arah tertentu. Client TIDAK boleh mengirim
// teks lokasi bebas — pilihan selalu berasal dari StorageLocation aktif yang lolos filter ini.
export function locationsAllowedForDirection(locations, direction) {
  const allowed = ALLOWED_LOCATION_TYPES[direction] || [];
  return (locations || []).filter((location) => location?.active && allowed.includes(location.locationType));
}

// readerMode datang dari server (routes/unitCustody.js): "OFF" = fitur belum diaktifkan untuk siapa pun
// (fail-closed, bukan error); "COHORT"/"GLOBAL" dengan items kosong = memang belum ada unit di tab tersebut.
export function emptyStateCopy({ readerMode, tabKey }) {
  if (readerMode === "OFF") {
    return {
      title: "Antrean custody belum diaktifkan",
      description: "Fitur ini sedang dalam tahap uji coba (canary). Hubungi Admin bila Anda seharusnya sudah melihat antrean di sini.",
      belumAktif: true,
    };
  }
  const label = CUSTODY_TABS.find((tab) => tab.key === tabKey)?.label?.toLowerCase() || "tab ini";
  return { title: `Tidak ada unit di tab ${label}`, description: "Unit yang diserahkan Delivery akan muncul di sini.", belumAktif: false };
}

export function directionLabel(direction) {
  return DIRECTION_LABEL[direction] || direction || "—";
}
