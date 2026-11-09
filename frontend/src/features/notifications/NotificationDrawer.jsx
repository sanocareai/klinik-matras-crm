import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { DaftarOverlay } from "@/components/ui/overlay-status.jsx";
import { X, Settings, CheckCheck, Search, BellOff } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useNotificationStore } from "./notificationStore.js";
import { groupNotifications, GROUP_LABELS, buildTargetUrl } from "./notificationTypes.js";
import NotificationItem from "./NotificationItem.jsx";

// Drawer notifikasi dari SISI KANAN.
//
// Dibangun di atas Radix Dialog, BUKAN overlay buatan sendiri: focus trap,
// tutup dengan Escape, aria-modal, dan pengembalian fokus ke lonceng saat
// ditutup semuanya sudah benar dari sononya (ketentuan #5 & #28). Menulis
// ulang itu manual hampir selalu menghasilkan focus trap yang bocor.

const TABS = [
  { key: "all",    label: "Semua" },
  { key: "unread", label: "Belum dibaca" },
  { key: "action", label: "Perlu tindakan" },
];

export default function NotificationDrawer() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [cari, setCari] = useState("");

  const drawerOpen    = useNotificationStore((s) => s.drawerOpen);
  const closeDrawer   = useNotificationStore((s) => s.closeDrawer);
  const notifications = useNotificationStore((s) => s.notifications);
  const markAsRead    = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);

  const unread = notifications.filter((n) => !n.isRead).length;
  const perluTindakan = notifications.filter((n) => n.actionRequired).length;
  const jumlahTab = { all: notifications.length, unread, action: perluTindakan };

  // Redesain Apple (10 Nov 2026): kolom cari di drawer — saring judul/isi notifikasi (sama dengan halaman /notifications).
  const terfilter = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return notifications.filter((n) => {
      if (tab === "unread" && n.isRead) return false;
      if (tab === "action" && !n.actionRequired) return false;
      if (q && !`${n.title} ${n.message || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notifications, tab, cari]);
  const groups = groupNotifications(terfilter);

  // Klik item = tandai dibaca + buka tujuannya (#15). Tujuannya dihitung
  // per-tipe (#17), BUKAN selalu /inbox seperti perilaku lonceng yang lama.
  function activate(notif) {
    markAsRead(notif.id);
    closeDrawer();
    navigate(buildTargetUrl(notif));
  }

  return (
    <Dialog.Root open={drawerOpen} onOpenChange={(o) => (o ? null : closeDrawer())}>
      <Dialog.Portal>
        {/* Overlay — klik di sini menutup (perilaku bawaan Radix) */}
        <Dialog.Overlay className="nt-latar fixed inset-0 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />

        <Dialog.Content
          aria-label="Notifikasi"
          className={cn(
            // Panel melayang gaya Apple (sudut 24px, kaca) di desktop; layar penuh di HP (#3, #4) — lihat styles/sanss-cari.css.
            "nt-panel fixed z-[201] flex flex-col outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
          )}
        >
          {/* ── Kepala (#6) ────────────────────────────────────────────── */}
          <div className="nt-kepala">
            <div className="nt-kepala-baris">
              <div className="min-w-0">
                <Dialog.Title className="nt-judul-besar">Notifikasi</Dialog.Title>
                <Dialog.Description className="nt-subjudul">
                  {unread > 0 ? `${unread > 99 ? "99+" : unread} belum dibaca` : "Semua sudah dibaca"}
                </Dialog.Description>
              </div>
              <div className="nt-aksi">
                <button
                  type="button"
                  onClick={markAllAsRead}
                  disabled={unread === 0}
                  title="Tandai semua sudah dibaca"
                  aria-label="Tandai semua sudah dibaca"
                  className="nt-bulat"
                >
                  <CheckCheck size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => { closeDrawer(); navigate("/pengaturan"); }}
                  title="Pengaturan notifikasi"
                  aria-label="Pengaturan notifikasi"
                  className="nt-bulat"
                >
                  <Settings size={16} />
                </button>
                <Dialog.Close aria-label="Tutup notifikasi" className="nt-bulat">
                  <X size={16} />
                </Dialog.Close>
              </div>
            </div>

            <label className="nt-cari">
              <Search size={15} aria-hidden />
              <input
                type="search"
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Cari notifikasi"
                aria-label="Cari notifikasi"
              />
            </label>

            {/* ── Segmen (#7) — role=tablist ── */}
            <div role="tablist" aria-label="Saring notifikasi" className="nt-segmen">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  data-aktif={tab === t.key ? "true" : "false"}
                  onClick={() => setTab(t.key)}
                  className="nt-segmen-btn"
                >
                  {t.label}
                  {jumlahTab[t.key] > 0 && <span className="nt-segmen-n">{jumlahTab[t.key] > 99 ? "99+" : jumlahTab[t.key]}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* ── Daftar, dikelompokkan (#8) ─────────────────────────────── */}
          <div className="nt-daftar">
            {terfilter.length === 0 ? (
              <div className="nt-kosong">
                <span className="nt-kosong-ubin" aria-hidden><BellOff size={22} /></span>
                <p className="nt-kosong-judul">{cari.trim() ? "Tidak ada yang cocok" : "Tidak ada notifikasi"}</p>
                <p className="nt-kosong-sub">
                  {cari.trim() ? `Tidak ada notifikasi berisi “${cari.trim()}”.`
                  : tab === "unread" ? "Semua notifikasi sudah dibaca."
                  : tab === "action" ? "Tidak ada yang menunggu tindakan."
                  : "Notifikasi dari semua workspace akan muncul di sini."}
                </p>
              </div>
            ) : (
              ["new", "today", "earlier"].map((g) =>
                groups[g].length === 0 ? null : (
                  <section key={g} className="nt-grup">
                    <h3 className="nt-grup-judul">{GROUP_LABELS[g]}</h3>
                    <div className="nt-kartu">
                      {groups[g].map((n) => (
                        <NotificationItem key={n.id} notif={n} onActivate={activate} compact />
                      ))}
                    </div>
                  </section>
                )
              )
            )}
          </div>

          {/* ── Kaki (#18, #19) ─────────────────────────────────────── */}
          <div className="nt-kaki">
            <button
              type="button"
              onClick={() => { closeDrawer(); navigate("/notifications"); }}
              className="nt-kapsul"
            >
              Lihat semua notifikasi
            </button>
          </div>
          <DaftarOverlay />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
