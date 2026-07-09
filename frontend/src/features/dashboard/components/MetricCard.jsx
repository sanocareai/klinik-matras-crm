import React from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useCountUp } from "../hooks/useCountUp.js";
import { formatRupiahShort } from "../../../utils/format.js";

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

// format: 'number' | 'money' | 'percent'
export default function MetricCard({ label, value, format = "number", icon: Icon, trend }) {
  const numericValue = typeof value === "number" ? value : 0;
  const animated = useCountUp(numericValue);

  let display;
  if (format === "money") display = formatRupiahShort(animated);
  else if (format === "percent") display = `${animated}%`;
  else display = animated.toLocaleString("id-ID");

  const hasTrend = trend != null && Number.isFinite(trend);
  const trendUp = hasTrend && trend >= 0;

  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ scale: 1.01 }}
      transition={{ duration: 0.15 }}
      className="dash-metric-card"
    >
      <div className="dash-metric-top">
        <span className="dash-metric-label">{label}</span>
        {Icon && (
          <span className="dash-metric-icon">
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className="dash-metric-value">{display}</div>
      {hasTrend && (
        <div className={`dash-metric-trend ${trendUp ? "up" : "down"}`}>
          {trendUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          <span>{trendUp ? "+" : ""}{trend.toFixed(1)}% dari periode sebelumnya</span>
        </div>
      )}
    </motion.div>
  );
}
