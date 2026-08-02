import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Truck, MapPinned } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { cn } from "@/lib/utils.js";
import MockBadge from "@/features/armada/components/MockBadge.jsx";
import StatusBadge from "@/features/armada/components/StatusBadge.jsx";
import {
  TRACKING_STATUS, seedTrackingDrivers, positionOf, tickSimulation,
} from "@/features/armada/data/trackingMock.js";

// Live Tracking — Delivery Tahap 4.
//
// ⚠️ SIMULASI, DITEGASKAN OLEH KETENTUAN (bukan sekadar belum sempat dibuat
// nyata) — lihat catatan panjang di features/armada/data/trackingMock.js.
// Badge "Contoh" dipasang di header, konsisten dengan cara Tahap 1 menandai
// data non-real.

const TICK_MS = 2200;

function DotMap({ drivers, selectedId, onSelect }) {
  return (
    <div className="relative h-[320px] w-full overflow-hidden rounded-card border border-border bg-inset">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        {/* "Jalan" dekoratif — dashed lines, murni ilustrasi, BUKAN rute nyata */}
        <path d="M0 60 Q30 20 60 40 T100 20" fill="none" stroke="var(--hairline)" strokeWidth="0.6" strokeDasharray="2 2" />
        <path d="M0 85 Q40 90 80 70 T100 75" fill="none" stroke="var(--hairline)" strokeWidth="0.6" strokeDasharray="2 2" />
      </svg>

      {drivers.map((d) => {
        const pos = positionOf(d);
        const bergerak = d.status === "DALAM_PERJALANAN" || d.status === "BERANGKAT";
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id)}
            aria-label={`${d.driverName} — ${TRACKING_STATUS[d.status]?.label}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md transition-[left,top] duration-[1800ms] ease-linear",
              "flex h-7 w-7 items-center justify-center text-[9px] font-bold text-white",
              selectedId === d.id ? "z-10 h-8 w-8 ring-2 ring-accent" : "",
              d.status === "SELESAI" || d.status === "TIBA" ? "bg-green" : bergerak ? "bg-accent" : "bg-ink3"
            )}
          >
            {d.driverName.split(" ").map((s) => s[0]).slice(0, 2).join("")}
          </button>
        );
      })}
    </div>
  );
}

function TrackingDetailPanel({ driver, onClose }) {
  return (
    <Dialog.Root open={!!driver} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-label="Detail driver"
          className="fixed right-0 top-0 z-[201] flex h-full w-full flex-col bg-surface shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[380px]"
        >
          {driver && (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
                <Dialog.Title className="text-[15px] font-bold text-ink">{driver.driverName}</Dialog.Title>
                <Dialog.Close aria-label="Tutup" className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
                  <X size={16} />
                </Dialog.Close>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                <StatusBadge map={TRACKING_STATUS} value={driver.status} />
                <div className="text-[12.5px] text-ink2">
                  <div>Kendaraan: <span className="font-semibold text-ink">{driver.vehiclePlate}</span></div>
                  <div>Area: <span className="font-semibold text-ink">{driver.area}</span></div>
                </div>
                {driver.jobId ? (
                  <div className="rounded-btn border border-border p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-ink3">Job Sekarang</div>
                    <div className="mt-0.5 text-[12.5px] font-semibold text-ink">{driver.jobId}</div>
                    <div className="text-[12px] text-ink2">{driver.customerName}</div>
                    <div className="mt-1 text-[11.5px] text-ink3">{driver.nextStop}</div>
                    {driver.etaMinutes != null && (
                      <div className="mt-1.5 text-[12px] font-bold text-accent">
                        ETA {driver.etaMinutes === 0 ? "tiba sekarang" : `${driver.etaMinutes} menit`} (simulasi)
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[12px] text-ink3">Belum ada job aktif.</p>
                )}
                <p className="border-t border-line pt-3 text-[10.5px] leading-relaxed text-ink3">
                  Posisi & ETA di halaman ini SIMULASI — driver belum mengirim titik
                  GPS sungguhan dari aplikasinya. Lihat catatan di kode untuk detail.
                </p>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function ArmadaTracking() {
  const [drivers, setDrivers] = useState(() => seedTrackingDrivers());
  const [selectedId, setSelectedId] = useState(null);
  const [fStatus, setFStatus] = useState("");
  const [cari, setCari] = useState("");
  const intervalRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setDrivers((prev) => tickSimulation(prev)), TICK_MS);
    return () => clearInterval(intervalRef.current);
  }, []);

  const terfilter = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return drivers.filter((d) => {
      if (fStatus && d.status !== fStatus) return false;
      if (q && !`${d.driverName} ${d.vehiclePlate} ${d.customerName || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [drivers, fStatus, cari]);

  const selected = drivers.find((d) => d.id === selectedId) || null;

  return (
    <PageContainer>
      <PageHeader
        title={<span className="flex items-center gap-2">Live Tracking <MockBadge /></span>}
        subtitle="Simulasi posisi driver — belum terhubung ke GPS sungguhan."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search" value={cari} onChange={(e) => setCari(e.target.value)}
          placeholder="Cari driver, kendaraan, atau pelanggan…" aria-label="Cari"
          className="h-9 min-w-[200px] flex-1 rounded-btn border border-border bg-surface px-3 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
        />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter status"
          className="h-9 rounded-btn border border-border bg-surface px-2.5 text-[12.5px] text-ink outline-none focus:border-accent">
          <option value="">Semua status</option>
          {Object.entries(TRACKING_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <DotMap drivers={terfilter} selectedId={selectedId} onSelect={setSelectedId} />

        <div className="rounded-card border border-border bg-surface">
          <div className="border-b border-line px-3 py-2.5">
            <h3 className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink">
              <Truck size={13} aria-hidden /> {terfilter.length} Driver
            </h3>
          </div>
          <ul className="max-h-[280px] divide-y divide-line overflow-y-auto">
            {terfilter.length === 0 ? (
              <li className="px-3 py-6 text-center text-[11.5px] text-ink3">Tidak ada yang cocok filter.</li>
            ) : (
              terfilter.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={cn("w-full px-3 py-2 text-left transition-colors hover:bg-hovertint", selectedId === d.id && "bg-accentbg")}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold text-ink">{d.driverName}</span>
                      <StatusBadge map={TRACKING_STATUS} value={d.status} className="ml-auto shrink-0" />
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-ink3">
                      {d.customerName ? `${d.customerName} · ${d.nextStop}` : "Belum ada job"}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <TrackingDetailPanel driver={selected} onClose={() => setSelectedId(null)} />
    </PageContainer>
  );
}
