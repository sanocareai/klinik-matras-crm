import React from "react";
import { MoreVertical, AlertTriangle } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu.jsx";
import { formatRupiah, STAGE_LABELS, ORDER_STATUS_LABELS } from "@/utils/format.js";
import { cn } from "@/lib/utils.js";

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

// Titik warna per stage — mengikuti STAGE_VARIANT di utils/format.js
// (sano-color-system.md §4). Sengaja class statis, bukan dibangun runtime,
// supaya ke-scan Tailwind. Restrukturisasi 24 Agustus 2026 (7→4 stage):
// QUALIFIED/QUOTED/BOOKED/SCHEDULED digabung PROSPECT (accent), COMPLETED/
// REVIEWED digabung TRANSACTION (green). SPAM baru — abu-abu netral.
// Revisi 26 Agustus 2026: REVIEWED dikembalikan (definisi baru — review
// publik, bukan lagi ditinjau internal) — tetap hijau (sama seperti
// TRANSACTION, cuma sudah lebih maju), konsisten dengan STAGE_VARIANT.
export const STAGE_DOT = {
  NEW:         "bg-orange",
  PROSPECT:    "bg-accent",
  TRANSACTION: "bg-green",
  REVIEWED:    "bg-green",
  SPAM:        "bg-inset",
};

// Glow kaca per stage (D-101, 5 September 2026) — owner: kartu Kanban abu-
// abu/gelap "kurang match sama biru kita" di halaman Pipeline yang sudah
// jadi kaca (D-099), minta glass effect + glow warna per stage (New=oranye,
// Prospek=biru, dst). BUKAN warna baru — SATU-SATUNYA sumber, dipetakan
// PERSIS dari STAGE_DOT di atas (var CSS yang SUDAH ada: --orange/--accent/
// --green), cuma diperluas dari "titik kecil" jadi glow di tepi kartu.
// Dipakai sebagai custom property `--kb-accent` inline per kartu (pola sama
// dengan --dh-bar di Delivery Hub) — CSS aktualnya di delivery-dark.css/
// -light.css §.dh-kanban-card, no-op di luar .glass-division.
const STAGE_GLOW = {
  NEW:         "var(--orange)",
  PROSPECT:    "var(--accent)",
  TRANSACTION: "var(--green)",
  REVIEWED:    "var(--green)",
  SPAM:        "var(--ink3)",
};

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
      // --kb-accent (D-101) — dibaca CSS .dh-kanban-card (delivery-dark.css/
      // -light.css), no-op di luar .glass-division/mode lama.
      style={{ "--kb-accent": STAGE_GLOW[stage] || STAGE_GLOW.SPAM }}
      className={cn(
        "dh-kanban-card group relative rounded-xl  bg-surface p-2.5 shadow-card",
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
          <p className="truncate text-[13px] font-semibold leading-tight text-ink">{nama}</p>
          {card.phone && (
            <p className="mt-0.5 truncate text-[11px] tabular-nums text-ink3">{card.phone}</p>
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
                <span className={cn("h-2 w-2 shrink-0 rounded-full", STAGE_DOT[s] || "bg-ink3")} />
                {STAGE_LABELS[s] || s}
              </MenuItem>
            ))}
          </Menu>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold tabular-nums text-ink">
          {formatRupiah(card.totalValue)}
        </span>
        <span className={cn("text-[11px] tabular-nums", stale ? "font-semibold text-orange" : "text-ink3")}>
          {card.daysSince}h lalu
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
          {card.latestOrderStatus && (
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

      {(card.assignedSales || card.unreadCount > 0) && (
        <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-1.5">
          <span className="min-w-0 truncate text-[11px] text-ink3">
            {card.assignedSales?.name || "Belum ada sales"}
          </span>
          {card.unreadCount > 0 && (
            <span
              className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white"
              title={`${card.unreadCount} pesan belum dibaca`}
            >
              {card.unreadCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
