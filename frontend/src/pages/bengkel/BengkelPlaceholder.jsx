import React from "react";
import { useNavigate } from "react-router-dom";
import { Hammer } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";

// Halaman Production yang BELUM dibangun.
//
// Pola yang sama dengan ArmadaPlaceholder (Delivery) — sidebar menampilkan
// enam menu sekaligus, dan menu yang diklik lalu menghasilkan 404 membuat
// orang mengira sistemnya rusak.
//
// ⚠️ BEDA PENTING dari dua modul sebelumnya: backend-nya SUDAH ADA untuk
// hampir semua halaman ini (stage engine, QC fit test, scope revision
// semuanya sudah ditulis dan punya endpoint) — yang belum cuma UI-nya.
// Karena itu `description` di tiap pemakaian menyebut endpoint yang sudah
// siap dipakai, supaya jelas ini soal menyambungkan, bukan membangun dari nol.
//
// Dihapus begitu keenam halaman jadi nyata.
export default function BengkelPlaceholder({ title, subtitle, phase, description }) {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <EmptyState
          icon={Hammer}
          title={`Dibangun di Tahap ${phase}`}
          description={description}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate("/bengkel")}>
                Kembali ke Papan Produksi
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate("/bengkel/work-orders")}>
                Buka Work Order
              </Button>
            </div>
          }
        />
      </Card>
    </PageContainer>
  );
}
