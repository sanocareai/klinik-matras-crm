import React, { useState } from "react";
import { Users, ShoppingCart, Wallet, Target } from "lucide-react";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { formatTanggalIndo, formatRupiahShort } from "../utils/format.js";
import { makeRange } from "../lib/dateRange.js";
import { useDashboardData } from "../features/dashboard/hooks/useDashboardData.js";
import StatCard from "@/components/ui/stat-card.jsx";
import RevenueOverview from "../features/dashboard/components/RevenueOverview.jsx";
import PipelineFunnelCard from "../features/dashboard/components/PipelineFunnelCard.jsx";
import TopRepsCard from "../features/dashboard/components/TopRepsCard.jsx";
import TaskQueueCard from "../features/dashboard/components/TaskQueueCard.jsx";
import HotLeadsCard from "../features/dashboard/components/HotLeadsCard.jsx";
import LeadsDetailModal from "../features/dashboard/components/LeadsDetailModal.jsx";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ═══ DASHBOARD (DS v2.1) ══════════════════════════════════════════════════
// Tata letak mengikuti pola referensi:
//   header sapaan + date picker
//   → 4 kartu KPI (baris penuh)
//   → Ringkasan Penjualan (kartu lebar penuh, angka + area chart)
//   → 2 kolom: Corong Pipeline | Sales Terbaik
//   → 2 kolom: Perlu Ditindak  | Lead Panas
//
// KEDALAMAN UBIN NAIK BERURUTAN di baris KPI (1→2→3→4). Itu yang memberi
// "gradasi biru terang→gelap" yang diminta: satu keluarga warna, tapi barisnya
// tidak terlihat rata/monoton. Angka & delta tetap yang membawa informasi.
export default function Dashboard({ user }) {
  const [range, setRange] = useState(() => makeRange("last_30_days"));
  const [leadsModal, setLeadsModal] = useState(null);
  const d = useDashboardData(range);

  const ov = d.overview.data;
  const konversi = ov && ov.totalCustomers > 0
    ? Math.round((ov.customersWithOrders / ov.totalCustomers) * 100)
    : 0;
  const userName = user?.name?.split(" ")[0] || "Anda";

  return (
    <PageContainer>
      <PageHeader
        title={`Halo, ${userName} 👋`}
        subtitle={`Ringkasan bisnis Anda · ${formatTanggalIndo()}`}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <PageBody>
        {/* ── KPI ── gradasi kedalaman 1→4 di satu baris */}
        <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            label="New Leads" icon={Users} depth={1}
            value={(ov?.newCustomers ?? 0).toLocaleString("id-ID")}
            delta={ov?.growthCustomers}
            onClick={() => setLeadsModal({ date: todayStr(), session: "all" })}
          />
          <StatCard
            label="Total Orders" icon={ShoppingCart} depth={2}
            value={(ov?.totalOrders ?? 0).toLocaleString("id-ID")}
            delta={ov?.growthOrders}
          />
          <StatCard
            label="Revenue" icon={Wallet} depth={3}
            value={formatRupiahShort(ov?.totalOrderValue ?? 0)}
            delta={ov?.growthOrderValue}
          />
          <StatCard
            label="Conversion" icon={Target} depth={4}
            value={`${konversi}%`}
            deltaSuffix="pelanggan yang order"
          />
        </section>

        {/* ── Ringkasan penjualan (lebar penuh) ── */}
        {/* RevenueOverview mengambil deretnya SENDIRI (harian) + punya
            pemilih periode sendiri — lihat komponennya. */}
        <RevenueOverview />

        {/* ── Dua kolom: corong + leaderboard ── */}
        {/* Keduanya SELF-FETCH dengan periode sendiri (PeriodMenu) —
            lihat komponennya. Tidak lagi menerima data/loading dari sini. */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PipelineFunnelCard />
          <TopRepsCard />
        </section>

        {/* ── Dua kolom: antrean tindakan + lead panas ── */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TaskQueueCard
            items={d.followUps.data?.items}
            loading={d.followUps.isLoading}
            error={d.followUps.isError}
          />
          <HotLeadsCard
            items={d.hotLeads.data?.items}
            loading={d.hotLeads.isLoading}
            error={d.hotLeads.isError}
          />
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
