import React from "react";
import { Modal } from "@/components/ui/modal.jsx";
import RouteTimeline from "./RouteTimeline.jsx";

export default function RouteTimelineModal({ route, open, onOpenChange }) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Histori Waktu — Rute ${route.code}`}
      description="Waktu tercatat otomatis dari aksi driver (atomik dengan setiap transisi status). Stop tanpa bukti waktu ditampilkan 'Tidak tersedia', bukan diperkirakan."
    >
      {open && <RouteTimeline routeId={route.id} />}
    </Modal>
  );
}
