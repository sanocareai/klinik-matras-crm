import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import {
  DELIVERY_KPI, JOB_STATUS_CHART, DELIVERY_JOBS, VEHICLE_ALERTS, RECENT_ACTIVITY,
  buildIssuePriority, buildFleetAvailability,
} from "@/features/armada/data/deliveryMock.js";
import DeliveryKpiRow from "@/features/armada/components/DeliveryKpiRow.jsx";
import JobStatusChart from "@/features/armada/components/JobStatusChart.jsx";
import TodayJobsTable from "@/features/armada/components/TodayJobsTable.jsx";
import IssuePriorityList from "@/features/armada/components/IssuePriorityList.jsx";
import FleetAvailability from "@/features/armada/components/FleetAvailability.jsx";
import RecentActivity from "@/features/armada/components/RecentActivity.jsx";

// Dashboard Delivery & Fulfillment — Tahap 1.
//
// ⚠️ SELURUH ANGKA DI HALAMAN INI DATA CONTOH. Tiap widget membawa badge
// "Contoh" (features/armada/components/MockBadge.jsx). Data operasional ASLI
// modul ini ada di /armada/jobs, yang memakai backend nyata dan TIDAK
// disentuh Tahap 1.
//
// TIDAK ADA hero banner yang mengulang judul "Delivery & Fulfillment" —
// judulnya sudah ada di PageHeader dan di breadcrumb topbar. Ringkasan
// operasionalnya diambil alih baris KPI, yang membawa informasi sungguhan
// alih-alih mengulang nama halaman.

const HARI_INI = "2026-08-02";

export default function ArmadaDashboard() {
  const navigate = useNavigate();
  const [tanggal, setTanggal] = useState(HARI_INI);

  // Turunan, bukan konstanta terpisah — supaya tidak pernah berbeda dari
  // daftar job/kendaraan yang jadi sumbernya.
  const jobsHariIni = useMemo(
    () => DELIVERY_JOBS.filter((j) => j.scheduledDate === tanggal),
    [tanggal]
  );
  const issues = useMemo(() => buildIssuePriority(jobsHariIni), [jobsHariIni]);
  const fleet = useMemo(() => buildFleetAvailability(), []);

  return (
    <PageContainer>
      <PageHeader
        title="Delivery &amp; Fulfillment"
        subtitle="Kelola jadwal, penugasan, rute, dan penyelesaian job pengiriman."
        actions={
          <>
            <label className="sr-only" htmlFor="tanggal-delivery">Tanggal</label>
            <input
              id="tanggal-delivery"
              type="date"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
              className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none transition-colors focus:border-accent"
            />
            <Button size="sm" onClick={() => navigate("/armada/jobs")}>
              <Plus size={14} /> Buat Job
            </Button>
          </>
        }
      />

      <PageBody>
        <DeliveryKpiRow items={DELIVERY_KPI} />

        {/* Overview + panel pendukung. Di bawah lg menumpuk satu kolom. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
          <JobStatusChart data={JOB_STATUS_CHART} />
          <IssuePriorityList issues={issues} vehicleAlerts={VEHICLE_ALERTS} />
        </div>

        <TodayJobsTable jobs={jobsHariIni} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FleetAvailability data={fleet} />
          <RecentActivity items={RECENT_ACTIVITY} />
        </div>
      </PageBody>
    </PageContainer>
  );
}
