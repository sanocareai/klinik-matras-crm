import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { api } from "../../../../api.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import ProfileSection from "./ProfileSection.jsx";
import PipelineSection from "./PipelineSection.jsx";
import InfoSection from "./InfoSection.jsx";
import MediaGallery from "./MediaGallery.jsx";
import NotesSection from "./NotesSection.jsx";
import GroupPanel from "./GroupPanel.jsx";
import NextBestActionCard from "./NextBestActionCard.jsx";
import AssignmentSection from "./AssignmentSection.jsx";
import ActiveOrderCard from "./ActiveOrderCard.jsx";
import OrderHistoryList from "./OrderHistoryList.jsx";
import OrderEditDrawer from "./OrderEditDrawer.jsx";
import { CustomerPanelSkeleton } from "../Skeletons.jsx";

// Panel kanan Inbox (Fase E). type=GROUP → GroupPanel (tanpa pipeline/order/
// dll), INDIVIDUAL → profil customer lengkap. Collapsible via onClose (state
// & persist localStorage dikelola di Inbox.jsx, lihat komentar di sana) —
// backdrop di bawah ini muncul (lewat CSS) di layar <1024px sebagai drawer.
export default function CustomerPanel({ conversation, onClose }) {
  const customerId = conversation?.customer?.id;
  const [customer, setCustomer]   = useState(null);
  const [loadError, setLoadError] = useState(null);
  // Wave 9 (redesign Inbox) — order yang sedang dibuka di OrderEditDrawer.
  // null = drawer tertutup. Dipicu dari ActiveOrderCard (tab Overview) MAUPUN
  // OrderHistoryList (tab Order), keduanya cuma memanggil setOrderDrawerOrder.
  const [orderDrawerOrder, setOrderDrawerOrder] = useState(null);

  useEffect(() => {
    // Ganti percakapan/pelanggan sementara OrderEditDrawer terbuka akan
    // menampilkan order pelanggan yang SALAH begitu drawer masih terbuka —
    // tutup dulu, konsisten dengan pola reset lain di effect ini.
    setOrderDrawerOrder(null);
    if (conversation?.type === "GROUP") { setCustomer(null); setLoadError(null); return; }
    if (!customerId) { setCustomer(null); setLoadError(null); return; }
    setLoadError(null);
    setCustomer(null);
    api.getCustomer(customerId)
      .then(setCustomer)
      .catch((err) => setLoadError(err.message || "Gagal memuat data pelanggan"));
  }, [customerId, conversation?.type]);

  if (conversation?.type === "GROUP") {
    return (
      <>
        <div className="customer-panel-backdrop" onClick={onClose} />
        <GroupPanel conversation={conversation} />
      </>
    );
  }

  if (!customerId) {
    return (
      <div className="customer-panel customer-panel-empty" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p className="text-muted" style={{ fontSize: 13 }}>Pilih percakapan</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="customer-panel" style={{ padding: 20, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)", fontSize: 13, marginBottom: 12 }}>{loadError}</p>
        <button className="btn btn-ghost btn-sm" onClick={() => { setLoadError(null); setCustomer(null); }}>Coba Lagi</button>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="customer-panel">
        <CustomerPanelSkeleton />
      </div>
    );
  }

  return (
    <>
      <div className="customer-panel-backdrop" onClick={onClose} />
      <div className="customer-panel">
        <ProfileSection customer={customer} conversation={conversation} onUpdate={setCustomer} />

        <div style={{ padding: "0 16px 12px" }}>
          <Link to="/customers" className="panel-fullprofile-link">
            <ExternalLink size={12} /> Lihat Profil Lengkap
          </Link>
        </div>

        {/* Wave 9 (redesign Inbox, plan starry-humming-knuth) — panel ini
            dulu satu scroll panjang (Pipeline→Info→SELURUH editor order
            inline→Media→Notes). Sekarang bertab: Overview (identitas +
            rekomendasi + ringkasan SATU order paling relevan), Order
            (riwayat semua order, ringkas), Media, Aktivitas (catatan
            internal — pemetaan paling dekat dengan "activity log" yang
            sudah ada di codebase ini; tidak ada feed aktivitas terpisah
            yang dibangun di wave ini). Editor order LENGKAP (OrderSection.jsx,
            2234 baris, tidak disentuh isinya) pindah ke OrderEditDrawer,
            dibuka dari tombol "Buka"/"Buka Order" di kedua tab Overview
            & Order — BUKAN lagi dirender permanen inline di sini. */}
        <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
          <div className="px-4">
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
              <TabsTrigger value="order" className="flex-1">Order</TabsTrigger>
              <TabsTrigger value="media" className="flex-1">Media</TabsTrigger>
              <TabsTrigger value="activity" className="flex-1">Aktivitas</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="panel-body">
            {/* Wave 6 (redesign Inbox) — siapa pegang chat vs siapa pemilik
                lead, dua konsep yang sering tertukar (CLAUDE.md §20). Paling
                atas, karena ini identitas dasar ("siapa yang bertanggung
                jawab"), bukan rekomendasi. */}
            <AssignmentSection conversation={conversation} customer={customer} />

            {/* Wave 2 (redesign Inbox) — Next Best Action, di atas Pipeline
                supaya jadi hal PERTAMA yang dilihat sales: "apa yang harus
                saya lakukan sekarang untuk pelanggan ini", sebelum detail
                lain. Render null diam-diam kalau tidak relevan/gagal —
                lihat komentar di NextBestActionCard.jsx. */}
            <div className="panel-section">
              <NextBestActionCard customerId={customer.id} />
            </div>

            {/* Wave 9 — ringkasan SATU order paling relevan, bukan seluruh
                editor. "Buka Order" → OrderEditDrawer. Render null diam-diam
                kalau belum ada order sama sekali. */}
            <div className="panel-section">
              <ActiveOrderCard customer={customer} onOpenOrder={setOrderDrawerOrder} />
            </div>

            <PipelineSection customer={customer} onUpdate={setCustomer} />
            <InfoSection customer={customer} onUpdate={setCustomer} />
          </TabsContent>

          <TabsContent value="order" className="panel-body">
            <OrderHistoryList customer={customer} onOpenOrder={setOrderDrawerOrder} />
          </TabsContent>

          <TabsContent value="media" className="panel-body">
            <MediaGallery conversationId={conversation?.id} />
          </TabsContent>

          <TabsContent value="activity" className="panel-body">
            <NotesSection customer={customer} onUpdate={setCustomer} />
          </TabsContent>
        </Tabs>
      </div>

      <OrderEditDrawer
        open={!!orderDrawerOrder}
        order={orderDrawerOrder}
        customer={customer}
        onClose={() => setOrderDrawerOrder(null)}
        onUpdate={setCustomer}
      />
    </>
  );
}
