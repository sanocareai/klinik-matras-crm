import React, { useCallback, useEffect, useState } from "react";
import { Users, ShoppingCart, Percent, Wallet } from "lucide-react";
import { api } from "../api.js";
import DateRangePicker from "../components/DateRangePicker.jsx";
import DashboardLayout from "../features/dashboard/components/DashboardLayout.jsx";
import MetricCard from "../features/dashboard/components/MetricCard.jsx";
import ChartWidget from "../features/dashboard/components/ChartWidget.jsx";
import PipelineWidget from "../features/dashboard/components/PipelineWidget.jsx";
import RecentOrdersTable from "../features/dashboard/components/RecentOrdersTable.jsx";
import TargetSalesWidget from "../features/dashboard/components/TargetSalesWidget.jsx";
import { formatTanggalIndo, getDatePreset } from "../utils/format.js";

// Widget gagal fetch sendiri-sendiri — 1 widget error TIDAK memblokir seluruh
// dashboard (beda dari versi lama yang 1 error global bikin halaman kosong).
function WidgetError({ title, message }) {
  return (
    <div className="dash-chart-card">
      {title && <h3>{title}</h3>}
      <p style={{ fontSize: 12.5, color: "var(--danger)", margin: 0 }}>
        Gagal memuat data: {message}
      </p>
    </div>
  );
}

export default function Dashboard({ user }) {
  const [dateRange, setDateRange] = useState(getDatePreset("30d"));
  const [overview, setOverview]   = useState(null);
  const [funnel, setFunnel]       = useState(null);
  const [recentOrders, setRecentOrders] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [errors, setErrors]       = useState({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErrors({});
    const params = { from: dateRange.from, to: dateRange.to };

    const [ov, fn, ro] = await Promise.all([
      api.getAnalyticsOverview(params).catch((e) => { setErrors((p) => ({ ...p, overview: e.message })); return null; }),
      api.getAnalyticsPipelineFunnel().catch((e) => { setErrors((p) => ({ ...p, funnel: e.message })); return null; }),
      api.getRecentOrders({ limit: 8 }).catch((e) => { setErrors((p) => ({ ...p, orders: e.message })); return null; }),
    ]);

    setOverview(ov);
    setFunnel(fn);
    setRecentOrders(ro);
    setLoading(false);
  }, [dateRange.from, dateRange.to]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const userName = user?.name?.split(" ")[0] || "Anda";

  // Conversion Rate = % pelanggan yang sudah pernah order, dari data yang
  // sudah tersedia di /analytics/overview (bukan angka baru/fake).
  const conversionRate = overview && overview.totalCustomers > 0
    ? Math.round((overview.customersWithOrders / overview.totalCustomers) * 100)
    : 0;

  return (
    <div className="dash-page">
      <div className="page-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <div className="page-header-left">
          <h1 className="dash-page-title">Halo, {userName} 👋</h1>
          <p className="dash-page-sub">{formatTanggalIndo()}</p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* KPI row */}
      {loading ? (
        <div className="dash-metric-grid">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton skeleton-card" style={{ height: 104, marginBottom: 0 }} />
          ))}
        </div>
      ) : errors.overview ? (
        <div className="dash-metric-grid">
          <WidgetError title="Metrik" message={errors.overview} />
        </div>
      ) : (
        <DashboardLayout>
          <MetricCard label="Total Leads" value={overview?.totalCustomers || 0} icon={Users} trend={overview?.growthCustomers} />
          <MetricCard label="Total Order" value={overview?.totalOrders || 0} icon={ShoppingCart} trend={overview?.growthOrders} />
          <MetricCard label="Conversion Rate" value={conversionRate} format="percent" icon={Percent} />
          <MetricCard label="Revenue" value={overview?.totalOrderValue || 0} format="money" icon={Wallet} trend={overview?.growthOrderValue} />
        </DashboardLayout>
      )}

      {/* Target Sales Tim — endpoint sales-performance yang sama dipakai Laporan */}
      <TargetSalesWidget />

      {/* Chart + Pipeline + Recent Orders */}
      <div className="dash-charts-grid">
        {errors.overview ? (
          <WidgetError title="Leads by Source" message={errors.overview} />
        ) : (
          <ChartWidget data={overview?.leadSourceBreakdown} loading={loading} />
        )}

        {errors.funnel ? (
          <WidgetError title="Sales Pipeline" message={errors.funnel} />
        ) : (
          <PipelineWidget funnel={funnel} loading={loading} />
        )}

        {errors.orders ? (
          <WidgetError title="Recent Orders" message={errors.orders} />
        ) : (
          <RecentOrdersTable orders={recentOrders} loading={loading} />
        )}
      </div>
    </div>
  );
}
