import React from "react";
import { motion } from "framer-motion";

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1 },
  },
};

// Grid KPI responsif: 4 kolom desktop, 2 tablet, 1 mobile (breakpoint di CSS
// .dash-metric-grid). Membungkus children dengan motion container supaya
// stagger cascade dari MetricCard jalan otomatis tanpa tiap card atur delay
// sendiri-sendiri.
export default function DashboardLayout({ children }) {
  return (
    <motion.div
      className="dash-metric-grid"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}
