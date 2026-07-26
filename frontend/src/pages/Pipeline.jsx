import React, { useEffect, useState, useRef } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import { formatRupiah, STAGE_LABELS } from "../utils/format.js";
import { useCountUp } from "../hooks/useCountUp.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import { cn } from "@/lib/utils.js";
import KanbanCard, { STAGE_DOT, isStale } from "@/features/pipeline/components/KanbanCard.jsx";
// Lazy — lihat catatan yang sama di Customers.jsx: exportToExcel() (xlsx +
// file-saver, ~285KB) dynamic-import di titik pakai, bukan static di atas.

const STAGES = ["NEW", "QUALIFIED", "QUOTED", "BOOKED", "SCHEDULED", "COMPLETED", "PAID", "REVIEWED"];

// Total nilai per kolom, dengan count-up saat berubah. Dipisah jadi komponen
// sendiri karena useCountUp adalah hook — tidak boleh dipanggil di dalam
// loop .map() di komponen induk. Count-up ini yang membuat "dampak uang"
// dari memindahkan deal terlihat (sano-animation-guidelines.md §3.6).
function ColumnTotal({ value }) {
  const animated = useCountUp(value);
  return (
    <span className="text-[13px] font-bold tabular-nums text-ink">
      {formatRupiah(Math.round(animated))}
    </span>
  );
}

export default function Pipeline() {
  const [board, setBoard]     = useState({});
  const [users, setUsers]     = useState([]);
  const [filterSales, setFilterSales] = useState("");
  const [loading, setLoading] = useState(true);
  const [moveMenu, setMoveMenu] = useState(null); // ID card yang menu-nya terbuka
  const dragState = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  // ID card yang SEDANG digeser — hanya untuk visual "lift" (state `dragging`
  // di KanbanCard). Sengaja state terpisah dari dragState (yang tetap ref
  // supaya tidak memicu re-render tiap dragover).
  const [draggingId, setDraggingId] = useState(null);

  async function loadBoard() {
    setLoading(true);
    try {
      const [b, u] = await Promise.all([api.getPipelineBoard(), api.getUsers()]);
      setBoard(b);
      setUsers(u);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBoard(); }, []);

  function getCards(stage) {
    const cards = board[stage] || [];
    if (!filterSales) return cards;
    return cards.filter((c) => c.assignedSalesId === filterSales);
  }

  function stageTotal(stage) {
    return getCards(stage).reduce((s, c) => s + (c.totalValue || 0), 0);
  }

  // Pindah card ke stage baru — dipakai oleh drag-and-drop maupun tombol mobile.
  // Optimistic update, rollback lewat loadBoard() kalau API gagal.
  async function moveCardToStage(card, fromStage, toStage) {
    if (fromStage === toStage) return;
    setBoard((prev) => {
      const next = { ...prev };
      next[fromStage] = (prev[fromStage] || []).filter((c) => c.id !== card.id);
      next[toStage]   = [{ ...card }, ...(prev[toStage] || [])];
      return next;
    });
    try {
      // Ini juga yang mencatat baris pipeline_transitions di backend (satu
      // transaksi) dan memicu webhook lead.won kalau toStage = PAID —
      // lihat routes/customers.js PATCH /:id.
      await api.updateCustomer(card.id, { pipelineStage: toStage });
    } catch (err) {
      alert("Gagal memindah pelanggan: " + err.message);
      loadBoard();
    }
  }

  // Drag & drop handlers (desktop) — HTML5 native, logika TIDAK diubah di
  // Wave 5A, hanya ditambah set/clear draggingId untuk efek visual.
  function onDragStart(e, card, fromStage) {
    dragState.current = { card, fromStage };
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(card.id);
  }

  // Selalu jalan di akhir drag, termasuk kalau dilepas di luar kolom / ditekan
  // Esc — jadi ini titik pembersihan yang bisa diandalkan untuk state visual.
  function onDragEnd() {
    setDraggingId(null);
    setDragOver(null);
  }

  function onDragOver(e, stage) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(stage);
  }

  async function onDrop(e, toStage) {
    e.preventDefault();
    setDragOver(null);
    setDraggingId(null);
    if (!dragState.current) return;
    const { card, fromStage } = dragState.current;
    dragState.current = null;
    await moveCardToStage(card, fromStage, toStage);
  }

  async function handleExport() {
    const { exportToExcel } = await import("../utils/export.js");
    const rows = [];
    STAGES.forEach((stage) => {
      getCards(stage).forEach((c) => {
        rows.push({
          Nama: c.name || c.phone || "",
          Telepon: c.phone || "",
          Stage: STAGE_LABELS[stage] || stage,
          "Total Nilai Order": formatRupiah(c.totalValue || 0),
          "Hari di Stage": c.daysSince || 0,
          Mandek: isStale(c, stage) ? "Ya" : "",
          "Sales Person": c.assignedSales?.name || "",
        });
      });
    });
    exportToExcel(rows, "pipeline-" + new Date().toISOString().slice(0, 10));
  }

  const totalMandek = STAGES.reduce(
    (n, s) => n + getCards(s).filter((c) => isStale(c, s)).length, 0
  );

  return (
    <PageContainer>
      <PageHeader
        title="Pipeline"
        subtitle={
          totalMandek > 0
            ? `${totalMandek} deal mandek ${"≥"}14 hari — perlu ditindak`
            : "Geser kartu antar stage untuk memperbarui status"
        }
        actions={
          <>
            <select
              className="h-8 rounded-lg bg-surface px-2 text-[13px] text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              value={filterSales}
              onChange={(e) => setFilterSales(e.target.value)}
              aria-label="Filter sales person"
            >
              <option value="">Semua Sales</option>
              {users.filter((u) => u.role === "SALES" || u.role === "ADMIN").map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={loadBoard} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExport}>
              <Download size={14} /> Export
            </Button>
          </>
        }
      />

      <PageBody>
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STAGES.map((s) => (
              <div key={s} className="flex flex-col gap-2 rounded-2xl bg-inset/80 p-2.5">
                <Skeleton className="h-5 w-24" />
                {[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
            ))}
          </div>
        ) : (
          // Mobile: kolom menumpuk (1 kolom) — sengaja BUKAN scroll horizontal,
          // karena drag & drop tidak jalan di touch dan tombol "Pindah ke" di
          // kartu sudah menangani perpindahan di HP.
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STAGES.map((stage) => {
              const cards = getCards(stage);
              return (
                <div
                  key={stage}
                  onDragOver={(e) => onDragOver(e, stage)}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => onDrop(e, stage)}
                  className={cn(
                    "flex flex-col rounded-2xl  p-2.5 transition-colors duration-150",
                    dragOver === stage
                      ? "bg-accentbg/70"
                      : "border-transparent bg-inset/80"
                  )}
                >
                  <div className="flex items-center gap-2 px-0.5">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STAGE_DOT[stage] || "bg-ink3")} />
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink2">
                      {STAGE_LABELS[stage] || stage}
                    </span>
                    <span className="rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-ink2">
                      {cards.length}
                    </span>
                  </div>
                  <div className="mb-2 mt-1 px-0.5">
                    <ColumnTotal value={stageTotal(stage)} />
                  </div>

                  <div className="flex flex-1 flex-col gap-2">
                    {cards.map((card) => (
                      <KanbanCard
                        key={card.id}
                        card={card}
                        stage={stage}
                        stages={STAGES}
                        dragging={draggingId === card.id}
                        menuOpen={moveMenu === card.id}
                        onDragStart={(e) => onDragStart(e, card, stage)}
                        onDragEnd={onDragEnd}
                        onToggleMenu={() => setMoveMenu(moveMenu === card.id ? null : card.id)}
                        onMoveToStage={(s) => { setMoveMenu(null); moveCardToStage(card, stage, s); }}
                      />
                    ))}
                    {cards.length === 0 && (
                      <div className="flex min-h-16 items-center justify-center rounded-xl border-dashed border-line px-2 py-3 text-center text-[11px] text-ink3">
                        Kosong
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageBody>
    </PageContainer>
  );
}
