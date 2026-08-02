import React from "react";
import { useNavigate } from "react-router-dom";
import { Hammer } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";

// Halaman Delivery yang BELUM dibangun.
//
// Kenapa ini ada, bukan sekadar route yang tidak didaftarkan: sidebar Delivery
// menampilkan sembilan menu sekaligus (sesuai struktur yang diminta). Menu yang
// diklik lalu menghasilkan 404 — atau lebih buruk, redirect diam-diam ke
// halaman lain — membuat orang mengira sistemnya rusak. Placeholder yang
// menyebut TAHAP KEBERAPA fitur ini datang jauh lebih jujur daripada layar
// kosong, dan sejalan dengan aturan "empty state harus informatif".
//
// Dihapus begitu halaman aslinya dibangun. Kalau file ini masih dipakai
// setelah Tahap 6, berarti ada tahap yang terlewat.
export default function ArmadaPlaceholder({ title, subtitle, stage, description }) {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <EmptyState
          icon={Hammer}
          title={`Dibangun di Tahap ${stage}`}
          description={description}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate("/armada/dashboard")}>
                Kembali ke Dashboard
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate("/armada/jobs")}>
                Buka Jadwal &amp; Penugasan
              </Button>
            </div>
          }
        />
      </Card>
    </PageContainer>
  );
}
