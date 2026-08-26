import React, { useState } from "react";
import { Users, ShoppingCart, Wallet, Target } from "lucide-react";
import DateRangePicker from "../components/DateRangePicker.jsx";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { formatTanggalIndo, formatRupiahShort } from "../utils/format.js";
import { makeRange, compareLabel } from "../lib/dateRange.js";
import { useDashboardData } from "../features/dashboard/hooks/useDashboardData.js";
import StatCard from "@/components/ui/stat-card.jsx";
import RevenueOverview from "../features/dashboard/components/RevenueOverview.jsx";
import PipelineFunnelCard from "../features/dashboard/components/PipelineFunnelCard.jsx";
import TopRepsCard from "../features/dashboard/components/TopRepsCard.jsx";
import TaskQueueCard from "../features/dashboard/components/TaskQueueCard.jsx";
import HotLeadsCard from "../features/dashboard/components/HotLeadsCard.jsx";
import LeadsDetailModal from "../features/dashboard/components/LeadsDetailModal.jsx";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ═══ DASHBOARD (DS v2.1) ══════════════════════════════════════════════════
// Tata letak mengikuti pola referensi:
//   header sapaan + date picker
//   → 4 kartu KPI (baris penuh)
//   → Ringkasan Penjualan (kartu lebar penuh, angka + area chart)
//   → 2 kolom: Corong Pipeline | Sales Terbaik
//   → 2 kolom: Perlu Ditindak  | Lead Panas
//
// KEDALAMAN UBIN NAIK BERURUTAN di baris KPI (1→2→3→4). Itu yang memberi
// "gradasi biru terang→gelap" yang diminta: satu keluarga warna, tapi barisnya
// tidak terlihat rata/monoton. Angka & delta tetap yang membawa informasi.
export default function Dashboard({ user }) {
  const [range, setRange] = useState(() => makeRange("today"));
  const [leadsModal, setLeadsModal] = useState(null);
  const d = useDashboardData(range);

  const ov = d.overview.data;
  // "Conversion" = PELANGGAN DISTINCT yang order (customersWithOrders) /
  // total lead baru (totalCustomers) — BUKAN total jumlah order (totalOrders)
  // dibagi lead. Sengaja begitu: satu pelanggan yang order 2x dalam periode
  // yang sama tidak boleh dihitung sebagai "2 konversi".
  //
  // BUG YANG DIPERBAIKI (26 Agustus 2026): `totalCustomers`/`customersWithOrders`
  // di atas ikut `range` yang dipilih (custWhereKonversi di backend) — artinya
  // ini COHORT: "dari lead yang masuk DI PERIODE INI, berapa yang SUDAH
  // closing (sampai sekarang)". Di-set "Hari ini", cohort-nya adalah lead
  // yang BARU SAJA masuk hari itu juga — hampir tidak pernah sempat closing
  // di HARI YANG SAMA, jadi Conversion nyaris selalu 0% dan disangka bug
  // (dilaporkan owner: "kok Conversion 0% padahal ada order hari ini?" —
  // order itu dari lead LAMA yang baru closing hari ini, bukan dari cohort
  // hari ini, jadi memang benar tidak ikut kehitung di sini).
  //
  // Sekarang kartu ini SELALU pakai cohort BULAN INI (via `overviewMTD`,
  // lihat useDashboardData.js), TIDAK ikut `range` — sama pola dengan
  // "Target Bulanan Tim" di Laporan.
  const ovMTD = d.overviewMTD.data;
  const konversi = ovMTD && ovMTD.totalCustomers > 0
    ? Math.round((ovMTD.customersWithOrders / ovMTD.totalCustomers) * 100)
    : null;
  const userName = user?.name?.split(" ")[0] || "Anda";
  // Label pembanding ikut PANJANG rentang yang sedang dipilih ("vs kemarin",
  // "vs 7 hari sebelumnya", dst) — BUKAN teks statis. Backend (buildPrevRange
  // di routes/analytics.js) sudah lama menghitung periode pembanding dengan
  // benar; StatCard sebelumnya cuma punya default hardcode "vs last week"
  // yang tidak pernah ikut menyesuaikan rentang yang dipilih. null kalau
  // preset "Semua" (tidak ada periode pembanding yang valid).
  const cmp = compareLabel(range);
  // Label pembanding KHUSUS kartu Conversion — ikut cohort bulan-berjalan
  // (di atas), BUKAN `range` yang dipilih di date picker.
  const cmpMTD = compareLabel(makeRange("this_month"));

  return (
    <PageContainer>
      <PageHeader
        title={`Halo, ${userName} 👋`}
        subtitle={`Ringkasan bisnis Anda · ${formatTanggalIndo()}`}
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <PageBody>
        {/* ── KPI ── gradasi kedalaman 1→4 di satu baris */}
        <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            label="New Leads" icon={Users} depth={1}
            value={(ov?.newCustomers ?? 0).toLocaleString("id-ID")}
            delta={ov?.growthCustomers} deltaSuffix={cmp}
            onClick={() => setLeadsModal({ date: todayStr(), session: "all" })}
            tooltip="Pelanggan baru (Customer dibuat) di periode yang dipilih, chat SPAM dikecualikan. Klik kartu untuk lihat daftarnya."
          />
          <StatCard
            label="Total Orders" icon={ShoppingCart} depth={2}
            value={(ov?.totalOrders ?? 0).toLocaleString("id-ID")}
            delta={ov?.growthOrders} deltaSuffix={cmp}
            tooltip="Jumlah order yang dibuat di periode yang dipilih (order CANCELLED tidak dihitung)."
          />
          <StatCard
            label="Revenue" icon={Wallet} depth={3}
            value={formatRupiahShort(ov?.totalOrderValue ?? 0)}
            delta={ov?.growthOrderValue} deltaSuffix={cmp}
            tooltip="Total nilai order MASUK di periode yang dipilih — belum tentu sudah dibayar lunas."
          />
          <StatCard
            label="Conversion" icon={Target} depth={4}
            value={konversi != null ? `${konversi}%` : "—"}
            delta={ovMTD?.growthConversion} deltaSuffix={cmpMTD}
            note={
              ovMTD ? `${(ovMTD.customersWithOrders ?? 0).toLocaleString("id-ID")} dari ${(ovMTD.totalCustomers ?? 0).toLocaleString("id-ID")} lead bulan ini`
                 : "lead bulan ini yang sudah order"
            }
            tooltip={`Conversion = (lead BULAN INI yang sudah order) ÷ (SELURUH lead bulan ini) × 100%. SELALU bulan berjalan, tidak ikut rentang tanggal yang dipilih di atas — kalau di-set "Hari ini", lead yang baru masuk hari itu memang hampir tidak pernah sempat closing hari yang sama juga. Contoh: ${ovMTD?.customersWithOrders ?? 0} ÷ ${ovMTD?.totalCustomers ?? 0} = ${konversi ?? "—"}%.`}
          />
        </section>

        {/* ── Ringkasan penjualan (lebar penuh) ── */}
        {/* DS v2.4: Sales Overview, Deal Pipeline, Top Performing Reps
            SATU periode — semuanya menerima `range` yang sama dari date
            picker di header. Pilih satu tanggal, ketiganya ikut berubah. */}
        <RevenueOverview
          range={range}
          repeatRate={ov?.repeatRate}
          repeatCustomers={ov?.repeatCustomers}
          customersWithOrders={ov?.customersWithOrders}
        />

        {/* ── Dua kolom: corong + leaderboard ── */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PipelineFunnelCard range={range} />
          <TopRepsCard range={range} />
        </section>

        {/* ── Dua kolom: antrean tindakan + lead panas ── */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TaskQueueCard
            items={d.followUps.data?.items}
            loading={d.followUps.isLoading}
            error={d.followUps.isError}
          />
          <HotLeadsCard
            items={d.hotLeads.data?.items}
            loading={d.hotLeads.isLoading}
            error={d.hotLeads.isError}
          />
        </section>
      </PageBody>

      <LeadsDetailModal
        open={!!leadsModal}
        initialDate={leadsModal?.date}
        initialSession={leadsModal?.session}
        onClose={() => setLeadsModal(null)}
      />
    </PageContainer>
  );
}
