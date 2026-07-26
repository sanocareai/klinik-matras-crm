import React from "react";
import { useNavigate } from "react-router-dom";
import { Clock, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Divider } from "@/components/ui/divider.jsx";
import { formatDurasiRelatif } from "../../../utils/format.js";

// Titik urgensi per severity dari backend (/analytics/follow-ups):
//   critical (≥24 jam) → merah   — ini yang benar-benar perlu ditindak
//   high     (≥3 jam)  → oranye
//   medium/low         → netral, TANPA warna
//
// Spec Step 4: "Reserve red for genuinely actionable urgency, not everything
// overdue." Versi lama menandai MERAH semua yang >60 menit — di data nyata
// hampir semua baris jadi merah, sehingga merah berhenti berarti apa pun.
const DOT = {
  critical: "bg-red",
  high:     "bg-orange",
  medium:   "bg-ink3",
  low:      "bg-ink3",
};

export default function FollowUpTasks({ items, loading, error, isMock }) {
  const navigate = useNavigate();
  const list = Array.isArray(items) ? items : [];

  return (
    <Card className="flex flex-col">
      <CardHeader className="mb-3 flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5">
          <Clock size={15} className="text-ink3" /> Perlu Follow-up
        </CardTitle>
        {isMock && <Badge variant="accent">Contoh</Badge>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-btn bg-inset" />)}
          </div>
        ) : error ? (
          <EmptyState icon={AlertTriangle} title="Gagal memuat" description="Tidak bisa memuat antrean follow-up. Coba muat ulang." />
        ) : list.length === 0 ? (
          <EmptyState icon={Clock} title="Semua sudah dibalas" description="Tidak ada percakapan yang menunggu balasan." />
        ) : (
          // Baris dipisah HAIRLINE, bukan kartu ber-border satu per satu.
          <div>
            {list.map((t, i) => (
              <React.Fragment key={t.id}>
                {i > 0 && <Divider />}
                <div className="group flex items-center gap-2.5 py-2.5">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${DOT[t.severity] || DOT.low}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="t-body truncate font-medium">{t.customerName}</span>
                      {t.unassigned && <Badge variant="orange">Belum diambil</Badge>}
                    </div>
                    {/* Waktu tunggu jadi teks SECONDARY — statusnya, bukan
                        judulnya. Formatnya relatif ("25 hari"), bukan
                        "615 jam 9 mnt". */}
                    <p className="t-secondary truncate">
                      {formatDurasiRelatif(t.waitingMinutes)} · {t.sessionLabel}
                    </p>
                  </div>
                  {/* Aksi level-baris = tertiary, muncul penuh saat hover. */}
                  <Button
                    variant="tertiary"
                    size="sm"
                    className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => navigate("/inbox")}
                  >
                    {t.nextAction || "Balas"}
                  </Button>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
