import React, { useCallback, useEffect, useState } from "react";
import { Sunrise, X, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";

// Sisi Produksi dari Usulan Prioritas Pagi (3 Oktober 2026) — pasangan dari
// features/armada/components/MorningPriorityPanel.jsx (Route Planner). Dispatcher menandai order
// Diproses yang jadi incaran rute pagi; priority langsung berlaku ke unit aktif order itu, lewat jalur
// yang SAMA dengan PATCH /units/:id/production.
//
// REVISI (3 Oktober, hari yang sama — laporan owner: "gaperlu menunggu persetujuan produksi...
// Nadya dan Natasha diskusi di pagi hari, kalo minta persetujuan terlalu lama"): versi PERTAMA panel
// ini punya tombol Setujui/Tolak (gerbang). SEKARANG murni VISIBILITAS — Produksi lihat apa yang sudah
// ditandai dispatcher pagi ini, dan boleh membatalkan kalau keliru, tapi tidak perlu klik apa pun untuk
// yang sudah benar (sudah berlaku duluan). Lihat catatan desain lengkap di services/morningPriority.js.
const PRIORITY_LABEL = { NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Tinggi", CRITICAL: "Tinggi" }; // Mendesak/Kritis lama tampil Tinggi (nilai tersimpan tidak diubah)
const PRIORITY_TONE = { NORMAL: "neutral", HIGH: "accent", URGENT: "orange", CRITICAL: "red" };

export default function MorningPriorityApprovalPanel() {
  const [tersedia, setTersedia] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]);
  const [membatalkan, setMembatalkan] = useState(null); // id yang sedang diproses

  const muat = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await api.getMorningPriorityRequests({ status: "APPROVED" }));
      setTersedia(true);
    } catch (e) {
      if (e.status === 403) setTersedia(false);
      else setError(e.message || "Gagal memuat usulan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  async function batalkan(id) {
    setMembatalkan(id);
    try {
      await api.dismissMorningPriority(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e.message || "Gagal membatalkan");
    } finally {
      setMembatalkan(null);
    }
  }

  if (!tersedia || (!loading && rows.length === 0 && !error)) return null;

  return (
    <Card className="mb-3 overflow-hidden p-0">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <Sunrise size={16} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-bold text-ink">Prioritas Pagi dari Dispatcher</span>
          <span className="ml-2 text-[12px] text-ink3">order Diproses yang ditandai untuk draft rute hari ini — sudah berlaku</span>
        </div>
        {rows.length > 0 && <Badge variant="accent">{rows.length} ditandai</Badge>}
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
                    <Badge variant={PRIORITY_TONE[r.appliedPriority] || "accent"}>{PRIORITY_LABEL[r.appliedPriority] || r.appliedPriority}</Badge>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink3">
                    Ditandai {r.requestedBy?.name || "dispatcher"}{r.note ? ` — "${r.note}"` : ""}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => batalkan(r.id)} disabled={membatalkan === r.id}>
                  {membatalkan === r.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Batalkan
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
