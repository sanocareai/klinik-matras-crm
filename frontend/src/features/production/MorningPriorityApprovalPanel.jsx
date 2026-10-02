import React, { useCallback, useEffect, useState } from "react";
import { Sunrise, Check, X, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";

// Sisi Produksi dari Usulan Prioritas Pagi (3 Oktober 2026) — pasangan dari
// features/armada/components/MorningPriorityPanel.jsx (Route Planner). Dispatcher mengusulkan order
// Diproses yang jadi incaran rute pagi; di sini Production Lead/Admin MEMUTUSKAN — menyetujui (priority
// ditulis ke unit aktif order itu, lewat jalur yang SAMA dengan PATCH /units/:id/production) atau
// menolak. Lihat backend/src/services/morningPriority.js untuk alasan pemisahan tugas ini.
const PRIORITY_LABEL = { NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Mendesak", CRITICAL: "Kritis" };

export default function MorningPriorityApprovalPanel() {
  const [tersedia, setTersedia] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [memutuskan, setMemutuskan] = useState(null); // id yang sedang diproses

  const muat = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await api.getMorningPriorityRequests({ status: "PENDING" }));
      setTersedia(true);
    } catch (e) {
      if (e.status === 403) setTersedia(false);
      else setError(e.message || "Gagal memuat usulan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  async function putuskan(id, setuju) {
    setMemutuskan(id);
    try {
      if (setuju) await api.approveMorningPriority(id);
      else await api.dismissMorningPriority(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e.message || "Gagal memutuskan");
    } finally {
      setMemutuskan(null);
    }
  }

  if (!tersedia || (!loading && rows.length === 0 && !error)) return null;

  return (
    <Card className="mb-3 overflow-hidden p-0">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <Sunrise size={16} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-bold text-ink">Usulan Prioritas Pagi dari Dispatcher</span>
          <span className="ml-2 text-[12px] text-ink3">order Diproses yang diajukan untuk draft rute hari ini</span>
        </div>
        {rows.length > 0 && <Badge variant="orange">{rows.length} menunggu</Badge>}
      </div>
      <div className="p-3">
        {error && <div className="mb-3 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
        {loading ? (
          <div className="flex items-center justify-center py-6 text-ink3"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2.5 rounded-btn border border-line px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-semibold text-ink">{r.order?.orderNumber}</span>
                    <span className="truncate text-[13px] font-medium text-ink">{r.order?.customer?.name}</span>
                    <Badge variant="accent">{PRIORITY_LABEL[r.suggestedPriority] || r.suggestedPriority}</Badge>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink3">
                    Diusulkan {r.requestedBy?.name || "dispatcher"}{r.note ? ` — "${r.note}"` : ""}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => putuskan(r.id, false)} disabled={memutuskan === r.id}>
                  <X size={13} /> Tolak
                </Button>
                <Button size="sm" onClick={() => putuskan(r.id, true)} disabled={memutuskan === r.id}>
                  {memutuskan === r.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Setujui
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
