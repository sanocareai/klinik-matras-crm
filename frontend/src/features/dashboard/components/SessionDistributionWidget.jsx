import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../../../api.js";

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const PERIOD_OPTIONS = [
  { key: "today", label: "Hari Ini" },
  { key: "week",  label: "7 Hari" },
  { key: "month", label: "Bulan Ini" },
];

// GET /dashboard/session-distribution — read-only, tidak menyentuh
// logic pembuatan/update Customer atau Conversation manapun.
// onCardClick(session) opsional — dipanggil saat card CS-1/CS-2 diklik,
// dipakai Dashboard.jsx untuk buka LeadsDetailModal terfilter sesi itu.
export default function SessionDistributionWidget({ onCardClick }) {
  const [period, setPeriod] = useState("today");
  const [rows, setRows]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  // BUG (fix, glitch): setRows(null) dulu langsung dipanggil tiap ganti
  // period (Hari Ini/7 Hari/Bulan Ini) — card CS-1/CS-2 hilang total ganti
  // skeleton, lalu motion.div re-mount dari nol (stagger animation replay
  // dari awal) begitu data baru datang. Kelihatan seperti "patah" tiap klik
  // toggle padahal cuma ganti filter. Sekarang card LAMA tetap tampil
  // (redup, lihat className loading di JSX) selama fetch baru berjalan.
  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getSessionDistribution({ period })
      .then((data) => { setRows(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [period]);

  return (
    <div className="dash-session-section" style={{ marginBottom: 20 }}>
      <div className="dash-session-header">
        <h2 className="target-sales-heading" style={{ margin: 0 }}>Distribusi Chat CS-1 vs CS-2</h2>
        <div className="dash-session-period-toggle">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`dash-session-period-btn ${period === opt.key ? "active" : ""}`}
              onClick={() => setPeriod(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="dash-chart-card">
          <p style={{ fontSize: 12.5, color: "var(--danger)", margin: 0 }}>Gagal memuat data: {error}</p>
        </div>
      ) : !rows ? (
        <div className="dash-session-grid">
          <div className="skeleton skeleton-card" style={{ height: 110 }} />
          <div className="skeleton skeleton-card" style={{ height: 110 }} />
        </div>
      ) : (
        <motion.div
          className={`dash-session-grid${loading ? " dash-session-grid-loading" : ""}`}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
          initial="hidden"
          animate="show"
        >
          {rows.map((r) => (
            <motion.div
              key={r.session}
              variants={itemVariants}
              className={`dash-session-card${onCardClick ? " dash-session-card-clickable" : ""}`}
              onClick={onCardClick ? () => onCardClick(r.session) : undefined}
              role={onCardClick ? "button" : undefined}
              tabIndex={onCardClick ? 0 : undefined}
            >
              <span className="dash-session-label">{r.session}</span>
              <span className="dash-session-value">{r.newLeads}</span>
              <span className="dash-session-value-caption">Lead Baru</span>
              <span className="dash-session-sub">{r.totalActive} percakapan aktif</span>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
