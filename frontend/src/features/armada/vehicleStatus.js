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
  IN_PROGRESS:  { label: "Berjalan",    tone: "accent" },
  COMPLETED:    { label: "Selesai",     tone: "green" },
  CANCELLED:    { label: "Dibatalkan",  tone: "red" },
};
