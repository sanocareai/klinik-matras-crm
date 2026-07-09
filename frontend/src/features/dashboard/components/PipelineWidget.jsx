import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { STAGE_LABELS, formatRupiahShort } from "../../../utils/format.js";

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const MAIN_STAGES = ["LEAD", "QUALIFIED", "QUOTED", "WON"];

export default function PipelineWidget({ funnel, loading }) {
  const byStage = useMemo(() => {
    const map = {};
    (funnel || []).forEach((f) => { map[f.stage] = f; });
    return map;
  }, [funnel]);

  const mainRows = MAIN_STAGES.map((stage) => byStage[stage] || { stage, count: 0, value: 0 });
  const lostRow = byStage.LOST || { stage: "LOST", count: 0, value: 0 };
  const maxCount = Math.max(1, ...mainRows.map((r) => r.count));

  if (loading) {
    return (
      <div className="dash-chart-card">
        <h3>Sales Pipeline</h3>
        <div className="skeleton" style={{ height: 220, borderRadius: 12 }} />
      </div>
    );
  }

  return (
    <motion.div variants={itemVariants} className="dash-chart-card">
      <h3>Sales Pipeline</h3>

      <div className="dash-pipeline-list">
        {mainRows.map((row) => {
          const pct = Math.round((row.count / maxCount) * 100);
          return (
            <div key={row.stage} className="dash-pipeline-row">
              <div className="dash-pipeline-row-top">
                <span className="dash-pipeline-stage">{STAGE_LABELS[row.stage] || row.stage}</span>
                <span className="dash-pipeline-meta">
                  {row.count} deal{row.value > 0 ? ` · ${formatRupiahShort(row.value)}` : ""}
                </span>
              </div>
              <div className="dash-pipeline-track">
                <motion.div
                  className="dash-pipeline-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {lostRow.count > 0 && (
        <div className="dash-pipeline-lost">
          <span>Gagal</span>
          <span>{lostRow.count} deal{lostRow.value > 0 ? ` · ${formatRupiahShort(lostRow.value)}` : ""}</span>
        </div>
      )}
    </motion.div>
  );
}
