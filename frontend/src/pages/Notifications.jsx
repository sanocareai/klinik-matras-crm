import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";
import { useNotificationStore } from "@/features/notifications/notificationStore.js";
import {
  NOTIF_WORKSPACES, NOTIF_TYPES, NOTIF_PRIORITIES,
  groupNotifications, GROUP_LABELS, buildTargetUrl, workspaceOf,
} from "@/features/notifications/notificationTypes.js";
import NotificationItem from "@/features/notifications/NotificationItem.jsx";

// Notification Center — /notifications.
//
// Versi lengkap dari drawer: isi & perilaku itemnya SAMA (memakai
// NotificationItem yang sama), yang ditambahkan cuma alat penyaring untuk
// menelusuri riwayat. Drawer untuk "apa yang baru", halaman ini untuk
// "cari notifikasi yang mana".

const TABS = [
  { key: "all",    label: "Semua" },
  { key: "unread", label: "Belum dibaca" },
  { key: "action", label: "Perlu tindakan" },
];

const DATE_FILTERS = [
  { key: "all",   label: "Semua waktu" },
  { key: "today", label: "Hari ini" },
  { key: "7d",    label: "7 hari" },
  { key: "30d",   label: "30 hari" },
];

const selectClass =
  "h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none transition-colors focus:border-accent";

export default function Notifications() {
  const navigate = useNavigate();
  const notifications = useNotificationStore((s) => s.notifications);
  const markAsRead    = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);

  const [tab, setTab]             = useState("all");
  const [cari, setCari]           = useState("");
  const [workspace, setWorkspace] = useState("all");
  const [tipe, setTipe]           = useState("all");
  const [tanggal, setTanggal]     = useState("all");
  const [prioritas, setPrioritas] = useState("all");

  const hasil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    const now = Date.now();
    const awalHariIni = new Date(now); awalHariIni.setHours(0, 0, 0, 0);

    return notifications.filter((n) => {
      if (tab === "unread" && n.isRead) return false;
      if (tab === "action" && !n.actionRequired) return false;
      if (workspace !== "all" && workspaceOf(n) !== workspace) return false;
      if (tipe !== "all" && n.type !== tipe) return false;
      if (prioritas !== "all" && n.priority !== prioritas) return false;

      if (tanggal !== "all") {
        const t = new Date(n.createdAt).getTime();
        if (tanggal === "today" && t < awalHariIni.getTime()) return false;
        if (tanggal === "7d" && now - t > 7 * 864e5) return false;
        if (tanggal === "30d" && now - t > 30 * 864e5) return false;
      }

      // Pencarian menyapu judul DAN isi pesan — pencarian judul saja terasa
      // rusak begitu user mengetik kata yang jelas ia lihat di badan teks.
      if (q && !`${n.title} ${n.message}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notifications, tab, cari, workspace, tipe, tanggal, prioritas]);

  const groups = groupNotifications(hasil);
  const unread = notifications.filter((n) => !n.isRead).length;

  function activate(notif) {
    markAsRead(notif.id);
    navigate(buildTargetUrl(notif));
  }

  return (
    <PageContainer>
      <PageHeader
        title="Notifikasi"
        subtitle="Kejadian dari semua workspace. Chat pelanggan ada di Inbox."
        actions={
          <button
            type="button"
            onClick={markAllAsRead}
            disabled={unread === 0}
            className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint disabled:opacity-40"
          >
            <CheckCheck size={14} /> Tandai semua dibaca
          </button>
        }
      />

      {/* ── Penyaring (#20) ─────────────────────────────────────────────── */}
      <div className="nt-saring mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari judul atau isi notifikasi…"
          aria-label="Cari notifikasi"
          className="h-9 min-w-[200px] flex-1 rounded-btn border border-border bg-surface px-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-accent"
        />

        <select value={workspace} onChange={(e) => setWorkspace(e.target.value)} aria-label="Filter workspace" className={selectClass}>
          <option value="all">Semua workspace</option>
          {Object.entries(NOTIF_WORKSPACES).map(([k, w]) => (
            <option key={k} value={k}>{w.label}</option>
          ))}
        </select>

        <select value={tipe} onChange={(e) => setTipe(e.target.value)} aria-label="Filter tipe" className={selectClass}>
          <option value="all">Semua tipe</option>
          {Object.entries(NOTIF_TYPES).map(([k, t]) => (
            <option key={k} value={k}>{t.label}</option>
          ))}
        </select>

        <select value={tanggal} onChange={(e) => setTanggal(e.target.value)} aria-label="Filter tanggal" className={selectClass}>
          {DATE_FILTERS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>

        <select value={prioritas} onChange={(e) => setPrioritas(e.target.value)} aria-label="Filter prioritas" className={selectClass}>
          <option value="all">Semua prioritas</option>
          {NOTIF_PRIORITIES.map((p) => (
            <option key={p} value={p}>{p === "critical" ? "Kritis" : p === "high" ? "Tinggi" : "Normal"}</option>
          ))}
        </select>
      </div>

      {/* ── Tab ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Saring notifikasi" className="nt-segmen nt-segmen-halaman">
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
          </button>
        ))}
      </div>
        <span className="ml-auto self-center text-[12px] text-ink3">
          {hasil.length} notifikasi
        </span>
      </div>

      {/* Redesain Apple (10 Nov 2026): kelompok = kartu membulat terpisah (gaya daftar iOS), baris sama dengan drawer. */}
      <div className="nt-halaman">
        {hasil.length === 0 ? (
          <div className="nt-kartu">
            <EmptyState
              icon={Bell}
              title="Tidak ada notifikasi yang cocok"
              description="Coba longgarkan penyaring atau kata kunci pencarian."
            />
          </div>
        ) : (
          ["new", "today", "earlier"].map((g) =>
            groups[g].length === 0 ? null : (
              <section key={g} className="nt-grup">
                <h3 className="nt-grup-judul">{GROUP_LABELS[g]}</h3>
                <div className="nt-kartu">
                  {groups[g].map((n) => (
                    <NotificationItem key={n.id} notif={n} onActivate={activate} />
                  ))}
                </div>
              </section>
            )
          )
        )}
      </div>
    </PageContainer>
  );
}
