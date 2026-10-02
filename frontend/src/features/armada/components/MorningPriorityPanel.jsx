import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Sunrise, Loader2, Clock, X } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatTanggalPendek } from "@/utils/formatDate.js";

// Usulan Prioritas Pagi (3 Oktober 2026, laporan owner: "orderan yang statusnya di proses bisa masuk
// penjadwalan, route planner... karna pembuatan rute harus ada draft dari pagi, sehingga nyambung
// dengan produksi menentukan high priority untuk orderan mana yang butuh di prioritaskan").
//
// SENGAJA TIDAK membuat Job/baris rute untuk order yang masih Diproses (Job DELIVERY baru lahir saat
// unit benar-benar READY_FOR_DELIVERY — lihat deliveryHandoff.js). Panel ini murni jalur KOORDINASI.
//
// REVISI (3 Oktober, hari yang sama — laporan owner: "gaperlu menunggu persetujuan produksi...
// Nadya dan Natasha diskusi di pagi hari, kalo minta persetujuan terlalu lama"): menandai di sini
// BERLAKU LANGSUNG (priority unit berubah saat itu juga), bukan menunggu klik approve terpisah di
// Produksi — tetap tercatat siapa yang menandai, dan bisa dibatalkan dari sini kalau keliru.
const PRIORITY_LABEL = { NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Mendesak", CRITICAL: "Kritis" };
const PRIORITY_TONE = { NORMAL: "neutral", HIGH: "accent", URGENT: "orange", CRITICAL: "red" };

export default function MorningPriorityPanel() {
  const [buka, setBuka] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tersedia, setTersedia] = useState(true); // false kalau akun ini tidak berhak sama sekali (403) — panel sembunyi diam-diam
  const [orders, setOrders] = useState([]);
  const [requests, setRequests] = useState([]); // APPROVED saja (yang sedang berlaku) — cukup untuk tahu mana yang sudah ditandai
  const [memproses, setMemproses] = useState(null); // orderId/requestId yang sedang diproses tombolnya

  const muat = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, r] = await Promise.all([
        api.getOrders({ status: "PROCESSING", sortBy: "deliveryConfirmedDate", limit: 100 }),
        api.getMorningPriorityRequests({ status: "APPROVED" }),
      ]);
      setOrders(o?.items || []);
      setRequests(Array.isArray(r) ? r : []);
      setTersedia(true);
    } catch (e) {
      if (e.status === 403) setTersedia(false);
      else setError(e.message || "Gagal memuat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (buka) muat(); }, [buka, muat]);

  async function tandai(orderId) {
    setMemproses(orderId);
    try {
      const row = await api.requestMorningPriority(orderId, {});
      setRequests((prev) => [...prev.filter((r) => r.orderId !== orderId), row]);
    } catch (e) {
      setError(e.message || "Gagal menandai prioritas");
    } finally {
      setMemproses(null);
    }
  }

  async function batalkan(requestId) {
    setMemproses(requestId);
    try {
      await api.dismissMorningPriority(requestId);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      setError(e.message || "Gagal membatalkan");
    } finally {
      setMemproses(null);
    }
  }

  if (!tersedia) return null;

  const requestByOrder = new Map(requests.map((r) => [r.orderId, r]));
  const belumDitandai = orders.filter((o) => !requestByOrder.get(o.id)).length;

  return (
    <Card className="mb-3 overflow-hidden p-0">
      <button
        type="button" onClick={() => setBuka((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-hovertint/60"
        aria-expanded={buka}
      >
        <Sunrise size={16} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-bold text-ink">Usulan Prioritas Pagi</span>
          <span className="ml-2 text-[12px] text-ink3">order yang masih Diproses, ditandai untuk draft rute hari ini</span>
        </div>
        {!buka && belumDitandai > 0 && <Badge variant="accent">{belumDitandai} belum ditandai</Badge>}
        <ChevronDown size={16} className={`shrink-0 text-ink3 transition-transform ${buka ? "rotate-180" : ""}`} />
      </button>

      {buka && (
        <div className="border-t border-line p-3">
          {error && <div className="mb-3 rounded-btn bg-redbg px-3 py-2.5 text-[12.5px] text-red">{error}</div>}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-ink3"><Loader2 size={18} className="animate-spin" /></div>
          ) : orders.length === 0 ? (
            <EmptyState icon={Clock} title="Tidak ada order Diproses" description="Semua order sudah siap kirim atau belum masuk produksi." />
          ) : (
            <div className="space-y-2">
              {orders.map((o) => {
                const req = requestByOrder.get(o.id);
                const target = o.deliveryConfirmedDate || o.deliveryEstimate;
                return (
                  <div key={o.id} className="flex flex-wrap items-center gap-2.5 rounded-btn border border-line px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-ink">{o.orderNumber}</span>
                        <span className="truncate text-[13px] font-medium text-ink">{o.customerName}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-ink3">
                        {o.deliveryCity && <span>{o.deliveryCity}</span>}
                        {target && <span>· Target kirim: {o.deliveryConfirmedDate ? `Pasti ${formatTanggalPendek(target)}` : target}</span>}
                      </div>
                    </div>
                    {!req ? (
                      <Button size="sm" variant="secondary" onClick={() => tandai(o.id)} disabled={memproses === o.id}>
                        {memproses === o.id ? <Loader2 size={13} className="animate-spin" /> : <Sunrise size={13} />} Tandai Prioritas
                      </Button>
                    ) : (
                      <>
                        <Badge variant={PRIORITY_TONE[req.appliedPriority] || "accent"}>{PRIORITY_LABEL[req.appliedPriority] || req.appliedPriority}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => batalkan(req.id)} disabled={memproses === req.id}>
                          {memproses === req.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Batalkan
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
