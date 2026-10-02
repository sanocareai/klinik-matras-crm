import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Sunrise, Loader2, Clock } from "lucide-react";
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
// unit benar-benar READY_FOR_DELIVERY — lihat deliveryHandoff.js). Panel ini murni jalur KOORDINASI:
// dispatcher menandai order mana yang jadi incaran rute pagi ini, Production Lead/Admin yang
// menyetujui dari papan Produksi (dispatcher TIDAK punya UNIT_ROUTING_WRITE, lihat
// backend/src/services/morningPriority.js untuk alasan lengkap pemisahan tugas ini). Begitu unit
// benar-benar siap, Job pengiriman muncul otomatis di panel "Belum Masuk Rute" seperti biasa — panel
// ini TIDAK menggantikan itu, cuma menyiapkan prioritasnya duluan.
const PRIORITY_LABEL = { NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Mendesak", CRITICAL: "Kritis" };
const PRIORITY_TONE = { NORMAL: "neutral", HIGH: "accent", URGENT: "orange", CRITICAL: "red" };

export default function MorningPriorityPanel() {
  const [buka, setBuka] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tersedia, setTersedia] = useState(true); // false kalau akun ini tidak berhak sama sekali (403) — panel sembunyi diam-diam
  const [orders, setOrders] = useState([]);
  const [requests, setRequests] = useState([]); // status apa pun, bukan cuma PENDING — supaya baris APPROVED/DISMISSED hari ini tetap kelihatan status-nya
  const [mengusulkan, setMengusulkan] = useState(null); // orderId yang sedang diproses tombolnya

  const muat = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, r] = await Promise.all([
        api.getOrders({ status: "PROCESSING", sortBy: "deliveryConfirmedDate", limit: 100 }),
        api.getMorningPriorityRequests({ status: "ALL" }),
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

  async function usulkan(orderId) {
    setMengusulkan(orderId);
    try {
      const created = await api.requestMorningPriority(orderId, {});
      setRequests((prev) => [...prev.filter((r) => r.id !== created.id), created]);
    } catch (e) {
      setError(e.message || "Gagal mengusulkan prioritas");
    } finally {
      setMengusulkan(null);
    }
  }

  if (!tersedia) return null;

  const requestByOrder = new Map(requests.map((r) => [r.orderId || r.order?.id, r]));
  const belumDiusulkan = orders.filter((o) => !requestByOrder.get(o.id) || requestByOrder.get(o.id).status === "DISMISSED").length;

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
        {!buka && belumDiusulkan > 0 && <Badge variant="accent">{belumDiusulkan} belum diusulkan</Badge>}
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
                    {!req || req.status === "DISMISSED" ? (
                      <Button size="sm" variant="secondary" onClick={() => usulkan(o.id)} disabled={mengusulkan === o.id}>
                        {mengusulkan === o.id ? <Loader2 size={13} className="animate-spin" /> : <Sunrise size={13} />} Usulkan Prioritas
                      </Button>
                    ) : req.status === "PENDING" ? (
                      <Badge variant="orange">Menunggu persetujuan produksi</Badge>
                    ) : (
                      <Badge variant={PRIORITY_TONE[req.appliedPriority] || "accent"}>Disetujui — {PRIORITY_LABEL[req.appliedPriority] || req.appliedPriority}</Badge>
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
