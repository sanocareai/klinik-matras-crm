import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function KpiCard({ label, value, sub, color = "blue", Icon, growth }) {
  return (
    <div className={`kpi-card kpi-${color}`}>
      {Icon && (
        <div className="kpi-icon-circle">
          <Icon size={20} color="white" />
        </div>
      )}
      <div className="kpi-body">
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          {sub && <div className="kpi-sub">{sub}</div>}
          {growth !== undefined && growth !== null && (
            <span className={growth > 0 ? "growth-up" : growth < 0 ? "growth-down" : "growth-zero"}>
              {growth > 0 ? <TrendingUp size={12} /> : growth < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
              {" "}{Math.abs(growth)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
