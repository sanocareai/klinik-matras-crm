import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import DamagedStockTab from "@/features/warehouse/components/DamagedStockTab.jsx";
import ReturnsTab from "@/features/warehouse/components/ReturnsTab.jsx";
import AdjustmentsTab from "@/features/warehouse/components/AdjustmentsTab.jsx";
import RiwayatReferensiTab from "@/features/warehouse/components/RiwayatReferensiTab.jsx";
import KoreksiDokumenTab from "@/features/warehouse/koreksi/KoreksiDokumenTab.jsx";
import KoreksiFokus from "@/features/warehouse/koreksi/KoreksiFokus.jsx";
import RusakDetail from "@/features/warehouse/dokumen/RusakDetail.jsx";
import ReturDetail from "@/features/warehouse/dokumen/ReturDetail.jsx";
import PenyesuaianDetail from "@/features/warehouse/dokumen/PenyesuaianDetail.jsx";

// Damaged, Return & Adjustment — Warehouse Tahap 6. DATA NYATA.
//
// Ketiga sub-fitur memakai tipe movement yang SUDAH ADA sejak v1 (WASTE,
// RETURN, ADJUSTMENT) — tidak ada tipe movement baru. Bedanya dengan
// endpoint satu-langkah yang sudah ada (routes/inventory.js — TIDAK
// diubah): tiga dokumen di sini membungkus keputusan yang perlu ditinjau
// dulu sebelum ledger benar-benar tertulis. Lihat catatan panjang di
// schema.prisma di atas ketiga model untuk konsekuensi & batasan yang
// diakui sadar (terutama soal saldo yang tidak dipecah per lokasi/status).
//
// UX Gudang Tahap 4: detail dokumen = JENDELA FOKUS berbasis rute /warehouse/adjustments/:jenis/:id (jenis = damaged | returns | stock | koreksi). Daftar (dengan tab, saringan, pencarian,
// dan posisi gulirnya) tetap terpasang di belakang jendela; Back/Esc/Tutup mengembalikan konteks.
const PATH = "/warehouse/adjustments";
const TAB_DARI_JENIS = { damaged: "damaged", returns: "returns", stock: "adjustments", koreksi: "koreksi" };
const TAB_VALID = ["damaged", "returns", "adjustments", "koreksi", "referensi"];
const KABAR = "gudang-dokumen-berubah";

export default function WarehouseAdjustments() {
  const [sp] = useSearchParams(); const navigate = useNavigate(); const { jenis, id } = useParams();
  const awal = TAB_DARI_JENIS[jenis] ?? sp.get("tab");
  const [tab, setTab] = useState(TAB_VALID.includes(awal) ? awal : "damaged"); // tautan kembali dari halaman detail membuka sub-tab yang sesuai
  const [versiKoreksi, setVersiKoreksi] = useState(0);
  const dariDaftar = useRef(!id); // true bila jendela dibuka dari daftar (Tutup = mundur satu langkah); false bila halaman dibuka langsung di URL detail (Tutup = ganti URL ke daftar)
  useEffect(() => { if (!id) dariDaftar.current = true; }, [id]);
  useEffect(() => { if (jenis && TAB_DARI_JENIS[jenis]) setTab(TAB_DARI_JENIS[jenis]); }, [jenis]);
  const tutup = () => { if (dariDaftar.current) navigate(-1); else { dariDaftar.current = true; navigate(`${PATH}?tab=${tab}`, { replace: true }); } };
  const berubah = () => { window.dispatchEvent(new Event(KABAR)); setVersiKoreksi((v) => v + 1); };
  const bukaKoreksi = (kid) => navigate(`${PATH}/koreksi/${kid}`);

  return (
    <PageContainer>
      <PageHeader title="Barang Rusak, Retur & Penyesuaian" subtitle="Barang rusak, retur, dan penyesuaian stok yang perlu ditinjau." />
      <PageBody>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="damaged">Barang Rusak</TabsTrigger>
            <TabsTrigger value="returns">Retur</TabsTrigger>
            <TabsTrigger value="adjustments">Penyesuaian Stok</TabsTrigger>
            <TabsTrigger value="koreksi">Koreksi Dokumen</TabsTrigger>
            <TabsTrigger value="referensi">Riwayat Referensi (bukan transaksi)</TabsTrigger>
          </TabsList>
          <TabsContent value="damaged" className="mt-4"><DamagedStockTab /></TabsContent>
          <TabsContent value="returns" className="mt-4"><ReturnsTab /></TabsContent>
          <TabsContent value="adjustments" className="mt-4"><AdjustmentsTab /></TabsContent>
          <TabsContent value="koreksi" className="mt-4"><KoreksiDokumenTab onBuka={bukaKoreksi} versiDaftar={versiKoreksi} /></TabsContent>
          <TabsContent value="referensi" className="mt-4"><RiwayatReferensiTab /></TabsContent>
        </Tabs>
      </PageBody>
      {id && jenis === "damaged" && <RusakDetail key="fokus" id={id} onTutup={tutup} onBerubah={berubah} />}
      {id && jenis === "returns" && <ReturDetail key="fokus" id={id} onTutup={tutup} onBerubah={berubah} />}
      {id && jenis === "stock" && <PenyesuaianDetail key="fokus" id={id} onTutup={tutup} onBerubah={berubah} />}
      {id && jenis === "koreksi" && <KoreksiFokus key="fokus" id={id} onTutup={tutup} onBerubah={berubah} />}
    </PageContainer>
  );
}

