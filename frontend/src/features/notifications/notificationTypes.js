// Notifikasi GLOBAL SANSS — event dari SELURUH workspace.
//
// ⚠️ BUKAN Inbox Sales CRM. Bedanya tegas dan sengaja:
//   Inbox        = percakapan pelanggan. Isinya pesan WhatsApp, dibalas orang,
//                  hidup di workspace Sales CRM. Punya unread-nya SENDIRI yang
//                  tampil sebagai badge di menu "Inbox" di sidebar.
//   Notifikasi   = peristiwa lintas workspace yang perlu DIKETAHUI (stok
//                  menipis, QC gagal, pengiriman bermasalah, order baru).
//                  Tidak dibalas — dibaca lalu dituju.
//
// Sebelum refactor 2 Agustus 2026 keduanya tercampur: lonceng di topbar
// memakai angka unread Inbox dan mengklik-nya melompat langsung ke
// /inbox. Akibatnya seluruh kejadian di Produksi/Gudang/Armada tidak
// pernah punya tempat, dan lonceng terasa seperti tombol Inbox kedua.

// ── Workspace asal notifikasi ────────────────────────────────────────────
// Kuncinya SAMA dengan portal di backend/src/constants/permissions.js
// (growth/bengkel/warehouse/armada) + "system" untuk pesan tingkat aplikasi
// yang tidak dimiliki divisi mana pun.
//
// Warna SENGAJA tetap di dalam tone biru SANSS (ketentuan #11): badge
// workspace membedakan ASAL, bukan tingkat kegentingan. Kalau tiap workspace
// diberi warna sendiri (hijau/ungu/oranye), mata akan membaca warna itu
// sebagai prioritas — padahal prioritas punya kanalnya sendiri di bawah.
export const NOTIF_WORKSPACES = {
  growth:    { label: "Sales CRM",  badge: "bg-[#E8F0FF] text-[#1457D9]" },
  bengkel:   { label: "Production", badge: "bg-[#EEF3FF] text-[#2F73F2]" },
  warehouse: { label: "Warehouse",  badge: "bg-[#E4EDFF] text-[#0E3B96]" },
  armada:    { label: "Delivery",   badge: "bg-[#F0F5FF] text-[#4E8BFF]" },
  system:    { label: "System",     badge: "bg-[#EDF1F7] text-[#536981]" },
};

// ── Tipe notifikasi → ke mana klik membawanya ────────────────────────────
// INI JANTUNG KETENTUAN #16/#17: notifikasi TIDAK BOLEH selalu jatuh ke
// Sales Inbox. Tiap tipe punya tujuannya sendiri, dibangun dari `refId`
// notifikasi lewat `buildTargetUrl` di bawah.
//
// ⚠️ CATATAN KEJUJURAN (diperbarui 2 Agustus 2026 setelah bug report "klik
// notifikasi tidak ada respon"). Baru DUA dari enam yang benar-benar membuka
// OBJEK-nya, bukan cuma mendarat di halaman daftar:
//   SALES_MESSAGE → pages/Inbox.jsx        baca `?conv=` (sudah ada sebelumnya)
//   CUSTOMER      → pages/Customers.jsx    baca `?id=` → buka CustomerDrawer
//   SALES_ORDER   → pages/Orders.jsx       baca `?id=` → buka OrderTimelineDrawer
// WORK_ORDER, QUALITY_CONTROL, LOW_STOCK, MATERIAL_REQUEST, DELIVERY_ISSUE
// BELUM — halaman tujuannya (Bengkel/Gudang/Armada) tidak punya mekanisme
// "buka satu objek" sama sekali saat ini (bukan cuma belum baca query param,
// UI detail-per-itemnya sendiri belum ada). Klik notifikasi tipe itu akan
// mendarat di papan/daftar workspace-nya — perbaikan yang nyata dibanding
// sebelumnya (semua ke Sales Inbox), tapi belum "buka objek yang benar".
// Parameternya tetap disertakan di URL supaya begitu detail view-nya
// dibangun, tinggal ditambah pembaca `useSearchParams()` sama seperti dua
// yang sudah ada di atas — jangan sampai kejujuran catatan ini kadaluarsa
// begitu itu dikerjakan, PERBARUI daftar di atas.
export const NOTIF_TYPES = {
  SALES_MESSAGE:    { workspace: "growth",    label: "Pesan baru",     path: (id) => `/inbox?conv=${id}` },
  CUSTOMER:         { workspace: "growth",    label: "Pelanggan",      path: (id) => `/customers?id=${id}` },
  SALES_ORDER:      { workspace: "growth",    label: "Order",          path: (id) => `/orders?id=${id}` },
  WORK_ORDER:       { workspace: "bengkel",   label: "Work order",     path: (id) => `/bengkel?unit=${id}` },
  QUALITY_CONTROL:  { workspace: "bengkel",   label: "Quality control",path: (id) => `/bengkel?qc=${id}` },
  LOW_STOCK:        { workspace: "warehouse", label: "Stok menipis",   path: (id) => `/gudang?material=${id}` },
  MATERIAL_REQUEST: { workspace: "warehouse", label: "Permintaan material", path: (id) => `/gudang?request=${id}` },
  DELIVERY_ISSUE:   { workspace: "armada",    label: "Pengiriman",     path: (id) => `/armada?job=${id}` },
  SYSTEM:           { workspace: "system",    label: "Sistem",         path: () => `/notifications` },
};

export const NOTIF_PRIORITIES = ["critical", "high", "normal"];

/**
 * Tujuan sebuah notifikasi. `targetUrl` eksplisit menang atas peta tipe —
 * itu jalan keluar untuk notifikasi yang tujuannya tidak mengikuti pola.
 */
export function buildTargetUrl(notif) {
  if (notif.targetUrl) return notif.targetUrl;
  const tipe = NOTIF_TYPES[notif.type];
  if (!tipe) return "/notifications";
  return tipe.path(notif.refId);
}

export function workspaceOf(notif) {
  return notif.workspace || NOTIF_TYPES[notif.type]?.workspace || "system";
}

// ── Pengelompokan waktu (ketentuan #8) ───────────────────────────────────
// "New" = belum dibaca DAN masih baru (≤60 menit). Sengaja bukan sekadar
// "belum dibaca": notifikasi seminggu lalu yang belum dibuka bukan hal baru,
// dan menaruhnya di puncak setiap hari membuat kelompok "New" tidak berarti.
export function groupNotifications(list, now = Date.now()) {
  const SATU_JAM = 60 * 60 * 1000;
  const awalHariIni = new Date(now); awalHariIni.setHours(0, 0, 0, 0);

  const groups = { new: [], today: [], earlier: [] };
  for (const n of list) {
    const t = new Date(n.createdAt).getTime();
    if (!n.isRead && now - t <= SATU_JAM) groups.new.push(n);
    else if (t >= awalHariIni.getTime()) groups.today.push(n);
    else groups.earlier.push(n);
  }
  return groups;
}

export const GROUP_LABELS = { new: "Baru", today: "Hari ini", earlier: "Sebelumnya" };

/** Waktu relatif ringkas — sama gaya dengan yang dipakai Inbox. */
export function relativeTime(iso, now = Date.now()) {
  const detik = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (detik < 60) return "baru saja";
  const menit = Math.floor(detik / 60);
  if (menit < 60) return `${menit} mnt`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam`;
  const hari = Math.floor(jam / 24);
  if (hari < 7) return `${hari} hr`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}
