import React from "react";
import { ArrowLeft, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { useHubParam } from "@/hooks/useHubParam.js";
import ProductionWorkOrders, { ORDER_SCOPES } from "./ProductionWorkOrders.jsx";
import ProductionOrders from "./ProductionOrders.jsx";

// Order Produksi (P12B.3) — klik menu LANGSUNG menampilkan daftar order asli yang aktif: tanpa halaman perantara, pemilihan mode, wizard, atau
// langkah pembuka. Aktif · Semua · Riwayat adalah filter ringan di baris saring halaman yang sama (default Aktif; ?tab= bertahan saat muat ulang).
// Klik baris membuka Unit 360. Membaca order asli TIDAK butuh Production V2 aktif maupun Mode Latihan (daftar = endpoint lama getWorkOrders).
//
// "Semua Order" level order (pembaruan status order oleh Production, D-086) tetap tersedia sebagai tampilan sekunder (?view=order) lewat tombol
// "Status order" — bukan langkah wajib dan bukan bagian dari filter di atas.
export const ORDER_SCOPE_KEYS = ORDER_SCOPES.map((s) => s.key);

export default function ProductionOrdersHub() {
  const [scope, setScope] = useHubParam("tab", ORDER_SCOPE_KEYS, "aktif");
  const [view, setView] = useHubParam("view", ["units", "order"], "units");

  if (view === "order") {
    return (
      <div>
        <div className="px-4 pt-4 md:px-8 md:pt-6">
          <Button variant="ghost" size="sm" onClick={() => setView("units")} data-testid="order-back-to-units"><ArrowLeft size={14} aria-hidden /> Kembali ke daftar order produksi</Button>
        </div>
        <ProductionOrders />
      </div>
    );
  }
  return (
    <ProductionWorkOrders
      scope={scope}
      onScopeChange={setScope}
      headerExtra={<Button variant="ghost" size="sm" onClick={() => setView("order")} data-testid="order-open-status"><ListChecks size={14} aria-hidden /> Status order</Button>}
    />
  );
}
