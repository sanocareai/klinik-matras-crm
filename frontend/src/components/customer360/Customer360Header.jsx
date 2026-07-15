import React from "react";
import { X, MessageSquare } from "lucide-react";
import Avatar from "../Avatar.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { STAGE_LABELS, stageVariant, healthVariant, HEALTH_LABELS } from "../../utils/format.js";

// Header 360 — identitas + stage (badge) + kondisi + komplain + assignee +
// "Buka chat" + tutup. Edit stage yang sebenarnya ada di ProfileFields.
export default function Customer360Header({ customer, onOpenChat, onClose }) {
  const name = customer.name || customer.phone || customer.instagramHandle || "Pelanggan";
  return (
    <div className="flex items-start gap-3 border-b border-slate-200 p-4">
      <Avatar name={name} src={customer.profilePictureUrl} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="truncate text-[16px] font-bold text-slate-900">{name}</h2>
          {customer.healthStatus && <Badge variant={healthVariant(customer.healthStatus)}>{HEALTH_LABELS[customer.healthStatus]}</Badge>}
          {customer.pernahKomplain && <Badge variant="danger">Pernah Komplain</Badge>}
        </div>
        <div className="mt-0.5 text-[12.5px] text-slate-500">{customer.phone || customer.instagramHandle}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={stageVariant(customer.pipelineStage)}>{STAGE_LABELS[customer.pipelineStage] || customer.pipelineStage}</Badge>
          {customer.assignedSales?.name && <span className="text-[11px] text-slate-400">{customer.assignedSales.name}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={onOpenChat}><MessageSquare size={14} /> Buka chat</Button>
        <button onClick={onClose} aria-label="Tutup" className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
