import React from "react";
import {
  AlertTriangle, MessageCircle, UserRound, ClipboardList, Hammer, ShieldCheck, PackageMinus, PackageOpen, Truck, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import {
  NOTIF_WORKSPACES, NOTIF_TYPES, workspaceOf, relativeTime,
} from "./notificationTypes.js";

// Satu baris notifikasi. Dipakai BERSAMA oleh drawer dan halaman /notifications supaya keduanya tidak pernah
// berbeda tampilan. Redesain Apple (10 Nov 2026): ubin ikon squircle per TIPE (warna = asal workspace, lembut),
// judul tebal bila belum dibaca + titik biru di kanan, chip kecil hanya untuk Kritis / Perlu tindakan. Alamat tujuan
// teknis (/inbox?conv=…) TIDAK ditampilkan lagi — jargon bagi pengguna; `compact` hanya merapatkan jarak.
// Gaya: styles/sanss-cari.css (.nt-*), berlaku di semua tema lewat token.
const IKON_TIPE = {
  SALES_MESSAGE: MessageCircle,
  CUSTOMER: UserRound,
  SALES_ORDER: ClipboardList,
  WORK_ORDER: Hammer,
  QUALITY_CONTROL: ShieldCheck,
  LOW_STOCK: PackageMinus,
  MATERIAL_REQUEST: PackageOpen,
  DELIVERY_ISSUE: Truck,
  SYSTEM: Bell,
};

export default function NotificationItem({ notif, onActivate, compact = false }) {
  const wsKey = workspaceOf(notif);
  const ws = NOTIF_WORKSPACES[wsKey] || NOTIF_WORKSPACES.system;
  const tipe = NOTIF_TYPES[notif.type];
  const belumDibaca = !notif.isRead;
  const Ikon = IKON_TIPE[notif.type] || Bell;

  return (
    <button
      type="button"
      onClick={() => onActivate(notif)}
      // Tautan tujuan diumumkan ke screen reader: item ini bernavigasi.
      aria-label={`${ws.label}: ${notif.title}. ${belumDibaca ? "Belum dibaca. " : ""}Buka.`}
      data-belum={belumDibaca ? "true" : "false"}
      className={cn("nt-item", compact && "nt-item-ringkas")}
    >
      <span className={cn("nt-ubin", `nt-ubin-${wsKey in NOTIF_WORKSPACES ? wsKey : "system"}`, notif.priority === "critical" && "nt-ubin-kritis")} aria-hidden>
        {notif.priority === "critical" ? <AlertTriangle size={17} strokeWidth={2.2} /> : <Ikon size={17} strokeWidth={2.1} />}
      </span>

      <span className="nt-isi">
        <span className="nt-baris1">
          <span className="nt-asal">{ws.label}{tipe ? ` · ${tipe.label}` : ""}</span>
          <time className="nt-waktu" dateTime={notif.createdAt}>{relativeTime(notif.createdAt)}</time>
          {belumDibaca && <span className="nt-titik" aria-hidden />}
        </span>
        <span className="nt-judul">{notif.title}</span>
        {notif.message && <span className="nt-pesan">{notif.message}</span>}
        {(notif.priority === "critical" || notif.actionRequired) && (
          <span className="nt-chips">
            {notif.priority === "critical" && <span className="nt-chip nt-chip-kritis">Kritis</span>}
            {notif.actionRequired && <span className="nt-chip nt-chip-tindakan">Perlu tindakan</span>}
          </span>
        )}
      </span>
    </button>
  );
}
