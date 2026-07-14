import React, { useState } from "react";
import { Users, ShoppingCart, Percent } from "lucide-react";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { getDatePreset, formatTanggalIndo } from "../utils/format.js";
import { useDashboardData } from "../features/dashboard/hooks/useDashboardData.js";
import { BAND2_IS_MOCK } from "../features/dashboard/data/contracts.js";
// Band 1
import MetricCard from "../features/dashboard/components/MetricCard.jsx";
import HeroMetricCard from "../features/dashboard/components/HeroMetricCard.jsx";
import SalesPerformanceStrip from "../features/dashboard/components/SalesPerformanceStrip.jsx";
// Band 2 (Act)
import AIRecommendations from "../features/dashboard/components/AIRecommendations.jsx";
import HotLeads from "../features/dashboard/components/HotLeads.jsx";
import FollowUpTasks from "../features/dashboard/components/FollowUpTasks.jsx";
import TeamHealth from "../features/dashboard/components/TeamHealth.jsx";
// Band 3 (Analyze) — reuse existing + new
import ChartWidget from "../features/dashboard/components/ChartWidget.jsx";
import PipelineWidget from "../features/dashboard/components/PipelineWidget.jsx";
import ConversationAnalytics from "../features/dashboard/components/ConversationAnalytics.jsx";
import RevenueTrend from "../features/dashboard/components/RevenueTrend.jsx";
import LeadsDetailModal from "../features/dashboard/components/LeadsDetailModal.jsx";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Dashboard = command center (Wave 2A). Tiga band: Orient → Act → Analyze.
// Band 1 & 3 pakai data NYATA (/analytics/*), Band 2 pakai kontrak MOCK sampai
// Wave 2B. Tidak menyentuh WAHA/SSE/inbox.
export default function Dashboard({ user }) {
  const [range, setRange] = useState(getDatePreset("30d"));
  const [leadsModal, setLeadsModal] = useState(null);
  const d = useDashboardData(range);

  const ov = d.overview.data;
  const sales = Array.isArray(d.salesPerf.data) ? d.salesPerf.data : [];
  const conversion = ov && ov.totalCustomers > 0
    ? Math.round((ov.customersWithOrders / ov.totalCustomers) * 100)
    : 0;
  const userName = user?.name?.split(" ")[0] || "Anda";

  return (
    <PageContainer>
      <PageHeader
        title={`Halo, ${userName} 👋`}
        subtitle={formatTanggalIndo()}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <PageBody>
        {/* ── BAND 1 — ORIENT: "Apa yang terjadi?" ── */}
        <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <HeroMetricCard
            value={ov?.totalOrderValue || 0}
            trend={ov?.growthOrderValue}
            sparkline={ov?.monthlyRevenue || []}
          />
          <MetricCard
            label="Total Leads"
            value={ov?.totalCustomers || 0}
            icon={Users}
            trend={ov?.growthCustomers}
            onClick={() => setLeadsModal({ date: todayStr(), session: "all" })}
          />
          <MetricCard label="Total Order" value={ov?.totalOrders || 0} icon={ShoppingCart} trend={ov?.growthOrders} />
          <MetricCard label="Conversion Rate" value={conversion} format="percent" icon={Percent} />
        </section>
        <SalesPerformanceStrip data={sales} loading={d.salesPerf.isLoading} />

        {/* ── BAND 2 — ACT: "Apa yang harus saya lakukan?" (unggulan) ── */}
        <section className="flex flex-col gap-4">
          <AIRecommendations
            items={d.recommendations.data?.items || []}
            loading={d.recommendations.isLoading}
            isMock={BAND2_IS_MOCK}
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <HotLeads items={d.hotLeads.data?.items || []} loading={d.hotLeads.isLoading} isMock={BAND2_IS_MOCK} />
            <FollowUpTasks items={d.followUps.data?.items || []} loading={d.followUps.isLoading} isMock={BAND2_IS_MOCK} />
            <TeamHealth data={sales} loading={d.salesPerf.isLoading} />
          </div>
        </section>

        {/* ── BAND 3 — ANALYZE: "Kenapa ini terjadi?" ── */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PipelineWidget funnel={d.funnel.data} loading={d.funnel.isLoading} />
          <ChartWidget data={ov?.leadSourceBreakdown} loading={d.overview.isLoading} />
          <ConversationAnalytics data={d.performance.data} loading={d.performance.isLoading} />
          <RevenueTrend data={ov?.monthlyRevenue || []} loading={d.overview.isLoading} />
        </section>
      </PageBody>

      <LeadsDetailModal
        open={!!leadsModal}
        initialDate={leadsModal?.date}
        initialSession={leadsModal?.session}
        onClose={() => setLeadsModal(null)}
      />
    </PageContainer>
  );
}
