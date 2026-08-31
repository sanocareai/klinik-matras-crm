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

  // Revisi scope (PRD §7.4, D-008). SENGAJA DUA permission terpisah untuk
  // dua sisi alur yang sama — pemisahan ini yang membuat angka delta harga
  // bisa dipercaya. Yang membongkar kasur dan melihat kondisi aslinya
  // MENGAJUKAN; yang bicara ke customer MEREKAM hasilnya. Satu orang tidak
  // boleh mengarang delta harga sekaligus menyetujuinya sendiri.
  SCOPE_REVISION_PROPOSE: "scope_revision:propose", // produksi & QC
  SCOPE_REVISION_DECIDE: "scope_revision:decide",   // sales & admin
  INVENTORY_READ: "inventory:read",
  INVENTORY_WRITE: "inventory:write",
  // Catat bahan baku dipakai untuk SATU unit spesifik (busa/lem/kain saat
  // mengerjakan tahap). SENGAJA dipisah dari INVENTORY_WRITE — lantai
  // produksi tidak butuh (dan tidak boleh) akses goods receipt/stock
  // opname/transfer gudang, cuma "bahan ini saya pakai untuk unit ini".
  UNIT_MATERIAL_WRITE: "unit:material:write",

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
    P.UNIT_READ, P.UNIT_ROUTING_WRITE, P.SCOPE_REVISION_DECIDE,
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
    P.UNIT_READ, P.SCOPE_REVISION_DECIDE,
    P.DASHBOARD_READ,
    // D-030 paritas mobile (21 Agustus 2026) — ditemukan saat membangun tab
    // Pembayaran di "Rincian Pesanan": SALES bisa CATAT pembayaran (POST
    // /orders/:id/payments TIDAK dijaga requirePermission sama sekali) tapi
    // TIDAK BISA lihat riwayatnya sendiri (GET /armada/payments butuh
    // PAYMENT_READ, sebelumnya cuma ADMIN) — asimetri nyata, bukan
    // pembatasan yang disengaja (bandingkan komentar UNIT_READ di atas:
    // sales MEMANG dimaksudkan bisa lihat status finansial order-nya).
    P.PAYMENT_READ,
  ],

  // Lantai produksi: tahu kasur siapa dan harus diapakan, TIDAK tahu nomor
  // telepon customer maupun harga.
  PRODUCTION_WORKER: [
    P.UNIT_READ, P.UNIT_STAGE_WRITE, P.UNIT_MATERIAL_WRITE,
    P.CUSTOMER_READ, P.ORDER_READ,
  ],

  PRODUCTION_LEAD: [
    P.UNIT_READ, P.UNIT_STAGE_WRITE, P.UNIT_ROUTING_WRITE, P.UNIT_MATERIAL_WRITE, P.SCOPE_REVISION_PROPOSE,
    P.CUSTOMER_READ, P.ORDER_READ,
    P.INVENTORY_READ,
    P.DASHBOARD_READ,
  ],

  QC_LEAD: [
    P.UNIT_READ, P.UNIT_STAGE_WRITE, P.QC_WRITE, P.SCOPE_REVISION_PROPOSE,
    P.CUSTOMER_READ, P.ORDER_READ,
    P.DASHBOARD_READ,
  ],

  WAREHOUSE: [
    P.INVENTORY_READ, P.INVENTORY_WRITE, P.UNIT_MATERIAL_WRITE,
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

  // Helper (pendamping driver, D-037, 31 Agustus 2026) — permission SAMA
  // dengan DRIVER (boleh buka "Job Saya" untuk job yang dia bantu), tapi
  // role TERPISAH: helper TIDAK PERNAH muncul di daftar pilihan driver
  // (GET /armada/drivers cuma query role DRIVER, lihat armada.js).
  HELPER: [
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
  // Redesign SANSS (1 Agustus 2026, Gilang): label mengikuti mockup —
  // dwibahasa (judul Inggris, deskripsi Indonesia). Key TIDAK diubah supaya
  // path/permission/riwayat tidak ikut bergeser.
  //
  // GUDANG DIPISAH jadi workspace sendiri ("warehouse") — sebelumnya cuma
  // sub-halaman di dalam Bengkel. Alasannya: WAREHOUSE adalah role terpisah
  // dengan permission sendiri (satu-satunya pemegang INVENTORY_WRITE), jadi
  // menyembunyikannya di balik portal Produksi membuat orang gudang harus
  // lewat divisi yang bukan miliknya. Sekarang 5 workspace, sesuai mockup.
  {
    key: "growth",
    label: "Sales CRM & Omnichannel",
    description: "Lead, customer journey, quotation, dan seluruh kanal penjualan.",
    path: "/dashboard",
    roles: ["ADMIN", "SALES"],
  },
  {
    key: "bengkel",
    label: "Production Operations",
    description: "Perencanaan produksi, work order, quality control, dan kapasitas.",
    path: "/bengkel",
    roles: ["ADMIN", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD"],
  },
  {
    key: "warehouse",
    label: "Warehouse & Inventory Control",
    description: "Stok bahan baku, produk jadi, mutasi, dan stock opname.",
    path: "/gudang",
    // WAREHOUSE tetap boleh membuka Produksi juga (mereka melayani bengkel),
    // makanya role ini masih terdaftar di portal bengkel di atas? TIDAK —
    // sengaja DILEPAS dari sana: orang gudang sekarang mendarat di
    // workspace-nya sendiri. Kalau nanti terbukti mereka butuh papan
    // produksi juga, tambahkan lagi WAREHOUSE ke portal bengkel.
    roles: ["ADMIN", "WAREHOUSE", "PRODUCTION_LEAD"],
  },
  {
    key: "armada",
    label: "Delivery & Fulfillment",
    description: "Penjadwalan armada, rute, instalasi, proof of delivery, dan SLA.",
    path: "/armada",
    roles: ["ADMIN", "DISPATCHER", "DRIVER", "HELPER"],
  },
  {
    key: "kendali",
    label: "All Teams Dashboard",
    description: "Executive overview lintas sales, produksi, warehouse, dan delivery.",
    path: "/kendali",
    roles: ["ADMIN", "FINANCE"],
  },
];

export const ALL_ROLES = Object.keys(ROLE_PERMISSIONS);
