import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, RefreshCw, ChevronDown } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import Customer360Header from "./Customer360Header.jsx";
import Customer360Skeleton from "./Customer360Skeleton.jsx";
import CustomerOverview from "./panels/CustomerOverview.jsx";
import HealthScoreCard from "./panels/HealthScoreCard.jsx";
import NextActionCard from "./panels/NextActionCard.jsx";
import ProfileFields from "./panels/ProfileFields.jsx";
import ActivityTimeline from "./panels/ActivityTimeline.jsx";
import ConversationHistoryTab from "./panels/ConversationHistoryTab.jsx";
import OrderSection from "../customer/OrderSection.jsx";
import NotesSection from "../customer/NotesSection.jsx";
import { useCustomer360 } from "./hooks/useCustomer360.js";
import { deriveCustomerSignals, deriveNextAction, buildOverviewText } from "./lib/customerSignals.js";
import { computeHealthScore } from "./lib/healthScore.js";

// Default tab = Aktivitas (timeline) — sales butuh konteks/riwayat dulu.
const TABS = ["Aktivitas", "Order", "Catatan", "Riwayat Chat"];

// Orchestrator Customer 360. Logika domain tetap di OrderSection/NotesSection/
// StageSelect/ProfileFields + api. Tidak menyentuh inbox/WAHA/SSE/backend.
export default function Customer360({ customerId, onClose, onUpdated }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("Aktivitas");
  const [profileOpen, setProfileOpen] = useState(false); // Profil di-collapse (prioritas rendah)
  const { customer, conversations, invalidate } = useCustomer360(customerId);

  const c = customer.data;
  const convos = conversations.data || [];
  const openChat = () => { onClose?.(); navigate("/inbox"); };
  const handleUpdated = () => { invalidate(); onUpdated?.(); };

  const ctx = useMemo(() => (c ? deriveCustomerSignals(c, convos) : null), [c, convos]);
  const health = useMemo(() => (ctx ? computeHealthScore(ctx) : null), [ctx]);
  const overview = ctx && health ? buildOverviewText(ctx, health.category) : "";
  const action = ctx ? deriveNextAction(ctx) : null;

  // ── Top-level: loading (skeleton premium meniru layout) ──
  if (customer.isLoading) return <Customer360Skeleton />;
  // ── Top-level: error + retry ──
  if (customer.isError || !c) {
    return (
      <div className="p-5">
        <EmptyState
          icon={AlertTriangle}
          title="Gagal memuat pelanggan"
          description="Tidak bisa memuat data pelanggan. Coba muat ulang."
          action={<Button size="sm" variant="outline" onClick={() => customer.refetch()}><RefreshCw size={13} /> Coba lagi</Button>}
        />
        <div className="mt-3 text-center"><Button size="sm" variant="ghost" onClick={onClose}>Tutup</Button></div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Customer360Header
        customer={c}
        orderCount={ctx?.orderCount || 0}
        orderValue={ctx?.orderValue || 0}
        onOpenChat={openChat}
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
          {/* LEFT — identity + intelligence. Prioritas AKSI dulu:
              Insight → Next Action → Health Score → Profile. */}
          <div className="flex w-full flex-col gap-3 lg:w-[300px] lg:shrink-0">
            <CustomerOverview text={overview} />
            <NextActionCard action={action} onOpenChat={openChat} />
            <HealthScoreCard health={health} />
            {/* Profil — prioritas rendah, collapsible (default tertutup) supaya
                360 terasa "intelligence drawer", bukan form edit. */}
            <div className="rounded-2xl border border-black/5 bg-card shadow-sm">
              <button
                type="button"
                onClick={() => setProfileOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
                aria-expanded={profileOpen}
              >
                <span className="text-[13px] font-semibold text-slate-700">Profil &amp; Detail</span>
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${profileOpen ? "rotate-180" : ""}`} />
              </button>
              {profileOpen && (
                <div className="border-t border-slate-100 px-4 py-4">
                  <ProfileFields customer={c} onUpdated={handleUpdated} />
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — activity + records */}
          <div className="min-w-0 flex-1">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>{TABS.map((t) => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}</TabsList>
              <div className="pt-4">
                <TabsContent value="Aktivitas">
                  <ActivityTimeline
                    orders={c.orders} notes={c.notes} conversations={convos}
                    loading={conversations.isLoading} error={conversations.isError}
                    onRetry={() => conversations.refetch()}
                  />
                </TabsContent>
                <TabsContent value="Order"><OrderSection customer={c} onUpdate={handleUpdated} /></TabsContent>
                <TabsContent value="Catatan"><NotesSection customer={c} onUpdate={handleUpdated} /></TabsContent>
                <TabsContent value="Riwayat Chat">
                  <ConversationHistoryTab
                    conversations={convos} loading={conversations.isLoading} error={conversations.isError}
                    onRetry={() => conversations.refetch()} onOpenChat={openChat}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
