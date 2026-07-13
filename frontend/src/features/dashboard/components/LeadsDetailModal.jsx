import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ChevronRight } from "lucide-react";
import { api } from "../../../api.js";
import { formatTanggalIndo, formatWaktu, formatPhoneDisplay } from "../../../utils/format.js";

const SESSION_OPTIONS = [
  { key: "all",  label: "Semua" },
  { key: "CS-1", label: "CS-1" },
  { key: "CS-2", label: "CS-2" },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Drill-down widget "Distribusi Lead per Sesi" & card "Total Leads" —
// GET /dashboard/leads-detail, read-only. Klik row → buka conversation
// customer itu langsung di Inbox (pola navigate("/inbox?conv=ID") yang
// sama dipakai ToastNotif.jsx).
export default function LeadsDetailModal({ open, initialDate, initialSession = "all", onClose }) {
  const navigate = useNavigate();
  const [date, setDate]       = useState(initialDate || todayStr());
  const [session, setSession] = useState(initialSession);
  const [rows, setRows]       = useState(null);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!open) return;
    setDate(initialDate || todayStr());
    setSession(initialSession || "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError(null);
    api.getLeadsDetail({ date, session })
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [open, date, session]);

  if (!open) return null;

  function handleRowClick(row) {
    if (!row.conversationId) return;
    onClose();
    navigate(`/inbox?conv=${row.conversationId}`);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box leads-detail-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Lead — {formatTanggalIndo(new Date(`${date}T00:00:00`))}</h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="leads-detail-controls">
            <input
              type="date"
              className="leads-detail-date-input"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
            />
            <div className="dash-session-period-toggle">
              {SESSION_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`dash-session-period-btn ${session === opt.key ? "active" : ""}`}
                  onClick={() => setSession(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p style={{ fontSize: 12.5, color: "var(--danger)" }}>Gagal memuat data: {error}</p>
          ) : !rows ? (
            <div className="leads-detail-list">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 8 }} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="dash-chart-empty">Tidak ada lead baru di tanggal ini.</p>
          ) : (
            <div className="leads-detail-list">
              {rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="leads-detail-row"
                  onClick={() => handleRowClick(r)}
                  disabled={!r.conversationId}
                >
                  <div className="leads-detail-row-main">
                    <span className="leads-detail-name">{r.name || "Tanpa nama"}</span>
                    <span className="leads-detail-phone">{formatPhoneDisplay(r.phone)}</span>
                  </div>
                  <div className="leads-detail-row-meta">
                    <span className="leads-detail-time">{formatWaktu(r.createdAt)}</span>
                    {r.sessionId && <span className="session-badge">{r.sessionId}</span>}
                    <ChevronRight size={16} color="var(--text-muted)" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
