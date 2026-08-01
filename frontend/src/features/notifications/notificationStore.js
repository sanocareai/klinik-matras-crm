import { create } from "zustand";
import { workspaceOf } from "./notificationTypes.js";

// State notifikasi global. Zustand dipilih karena SUDAH dipakai di repo ini
// (features/inbox/stores/*) — bukan dependency baru, dan tiga konsumen
// (lonceng di Topbar, drawer, halaman /notifications) perlu membaca angka
// unread yang SAMA tanpa mengoper prop lewat Layout.

// ── DATA DUMMY (ketentuan #29) ───────────────────────────────────────────
// ⚠️ SEMENTARA, DAN HARUS DIGANTI. Belum ada tabel/endpoint notifikasi di
// backend; ini bentuk datanya supaya UI bisa dibangun & dinilai lebih dulu.
// Begitu backend ada, ganti `seed()` dengan fetch — bentuk objeknya sengaja
// sudah menyerupai baris tabel, jadi komponennya tidak perlu berubah.
//
// Sengaja mencakup KELIMA workspace, bukan cuma Sales CRM: seluruh gunanya
// refactor ini adalah membuktikan lonceng bukan lagi pintu kedua ke Inbox.
function seed() {
  const now = Date.now();
  const menit = (m) => new Date(now - m * 60 * 1000).toISOString();
  const jam = (h) => menit(h * 60);

  return [
    { id: "n1", type: "SALES_MESSAGE", refId: "cmsae7z8y1xqglq8mp7jd2gvk",
      title: "Pesan baru dari Natalia Mimi",
      message: "Mayan… besar juga yah — menanyakan ukuran King 180x200.",
      createdAt: menit(4), isRead: false, actionRequired: false, priority: "normal" },

    { id: "n2", type: "LOW_STOCK", refId: "MAT-FM-HR32",
      title: "Foam HR 32 di bawah minimum",
      message: "Sisa 14 lembar, titik pesan ulang 20. Produksi minggu ini butuh 26.",
      createdAt: menit(18), isRead: false, actionRequired: true, priority: "critical" },

    { id: "n3", type: "QUALITY_CONTROL", refId: "RES-01082026-004-U1",
      title: "Uji Berat Badan gagal — terlalu empuk",
      message: "Unit RES-01082026-004-U1 dikembalikan ke modul lapisan (rework).",
      createdAt: menit(42), isRead: false, actionRequired: true, priority: "high" },

    { id: "n4", type: "DELIVERY_ISSUE", refId: "DO-260802-011",
      title: "Pengiriman gagal — pelanggan tidak di tempat",
      message: "DO-260802-011 (Depok). Driver menunggu 20 menit, perlu dijadwal ulang.",
      createdAt: jam(2), isRead: false, actionRequired: true, priority: "high" },

    // ⚠️ refId di sini SENGAJA id database production ASLI (cmsa6iyr92y0njjl4jpnq53zw
    // = order RES-01082026-006), bukan orderNumber yang enak dibaca manusia —
    // Orders.jsx mencocokkan ke `Order.id`, bukan `Order.orderNumber` (lihat
    // efek `?id=` di sana). refId human-readable akan membuat notifikasi ini
    // TIDAK PERNAH menemukan order-nya, dan klik terasa "tidak ada respon"
    // lagi — persis bug yang baru diperbaiki, cuma pindah tempat.
    { id: "n5", type: "SALES_ORDER", refId: "cmsa6iyr92y0njjl4jpnq53zw",
      title: "Order RES-01082026-006 dikonfirmasi",
      message: "Ganti kain — menunggu dijadwalkan pickup.",
      createdAt: jam(3), isRead: false, actionRequired: false, priority: "normal" },

    { id: "n6", type: "WORK_ORDER", refId: "RES-01082026-001-U1",
      title: "Unit masuk tahap Jahit Corner",
      message: "RES-01082026-001-U1 — perkiraan selesai hari ini.",
      createdAt: jam(5), isRead: true, actionRequired: false, priority: "normal" },

    { id: "n7", type: "MATERIAL_REQUEST", refId: "MR-260802-003",
      title: "Permintaan material menunggu persetujuan",
      message: "Bengkel meminta 8 lembar Rebonded D50 untuk antrean besok.",
      createdAt: jam(7), isRead: false, actionRequired: true, priority: "normal" },

    // refId id Customer ASLI (sama alasannya dengan n5 di atas) — Customers.jsx
    // mencocokkan ke `Customer.id`, bukan nama.
    { id: "n8", type: "CUSTOMER", refId: "cmsap22d405e4k2zjxbeadbc3",
      title: "Pelanggan menandai komplain",
      message: "Dede Arsha — kasur terasa turun lagi setelah 2 minggu.",
      createdAt: jam(26), isRead: true, actionRequired: true, priority: "critical" },

    { id: "n9", type: "SYSTEM", refId: null,
      title: "Backup harian berhasil",
      message: "Database ter-backup ke Google Drive pukul 01.51 WIB.",
      createdAt: jam(30), isRead: true, actionRequired: false, priority: "normal" },

    { id: "n10", type: "SALES_MESSAGE", refId: "conv-lama-1",
      title: "Pesan belum dibalas 3 jam",
      message: "Maya R. menanyakan jadwal survei.",
      createdAt: jam(52), isRead: true, actionRequired: false, priority: "normal" },
  ].map((n) => ({ ...n, workspace: workspaceOf(n) }));
}

export const useNotificationStore = create((set, get) => ({
  notifications: seed(),
  drawerOpen: false,

  openDrawer:  () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),

  // Menandai dibaca bersifat idempoten — dipanggil dari klik item, dan klik
  // item juga menavigasi; kalau tidak idempoten, kembali ke drawer lalu
  // mengklik lagi akan menghitung ulang.
  markAsRead: (id) => set((s) => ({
    notifications: s.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
  })),

  markAllAsRead: () => set((s) => ({
    notifications: s.notifications.map((n) => (n.isRead ? n : { ...n, isRead: true })),
  })),

  /**
   * Jumlah belum dibaca LINTAS WORKSPACE (ketentuan #21).
   * SENGAJA tidak menyentuh unread Inbox Sales CRM: itu angka yang berbeda,
   * punya badge sendiri di menu Inbox (ketentuan #22).
   */
  unreadCount: () => get().notifications.filter((n) => !n.isRead).length,

  actionRequiredCount: () =>
    get().notifications.filter((n) => n.actionRequired && !n.isRead).length,
}));

/** Aturan badge #23: 0 disembunyikan, 1–99 apa adanya, >99 jadi "99+". */
export function badgeText(count) {
  if (!count || count < 1) return null;
  return count > 99 ? "99+" : String(count);
}
