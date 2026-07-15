import React from "react";
import { MessageSquare, AlertTriangle, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { formatWaktu, formatTanggalWaktu, convStatusVariant, CONV_STATUS_LABELS } from "../../../utils/format.js";

// Riwayat chat — tampilan RINGKAS (cap 8 pesan terakhir/percakapan). Percakapan
// penuh lewat "Buka Chat" (Inbox). loading/empty/error+retry.
export default function ConversationHistoryTab({ conversations, loading, error, onRetry, onOpenChat }) {
  if (loading) {
    return <div className="flex flex-col gap-2">{[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 10 }} />)}</div>;
  }
  if (error) {
    return (
      <EmptyState icon={AlertTriangle} title="Gagal memuat percakapan" description="Coba muat ulang."
        action={<Button size="sm" variant="outline" onClick={onRetry}><RefreshCw size={13} /> Coba lagi</Button>} />
    );
  }
  const convos = Array.isArray(conversations) ? conversations : [];
  if (convos.length === 0) {
    return <EmptyState icon={MessageSquare} title="Belum ada percakapan" description="Riwayat chat akan muncul di sini." />;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onOpenChat}>Buka Chat penuh</Button>
      </div>
      {convos.map((conv) => (
        <div key={conv.id} className="rounded-xl border border-slate-100 p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px]">
            <Badge variant="success">{conv.channel === "WHATSAPP" ? "WhatsApp" : conv.channel}</Badge>
            <span className="text-slate-400">{formatTanggalWaktu(conv.lastMessageAt)}</span>
            <Badge variant={convStatusVariant(conv.status)} className="ml-auto">{CONV_STATUS_LABELS[conv.status] || conv.status}</Badge>
          </div>
          <div className="flex flex-col gap-1">
            {(conv.messages || []).slice(-8).map((m) => (
              <div key={m.id} className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] ${m.direction === "OUTBOUND" ? "self-end bg-brand-50 text-brand-900" : "self-start bg-slate-100 text-slate-700"}`}>
                {m.content || (m.mediaType ? `[${m.mediaType}]` : "")}
                <div className="mt-0.5 text-[9.5px] text-slate-400">{formatWaktu(m.createdAt)}</div>
              </div>
            ))}
            {(conv.messages || []).length === 0 && <p className="text-[12px] text-slate-400">Belum ada pesan.</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
