import React from "react";
import { useNavigate } from "react-router-dom";
import { Truck, Users } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import MockBadge from "./MockBadge.jsx";

// Ketersediaan armada & driver.
//
// Angkanya DITURUNKAN dari daftar kendaraan/driver (buildFleetAvailability),
// bukan ditulis manual — kalau ditulis manual, panel ini akan berbeda dari
// tabel Driver & Armada begitu ada satu baris yang diubah, dan dua angka yang
// bertentangan di satu produk lebih buruk daripada tidak ada angka.
const TONE = {
  green:   "text-green",
  accent:  "text-accent",
  orange:  "text-orange",
  neutral: "text-ink2",
};

function Baris({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12px] text-ink2">{label}</span>
      <strong className={cn("text-[15px] font-bold tabular-nums", TONE[tone] || TONE.neutral)}>
        {value}
      </strong>
    </div>
  );
}

export default function FleetAvailability({ data }) {
  const navigate = useNavigate();

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="text-[14px] font-bold text-ink">Ketersediaan Armada</h3>
        <MockBadge />
      </div>

      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
            <Truck size={13} aria-hidden /> Kendaraan
          </div>
          <Baris label="Tersedia"         value={data.vehicleAvailable}   tone="green" />
          <Baris label="Sedang digunakan" value={data.vehicleInUse}       tone="accent" />
          <Baris label="Dalam perawatan"  value={data.vehicleMaintenance} tone="orange" />
        </div>

        <div className="px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
            <Users size={13} aria-hidden /> Driver
          </div>
          <Baris label="Tersedia" value={data.driverAvailable} tone="green" />
          <Baris label="Bertugas" value={data.driverOnDuty}    tone="accent" />
        </div>
      </div>

      <div className="border-t border-line p-2">
        <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate("/armada/resources")}>
          Kelola Driver &amp; Armada
        </Button>
      </div>
    </Card>
  );
}
