import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, AlertTriangle, Truck as TruckIcon, Package } from "lucide-react";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Card } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows,
} from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import DeliveryKpiRow from "@/features/armada/components/DeliveryKpiRow.jsx";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import { JOB_STATUS_REAL, JOB_TYPE_REAL, customerOf, orderNumberOf } from "@/features/armada/jobStatus.js";
import { VEHICLE_STATUS_REAL } from "@/features/armada/vehicleStatus.js";

// Dashboard Delivery & Fulfillment — DATA NYATA (22 Agustus 2026, D-035).
//
// MENGGANTIKAN Tahap 1 yang 100% deliveryMock.js. Halaman ini sekarang
// memakai enum status/tipe SUNGGUHAN (jobStatus.js#JOB_STATUS_REAL — 8
// status, bukan 10 status versi spesifikasi lama, lihat catatan panjang di
// sana) dan sumber data nyata: GET /armada/jobs?date= untuk job hari ini,
// GET /armada/vehicles untuk armada + dokumen yang mau kadaluarsa.
//
// "Aktivitas Terbaru" versi Tahap 1 SENGAJA DIHAPUS, bukan diisi data
// kosong — tidak ada log aktivitas terpadu di backend (job status berubah
// tanpa event terpisah yang disimpan), jadi menampilkan widget itu cuma
// akan kosong atau butuh mengarang data. Lebih jujur tidak menampilkannya
// sampai memang ada sumbernya.
//
// KPI di sini menghitung dari job HARI YANG DIPILIH SAJA (bukan agregat
// keseluruhan) — konsisten dengan filter tanggal di header, sama seperti
// perilaku lama sebelum data nyata disambungkan.

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Dokumen yang kadaluarsa/mau habis (≤30 hari) — sinyal paling mendesak buat
// dispatcher, karena kendaraan dengan dokumen habis TIDAK BOLEH dioperasikan.
function dokumenBermasalah(vehicles) {
  const out = [];
  for (const v of vehicles) {
    for (const [label, tgl] of [
      ["STNK", v.stnkExpiry], ["Pajak", v.taxExpiry], ["KIR", v.kirExpiry], ["Asuransi", v.insuranceExpiry],
    ]) {
      if (!tgl) continue;
      const sisaHari = Math.floor((new Date(tgl) - new Date()) / 86400000);
      if (sisaHari <= 30) out.push({ vehicle: v, label, sisaHari, lewat: sisaHari < 0 });
    }
  }
  return out.sort((a, b) => a.sisaHari - b.sisaHari);
}

export default function ArmadaDashboard() {
  const navigate = useNavigate();
  const [tanggal, setTanggal] = useState(todayISO());
  const [jobs, setJobs] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsRes, vehiclesRes] = await Promise.all([
        api.getArmadaJobs({ date: tanggal, take: 200 }),
        api.getVehicles(),
      ]);
      setJobs(jobsRes.jobs);
      setVehicles(vehiclesRes.vehicles);
    } catch {
      setJobs([]);
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [tanggal]);

  useEffect(() => { load(); }, [load]);

  const kpi = useMemo(() => {
    if (!jobs) return [];
    const hitung = (pred) => jobs.filter(pred).length;
    return [
      { key: "UNSCHEDULED", label: "Belum Dijadwalkan", value: hitung((j) => j.status === "UNSCHEDULED"), tone: "neutral" },
      { key: "ASSIGNED",    label: "Driver Ditugaskan",  value: hitung((j) => j.status === "ASSIGNED"),    tone: "accent" },
      { key: "EN_ROUTE",    label: "Menuju Lokasi",      value: hitung((j) => j.status === "EN_ROUTE"),    tone: "accent" },
      { key: "ARRIVED",     label: "Tiba di Lokasi",     value: hitung((j) => j.status === "ARRIVED"),     tone: "accent" },
      { key: "COMPLETED",   label: "Selesai",            value: hitung((j) => j.status === "COMPLETED"),   tone: "green" },
      { key: "FAILED",      label: "Gagal",              value: hitung((j) => j.status === "FAILED"),      tone: "red" },
    ];
  }, [jobs]);

  const statusChart = useMemo(() => {
    if (!jobs) return [];
    return Object.entries(JOB_STATUS_REAL).map(([key, def]) => ({
      key, label: def.label, tone: def.tone, value: jobs.filter((j) => j.status === key).length,
    }));
  }, [jobs]);
  const maxChart = Math.max(1, ...statusChart.map((s) => s.value));

  const dokIssues = useMemo(() => dokumenBermasalah(vehicles.filter((v) => v.active)), [vehicles]);
  const fleetByStatus = useMemo(() => {
    const out = {};
    for (const v of vehicles) if (v.active) out[v.status] = (out[v.status] || 0) + 1;
    return out;
  }, [vehicles]);

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
            {/* Shortcut ke tab Armada (bukan cuma Jadwal & Penugasan) — dispatcher
                yang baru sadar kendaraannya belum lengkap (lihat panel "Butuh
                Perhatian" di bawah) sebelumnya harus buka Driver & Armada lalu
                klik tab Armada sendiri. ?tab=armada dibaca ArmadaResources.jsx
                supaya langsung mendarat di tab yang benar. */}
            <Button size="sm" variant="ghost" onClick={() => navigate("/armada/resources?tab=armada&action=tambah")}>
              <TruckIcon size={14} /> Tambah Kendaraan
            </Button>
            <Button size="sm" onClick={() => navigate("/armada/jobs")}>
              <Plus size={14} /> Buat Job
            </Button>
          </>
        }
      />

      <PageBody>
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[86px] animate-pulse rounded-card bg-inset" />)}
          </div>
        ) : (
          <DeliveryKpiRow items={kpi} />
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink">Job per Status</h3>
            <p className="mb-4 text-[12px] text-ink3">Sebaran job pada {new Date(tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.</p>
            {loading ? <TableSkeletonRows rows={4} cols={1} /> : statusChart.every((s) => s.value === 0) ? (
              <EmptyState icon={Package} title="Belum ada job pada tanggal ini" />
            ) : (
              <div className="flex flex-col gap-2">
                {statusChart.filter((s) => s.value > 0).map((s) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate text-[11.5px] text-ink2">{s.label}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded-full bg-inset">
                      <div
                        className={`h-full rounded-full ${{ neutral: "bg-ink3", accent: "bg-accent", green: "bg-green", orange: "bg-orange", red: "bg-red" }[s.tone]}`}
                        style={{ width: `${(s.value / maxChart) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 text-right text-[12px] font-bold text-ink">{s.value}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <AlertTriangle size={14} className="text-orange" /> Butuh Perhatian
            </h3>
            {loading ? <TableSkeletonRows rows={3} cols={1} /> : dokIssues.length === 0 ? (
              <p className="text-[12px] text-ink3">Tidak ada dokumen kendaraan yang mau kadaluarsa dalam 30 hari.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {dokIssues.slice(0, 6).map((d, i) => (
                  <div key={i} className="flex items-start gap-2 border-b border-line pb-2.5 last:border-0 last:pb-0">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${d.lewat ? "bg-red" : "bg-orange"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-ink">{d.vehicle.plateNumber} · {d.label}</p>
                      <p className={`text-[11px] ${d.lewat ? "text-red" : "text-ink3"}`}>{d.lewat ? `Kadaluarsa ${Math.abs(d.sisaHari)} hari lalu` : `${d.sisaHari} hari lagi`}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3"><h3 className="text-[13px] font-bold text-ink">Job Hari Ini</h3></div>
          {loading ? <div className="p-4"><TableSkeletonRows rows={4} cols={6} /></div> : jobs.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Belum ada job pada tanggal ini"
              description="Buat job baru atau ubah tanggal pada filter di atas."
              action={<Button size="sm" onClick={() => navigate("/armada/jobs")}><Plus size={14} /> Buat Job</Button>}
            />
          ) : (
            <TableWrap>
              <Table>
                <THead><TR><TH>Order</TH><TH>Pelanggan</TH><TH>Jenis</TH><TH>Driver</TH><TH>Kendaraan</TH><TH>Status</TH></TR></THead>
                <TBody>
                  {jobs.map((j) => {
                    const cust = customerOf(j);
                    return (
                      <TR key={j.id} className="cursor-pointer" onClick={() => navigate("/armada/jobs")}>
                        <TD className="font-semibold text-ink">{orderNumberOf(j) || "—"}</TD>
                        <TD className="text-ink2">{cust?.name || "—"}</TD>
                        <TD className="text-ink2">{JOB_TYPE_REAL[j.type]?.label || j.type}</TD>
                        <TD className="text-ink2">{j.driver?.name || <span className="text-orange">Belum ada</span>}</TD>
                        <TD className="text-ink2">{j.vehicle?.plateNumber || "—"}</TD>
                        <TD><StatusBadge map={JOB_STATUS_REAL} value={j.status} /></TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-ink">
            <TruckIcon size={14} /> Ketersediaan Armada
          </h3>
          {loading ? <TableSkeletonRows rows={2} cols={4} /> : vehicles.filter((v) => v.active).length === 0 ? (
            <EmptyState icon={TruckIcon} title="Belum ada kendaraan aktif" description="Tambahkan lewat Driver & Armada." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(VEHICLE_STATUS_REAL).map(([key, def]) => (
                <div key={key} className="rounded-2xl bg-inset/60 p-3 text-center">
                  <p className="text-[20px] font-bold text-ink">{fleetByStatus[key] || 0}</p>
                  <p className="text-[11px] text-ink3">{def.label}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </PageBody>
    </PageContainer>
  );
}
