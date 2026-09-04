import React, { useCallback, useEffect, useState } from "react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import DateRangePicker from "@/components/DateRangePicker.jsx";
import { makeRange, toApiParams } from "@/lib/dateRange.js";
import { KpiRowSkeleton, ChartGridSkeleton } from "@/features/laporan/components/LaporanSkeleton.jsx";
import ChartCard from "@/features/laporan/components/ChartCard.jsx";
import KpiCard from "@/features/laporan/components/KpiCard.jsx";
import BarRow from "@/features/laporan/components/BarRow.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import { Users, Truck as TruckIcon } from "lucide-react";
import { formatRupiah } from "@/utils/format.js";
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
//
// RINGKASAN BIAYA ARMADA dipindah ke sini dari ArmadaPengaturan.jsx (D-084,
// 5 September 2026) — laporan owner meninjau ulang tampilan "Driver &
// Armada": "apakah ringkasan biaya bagusnya dipisah?". Ya — secara metrik
// itu laporan (angka agregat per rentang tanggal), bukan data manajemen
// driver/kendaraan, jadi lebih pas SATU tempat dengan laporan lain di sini
// (dan ikut `range` yang sama, bukan date picker kedua terpisah).
// ArmadaPengaturan.jsx sendiri berubah jadi halaman Pengaturan Delivery
// (CRUD murni: Driver + Armada, 2 tab bukan 3 lagi) — lihat catatan di
// sana untuk detail lengkap.
function toneOf(t) {
  return t === "neutral" ? "muted" : t;
}

function statusBars(counts, map) {
  const max = Math.max(1, ...Object.values(counts));
  return Object.entries(map).map(([key, meta]) => ({
    label: meta.label, value: counts[key] || 0, max, tone: toneOf(meta.tone),
  }));
}

// Efisiensi km/liter + Rp/km per baris Ringkasan Biaya (D-084, dipindah
// dari ArmadaPengaturan.jsx — lihat catatan di bawah header untuk alasan
// pemindahannya).
function EfisiensiCell({ e }) {
  return e.alasanKosong ? (
    <span className="text-[11px] italic text-ink3" title={e.alasanKosong}>Belum cukup data</span>
  ) : (
    <span className="font-semibold text-ink">{e.kmPerLiter} km/L <span className="font-normal text-ink3">· {formatRupiah(e.rupiahPerKm)}/km</span></span>
  );
}

export default function ArmadaDeliveryReport() {
  const [range, setRange] = useState(() => makeRange("last_30_days"));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Ringkasan Biaya Armada (D-084, 5 September 2026) — laporan owner:
  // "Ringkasan Biaya bagusnya dipisah?" Ya — sebelumnya jadi tab ke-3 di
  // "Driver & Armada" (halaman CRUD data driver/kendaraan), padahal
  // secara metrik ini SAMA PERSIS jenis kontennya dengan Laporan Delivery
  // (angka agregat, ditelusuri per rentang tanggal) — cuma nyasar tempat.
  // Dipindah ke sini, IKUT `range` yang sama dengan seluruh laporan lain
  // di halaman ini (satu date picker untuk semuanya, bukan date picker
  // kedua yang terpisah seperti sebelumnya).
  const [fleet, setFleet] = useState(null);

  const load = useCallback(() => {
    const params = toApiParams(range);
    const setengahJadi = (!!range.from) !== (!!range.to);
    if (setengahJadi) return;
    setLoading(true);
    setError("");
    Promise.all([
      api.getDeliveryReportSummary(params),
      api.getFleetSummary(params),
    ])
      .then(([d, f]) => { setData(d); setFleet(f); })
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

            {/* Ringkasan Biaya Armada (D-084) — lihat komentar `fleet` di
                atas untuk kenapa ini pindah ke sini. Tabel, bukan
                ChartCard/BarRow seperti bagian lain di halaman ini — datanya
                genuinely tabular (banyak kolom per baris: PIC, efisiensi,
                biaya, servis, insiden sekaligus), bukan satu angka per
                kategori yang cocok jadi bar. */}
            <div>
              <h2 className="mb-1 text-[15px] font-bold text-ink">Ringkasan Biaya Armada</h2>
              <p className="mb-3 text-[12px] text-ink3">Efisiensi BBM &amp; total biaya operasional, dalam rentang tanggal yang sama di atas.</p>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card className="overflow-hidden p-0">
                  <div className="border-b border-line px-4 py-3"><h3 className="text-[13px] font-bold text-ink">Per Kendaraan</h3></div>
                  {!fleet ? <div className="p-4"><TableSkeletonRows rows={3} cols={5} /></div> : fleet.perKendaraan.length === 0 ? (
                    <EmptyState icon={TruckIcon} title="Belum ada kendaraan aktif" />
                  ) : (
                    <TableWrap>
                      <Table>
                        <THead><TR><TH>Kendaraan</TH><TH>PIC</TH><TH>Efisiensi</TH><TH>Total Biaya</TH><TH>Servis</TH><TH>Insiden</TH></TR></THead>
                        <TBody>
                          {fleet.perKendaraan.map((v) => (
                            <TR key={v.id}>
                              <TD className="font-semibold text-ink">{v.plateNumber}</TD>
                              <TD className="text-ink2">{v.picDriver?.name || "—"}</TD>
                              <TD><EfisiensiCell e={v.efisiensi} /></TD>
                              <TD numeric>{formatRupiah(v.totalBiaya)}</TD>
                              <TD numeric className="text-ink2">{formatRupiah(v.biayaServis)}</TD>
                              <TD numeric className={v.jumlahInsiden > 0 ? "font-semibold text-red" : "text-ink3"}>{v.jumlahInsiden}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </TableWrap>
                  )}
                </Card>

                <Card className="overflow-hidden p-0">
                  <div className="border-b border-line px-4 py-3"><h3 className="text-[13px] font-bold text-ink">Per Supir</h3></div>
                  {!fleet ? <div className="p-4"><TableSkeletonRows rows={3} cols={5} /></div> : fleet.perSupir.length === 0 ? (
                    <EmptyState icon={Users} title="Belum ada catatan biaya/insiden per supir" description="Muncul begitu ada biaya atau insiden yang ditautkan ke supir." />
                  ) : (
                    <TableWrap>
                      <Table>
                        <THead><TR><TH>Supir</TH><TH>Efisiensi</TH><TH>Total Biaya</TH><TH>Insiden</TH><TH>Salah Sendiri</TH></TR></THead>
                        <TBody>
                          {fleet.perSupir.map((s) => (
                            <TR key={s.driverId}>
                              <TD className="font-semibold text-ink">{s.name}</TD>
                              <TD><EfisiensiCell e={s.efisiensi} /></TD>
                              <TD numeric>{formatRupiah(s.totalBiaya)}</TD>
                              <TD numeric className={s.jumlahInsiden > 0 ? "font-semibold text-red" : "text-ink3"}>{s.jumlahInsiden}</TD>
                              <TD numeric className="text-ink3">{s.insidenSalahSendiri}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </TableWrap>
                  )}
                </Card>
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-ink3">
                km/liter dihitung dari selisih odometer tertinggi−terendah dibagi total liter periode ini (minimal 2 pengisian BBM ber-odometer). Rp/km ikut naik-turun mengikuti harga BBM — km/liter yang murni mengukur cara bawa mobil.
              </p>
            </div>
          </>
        )}
      </PageBody>
    </PageContainer>
  );
}
