import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { STAGE_LABELS, PIPELINE_STAGES, formatRupiahShort } from "../../../utils/format.js";

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

// Konsolidasi 24 Agustus 2026 (restrukturisasi pipeline 7→4): diambil dari
// PIPELINE_STAGES, SPAM dikecualikan — widget ini menampilkan "deal" per
// stage, chat junk bukan deal (sama alasannya dengan PipelineFunnelCard.jsx).
const MAIN_STAGES = PIPELINE_STAGES.map((p) => p.value).filter((s) => s !== "SPAM");

export default function PipelineWidget({ funnel, loading }) {
  const byStage = useMemo(() => {
    const map = {};
    (funnel || []).forEach((f) => { map[f.stage] = f; });
    return map;
  }, [funnel]);

  const mainRows = MAIN_STAGES.map((stage) => byStage[stage] || { stage, count: 0, value: 0 });
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
    </motion.div>
  );
}
