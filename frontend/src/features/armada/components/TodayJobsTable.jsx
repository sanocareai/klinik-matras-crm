import React from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  TableWrap, Table, THead, TBody, TR, TH, TD, TableEmptyRow,
} from "@/components/ui/table.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";
import { JOB_STATUS, JOB_TYPE, SLA_STATUS, DRIVERS, VEHICLES } from "../data/deliveryMock.js";
import StatusBadge from "./StatusBadge.jsx";
import MockBadge from "./MockBadge.jsx";

// Tabel "Job Hari Ini" di dashboard.
//
// DUA BENTUK, satu sumber data (ketentuan responsif):
//   ≥md  → tabel penuh, horizontal-scroll kalau sempit (TableWrap sudah
//          menangani itu)
//   <md  → daftar kartu; tabel 11 kolom di layar 375px tidak terbaca, dan
//          memaksanya scroll ke samping membuat kolom Action tidak pernah
//          ditemukan orang.

const namaDriver = (id) => DRIVERS.find((d) => d.id === id)?.name || null;
const platNomor  = (id) => VEHICLES.find((v) => v.id === id)?.plateNumber || null;

function Kosong() {
  const navigate = useNavigate();
  return (
    <EmptyState
      title="Belum ada job pada tanggal ini"
      description="Buat job baru atau ubah tanggal pada filter di atas."
      action={
        <Button size="sm" onClick={() => navigate("/armada/jobs")}>
          <Plus size={14} /> Buat Job
        </Button>
      }
    />
  );
}

export default function TodayJobsTable({ jobs }) {
  const navigate = useNavigate();
  const kosong = !jobs || jobs.length === 0;

  function buka(job) {
    // Tahap 1 belum punya detail drawer — dibangun di Tahap 2 bersama halaman
    // Jadwal & Penugasan. Sementara membawa ke daftar job dengan job terpilih
    // di query, supaya tautannya sudah benar dan Tahap 2 tinggal membacanya.
    navigate(`/armada/jobs?job=${job.id}`);
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="text-[14px] font-bold text-ink">Job Hari Ini</h3>
        <MockBadge />
        <Button
          variant="ghost" size="sm" className="ml-auto"
          onClick={() => navigate("/armada/jobs")}
        >
          Lihat semua
        </Button>
      </div>

      {kosong ? (
        <Kosong />
      ) : (
        <>
          {/* ── Desktop / tablet ─────────────────────────────────────────── */}
          <TableWrap className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Job ID</TH>
                  <TH>Order ID</TH>
                  <TH>Pelanggan</TH>
                  <TH>Jenis</TH>
                  <TH>Jadwal</TH>
                  <TH>Driver</TH>
                  <TH>Kendaraan</TH>
                  <TH>Status</TH>
                  <TH>SLA</TH>
                  <TH>Aksi</TH>
                </TR>
              </THead>
              <TBody>
                {jobs.map((j) => (
                  <TR key={j.id} clickable onClick={() => buka(j)}>
                    <TD className="font-semibold text-ink">{j.id}</TD>
                    <TD className="text-ink2">{j.orderId}</TD>
                    <TD truncate>{j.customerName}</TD>
                    <TD className="text-ink2">{JOB_TYPE[j.jobType]?.label || j.jobType}</TD>
                    <TD numeric className="whitespace-nowrap">{j.scheduledTime}</TD>
                    <TD truncate className={cn(!j.driverId && "text-orange")}>
                      {namaDriver(j.driverId) || "Belum ada"}
                    </TD>
                    <TD className="whitespace-nowrap text-ink2">{platNomor(j.vehicleId) || "—"}</TD>
                    <TD><StatusBadge map={JOB_STATUS} value={j.status} /></TD>
                    <TD><StatusBadge map={SLA_STATUS} value={j.slaStatus} /></TD>
                    <TD>
                      <Button
                        variant="ghost" size="sm"
                        onClick={(e) => { e.stopPropagation(); buka(j); }}
                        aria-label={`Lihat detail ${j.id}`}
                      >
                        Detail
                      </Button>
                    </TD>
                  </TR>
                ))}
                {jobs.length === 0 && <TableEmptyRow colSpan={10}>Tidak ada job.</TableEmptyRow>}
              </TBody>
            </Table>
          </TableWrap>

          {/* ── Mobile: kartu ────────────────────────────────────────────── */}
          <ul className="divide-y divide-line md:hidden">
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => buka(j)}
                  className="w-full px-4 py-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-ink">{j.id}</span>
                    <span className="text-[11px] text-ink3">{j.scheduledTime}</span>
                    <span className="ml-auto"><StatusBadge map={JOB_STATUS} value={j.status} /></span>
                  </div>
                  <div className="mt-1 truncate text-[13px] text-ink">{j.customerName}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink2">
                    <span>{JOB_TYPE[j.jobType]?.label || j.jobType}</span>
                    <span aria-hidden>·</span>
                    <span className={cn(!j.driverId && "font-semibold text-orange")}>
                      {namaDriver(j.driverId) || "Belum ada driver"}
                    </span>
                    <StatusBadge map={SLA_STATUS} value={j.slaStatus} className="ml-auto" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
