// ─── DATA CONTOH MODUL DELIVERY (Tahap 1) ───────────────────────────────────
//
// ⚠️ SELURUH ISI FILE INI ADALAH DATA CONTOH, BUKAN DATA ASLI.
// Mengikuti konvensi yang sudah berlaku di features/dashboard/data/contracts.js:
// widget yang memakai mock WAJIB menandainya "Contoh" di UI. Jangan pernah
// menampilkan angka dari file ini tanpa penanda itu — halaman Delivery dibuka
// orang yang sama yang memakai data operasional asli di /armada, dan angka
// palsu tanpa label akan dipakai untuk mengambil keputusan nyata.
//
// ⚠️ HUBUNGANNYA DENGAN DATA ASLI. Modul Delivery SUDAH punya backend nyata
// (backend/src/routes/armada.js, 19 endpoint) yang dipakai pages/Armada.jsx
// dan pages/DriverJobs.jsx: siklus job penuh, upload foto bukti, urutan rute,
// pencatatan pembayaran, dan antrean offline driver. File ini TIDAK
// menggantikannya — ia mengisi 8 halaman BARU yang backend-nya memang belum
// ada, supaya UI-nya bisa dinilai lebih dulu.
//
// ⚠️ TIGA ENTITAS DI BAWAH BELUM ADA DI DATABASE: Vehicle, Route, dan Address
// (job menyimpan alamat sebagai snapshot per kunjungan, bukan entitas).
// Artinya Route Planner & tab Armada tidak akan bisa jadi nyata tanpa migrasi
// skema — lihat catatan risiko R3 di laporan audit. Bentuk objek di sini
// sengaja dibuat menyerupai baris tabel supaya penggantian ke fetch nanti
// tidak perlu menyentuh komponen.

/** Penanda global — dipakai komponen untuk merender badge "Contoh". */
export const IS_MOCK = true;

// ── Enum status ─────────────────────────────────────────────────────────────
// Label Indonesia untuk UI, kunci Inggris untuk kode — konvensi CLAUDE.md.
//
// `tone` memetakan ke warna badge yang SUDAH ada di badge.jsx (neutral/accent/
// green/orange/red). Sengaja tidak memperkenalkan skala warna baru: aturan
// design system-nya adalah warna status HANYA untuk badge, bukan seluruh kartu.
export const JOB_STATUS = {
  UNSCHEDULED:  { label: "Belum Dijadwalkan", tone: "neutral" },
  AWAITING_DRIVER: { label: "Menunggu Driver", tone: "orange" },
  READY:        { label: "Siap Berangkat",    tone: "accent" },
  EN_ROUTE:     { label: "Menuju Lokasi",     tone: "accent" },
  ARRIVED:      { label: "Tiba di Lokasi",    tone: "accent" },
  IN_PROGRESS:  { label: "Sedang Diproses",   tone: "accent" },
  COMPLETED:    { label: "Selesai",           tone: "green" },
  FAILED:       { label: "Gagal",             tone: "red" },
  RESCHEDULED:  { label: "Dijadwalkan Ulang", tone: "orange" },
  CANCELLED:    { label: "Dibatalkan",        tone: "neutral" },
};

export const JOB_TYPE = {
  PICKUP:       { label: "Pengambilan" },
  DELIVERY:     { label: "Pengiriman" },
  INSTALLATION: { label: "Instalasi" },
  RETURN:       { label: "Retur" },
};

// SLA sengaja PUNYA LABEL TEKS, bukan cuma warna — aturan aksesibilitas
// spesifikasi: jangan hanya mengandalkan warna untuk status.
export const SLA_STATUS = {
  ON_TIME:  { label: "Tepat waktu", tone: "green" },
  AT_RISK:  { label: "Berisiko",    tone: "orange" },
  BREACHED: { label: "Terlambat",   tone: "red" },
};

export const DRIVER_STATUS = {
  AVAILABLE: { label: "Tersedia",  tone: "green" },
  ON_DUTY:   { label: "Bertugas",  tone: "accent" },
  RESTING:   { label: "Istirahat", tone: "orange" },
  INACTIVE:  { label: "Tidak Aktif", tone: "neutral" },
};

export const VEHICLE_STATUS = {
  AVAILABLE:   { label: "Tersedia",        tone: "green" },
  IN_USE:      { label: "Sedang Digunakan", tone: "accent" },
  MAINTENANCE: { label: "Dalam Perawatan",  tone: "orange" },
  INACTIVE:    { label: "Tidak Aktif",      tone: "neutral" },
};

// ── KPI dashboard ───────────────────────────────────────────────────────────
// Angka persis dari spesifikasi Gilang. `to` menautkan tiap KPI ke halaman
// Jadwal & Penugasan dengan filter status yang sesuai — KPI yang tidak bisa
// diklik memaksa orang mencari ulang apa yang baru saja dilihatnya.
export const DELIVERY_KPI = [
  { key: "UNSCHEDULED",     label: "Belum Dijadwalkan", value: 57, tone: "neutral" },
  { key: "AWAITING_DRIVER", label: "Menunggu Driver",   value: 12, tone: "orange" },
  { key: "READY",           label: "Siap Berangkat",    value: 8,  tone: "accent" },
  { key: "EN_ROUTE",        label: "Dalam Perjalanan",  value: 5,  tone: "accent" },
  { key: "COMPLETED",       label: "Selesai Hari Ini",  value: 21, tone: "green" },
  { key: "ISSUE",           label: "Bermasalah",        value: 3,  tone: "red" },
];

// Distribusi job per status untuk chart (Recharts, lewat ChartCard yang sudah
// ada di features/laporan — TIDAK menambah library chart baru).
export const JOB_STATUS_CHART = [
  { status: "Belum Dijadwalkan", jumlah: 57 },
  { status: "Menunggu Driver",   jumlah: 12 },
  { status: "Siap Berangkat",    jumlah: 8 },
  { status: "Dalam Perjalanan",  jumlah: 5 },
  { status: "Selesai",           jumlah: 21 },
  { status: "Bermasalah",        jumlah: 3 },
];

// ── Driver (contoh) ─────────────────────────────────────────────────────────
export const DRIVERS = [
  { id: "DRV-01", name: "Asep Saputra",  phone: "0812-1111-2201", area: "Jakarta Selatan", status: "ON_DUTY",   assignedVehicleId: "VHC-01", activeJobId: "JOB-2408-014", rating: 4.8, completedJobs: 312, lateJobs: 7,  documentStatus: "Lengkap",       lastActivity: "8 mnt lalu" },
  { id: "DRV-02", name: "Budi Hartono",  phone: "0812-1111-2202", area: "Bekasi",          status: "ON_DUTY",   assignedVehicleId: "VHC-02", activeJobId: "JOB-2408-016", rating: 4.6, completedJobs: 288, lateJobs: 14, documentStatus: "Lengkap",       lastActivity: "21 mnt lalu" },
  { id: "DRV-03", name: "Cecep Ramdani", phone: "0812-1111-2203", area: "Depok",           status: "AVAILABLE", assignedVehicleId: "VHC-03", activeJobId: null,           rating: 4.9, completedJobs: 401, lateJobs: 5,  documentStatus: "Lengkap",       lastActivity: "1 jam lalu" },
  { id: "DRV-04", name: "Dedi Kurnia",   phone: "0812-1111-2204", area: "Tangerang",       status: "RESTING",   assignedVehicleId: null,     activeJobId: null,           rating: 4.4, completedJobs: 176, lateJobs: 19, documentStatus: "SIM kadaluarsa", lastActivity: "2 jam lalu" },
  { id: "DRV-05", name: "Eko Prasetyo",  phone: "0812-1111-2205", area: "Bogor",           status: "AVAILABLE", assignedVehicleId: "VHC-04", activeJobId: null,           rating: 4.7, completedJobs: 254, lateJobs: 9,  documentStatus: "Lengkap",       lastActivity: "3 jam lalu" },
  { id: "DRV-06", name: "Ferry Gunawan", phone: "0812-1111-2206", area: "Jakarta Timur",   status: "INACTIVE",  assignedVehicleId: null,     activeJobId: null,           rating: 4.2, completedJobs: 98,  lateJobs: 12, documentStatus: "Belum lengkap",  lastActivity: "2 hari lalu" },
];

// ── Armada (contoh) ─────────────────────────────────────────────────────────
export const VEHICLES = [
  { id: "VHC-01", plateNumber: "B 9123 SAO", type: "Box Sedang", capacity: 6,  status: "IN_USE",       assignedDriverId: "DRV-01", currentJobId: "JOB-2408-014", mileage: 84210,  nextServiceDate: "2026-08-18", documentStatus: "Lengkap" },
  { id: "VHC-02", plateNumber: "B 9456 SAO", type: "Box Besar",  capacity: 10, status: "IN_USE",       assignedDriverId: "DRV-02", currentJobId: "JOB-2408-016", mileage: 121430, nextServiceDate: "2026-08-09", documentStatus: "Lengkap" },
  { id: "VHC-03", plateNumber: "B 9788 SAO", type: "Box Sedang", capacity: 6,  status: "AVAILABLE",    assignedDriverId: "DRV-03", currentJobId: null,           mileage: 65890,  nextServiceDate: "2026-09-02", documentStatus: "Lengkap" },
  { id: "VHC-04", plateNumber: "B 9901 SAO", type: "Pickup",     capacity: 3,  status: "AVAILABLE",    assignedDriverId: "DRV-05", currentJobId: null,           mileage: 43200,  nextServiceDate: "2026-08-25", documentStatus: "Lengkap" },
  { id: "VHC-05", plateNumber: "B 9555 SAO", type: "Box Besar",  capacity: 10, status: "MAINTENANCE",  assignedDriverId: null,     currentJobId: null,           mileage: 158900, nextServiceDate: "2026-08-03", documentStatus: "STNK kadaluarsa" },
];

// ── Job hari ini (contoh) ───────────────────────────────────────────────────
// `sourceType`/`sourceId` mengikuti spesifikasi integrasi lintas divisi:
// job bisa lahir dari Sales Order, item siap di Warehouse, permintaan retur,
// atau dibuat manual dispatcher.
export const DELIVERY_JOBS = [
  { id: "JOB-2408-011", orderId: "RES-01082026-004", customerId: "C-0241", customerName: "Nadia Pratiwi", customerPhone: "0813-2200-1141",
    jobType: "DELIVERY", scheduledDate: "2026-08-02", scheduledTime: "09:00", address: "Jl. Kemang Raya No. 24", area: "Jakarta Selatan",
    latitude: -6.2607, longitude: 106.8134, unitCount: 2, products: ["King Comfort 180x200", "Divan"], driverId: "DRV-01", vehicleId: "VHC-01",
    routeId: "RTE-2408-01", status: "COMPLETED", priority: "normal", slaStatus: "ON_TIME", notes: "Lantai 2, tanpa lift.",
    podStatus: "VERIFIED", issueCount: 0, sourceType: "SALES_ORDER", sourceId: "RES-01082026-004" },

  { id: "JOB-2408-014", orderId: "RES-01082026-005", customerId: "C-0238", customerName: "Rizky Ananda", customerPhone: "0813-2200-1142",
    jobType: "DELIVERY", scheduledDate: "2026-08-02", scheduledTime: "11:30", address: "Perum Harapan Indah Blok C2", area: "Bekasi",
    latitude: -6.2088, longitude: 106.9896, unitCount: 1, products: ["Orthopedic Plus 160x200"], driverId: "DRV-01", vehicleId: "VHC-01",
    routeId: "RTE-2408-01", status: "EN_ROUTE", priority: "normal", slaStatus: "ON_TIME", notes: "",
    podStatus: "PENDING", issueCount: 0, sourceType: "SALES_ORDER", sourceId: "RES-01082026-005" },

  { id: "JOB-2408-016", orderId: "RES-01082026-006", customerId: "C-0235", customerName: "Maya Ratnasari", customerPhone: "0813-2200-1143",
    jobType: "PICKUP", scheduledDate: "2026-08-02", scheduledTime: "13:00", address: "Jl. Margonda Raya No. 88", area: "Depok",
    latitude: -6.3728, longitude: 106.8317, unitCount: 1, products: ["Natural Latex 180x200"], driverId: "DRV-02", vehicleId: "VHC-02",
    routeId: "RTE-2408-02", status: "ARRIVED", priority: "high", slaStatus: "AT_RISK", notes: "Customer minta konfirmasi 30 mnt sebelum tiba.",
    podStatus: "PENDING", issueCount: 0, sourceType: "SALES_ORDER", sourceId: "RES-01082026-006" },

  { id: "JOB-2408-017", orderId: "SWS-01082026-001", customerId: "C-0250", customerName: "Dede Arsha", customerPhone: "0813-2200-1144",
    jobType: "INSTALLATION", scheduledDate: "2026-08-02", scheduledTime: "14:00", address: "Apartemen Green Park Tower B", area: "Jakarta Barat",
    latitude: -6.1751, longitude: 106.7650, unitCount: 3, products: ["Kasur Sewa 160x200 (3 unit)"], driverId: null, vehicleId: null,
    routeId: null, status: "AWAITING_DRIVER", priority: "high", slaStatus: "AT_RISK", notes: "Akses lift barang terbatas jam 10–15.",
    podStatus: "NOT_STARTED", issueCount: 1, sourceType: "WAREHOUSE_READY", sourceId: "WH-2408-0031" },

  { id: "JOB-2408-018", orderId: "RES-31072026-183", customerId: "C-0219", customerName: "Sinta Melati", customerPhone: "0813-2200-1145",
    jobType: "DELIVERY", scheduledDate: "2026-08-02", scheduledTime: "15:30", address: "Jl. Pahlawan No. 12", area: "Tangerang",
    latitude: -6.1783, longitude: 106.6319, unitCount: 1, products: ["Queen Comfort 160x200"], driverId: null, vehicleId: null,
    routeId: null, status: "UNSCHEDULED", priority: "normal", slaStatus: "AT_RISK", notes: "",
    podStatus: "NOT_STARTED", issueCount: 0, sourceType: "SALES_ORDER", sourceId: "RES-31072026-183" },

  { id: "JOB-2408-019", orderId: "RES-31072026-185", customerId: "C-0208", customerName: "Bayu Wicaksono", customerPhone: "0813-2200-1146",
    jobType: "DELIVERY", scheduledDate: "2026-08-02", scheduledTime: "16:00", address: "Cluster Anggrek No. 7", area: "Bogor",
    latitude: -6.5950, longitude: 106.8166, unitCount: 2, products: ["Full Service 180x200", "Bantal (2)"], driverId: "DRV-02", vehicleId: "VHC-02",
    routeId: "RTE-2408-02", status: "FAILED", priority: "critical", slaStatus: "BREACHED", notes: "Pelanggan tidak di lokasi, tidak bisa dihubungi.",
    podStatus: "NOT_STARTED", issueCount: 1, sourceType: "SALES_ORDER", sourceId: "RES-31072026-185" },

  { id: "JOB-2408-020", orderId: "RET-2408-002", customerId: "C-0199", customerName: "Lestari Handayani", customerPhone: "0813-2200-1147",
    jobType: "RETURN", scheduledDate: "2026-08-02", scheduledTime: "17:00", address: "Jl. Cipete Dalam No. 3", area: "Jakarta Selatan",
    latitude: -6.2745, longitude: 106.7997, unitCount: 1, products: ["Upgrade Lapisan 160x200"], driverId: "DRV-03", vehicleId: "VHC-03",
    routeId: null, status: "READY", priority: "normal", slaStatus: "ON_TIME", notes: "Retur karena tekstur terlalu keras.",
    podStatus: "NOT_STARTED", issueCount: 0, sourceType: "RETURN_REQUEST", sourceId: "RET-2408-002" },
];

// ── Job yang butuh perhatian (Issue Priority) ───────────────────────────────
// Bukan daftar terpisah — DITURUNKAN dari DELIVERY_JOBS supaya tidak ada dua
// sumber kebenaran yang bisa berbeda. Tiap entri menyebut ALASANNYA, karena
// "butuh perhatian" tanpa sebab tidak bisa ditindaklanjuti.
export function buildIssuePriority(jobs = DELIVERY_JOBS) {
  const out = [];
  for (const j of jobs) {
    if (j.slaStatus === "BREACHED") out.push({ job: j, reason: "Terlambat dari jadwal", tone: "red" });
    else if (!j.driverId && j.status !== "COMPLETED" && j.status !== "CANCELLED")
      out.push({ job: j, reason: "Belum ada driver", tone: "orange" });
    else if (j.slaStatus === "AT_RISK") out.push({ job: j, reason: "Berisiko lewat SLA", tone: "orange" });
    else if (j.status === "COMPLETED" && j.podStatus !== "VERIFIED")
      out.push({ job: j, reason: "Bukti serah terima belum lengkap", tone: "orange" });
  }
  const rank = { red: 0, orange: 1 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

// Kendaraan bermasalah — dipisah dari job karena penyebabnya bukan job.
export const VEHICLE_ALERTS = [
  { vehicleId: "VHC-05", plateNumber: "B 9555 SAO", reason: "Dalam perawatan · STNK kadaluarsa", tone: "red" },
  { vehicleId: "VHC-02", plateNumber: "B 9456 SAO", reason: "Servis berikutnya 9 Agustus (7 hari lagi)", tone: "orange" },
];

// ── Ringkasan armada & driver ───────────────────────────────────────────────
// Dihitung dari VEHICLES/DRIVERS, bukan angka terpisah — kalau ditulis manual,
// ia akan berbeda dari tabelnya sendiri begitu ada satu baris diubah.
export function buildFleetAvailability(vehicles = VEHICLES, drivers = DRIVERS) {
  const count = (list, key, val) => list.filter((x) => x[key] === val).length;
  return {
    vehicleAvailable:   count(vehicles, "status", "AVAILABLE"),
    vehicleInUse:       count(vehicles, "status", "IN_USE"),
    vehicleMaintenance: count(vehicles, "status", "MAINTENANCE"),
    driverAvailable:    count(drivers, "status", "AVAILABLE"),
    driverOnDuty:       count(drivers, "status", "ON_DUTY"),
  };
}

// ── Aktivitas terbaru ───────────────────────────────────────────────────────
export const RECENT_ACTIVITY = [
  { id: "act-1", time: "6 mnt",  actor: "Asep Saputra",  text: "Menyelesaikan JOB-2408-011 di Kemang", tone: "green" },
  { id: "act-2", time: "18 mnt", actor: "Sistem",        text: "JOB-2408-018 belum punya driver lewat batas H-1", tone: "orange" },
  { id: "act-3", time: "42 mnt", actor: "Budi Hartono",  text: "Melaporkan kendala di JOB-2408-019 — pelanggan tidak di lokasi", tone: "red" },
  { id: "act-4", time: "1 jam",  actor: "Novi",          text: "Menjadwalkan ulang JOB-2408-017 ke 14:00", tone: "neutral" },
  { id: "act-5", time: "2 jam",  actor: "Cecep Ramdani", text: "Mulai rute RTE-2408-01 (4 stop)", tone: "accent" },
];
