import React, { useEffect, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { api } from "../api.js";
import KpiCard from "../components/KpiCard.jsx";

const SOURCE_LABELS = {
  ADS: "Iklan",
  INSTAGRAM: "Instagram",
  WEBSITE: "Website",
  WHATSAPP_DIRECT: "WhatsApp langsung",
  REFERRAL: "Referral",
  OTHER: "Belum diisi",
};

const PIE_COLORS = ["#2563eb", "#d6336c", "#f59e0b", "#16a34a", "#7c3aed", "#6b7280"];

function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}

export default function Dashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getAnalyticsOverview().then(setData);
  }, []);

  if (!data) return <div className="page-loading">Memuat dashboard...</div>;

  const sourceData = data.leadSourceBreakdown.map((s) => ({
    name: SOURCE_LABELS[s.leadSource] || s.leadSource,
    value: s.count,
  }));

  return (
    <div className="dashboard-page">
      <h1>Dashboard</h1>

      <div className="kpi-grid">
        <KpiCard label="Total pelanggan" value={data.totalCustomers} color="purple" />
        <KpiCard label="Total order" value={data.totalOrders} color="blue" />
        <KpiCard label="Total nilai order" value={formatRupiah(data.totalOrderValue)} color="pink" />
        <KpiCard label="Terjual bulan ini" value={formatRupiah(data.thisMonthValue)} color="green" />
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3>Traffic bulanan (percakapan baru)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.monthlyTraffic}>
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {data.monthlyTraffic.length === 0 && (
            <p className="muted">Belum ada data percakapan untuk ditampilkan.</p>
          )}
        </div>

        <div className="chart-card">
          <h3>Sumber traffic</h3>
          {sourceData.length === 0 ? (
            <p className="muted">Belum ada data sumber pelanggan.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={sourceData} dataKey="value" nameKey="name" outerRadius={90} label>
                  {sourceData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
