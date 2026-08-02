import React from "react";
import { useNavigate } from "react-router-dom";
import { CircleCheck } from "lucide-react";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { cn } from "@/lib/utils.js";
import MockBadge from "./MockBadge.jsx";

// Job yang butuh perhatian, diurutkan dari yang paling genting.
//
// Tiap baris WAJIB menyebut ALASANNYA ("Terlambat dari jadwal", "Belum ada
// driver"). Daftar "bermasalah" tanpa sebab tidak bisa ditindaklanjuti — orang
// harus membuka satu per satu untuk tahu apa yang salah, dan itu justru
// pekerjaan yang mau dihilangkan panel ini.
//
// Garis kiri berwarna + label teks, BUKAN kartu penuh warna: daftar berisi
// lima item merah akan jadi dinding merah yang tidak menonjolkan apa pun.
const TONE = {
  red:    { bar: "bg-red",    text: "text-red" },
  orange: { bar: "bg-orange", text: "text-orange" },
};

export default function IssuePriorityList({ issues, vehicleAlerts = [] }) {
  const navigate = useNavigate();
  const kosong = issues.length === 0 && vehicleAlerts.length === 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="text-[14px] font-bold text-ink">Butuh Perhatian</h3>
        <MockBadge />
        {!kosong && (
          <span className="ml-auto rounded-chip bg-inset px-2 py-0.5 text-[11px] font-semibold text-ink2">
            {issues.length + vehicleAlerts.length}
          </span>
        )}
      </div>

      {kosong ? (
        <EmptyState
          icon={CircleCheck}
          title="Tidak ada yang butuh perhatian"
          description="Seluruh job hari ini berjalan sesuai jadwal."
        />
      ) : (
        <ul className="divide-y divide-line">
          {issues.map(({ job, reason, tone }) => {
            const t = TONE[tone] || TONE.orange;
            return (
              <li key={job.id} className="relative">
                <span className={cn("absolute inset-y-0 left-0 w-[3px]", t.bar)} aria-hidden />
                <button
                  type="button"
                  onClick={() => navigate(`/armada/jobs?job=${job.id}`)}
                  className="w-full py-3 pl-4 pr-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-ink">{job.id}</span>
                    <span className={cn("text-[11px] font-semibold", t.text)}>{reason}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-ink3">{job.scheduledTime}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-ink2">
                    {job.customerName} · {job.area}
                  </div>
                </button>
              </li>
            );
          })}

          {vehicleAlerts.map((v) => {
            const t = TONE[v.tone] || TONE.orange;
            return (
              <li key={v.vehicleId} className="relative">
                <span className={cn("absolute inset-y-0 left-0 w-[3px]", t.bar)} aria-hidden />
                <button
                  type="button"
                  onClick={() => navigate("/armada/resources")}
                  className="w-full py-3 pl-4 pr-3 text-left transition-colors hover:bg-hovertint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-ink">{v.plateNumber}</span>
                    <span className={cn("text-[11px] font-semibold", t.text)}>Kendaraan</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-ink2">{v.reason}</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-line p-2">
        <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate("/armada/issues")}>
          Buka Kendala &amp; Reschedule
        </Button>
      </div>
    </Card>
  );
}
