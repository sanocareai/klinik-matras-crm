import React, { useEffect, useState, useRef } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";
import { formatRupiah, STAGE_LABELS } from "../utils/format.js";
import { exportToExcel } from "../utils/export.js";

const STAGES = ["LEAD", "QUALIFIED", "QUOTED", "WON", "LOST"];
const DOT_CLASS = { LEAD: "dot-lead", QUALIFIED: "dot-qualified", QUOTED: "dot-quoted", WON: "dot-won", LOST: "dot-lost" };

export default function Pipeline() {
  const [board, setBoard]     = useState({});
  const [users, setUsers]     = useState([]);
  const [filterSales, setFilterSales] = useState("");
  const [loading, setLoading] = useState(true);
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

  // Drag & drop handlers
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
    if (fromStage === toStage) return;

    // Optimistic update
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
      loadBoard(); // revert
    }
  }

  function handleExport() {
    const rows = [];
    STAGES.forEach((stage) => {
      getCards(stage).forEach((c) => {
        rows.push({
          Nama: c.name || c.phone || "",
          Telepon: c.phone || "",
          Stage: STAGE_LABELS[stage] || stage,
          "Nilai Total": c.totalValue || 0,
          "Hari di Stage": c.daysSince || 0,
          Sales: c.assignedSales?.name || "",
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
                      <div style={{ minWidth: 0 }}>
                        <div className="kanban-card-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {card.name || card.phone || "—"}
                        </div>
                        {card.phone && <div className="kanban-card-phone">{card.phone}</div>}
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
