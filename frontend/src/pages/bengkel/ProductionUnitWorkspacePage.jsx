import React, { useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageContainer, PageBody } from "@/components/ui/page.jsx";
import { useTabs } from "@/lib/TabsContext.jsx";
import UnitWorkspace from "@/features/production/workspace/UnitWorkspace.jsx";
import { LIST_PATH, bacaKeadaan, jalurUnit } from "@/features/production/workspace/workListModel.js";

// RUANG KERJA UNIT — rute tersendiri (/bengkel/production-v2/unit/:unitId?bagian=…). Rute sendiri = tombol Kembali browser kembali ke Daftar kerja dengan pencarian,
// filter, urutan, dan order terbuka yang sama (URL daftar tersimpan di riwayat) serta posisi gulir dipulihkan oleh halaman daftar.
export default function ProductionUnitWorkspacePage() {
  const { unitId } = useParams(); const [sp] = useSearchParams(); const navigate = useNavigate(); const { replaceActivePath, openInActiveTab } = useTabs();
  const bagian = bacaKeadaan({ bagian: sp.get("bagian") }).bagian;
  const onBagian = useCallback((b) => replaceActivePath(jalurUnit(unitId, b)), [replaceActivePath, unitId]);
  const onKembali = useCallback(() => {
    const idx = window.history.state?.idx;
    if (typeof idx === "number" && idx > 0) navigate(-1); // kembali ke daftar yang sama persis (query tersimpan di riwayat)
    else openInActiveTab(LIST_PATH, { title: "Status Produksi" }); // dibuka langsung / setelah muat ulang: tidak ada riwayat → ke daftar bawaan
  }, [navigate, openInActiveTab]);
  return (
    <PageContainer fluid>
      <PageBody><UnitWorkspace unitId={unitId} bagian={bagian} onBagian={onBagian} onKembali={onKembali} /></PageBody>
    </PageContainer>
  );
}
