import React from "react";
import { X, MessageSquare, MapPin, ShoppingBag, Clock } from "lucide-react";
import Avatar from "../Avatar.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { STAGE_LABELS, stageVariant, healthVariant, formatRupiahShort, formatTanggalWaktu } from "../../utils/format.js";

// Header 360 — hierarki identitas: NAMA → lokasi · kontak → order (jumlah·nilai) ·
// stage · owner → konteks (interaksi terakhir · pelanggan sejak). CTA utama
// "Lanjutkan WhatsApp" (bahasa aksi sales).
export default function Customer360Header({ customer, orderCount = 0, orderValue = 0, lastMessageAt, onOpenChat, onClose }) {
  const name = customer.name || customer.phone || customer.instagramHandle || "Pelanggan";
  const sejak = customer.createdAt
    ? new Date(customer.createdAt).toLocaleDateString("id-ID", { month: "short", year: "numeric" })
    : null;
  return (
    <div className="flex items-start gap-3 border-b border-line bg-surface p-4">
      <Avatar name={name} src={customer.profilePictureUrl} size="md" />

      <div className="min-w-0 flex-1">
        {/* Nama + status */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-[17px] font-bold tracking-[-0.01em] text-ink">{name}</h2>
          {/* Dibaca dari Order.healthStatus (pernahSakit), BUKAN
              Customer.healthStatus lama — lihat catatan di routes/customers.js. */}
          {customer.pernahSakit && <Badge variant={healthVariant("SAKIT")}>Sakit</Badge>}
          {customer.pernahKomplain && <Badge variant="danger">Pernah Komplain</Badge>}
        </div>

        {/* Lokasi · kontak */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink2">
          {customer.city && (
            <span className="inline-flex items-center gap-1"><MapPin size={12} /> {customer.city}</span>
          )}
          {customer.city && <span className="text-ink3">·</span>}
          <span>{customer.phone || customer.instagramHandle || "—"}</span>
        </div>

        {/* Order · stage · owner */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-inset px-2 py-1 text-[11.5px] font-semibold text-ink2">
            <ShoppingBag size={12} className="text-ink3" />
            {orderCount > 0 ? `${orderCount} order · ${formatRupiahShort(orderValue)}` : "Belum ada order"}
          </span>
          <Badge variant={stageVariant(customer.pipelineStage)}>{STAGE_LABELS[customer.pipelineStage] || customer.pipelineStage}</Badge>
          {customer.assignedSales?.name && (
            <span className="text-[11.5px] text-ink3">Sales: <span className="font-medium text-ink2">{customer.assignedSales.name}</span></span>
          )}
        </div>

        {/* Konteks halus — identitas tetap didahulukan */}
        {(lastMessageAt || sejak) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink3">
            {lastMessageAt && (
              <span className="inline-flex items-center gap-1"><Clock size={11} /> Interaksi terakhir {formatTanggalWaktu(lastMessageAt)}</span>
            )}
            {lastMessageAt && sejak && <span className="text-ink3">·</span>}
            {sejak && <span>Pelanggan sejak {sejak}</span>}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={onOpenChat}><MessageSquare size={14} /> Lanjutkan WhatsApp</Button>
        <button onClick={onClose} aria-label="Tutup" className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint hover:text-ink">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
