import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Settings, CheckCheck, Inbox as InboxIcon } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { EmptyState } from "@/components/ui/empty-state.jsx";
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

  const drawerOpen    = useNotificationStore((s) => s.drawerOpen);
  const closeDrawer   = useNotificationStore((s) => s.closeDrawer);
  const notifications = useNotificationStore((s) => s.notifications);
  const markAsRead    = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);

  const unread = notifications.filter((n) => !n.isRead).length;

  const terfilter = notifications.filter((n) => {
    if (tab === "unread") return !n.isRead;
    if (tab === "action") return n.actionRequired;
    return true;
  });
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
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />

        <Dialog.Content
          aria-label="Notifikasi"
          className={cn(
            "fixed right-0 top-0 z-[201] flex h-full flex-col bg-surface shadow-2xl outline-none",
            // 420px di desktop, layar penuh di mobile (#3, #4)
            "w-full sm:w-[420px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
          )}
        >
          {/* ── Header (#6) ────────────────────────────────────────────── */}
          <div className="shrink-0 border-b border-line px-4 pb-3 pt-4">
            <div className="flex items-center gap-2">
              <Dialog.Title className="text-[15px] font-bold text-ink">Notifikasi</Dialog.Title>
              {unread > 0 && (
                <span className="rounded-chip bg-accentbg px-1.5 py-0.5 text-[10px] font-bold text-accent">
                  {unread > 99 ? "99+" : unread} belum dibaca
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={markAllAsRead}
                  disabled={unread === 0}
                  title="Tandai semua sudah dibaca"
                  aria-label="Tandai semua sudah dibaca"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <CheckCheck size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => { closeDrawer(); navigate("/pengaturan"); }}
                  title="Pengaturan notifikasi"
                  aria-label="Pengaturan notifikasi"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
                >
                  <Settings size={16} />
                </button>
                <Dialog.Close
                  aria-label="Tutup notifikasi"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
                >
                  <X size={16} />
                </Dialog.Close>
              </div>
            </div>

            {/* ── Tab (#7) — role=tablist supaya panah kiri/kanan bekerja ── */}
            <div role="tablist" aria-label="Saring notifikasi" className="mt-3 flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "rounded-chip px-2.5 py-1 text-[12px] font-semibold transition-colors",
                    tab === t.key
                      ? "bg-accentbg text-accent"
                      : "text-ink3 hover:bg-hovertint hover:text-ink2"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Daftar, dikelompokkan (#8) ─────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {terfilter.length === 0 ? (
              <EmptyState
                icon={InboxIcon}
                title="Tidak ada notifikasi"
                description={
                  tab === "unread" ? "Semua notifikasi sudah dibaca."
                  : tab === "action" ? "Tidak ada yang menunggu tindakan."
                  : "Notifikasi dari semua workspace akan muncul di sini."
                }
              />
            ) : (
              ["new", "today", "earlier"].map((g) =>
                groups[g].length === 0 ? null : (
                  <section key={g}>
                    <h3 className="sticky top-0 z-[1] bg-inset px-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-ink3">
                      {GROUP_LABELS[g]}
                    </h3>
                    {groups[g].map((n) => (
                      <NotificationItem key={n.id} notif={n} onActivate={activate} compact />
                    ))}
                  </section>
                )
              )
            )}
          </div>

          {/* ── Footer (#18, #19) ─────────────────────────────────────── */}
          <div className="shrink-0 border-t border-line p-3">
            <button
              type="button"
              onClick={() => { closeDrawer(); navigate("/notifications"); }}
              className="w-full rounded-btn bg-inset py-2 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint hover:text-ink"
            >
              Lihat semua notifikasi
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
