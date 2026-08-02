import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams } from "@/lib/dateRange.js";
import { KpiRowSkeleton, ChartGridSkeleton } from "@/features/laporan/components/LaporanSkeleton.jsx";
import ChartCard from "@/features/laporan/components/ChartCard.jsx";
import KpiCard from "@/features/laporan/components/KpiCard.jsx";
import BarRow from "@/features/laporan/components/BarRow.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Users } from "lucide-react";
import { JOB_STATUS_REAL, JOB_TYPE_REAL, ACTIVE_STATUSES } from "@/features/armada/jobStatus.js";
import { POD_STATUS } from "@/features/armada/podStatus.js";
import { VEHICLE_STATUS_REAL, ROUTE_STATUS_REAL } from "@/features/armada/vehicleStatus.js";

// Laporan Delivery — Tahap 7. Terakhir dari daftar sidebar Armada.
//
// ⚠️ KONTEKS PENTING: saat halaman ini dibangun, tabel jobs MASIH KOSONG di
// production (0 baris) — sama seperti keadaan saat Vehicle/Route dibangun
// Tahap 3. Setiap chart di bawah akan tampil kosong ("Belum ada data")
// sampai dispatcher benar-benar memakai modul Delivery. Itu keadaan
// sebenarnya, BUKAN placeholder atau data contoh — tidak ada MockBadge di
// halaman ini karena datanya nyata, cuma belum ada isinya.
function toneOf(t) {
  return t === "neutral" ? "muted" : t;
}

function statusBars(counts, map) {
  const max = Math.max(1, ...Object.values(counts));
  return Object.entries(map).map(([key, meta]) => ({
    label: meta.label, value: counts[key] || 0, max, tone: toneOf(meta.tone),
  }));
}

export default function ArmadaDeliveryReport() {
  const [range, setRange] = useState(() => makeRange("last_30_days"));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const params = toApiParams(range);
    const setengahJadi = (!!range.from) !== (!!range.to);
    if (setengahJadi) return;
    setLoading(true);
    setError("");
    api.getDeliveryReportSummary(params)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const byStatusCounts = Object.fromEntries((data?.byStatus || []).map((r) => [r.status, r.count]));
  const byTypeCounts = Object.fromEntries((data?.byType || []).map((r) => [r.type, r.count]));
  const byRouteCounts = Object.fromEntries((data?.byRouteStatus || []).map((r) => [r.status, r.count]));
  const byVehicleCounts = Object.fromEntries((data?.byVehicleStatus || []).map((r) => [r.status, r.count]));

  const totalJobs = Object.values(byStatusCounts).reduce((a, b) => a + b, 0);
  const completed = byStatusCounts.COMPLETED || 0;
  const failed = byStatusCounts.FAILED || 0;
  const active = ACTIVE_STATUSES.reduce((sum, s) => sum + (byStatusCounts[s] || 0), 0);

  const totalPod = data ? Object.values(data.pod).reduce((a, b) => a + b, 0) : 0;
  const totalRoutes = Object.values(byRouteCounts).reduce((a, b) => a + b, 0);
  const totalVehicles = Object.values(byVehicleCounts).reduce((a, b) => a + b, 0);
  const totalDrivers = data?.driverProductivity?.length || 0;

  return (
    <PageContainer>
      <PageHeader
        title="Laporan Delivery"
        subtitle="Performa pengiriman, status armada, dan produktivitas driver."
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <PageBody>
        {error && <div className="rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}

        {loading ? (
          <>
            <KpiRowSkeleton count={4} />
            <ChartGridSkeleton cols={2} height={260} />
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Total Job" numericValue={totalJobs} index={0} />
              <KpiCard label="Selesai" numericValue={completed} index={1} />
              <KpiCard label="Gagal" numericValue={failed} index={2} />
              <KpiCard label="Masih Berjalan" numericValue={active} index={3} />
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <ChartCard
                title="Distribusi Status Job"
                description="Semua job dalam rentang tanggal terpilih, per status."
                index={0}
                empty={totalJobs === 0 ? "Belum ada job pada rentang ini." : null}
              >
                <div className="space-y-2.5">
                  {statusBars(byStatusCounts, JOB_STATUS_REAL).map((b) => <BarRow key={b.label} {...b} />)}
                </div>
              </ChartCard>

              <ChartCard
                title="Tipe Job"
                description="Pengambilan vs pengiriman dalam rentang tanggal terpilih."
                index={1}
                empty={totalJobs === 0 ? "Belum ada job pada rentang ini." : null}
              >
                <div className="space-y-2.5">
                  {statusBars(byTypeCounts, JOB_TYPE_REAL).map((b) => <BarRow key={b.label} {...b} />)}
                </div>
              </ChartCard>

              <ChartCard
                title="Proof of Delivery"
                description="Status verifikasi bukti serah terima job yang selesai."
                index={2}
                empty={totalPod === 0 ? "Belum ada job selesai pada rentang ini." : null}
              >
                <div className="space-y-2.5">
                  {statusBars(data?.pod || {}, POD_STATUS).map((b) => <BarRow key={b.label} {...b} />)}
                </div>
              </ChartCard>

              <ChartCard
                title="Status Rute"
                description="Rute terjadwal dalam rentang tanggal terpilih."
                index={3}
                empty={totalRoutes === 0 ? "Belum ada rute pada rentang ini." : null}
              >
                <div className="space-y-2.5">
                  {statusBars(byRouteCounts, ROUTE_STATUS_REAL).map((b) => <BarRow key={b.label} {...b} />)}
                </div>
              </ChartCard>

              <ChartCard
                title="Status Armada"
                description="Kondisi kendaraan SEKARANG — tidak terikat rentang tanggal di atas."
                index={4}
                empty={totalVehicles === 0 ? "Belum ada kendaraan terdaftar." : null}
              >
                <div className="space-y-2.5">
                  {statusBars(byVehicleCounts, VEHICLE_STATUS_REAL).map((b) => <BarRow key={b.label} {...b} />)}
                </div>
              </ChartCard>

              <ChartCard
                title="Produktivitas Driver"
                description="Jumlah job selesai per driver dalam rentang tanggal terpilih."
                index={5}
              >
                {totalDrivers === 0 ? (
                  <EmptyState icon={Users} title="Belum ada job selesai" description="Coba pilih rentang tanggal lain." />
                ) : (
                  <div className="space-y-2.5">
                    {data.driverProductivity.map((d) => (
                      <BarRow
                        key={d.driverId} label={d.name} value={d.completed}
                        max={data.driverProductivity[0].completed} display={d.completed}
                      />
                    ))}
                  </div>
                )}
              </ChartCard>
            </div>
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
