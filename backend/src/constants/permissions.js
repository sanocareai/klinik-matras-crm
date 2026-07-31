// Katalog permission Sano Hub — pengganti RLS Postgres di stack ini (D-001).
//
// Supabase memberi RLS gratis; kita tidak memakainya, jadi otorisasi HARUS
// eksplisit di lapisan aplikasi. Konsekuensinya: file ini adalah satu-satunya
// tempat "siapa boleh apa" didefinisikan. Jangan menyebar cek role ad-hoc
// (`if (user.role === 'ADMIN')`) ke dalam route — itu yang membuat aturan
// keamanan mustahil diaudit.
//
// Permission bersifat ADITIF: satu orang bisa memegang beberapa role dan
// mendapat gabungan permission-nya (D-010).

export const PERMISSIONS = {
  // --- Growth (CRM & omnichannel) ---
  CUSTOMER_READ: "customer:read",
  CUSTOMER_WRITE: "customer:write",
  // Nomor telepon & alamat lengkap. Sengaja DIPISAH dari CUSTOMER_READ:
  // lantai produksi perlu tahu kasur siapa, TIDAK perlu nomor teleponnya.
  CUSTOMER_PII_READ: "customer:pii:read",
  CONVERSATION_READ: "conversation:read",
  CONVERSATION_WRITE: "conversation:write",

  ORDER_READ: "order:read",
  ORDER_WRITE: "order:write",
  // Nilai order & harga item. Dipisah karena pekerja produksi tidak boleh
  // melihat harga (PRD §9.3).
  ORDER_PRICE_READ: "order:price:read",

  // --- Bengkel (produksi & inventory) ---
  UNIT_READ: "unit:read",
  // Menjalankan tahap: start / complete / block. Inilah yang membuat
  // unit_stage_logs punya arti — pelakunya harus orang yang benar-benar
  // mengerjakan.
  UNIT_STAGE_WRITE: "unit:stage:write",
  // Mengubah layanan/modul sebuah unit, melewati tahap opsional.
  UNIT_ROUTING_WRITE: "unit:routing:write",
  // Memutuskan hasil Uji Berat Badan (D-005).
  QC_WRITE: "qc:write",
  INVENTORY_READ: "inventory:read",
  INVENTORY_WRITE: "inventory:write",

  // --- Armada (pickup & delivery) ---
  JOB_READ: "job:read",
  JOB_WRITE: "job:write",
  // Driver: HANYA job yang ditugaskan ke dirinya, tanggal hari ini ±1.
  // Pembatasan barisnya ada di query, permission ini cuma pintunya.
  JOB_OWN_READ: "job:own:read",
  // TERPISAH dari JOB_WRITE (dispatcher, bisa ubah job SIAPA SAJA) — driver
  // cuma boleh mengubah status job MILIKNYA SENDIRI (mulai/tiba/selesai/
  // gagal). Pembatasan baris ada di query (WHERE driverId = req.user.id),
  // permission ini cuma pintunya.
  JOB_OWN_WRITE: "job:own:write",
  ROUTE_WRITE: "route:write",

  // --- Kendali (manajemen & keuangan) ---
  DASHBOARD_READ: "dashboard:read",
  PAYMENT_READ: "payment:read",
  PAYMENT_WRITE: "payment:write",

  // --- Administrasi ---
  USER_MANAGE: "user:manage",
  ROLE_GRANT: "role:grant",
  MASTER_DATA_WRITE: "masterdata:write",
};

const P = PERMISSIONS;

// Peta role → permission.
//
// ⚠️ CATATAN PENTING soal ADMIN. PRD §3 melarang "super admin bisa segalanya"
// sebagai default, karena itu menghancurkan jejak audit yang justru jadi
// alasan sistem ini dibangun. Karena itu ADMIN di sini TIDAK mendapat
// UNIT_STAGE_WRITE dan QC_WRITE — kalau admin bisa memajukan tahap produksi,
// kolom "siapa yang mengerjakan" di unit_stage_logs berhenti bisa dipercaya.
//
// Kalau Gilang memang ikut mengerjakan di bengkel, jawabannya BUKAN melebarkan
// ADMIN — tapi memberinya role PRODUCTION_LEAD / QC_LEAD sebagai tambahan.
// Itu justru gunanya multi-role, dan hasilnya jejak audit tetap jujur.
export const ROLE_PERMISSIONS = {
  ADMIN: [
    P.CUSTOMER_READ, P.CUSTOMER_WRITE, P.CUSTOMER_PII_READ,
    P.CONVERSATION_READ, P.CONVERSATION_WRITE,
    P.ORDER_READ, P.ORDER_WRITE, P.ORDER_PRICE_READ,
    P.UNIT_READ, P.UNIT_ROUTING_WRITE,
    P.INVENTORY_READ,
    P.JOB_READ, P.JOB_WRITE, P.ROUTE_WRITE,
    P.DASHBOARD_READ, P.PAYMENT_READ,
    P.USER_MANAGE, P.ROLE_GRANT, P.MASTER_DATA_WRITE,
  ],

  SALES: [
    P.CUSTOMER_READ, P.CUSTOMER_WRITE, P.CUSTOMER_PII_READ,
    P.CONVERSATION_READ, P.CONVERSATION_WRITE,
    P.ORDER_READ, P.ORDER_WRITE, P.ORDER_PRICE_READ,
    // Baca-saja: "kasur sampai tahap mana" + dokumentasi foto per tahap
    // (D-015) untuk dijawab ke customer / di-forward. PRD FR-G-08: order
    // timeline lintas portal harus terbaca CS tanpa keluar layar. TIDAK
    // dapat UNIT_STAGE_WRITE/UNIT_ROUTING_WRITE — sales tidak mengubah
    // produksi, cuma melihatnya.
    P.UNIT_READ,
    P.DASHBOARD_READ,
  ],

  // Lantai produksi: tahu kasur siapa dan harus diapakan, TIDAK tahu nomor
  // telepon customer maupun harga.
  PRODUCTION_WORKER: [
    P.UNIT_READ, P.UNIT_STAGE_WRITE,
    P.CUSTOMER_READ, P.ORDER_READ,
  ],

  PRODUCTION_LEAD: [
    P.UNIT_READ, P.UNIT_STAGE_WRITE, P.UNIT_ROUTING_WRITE,
    P.CUSTOMER_READ, P.ORDER_READ,
    P.INVENTORY_READ,
    P.DASHBOARD_READ,
  ],

  QC_LEAD: [
    P.UNIT_READ, P.UNIT_STAGE_WRITE, P.QC_WRITE,
    P.CUSTOMER_READ, P.ORDER_READ,
    P.DASHBOARD_READ,
  ],

  WAREHOUSE: [
    P.INVENTORY_READ, P.INVENTORY_WRITE,
    P.UNIT_READ,
  ],

  // Dispatcher BUTUH PII: menyusun rute tanpa alamat & nomor telepon mustahil.
  DISPATCHER: [
    P.JOB_READ, P.JOB_WRITE, P.ROUTE_WRITE,
    P.CUSTOMER_READ, P.CUSTOMER_PII_READ,
    P.ORDER_READ, P.UNIT_READ,
  ],

  // Driver melihat PII hanya untuk stop miliknya sendiri — pembatasan baris
  // dilakukan di query, bukan di sini.
  DRIVER: [
    P.JOB_OWN_READ, P.JOB_OWN_WRITE, P.CUSTOMER_PII_READ,
  ],

  FINANCE: [
    P.PAYMENT_READ, P.PAYMENT_WRITE,
    P.ORDER_READ, P.ORDER_PRICE_READ,
    P.CUSTOMER_READ,
    P.DASHBOARD_READ,
  ],
};

// Portal → role yang boleh masuk. Dipakai landing page untuk memilih kartu
// portal mana yang ditampilkan (PRD §4).
export const PORTALS = [
  // Label memakai istilah yang DIPAKAI TIM SEHARI-HARI, bukan istilah PRD.
  // Gilang menyebut divisi sales sebagai "CRM & Omnichannel WhatsApp" — itu
  // yang dipakai di UI. Key-nya tetap "growth" (identifier kode Inggris,
  // label Indonesia — konvensi CLAUDE.md).
  {
    key: "growth",
    label: "CRM & Omnichannel",
    description: "Chat WhatsApp, pelanggan, order, pipeline penjualan",
    path: "/dashboard",
    roles: ["ADMIN", "SALES"],
  },
  {
    key: "bengkel",
    label: "Produksi & Bengkel",
    description: "Target harian, tahap pengerjaan, QC, dokumentasi",
    path: "/bengkel",
    roles: ["ADMIN", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE"],
  },
  {
    key: "armada",
    label: "Armada & Pengiriman",
    description: "Jalur pengambilan & pengiriman harian, driver",
    path: "/armada",
    roles: ["ADMIN", "DISPATCHER", "DRIVER"],
  },
  {
    key: "kendali",
    label: "Kendali",
    description: "Ringkasan lintas divisi, keuangan, kapasitas",
    path: "/kendali",
    roles: ["ADMIN", "FINANCE"],
  },
];

export const ALL_ROLES = Object.keys(ROLE_PERMISSIONS);
