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
export default function SessionDistributionWidget() {
  const [period, setPeriod] = useState("today");
  const [rows, setRows]     = useState(null);
  const [error, setError]   = useState(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    api.getSessionDistribution({ period })
      .then(setRows)
      .catch((e) => setError(e.message));
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
          className="dash-session-grid"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
          initial="hidden"
          animate="show"
        >
          {rows.map((r) => (
            <motion.div key={r.session} variants={itemVariants} className="dash-session-card">
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
