import React from "react";
import { MessageSquare, Clock, CheckCircle2, Inbox, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { formatDuration } from "../../../utils/format.js";

function Stat({ icon: Icon, label, value, tint }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-[17px] font-bold leading-none tabular-nums text-slate-900">{value}</div>
        <div className="mt-1 truncate text-[11px] text-slate-400">{label}</div>
      </div>
    </div>
  );
}

// Analitik Percakapan — ringkasan operasional WhatsApp (dari /analytics/performance).
export default function ConversationAnalytics({ data, loading, error }) {
  const p = data && typeof data === "object" ? data : {};
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analitik Percakapan</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {loading ? (
          [...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 62, borderRadius: 12 }} />)
        ) : error ? (
          <div className="col-span-2">
            <EmptyState icon={AlertTriangle} title="Gagal memuat" description="Tidak bisa memuat analitik percakapan." />
          </div>
        ) : (
          <>
            <Stat icon={MessageSquare} label="Total percakapan" value={p.totalConversations ?? 0} tint="bg-brand-50 text-brand-600" />
            <Stat icon={Clock} label="Rata-rata respon" value={formatDuration(p.avgResponseMinutes)} tint="bg-chart-orange-soft text-chart-orange" />
            <Stat icon={CheckCircle2} label="Closing rate" value={`${p.closingRate ?? 0}%`} tint="bg-chart-green-soft text-chart-green" />
            <Stat icon={Inbox} label="Belum selesai" value={p.openCount ?? 0} tint="bg-slate-100 text-slate-500" />
          </>
        )}
      </CardContent>
    </Card>
  );
}
