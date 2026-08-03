import {
  Users, Wrench, Truck, Gauge, Package,
  MessageSquare, GitBranch, ClipboardList, BarChart3,
  Boxes, ScanLine, Route, CalendarClock, TrendingUp, HeartPulse,
} from "lucide-react";

// Konten halaman command center per divisi (`.division-page` di file desain
// SANSS v4). Dipakai oleh DivisionPage.jsx, satu komponen generik untuk
// kelima divisi — file ini yang membedakan isinya.
//
// ⚠️ ATURAN MODUL — dibaca dulu sebelum menambah/ubah entri:
// `path: null` berarti module BELUM ADA halamannya. Kartu tetap ditampilkan
// (keputusan Gilang 1 Agustus 2026: "tampilkan semua, non-aktif kalau belum
// ada") tapi non-klik dengan label "Segera hadir" — BUKAN dihapus, supaya
// grid tetap terasa selengkap mockup, tapi juga BUKAN diberi path palsu yang
// nyasar ke halaman tidak nyambung.
//
// Modul yang PUNYA path REAL di sini kadang bukan hasil terjemahan 1:1 dari
// nama modul mockup — beberapa slot fiktif mockup (mis. "Quotation" di
// Growth, "Management Report" di All Teams) DIGANTI dengan fitur asli yang
// sudah dibangun tapi tidak disebut di mockup (mis. Dashboard analitik,
// Galeri Produk, Ringkasan All Teams). Alasannya: field `path` di PORTALS
// (backend/src/constants/permissions.js) dulunya jadi TUJUAN LANGSUNG kartu
// Portal — sekarang kartu berhenti di command center ini dulu. Kalau modul
// yang membawa ke path itu tidak ada di grid, halaman aslinya jadi tidak
// bisa dijangkau lagi dari Portal sama sekali. Jadi tiap divisi WAJIB py
// minimal satu modul yang menuju `PORTALS[key].path`.
export const DIVISION_CONTENT = {
  growth: {
    icon: Users,
    short: "Sales CRM",
    title: "Sales CRM & Omnichannel",
    subtitle: "Lead, customer journey, quotation, dan seluruh kanal penjualan.",
    heroLine: "Workspace operasional terintegrasi untuk memantau lead, percakapan, dan pipeline penjualan SANO.",
    // Semua 6 modul di sini REAL — Growth adalah divisi paling lengkap
    // fiturnya, jadi tidak ada slot yang perlu di-nonaktifkan.
    modules: [
      { title: "Lead Inbox",        description: "Semua prospek dari WhatsApp, marketplace, web, dan showroom.", icon: MessageSquare, path: "/inbox" },
      { title: "Customer 360",      description: "Riwayat pelanggan, kebutuhan kasur, percakapan, dan transaksi.", icon: Users, path: "/customers" },
      { title: "Dashboard Penjualan", description: "KPI, funnel, dan traffic penjualan dalam satu tampilan.", icon: BarChart3, path: "/dashboard" },
      { title: "Galeri Produk",     description: "Katalog siap-kirim dari panel chat, lengkap harga & foto.", icon: Package, path: "/products" },
      { title: "Sales Pipeline",    description: "Pantau tahapan lead hingga closing secara visual.", icon: GitBranch, path: "/pipeline" },
      { title: "Order",             description: "Antrean pengerjaan order, terpisah dari sisi penjualan.", icon: ClipboardList, path: "/orders" },
    ],
  },
  bengkel: {
    icon: Wrench,
    short: "Production",
    title: "Production Operations",
    subtitle: "Perencanaan produksi, work order, quality control, dan kapasitas.",
    heroLine: "Workspace operasional untuk memantau tahap pengerjaan work order dan kapasitas produksi.",
    // Production Tahap 1 (2 Agustus 2026): Work Order jadi halaman nyata.
    //
    // Capacity Planning, Product Recipe, dan Maintenance TETAP null dan
    // memang TIDAK direncanakan — tidak ada entitas mesin, BOM, maupun
    // jadwal perawatan di sistem ini, dan tidak ada alur bisnis berjalan
    // yang membutuhkannya. Ketiganya tetap ditampilkan (non-aktif) supaya
    // jujur bahwa mockup pernah menyebutkannya, bukan supaya terlihat
    // seolah sedang dikerjakan.
    modules: [
      { title: "Production Board",  description: "Papan harian: target hari ini dan tahap yang selesai.", icon: ClipboardList, path: "/bengkel" },
      { title: "Work Order",        description: "Seluruh unit kasur beserta status dan tahap pengerjaannya.", icon: Boxes, path: "/bengkel/work-orders" },
      { title: "QC Inspection",     description: "Uji berat badan, verdict QC, dan catatan mutu per unit.", icon: ScanLine, path: null },
      { title: "Capacity Planning", description: "Rencana kapasitas mesin, tim, dan shift produksi.", icon: BarChart3, path: null },
      { title: "Product Recipe",    description: "Bill of material dan standar konstruksi tiap tipe kasur.", icon: Boxes, path: null },
      { title: "Maintenance",       description: "Jadwal perawatan mesin dan laporan downtime.", icon: Wrench, path: null },
    ],
  },
  warehouse: {
    icon: Package,
    short: "Warehouse",
    title: "Warehouse & Inventory Control",
    subtitle: "Stok bahan baku, produk jadi, mutasi, replenishment, dan stock opname.",
    heroLine: "Workspace operasional untuk memantau saldo stok dan pergerakan material.",
    modules: [
      // Tahap 1-8 Warehouse selesai (2 Agustus 2026) — semua 6 kartu di
      // bawah ini data NYATA. Dashboard masih memakai data contoh
      // (KPI agregatnya belum ada endpoint tersendiri), lihat MockBadge
      // di WarehouseDashboard.jsx.
      { title: "Dashboard",         description: "Ringkasan stok, penerimaan, pengeluaran, dan akurasi inventory.", icon: Gauge, path: "/warehouse/dashboard" },
      { title: "Stock & Material",  description: "Pantau saldo, lokasi rak, lot, dan status seluruh inventory.", icon: Package, path: "/warehouse/inventory" },
      { title: "Goods Receipt",     description: "Penerimaan bahan baku dan produk dari supplier atau produksi.", icon: ScanLine, path: "/warehouse/goods-receipt" },
      { title: "Material Issue",    description: "Pengeluaran material untuk work order produksi.", icon: ClipboardList, path: "/warehouse/material-issue" },
      { title: "Stock Transfer",    description: "Mutasi barang antar lokasi, rak, atau gudang.", icon: Route, path: "/warehouse/transfers" },
      { title: "Cycle Count",       description: "Jadwal stock opname dan rekonsiliasi selisih.", icon: CalendarClock, path: "/warehouse/stock-count" },
      { title: "Replenishment",     description: "Saran pembelian berdasarkan minimum stock dan kebutuhan produksi.", icon: TrendingUp, path: "/warehouse/replenishment" },
    ],
  },
  armada: {
    icon: Truck,
    short: "Delivery",
    title: "Delivery & Fulfillment",
    subtitle: "Penjadwalan armada, rute, instalasi, proof of delivery, dan SLA.",
    heroLine: "Workspace operasional untuk memantau jadwal pengiriman dan status armada.",
    modules: [
      { title: "Jadwal & Job",          description: "Atur jadwal pengiriman berdasarkan area dan prioritas.", icon: ClipboardList, path: "/armada" },
      { title: "Route Planner",         description: "Optimalkan rute, armada, dan urutan drop-off.", icon: Route, path: null },
      { title: "Installation Checklist",description: "Checklist penempatan, instalasi, dan edukasi pelanggan.", icon: ScanLine, path: null },
      { title: "Proof of Delivery",     description: "Foto, tanda tangan, waktu tiba, dan status penerimaan.", icon: Package, path: null },
      { title: "Driver App",            description: "Akses tugas, navigasi, kontak pelanggan, dan update status.", icon: Route, path: null },
      { title: "SLA Monitor",           description: "Pantau keterlambatan dan risiko pelanggaran SLA.", icon: Gauge, path: null },
    ],
  },
  kendali: {
    icon: Gauge,
    short: "All Teams",
    title: "All Teams Dashboard",
    subtitle: "Executive overview lintas sales, produksi, warehouse, dan delivery.",
    heroLine: "Ringkasan lintas divisi untuk manajemen — status order, produksi, dan pengiriman dalam satu tempat.",
    // Tiga modul pertama REAL (sesuai nav horizontal Kendali yang sudah ada
    // di Layout.jsx). Tiga sisanya deep-dive per fungsi yang di mockup
    // digambarkan sebagai dashboard analitik tersendiri — belum dibangun.
    modules: [
      { title: "Ringkasan Lintas Divisi", description: "Status order, produksi, dan pengiriman dalam satu ringkasan.", icon: Gauge, path: "/kendali" },
      { title: "Antrean Order",           description: "Semua order lintas divisi, dari pemesanan sampai selesai.", icon: ClipboardList, path: "/orders" },
      { title: "Laporan",                 description: "Ringkasan performa lintas divisi untuk manajemen.", icon: BarChart3, path: "/laporan", adminOnly: true },
      { title: "Inventory Health",        description: "Stock accuracy, low stock, dan aging inventory.", icon: Package, path: null },
      { title: "Delivery SLA",            description: "On-time rate, route performance, dan failed delivery.", icon: Truck, path: null },
      { title: "Customer Experience",     description: "Rating layanan, komplain, dan resolution time.", icon: HeartPulse, path: null },
    ],
  },
};
