import React from "react";
import { MoreVertical, AlertTriangle, Clock } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu.jsx";
import { formatRupiah, STAGE_LABELS, ORDER_STATUS_LABELS, stageClass } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";
import { OrderMilestoneBadge } from "@/components/OrderMilestoneBadge.jsx";

// Nada warna status order — hijau hanya untuk yang benar-benar selesai
// (DELIVERED), oranye untuk yang masih menunggu tindakan, merah untuk batal.
// Sisanya accent (sedang berjalan) mengikuti aturan satu accent DS v2.
const ORDER_STATUS_TONE = {
  PENDING:    "bg-orangebg text-orange",
  PICKUP:     "bg-accentbg text-accent",
  PROCESSING: "bg-accentbg text-accent",
  READY:      "bg-accentbg text-accent",
  DELIVERED:  "bg-greenbg text-green",
  CANCELLED:  "bg-redbg text-red",
};

// Warna tahap: SATU sumber di styles/stage-palette.css (token --stage-*), dipilih lewat stageClass(stage) di utils/format.js.
// STAGE_DOT / STAGE_GLOW lama (oranye/biru/hijau) dihapus — Fase Pipeline, 31 Okt 2026. Dipakai sebagai kelas "stage-dot" + stageClass().

// Ambang "stale" — deal yang tidak disentuh selama ini dianggap mandek.
// 14 hari dipilih supaya tidak berisik: siklus jual kasur di sini berhari-hari
// (lihat laporan Kecepatan Pipeline), jadi 7 hari akan menandai deal normal.
// TRANSACTION/REVIEWED/SPAM DIKECUALIKAN: TRANSACTION & REVIEWED adalah
// stage AKHIR "berhasil" — "lama tidak disentuh" di sana artinya sudah
// selesai (REVIEWED bahkan sudah lebih maju lagi), bukan mandek. SPAM juga
// bukan kandidat "mandek" — itu memang sengaja dibiarkan, bukan lead yang
// lupa ditindaklanjuti.
const STALE_DAYS = 14;
export function isStale(card, stage) {
  if (stage === "TRANSACTION" || stage === "REVIEWED" || stage === "SPAM") return false;
  return (card?.daysSince || 0) >= STALE_DAYS;
}

// Kartu deal di kolom Pipeline. Spec: sano-components.md §B.3 "Kanban Card"
// — nama · nilai (tabular-nums) · titik stage · avatar sales · meta, kompak.
//
// Drag & drop TETAP HTML5 native (bukan library) — persis seperti sebelumnya.
// Yang berubah hanya tampilan + state `dragging`.
export default function KanbanCard({
  card, stage, stages, dragging,
  onDragStart, onDragEnd, onMoveToStage, onOpenChat,
}) {
  const stale = isStale(card, stage);
  const nama  = card.name || card.phone || "—";

  // Klik kartu → buka chat customer. Sebelumnya kartu sama sekali tidak bisa
  // diklik: sales harus pindah ke Inbox lalu mencari nama customer manual.
  // Dibuat role="button" + keyboard-accessible, TAPI tetap `draggable` — klik
  // dan drag hidup bersama karena browser hanya memicu click kalau pointer
  // tidak bergeser (drag membatalkan click secara alami).
  function handleClick(e) {
    // Jangan buka chat kalau yang diklik kontrol di dalam kartu (menu pindah
    // stage) — tanpa ini menu tidak bisa dipakai lagi.
    if (e.target.closest("[data-no-chat]")) return;
    // Menu "Pindah ke" di-portal ke <body>: event klik item menu tetap menggelembung lewat pohon React ke kartu ini (bukan DOM),
    // sehingga memilih tahap ikut membuka chat. Abaikan klik yang targetnya di luar DOM kartu.
    if (!e.currentTarget.contains(e.target)) return;
    onOpenChat?.();
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      // onDragEnd WAJIB: kalau card dilepas DI LUAR kolom mana pun, onDrop
      // tidak pernah jalan — tanpa ini state "lift" tidak pernah dibersihkan
      // dan kartu tampak terangkat/transparan selamanya sampai reload.
      onDragEnd={onDragEnd}
      onClick={onOpenChat ? handleClick : undefined}
      onKeyDown={onOpenChat ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(e); }
      } : undefined}
      role={onOpenChat ? "button" : undefined}
      tabIndex={onOpenChat ? 0 : undefined}
      aria-label={onOpenChat ? `Buka chat ${nama}` : undefined}
      // --kb-accent/--dh-bar (D-101, diperkuat setelah owner lapor "gaada
      // perubahan" — glow versi pertama arahnya ke BAWAH dengan spread
      // negatif, jadi ketutup kartu berikutnya di kolom yang sama; border-
      // nya juga cuma 28-32% opacity, nyaris tak kelihatan). --dh-bar dibaca
      // `.dh-bar-left::after` yang SUDAH terbukti kelihatan (dipakai
      // Delivery Hub) — garis aksen kiri 3px + glow SENDIRI (posisi tetap,
      // tidak ketutup kartu lain). --kb-accent dibaca .dh-kanban-card untuk
      // border+halo tambahan (sekarang ambient, bukan drop-shadow ke bawah).
      className={cn(
        "crm-pipe-kartu group relative rounded-xl bg-surface p-3 shadow-card",
        // Lift saat digeser: shadow-popover + scale ~1.02 dalam 150ms, dan slot asal
        // diredam (opacity) — sano-animation-guidelines.md §3.6.
        "transition-[box-shadow,transform,opacity] duration-150 ease-out",
        "hover:shadow-popover active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        dragging
          ? "scale-[1.02] opacity-40 shadow-popover"
          : "cursor-grab",
        stale && !dragging && ""
      )}
    >
      <div className="flex items-start gap-2">
        <Avatar name={nama} src={card.profilePictureUrl} size="sm" />

        <div className="min-w-0 flex-1">
          <p className="crm-pipe-nama truncate text-[14px] font-bold leading-tight text-ink" title={nama}>{nama}</p>
          {card.phone && (
            <p className="crm-pipe-nomor mt-0.5 truncate text-[12px] tabular-nums text-ink3">{card.phone}</p>
          )}
        </div>

        {/* Tombol pindah stage — WAJIB ADA: drag & drop tidak bekerja di touch,
            jadi ini satu-satunya cara memindah deal dari HP.
            data-no-chat: klik di area ini tidak boleh ikut membuka chat.
            Menu Radix (bukan lagi popover rakitan sendiri) — Portal ke
            document.body jadi tidak pernah kepotong kartu/kolom tetangga,
            dan animasinya konsisten dgn dropdown filter lain di seluruh app.
            Uncontrolled (Radix urus buka/tutup sendiri) — sebelumnya parent
            (Pipeline.jsx) melacak `moveMenu` biar cuma 1 yang terbuka
            sekaligus, tapi Radix sudah otomatis menutup menu lain saat
            trigger lain diklik (dianggap "klik di luar"), jadi state itu
            tidak diperlukan lagi. */}
        <div data-no-chat>
          <Menu
            trigger={
              <button
                className="rounded-md p-1 text-ink3 transition-colors duration-150 hover:bg-hovertint hover:text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                title="Pindah stage"
                aria-label={`Pindah ${nama} ke stage lain`}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical size={14} />
              </button>
            }
          >
            <MenuLabel>Pindah ke</MenuLabel>
            {stages.filter((s) => s !== stage).map((s) => (
              <MenuItem key={s} onSelect={() => onMoveToStage(s)}>
                <span className={cn("stage-dot h-2 w-2 shrink-0 rounded-full", stageClass(s))} />
                {STAGE_LABELS[s] || s}
              </MenuItem>
            ))}
          </Menu>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="crm-pipe-nilai text-[15px] font-bold tabular-nums text-ink">
          {formatRupiah(card.totalValue)}
        </span>
      </div>

      {/* Peringatan stale — informasinya JUGA tersampaikan lewat teks, bukan
          hanya warna (aturan aksesibilitas sano-animation-guidelines.md §1.5). */}
      {stale && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-orange">
          <AlertTriangle size={11} className="shrink-0" />
          Mandek {card.daysSince} hari — perlu ditindak
        </p>
      )}

      {/* Status order TERBARU. Stage penjualan dan tahap PENGERJAAN adalah dua
          hal berbeda: customer bisa sudah "Paid" sementara kasurnya masih
          "Diproses". Tanpa ini board hanya bercerita separuh, dan sales harus
          buka profil satu per satu untuk tahu pekerjaannya sampai mana. */}
      {(card.latestOrderStatus || card.orderCount > 0) && (
        <div className="mt-1.5 flex items-center gap-1.5">
          {card.latestOrderMilestone && !card.latestOrderMilestone.legacy && <OrderMilestoneBadge milestone={card.latestOrderMilestone} showAhead={false} />}
          {card.latestOrderStatus && !(card.latestOrderMilestone && !card.latestOrderMilestone.legacy) && (
            <span className={cn(
              "rounded-chip px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              ORDER_STATUS_TONE[card.latestOrderStatus] || "bg-inset text-ink2"
            )}>
              {ORDER_STATUS_LABELS[card.latestOrderStatus] || card.latestOrderStatus}
            </span>
          )}
          {card.orderCount > 1 && (
            <span className="text-[10px] text-ink3">{card.orderCount} order</span>
          )}
        </div>
      )}

      <div className="crm-pipe-kaki mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink2" title={card.assignedSales?.name || "Belum ada sales"}>
          {card.assignedSales && <Avatar name={card.assignedSales.name} src={card.assignedSales.avatarUrl} size="sm" className="crm-pipe-sales h-5 w-5 text-[9px]" />}
          <span className="min-w-0 truncate">{card.assignedSales?.name || "Belum ada sales"}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn("inline-flex items-center gap-1 text-[12px] tabular-nums", stale ? "font-semibold text-orange" : "text-ink3")} title={card.daysSince + " hari sejak aktivitas terakhir"}>
            <Clock size={12} className="shrink-0" aria-hidden /> {card.daysSince} hari
          </span>
          {card.unreadCount > 0 && (
            <span
              className="crm-pipe-unread shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white"
              title={`${card.unreadCount} pesan belum dibaca`}
            >
              {card.unreadCount}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
