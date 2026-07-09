import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { SOURCE_LABELS } from "../../../utils/format.js";

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

// Palet monokromatik (gradasi slate) + 1 aksen biru untuk irisan terbesar —
// sesuai spec "Palette monokromatik + 1 aksen".
const MONO_PALETTE = ["#2563EB", "#94A3B8", "#CBD5E1", "#64748B", "#E2E8F0", "#475569"];

export default function ChartWidget({ data, loading }) {
  const sorted = useMemo(() => {
    return [...(data || [])]
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((d, i) => ({
        name: SOURCE_LABELS[d.leadSource] || d.leadSource,
        value: d.count,
        color: MONO_PALETTE[i % MONO_PALETTE.length],
      }));
  }, [data]);

  const total = sorted.reduce((sum, d) => sum + d.value, 0);

  if (loading) {
    return (
      <div className="dash-chart-card">
        <h3>Leads by Source</h3>
        <div className="skeleton" style={{ height: 220, borderRadius: 12 }} />
      </div>
    );
  }

  return (
    <motion.div variants={itemVariants} className="dash-chart-card">
      <h3>Leads by Source</h3>

      {total === 0 ? (
        <p className="dash-chart-empty">Belum ada data lead.</p>
      ) : (
        <>
          <div className="dash-donut-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={sorted}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={64}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="none"
                >
                  {sorted.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} lead`, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="dash-donut-center">
              <span className="dash-donut-total">{total.toLocaleString("id-ID")}</span>
              <span className="dash-donut-total-label">Leads</span>
            </div>
          </div>

          <div className="dash-donut-legend">
            {sorted.map((entry) => (
              <div key={entry.name} className="dash-donut-legend-item">
                <span className="dash-donut-legend-dot" style={{ background: entry.color }} />
                <span className="dash-donut-legend-label">{entry.name}</span>
                <span className="dash-donut-legend-value">{entry.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}
