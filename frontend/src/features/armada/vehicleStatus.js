// Status kendaraan & rute NYATA — dari enum backend (prisma/schema.prisma).
// Sama alasannya dengan jobStatus.js: dipisah dari deliveryMock.js supaya
// halaman berdata nyata tidak menawarkan pilihan yang tidak akan pernah cocok.

export const VEHICLE_STATUS_REAL = {
  AVAILABLE:   { label: "Tersedia",         tone: "green" },
  IN_USE:      { label: "Sedang Digunakan", tone: "accent" },
  MAINTENANCE: { label: "Dalam Perawatan",  tone: "orange" },
  INACTIVE:    { label: "Tidak Aktif",      tone: "neutral" },
};

export const ROUTE_STATUS_REAL = {
  DRAFT:        { label: "Draft",       tone: "neutral" },
  PUBLISHED:    { label: "Diterbitkan", tone: "accent" },
  // UPDATED (22 September 2026) — BUKAN status database sungguhan (enum
  // RouteStatus prisma cuma DRAFT/PUBLISHED/IN_PROGRESS/COMPLETED/
  // CANCELLED, lihat schema.prisma), murni label TAMPILAN turunan lewat
  // effectiveRouteStatus() di bawah: rute PUBLISHED yang diedit darurat
  // SETELAH diterbitkan (Route.lastEditedAt > publishedAt, kolom yang
  // SUDAH ada sejak redesain Sep 2026). Permintaan QA audit Route Planner:
  // dispatcher lain yang buka papan perlu tahu SEKILAS "ini rencana asli"
  // vs "ini sudah diubah sejak diterbitkan" tanpa harus baca teks jejak
  // edit satu-satu.
  UPDATED:      { label: "Diperbarui", tone: "orange" },
  IN_PROGRESS:  { label: "Berjalan",    tone: "accent" },
  COMPLETED:    { label: "Selesai",     tone: "green" },
  CANCELLED:    { label: "Dibatalkan",  tone: "red" },
};

// Lihat catatan UPDATED di atas — satu-satunya tempat aturannya dihitung,
// dipakai RouteCard.jsx (papan) dan mana pun lain yang perlu label status
// yang SAMA persis, supaya tidak diam-diam beda logic kalau disalin ulang.
export function effectiveRouteStatus(route) {
  if (
    route?.status === "PUBLISHED" &&
    route.lastEditedAt &&
    route.publishedAt &&
    new Date(route.lastEditedAt) > new Date(route.publishedAt)
  ) {
    return "UPDATED";
  }
  return route?.status;
}
