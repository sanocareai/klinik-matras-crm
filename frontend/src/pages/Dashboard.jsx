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
  // REVISI 26 Agustus 2026 (dua putaran): sempat di-decouple ke cohort
  // BULAN BERJALAN TETAP (tidak ikut `range`), supaya "Hari ini" tidak
  // selalu kelihatan 0% (leads yang BARU masuk hari itu memang hampir
  // tidak pernah sempat closing di HARI YANG SAMA). TAPI itu merusak
  // kegunaan lain yang owner pakai: bandingkan conversion rate Juli vs
  // Agustus lewat date picker — kalau di-hardcode ke bulan berjalan,
  // ganti rentang ke bulan lain tidak mengubah apa pun sama sekali.
  // Dikembalikan ikut `range` lagi (permintaan owner) — "Hari ini" boleh
  // kelihatan rendah/0% di jam-jam awal, itu wajar untuk cohort yang baru
  // masuk, BUKAN bug; yang penting date picker berfungsi lagi untuk
  // membandingkan periode/bulan mana pun.
  const konversi = ov && ov.totalCustomers > 0
    ? Math.round((ov.customersWithOrders / ov.totalCustomers) * 100)
    : null;
  const userName = user?.name?.split(" ")[0] || "Anda";
  // Label pembanding ikut PANJANG rentang yang sedang dipilih ("vs kemarin",
  // "vs 7 hari sebelumnya", dst) — BUKAN teks statis. Backend (buildPrevRange
  // di routes/analytics.js) sudah lama menghitung periode pembanding dengan
  // benar; StatCard sebelumnya cuma punya default hardcode "vs last week"
  // yang tidak pernah ikut menyesuaikan rentang yang dipilih. null kalau
  // preset "Semua" (tidak ada periode pembanding yang valid).
  const cmp = compareLabel(range);
  // BUG YANG DIPERBAIKI (26 Agustus 2026, laporan owner): kartu Conversion
  // cuma menampilkan PERSENTASE PERUBAHAN relatif (mis. "-32.0%") di
  // sebelah angka konversi sekarang (mis. "4%") — gampang disalahbaca
  // seolah -32 itu POIN PERSEN yang bisa langsung dikurangkan dari 4,
  // padahal itu perubahan RELATIF terhadap angka periode sebelumnya
  // (mis. 4% itu turun ~32% DARI 6,5%, bukan "4% dikurang 32%"). Sekarang
  // ditulis eksplisit "dari X%" pakai angka mentah periode sebelumnya
  // (conversionRatePrev, baru diekspos backend) supaya tidak perlu
  // menghitung ulang sendiri di kepala.
  const konversiPrevText = ov?.conversionRatePrev != null
    ? `dari ${ov.conversionRatePrev.toFixed(1).replace(".", ",")}%`
    : null;

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
            delta={ov?.growthConversion} deltaSuffix={konversiPrevText ? `${konversiPrevText} (${cmp})` : cmp}
            note={
              ov ? `${(ov.customersWithOrders ?? 0).toLocaleString("id-ID")} dari ${(ov.totalCustomers ?? 0).toLocaleString("id-ID")} pelanggan order`
                 : "pelanggan yang order"
            }
            tooltip={`Conversion = (lead di periode ini yang sudah order) ÷ (SELURUH lead baru DI PERIODE YANG DIPILIH) × 100%. Ikut date picker di atas — pilih Juli untuk lihat conversion Juli, Agustus untuk Agustus, dst. Kalau di-set "Hari ini", wajar kelihatan rendah/0% karena lead yang baru masuk hari itu belum tentu sempat closing hari yang sama juga. Contoh: ${ov?.customersWithOrders ?? 0} ÷ ${ov?.totalCustomers ?? 0} = ${konversi ?? "—"}%. Angka persen di sebelah kiri (mis. "-32%") adalah PERUBAHAN RELATIF dari periode sebelumnya, bukan poin persen — lihat "dari X%" di sebelahnya untuk angka mentahnya. ⚠️ BEDA dengan "Konversi Tim" di Laporan > Sales (keduanya BENAR, bukan salah satu salah hitung): angka di sini basisnya LEAD BARU yang lahir di periode ini (siapa pun yang menangani); "Konversi Tim" basisnya PERCAKAPAN yang ditangani 8 sales di periode ini, termasuk lead LAMA yang baru closing sekarang — makanya penyebut & pembilangnya beda dan wajar angkanya tidak sama.`}
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
