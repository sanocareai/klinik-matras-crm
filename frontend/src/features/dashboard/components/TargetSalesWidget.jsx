import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import { api } from "../../../api.js";
import Avatar from "../../../components/Avatar.jsx";
import { formatRupiahShort } from "../../../utils/format.js";

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

// Reuse GET /analytics/sales-performance — endpoint yang SAMA dipakai
// Laporan.jsx (per-sales totalOrderValue + target SalesTarget bulan itu),
// supaya angka konsisten dengan yang tampil di Laporan, bukan duplikat logic.
export default function TargetSalesWidget() {
  const [rows, setRows]     = useState(null);
  const [error, setError]   = useState(null);

  useEffect(() => {
    const now = new Date();
    api.getSalesPerformance({ year: now.getFullYear(), month: now.getMonth() + 1 })
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  const totals = useMemo(() => {
    if (!rows) return null;
    const totalTarget   = rows.reduce((sum, r) => sum + (r.target || 0), 0);
    const totalAchieved = rows.reduce((sum, r) => sum + (r.totalOrderValue || 0), 0);
    const percent = totalTarget > 0 ? Math.round((totalAchieved / totalTarget) * 100) : 0;
    return { totalTarget, totalAchieved, percent };
  }, [rows]);

  // On-track = pencapaian sudah >= proporsi hari berjalan bulan ini (kalau
  // baru tanggal 10 dari 30 hari, wajar baru capai ~33%, bukan tanda bahaya).
  const dayProgress = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.round((now.getDate() / daysInMonth) * 100);
  }, []);

  if (error) {
    return (
      <div className="dash-chart-card" style={{ marginBottom: 20 }}>
        <h3>Target Sales Tim</h3>
        <p style={{ fontSize: 12.5, color: "var(--danger)", margin: 0 }}>Gagal memuat data: {error}</p>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="target-sales-section" style={{ marginBottom: 20 }}>
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    );
  }

  const hasNoTarget = totals.totalTarget === 0;
  const onTrack = totals.percent >= dayProgress;

  return (
    <div className="target-sales-section" style={{ marginBottom: 20 }}>
      <h2 className="target-sales-heading">Target Sales Tim</h2>

      {hasNoTarget ? (
        <div className="dash-chart-card target-sales-empty">
          <TrendingUp size={28} color="var(--text-muted)" />
          <p className="target-sales-empty-text">
            Target bulan ini belum di-set untuk Sales Person manapun.
          </p>
          <Link to="/pengaturan?section=target-sales" className="btn btn-primary btn-sm">
            Atur Target Sales
          </Link>
        </div>
      ) : (
        <motion.div
          className="target-sales-grid"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
          initial="hidden"
          animate="show"
        >
          {/* Card besar — total tim */}
          <motion.div variants={itemVariants} className="dash-chart-card target-sales-total-card">
            <div className="target-sales-total-head">
              <span>Total Target Tim Bulan Ini</span>
              <span className={`target-ontrack-badge ${onTrack ? "onTrack" : "behind"}`}>
                {onTrack ? "On Track" : "Behind"}
              </span>
            </div>
            <div className="target-sales-total-numbers">
              <span className="target-sales-achieved">{formatRupiahShort(totals.totalAchieved)}</span>
              <span className="target-sales-of">/ {formatRupiahShort(totals.totalTarget)}</span>
            </div>
            <div className="target-sales-track target-sales-track-lg">
              <motion.div
                className={`target-sales-fill ${onTrack ? "onTrack" : "behind"}`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(totals.percent, 100)}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
            <span className="target-sales-percent">{totals.percent}% tercapai</span>
          </motion.div>

          {/* Grid kanan — per sales person */}
          <div className="target-sales-people-grid">
            {rows.map((r) => {
              const pct = r.target > 0 ? Math.round((r.totalOrderValue / r.target) * 100) : 0;
              const personOnTrack = pct >= dayProgress;
              return (
                <motion.div key={r.userId} variants={itemVariants} className="target-sales-person-card">
                  <div className="target-sales-person-head">
                    <Avatar name={r.name} size="sm" />
                    <span className="target-sales-person-name">{r.name}</span>
                  </div>
                  {r.target > 0 ? (
                    <>
                      <div className="target-sales-track">
                        <motion.div
                          className={`target-sales-fill ${personOnTrack ? "onTrack" : "behind"}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(pct, 100)}%` }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                        />
                      </div>
                      <div className="target-sales-person-numbers">
                        <span>{formatRupiahShort(r.totalOrderValue)} / {formatRupiahShort(r.target)}</span>
                        <span className="target-sales-person-pct">{pct}%</span>
                      </div>
                    </>
                  ) : (
                    <p className="target-sales-person-notarget">Belum ada target</p>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
