import React from "react";
import { X, MessageSquare, MapPin, ShoppingBag } from "lucide-react";
import Avatar from "../Avatar.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { STAGE_LABELS, stageVariant, healthVariant, HEALTH_LABELS, formatRupiahShort } from "../../utils/format.js";

// Header 360 — hierarki identitas: NAMA → lokasi · kontak → order (jumlah·nilai) ·
// stage · owner. CTA utama "Lanjutkan WhatsApp" (bahasa aksi sales).
export default function Customer360Header({ customer, orderCount = 0, orderValue = 0, onOpenChat, onClose }) {
  const name = customer.name || customer.phone || customer.instagramHandle || "Pelanggan";
  return (
    <div className="flex items-start gap-3 border-b border-slate-200 bg-white p-4">
      <Avatar name={name} src={customer.profilePictureUrl} size="md" />

      <div className="min-w-0 flex-1">
        {/* Nama + status */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-[17px] font-bold tracking-[-0.01em] text-slate-900">{name}</h2>
          {customer.healthStatus && <Badge variant={healthVariant(customer.healthStatus)}>{HEALTH_LABELS[customer.healthStatus]}</Badge>}
          {customer.pernahKomplain && <Badge variant="danger">Pernah Komplain</Badge>}
        </div>

        {/* Lokasi · kontak */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-slate-500">
          {customer.city && (
            <span className="inline-flex items-center gap-1"><MapPin size={12} /> {customer.city}</span>
          )}
          {customer.city && <span className="text-slate-300">·</span>}
          <span>{customer.phone || customer.instagramHandle || "—"}</span>
        </div>

        {/* Order · stage · owner */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11.5px] font-semibold text-slate-600">
            <ShoppingBag size={12} className="text-slate-400" />
            {orderCount > 0 ? `${orderCount} order · ${formatRupiahShort(orderValue)}` : "Belum ada order"}
          </span>
          <Badge variant={stageVariant(customer.pipelineStage)}>{STAGE_LABELS[customer.pipelineStage] || customer.pipelineStage}</Badge>
          {customer.assignedSales?.name && (
            <span className="text-[11.5px] text-slate-400">Sales: <span className="font-medium text-slate-500">{customer.assignedSales.name}</span></span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={onOpenChat}><MessageSquare size={14} /> Lanjutkan WhatsApp</Button>
        <button onClick={onClose} aria-label="Tutup" className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
