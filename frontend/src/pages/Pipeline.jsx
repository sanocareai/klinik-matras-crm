import React, { useEffect, useState, useRef } from "react";
import { Download, RefreshCw, MoreVertical } from "lucide-react";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";
import { formatRupiah, STAGE_LABELS } from "../utils/format.js";
// Lazy — lihat catatan yang sama di Customers.jsx: exportToExcel() (xlsx +
// file-saver, ~285KB) dynamic-import di titik pakai, bukan static di atas.

const STAGES = ["LEAD", "QUALIFIED", "QUOTED", "WON", "LOST"];
const DOT_CLASS = { LEAD: "dot-lead", QUALIFIED: "dot-qualified", QUOTED: "dot-quoted", WON: "dot-won", LOST: "dot-lost" };

export default function Pipeline() {
  const [board, setBoard]     = useState({});
  const [users, setUsers]     = useState([]);
  const [filterSales, setFilterSales] = useState("");
  const [loading, setLoading] = useState(true);
  const [moveMenu, setMoveMenu] = useState(null); // ID card yang menu-nya terbuka
  const dragState = useRef(null);
  const [dragOver, setDragOver] = useState(null);

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

  // Pindah card ke stage baru — dipakai oleh drag-and-drop maupun tombol mobile
  async function moveCardToStage(card, fromStage, toStage) {
    if (fromStage === toStage) return;
    setBoard((prev) => {
      const next = { ...prev };
      next[fromStage] = (prev[fromStage] || []).filter((c) => c.id !== card.id);
      next[toStage]   = [{ ...card }, ...(prev[toStage] || [])];
      return next;
    });
    try {
      await api.updateCustomer(card.id, { pipelineStage: toStage });
    } catch (err) {
      alert("Gagal memindah pelanggan: " + err.message);
      loadBoard();
    }
  }

  // Drag & drop handlers (desktop)
  function onDragStart(e, card, fromStage) {
    dragState.current = { card, fromStage };
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e, stage) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(stage);
  }

  async function onDrop(e, toStage) {
    e.preventDefault();
    setDragOver(null);
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
          "Sales Person": c.assignedSales?.name || "",
        });
      });
    });
    exportToExcel(rows, "pipeline-" + new Date().toISOString().slice(0, 10));
  }

  if (loading) return <div className="page-loading">Memuat pipeline...</div>;

  return (
    <div className="page kanban-page">
      {/* Toolbar */}
      <div className="kanban-toolbar">
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, flex: 1 }}>Pipeline</h1>
        <select
          className="filter-select"
          value={filterSales}
          onChange={(e) => setFilterSales(e.target.value)}
          style={{ minWidth: 160 }}
        >
          <option value="">Semua Sales</option>
          {users.filter((u) => u.role === "SALES" || u.role === "ADMIN").map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={loadBoard}>
          <RefreshCw size={14} /> Refresh
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleExport}>
          <Download size={14} /> Export
        </button>
      </div>

      {/* Kanban Board */}
      <div className="kanban-board">
        {STAGES.map((stage) => {
          const cards = getCards(stage);
          return (
            <div
              key={stage}
              className={`kanban-col ${dragOver === stage ? "drag-over" : ""}`}
              onDragOver={(e) => onDragOver(e, stage)}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDrop(e, stage)}
            >
              <div className="kanban-col-header">
                <div className={`kanban-col-dot ${DOT_CLASS[stage]}`} />
                <span className="kanban-col-name">{STAGE_LABELS[stage] || stage}</span>
                <span className="kanban-col-count">{cards.length}</span>
              </div>
              <div className="kanban-col-value">{formatRupiah(stageTotal(stage))}</div>

              <div className="kanban-cards">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="kanban-card"
                    draggable
                    onDragStart={(e) => onDragStart(e, card, stage)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <Avatar name={card.name || card.phone || "?"} size="sm" />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="kanban-card-name">
                          {card.name || card.phone || "—"}
                        </div>
                        {card.phone && <div className="kanban-card-phone">{card.phone}</div>}
                      </div>
                      {/* Tombol pindah stage — sangat berguna di mobile karena drag-and-drop tidak bekerja di touch */}
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <button
                          className="kanban-card-menu-btn"
                          title="Pindah stage"
                          onClick={(e) => { e.stopPropagation(); setMoveMenu(moveMenu === card.id ? null : card.id); }}
                        >
                          <MoreVertical size={14} />
                        </button>
                        {moveMenu === card.id && (
                          <>
                            <div className="kanban-menu-backdrop" onClick={() => setMoveMenu(null)} />
                            <div className="kanban-stage-picker">
                              <div className="kanban-stage-picker-title">Pindah ke:</div>
                              {STAGES.filter(s => s !== stage).map(s => (
                                <button key={s} className="kanban-stage-option"
                                  onClick={() => { setMoveMenu(null); moveCardToStage(card, stage, s); }}>
                                  <div className={`kanban-col-dot ${DOT_CLASS[s]}`} />
                                  {STAGE_LABELS[s] || s}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="kanban-card-meta">
                      <span className="kanban-card-value">{formatRupiah(card.totalValue)}</span>
                      <span className="kanban-card-days">{card.daysSince}h lalu</span>
                    </div>
                    {card.assignedSales && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                        👤 {card.assignedSales.name}
                      </div>
                    )}
                  </div>
                ))}
                {cards.length === 0 && (
                  <div style={{ padding: "12px 8px", color: "var(--text-muted)", fontSize: 12.5, textAlign: "center" }}>
                    Drag card ke sini
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
