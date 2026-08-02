import React from "react";
import { useNavigate } from "react-router-dom";
import { Hammer } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";

// Halaman Warehouse yang BELUM dibangun.
//
// Kenapa ini ada, bukan sekadar route yang tidak didaftarkan: sidebar
// Warehouse menampilkan sembilan menu sekaligus (sesuai struktur yang
// diminta). Menu yang diklik lalu menghasilkan 404 — atau lebih buruk,
// redirect diam-diam ke halaman lain — membuat orang mengira sistemnya rusak.
// Placeholder yang menyebut TAHAP KEBERAPA fitur ini datang jauh lebih jujur.
//
// Pola yang sama dengan pages/armada/ArmadaPlaceholder.jsx. Dihapus begitu
// halaman aslinya dibangun.
export default function WarehousePlaceholder({ title, subtitle, phase, description }) {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <EmptyState
          icon={Hammer}
          title={`Dibangun di Phase ${phase}`}
          description={description}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate("/warehouse/dashboard")}>
                Kembali ke Dashboard
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate("/warehouse/inventory")}>
                Buka Stock &amp; Material
              </Button>
            </div>
          }
        />
      </Card>
    </PageContainer>
  );
}
