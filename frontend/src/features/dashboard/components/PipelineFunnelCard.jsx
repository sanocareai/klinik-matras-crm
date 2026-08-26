import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import SectionCard from "@/components/ui/section-card.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import Funnel from "@/components/ui/funnel.jsx";
import { api } from "@/api.js";
import { formatRupiah, STAGE_LABELS } from "@/utils/format.js";
import { toApiParams } from "@/lib/dateRange.js";

// Revisi 26 Jul 2026: pipeline 8-stage (LOST dihapus dari sistem, jadi tidak
// ada lagi stage negatif yang perlu disembunyikan dari corong) — seluruh
// tahap NEW→REVIEWED ditampilkan supaya corong mencerminkan exit-criteria
// nyata di tiap tahap operasional.
// Revisi 30 Jul 2026: PAID dihapus (7 stage) — COMPLETED sekarang jadi tahap
// "berhasil" (dipakai juga sebagai pembilang conversion rate di bawah).
// Revisi 24 Agustus 2026: 7 stage → 4 (NEW/PROSPECT/TRANSACTION/SPAM). SPAM
// SENGAJA TIDAK ditampilkan di corong ini — corong menggambarkan progres
// lead MENYEMPIT ke arah closing, dan chat junk bukan bagian dari narasi
// itu (dikecualikan juga dari Closing Rate, lihat routes/analytics.js
// /sales-report). SPAM tetap terlihat di tempat lain (Kanban Pipeline).
// Revisi 26 Agustus 2026: REVIEWED dikembalikan (definisi baru — review
// publik) sebagai tahap KEEMPAT — subset dari TRANSACTION (customer yang
// closing DAN lanjut kasih review), jadi tetap konsisten dengan corong yang
// menyempit terus ke kanan.
const TAHAP = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED"];

// ─── DEAL PIPELINE ───────────────────────────────────────────────────────────
// DS v2.4: periode SENDIRI (PeriodMenu) DIHAPUS — sekarang mengikuti SATU
// date picker di header Dashboard lewat prop `range`, sama seperti Sales
// Overview & Top Performing Reps. Sebelumnya tiap kartu punya pemilih periode
// masing-masing yang independen — pilih tanggal di satu kartu tidak
// mengubah kartu lain, padahal semuanya menampilkan data yang "sama-sama
// tentang periode ini" di mata pengguna.
export default function PipelineFunnelCard({ range }) {
  const params = useMemo(() => toApiParams(range), [range]);

  const q = useQuery({
    queryKey: ["pipeline-funnel", params],
    queryFn: () => api.getAnalyticsPipelineFunnel(params),
    staleTime: 60_000,
  });

  const funnel = q.data || [];
  const byStage = Object.fromEntries(funnel.map((f) => [f.stage, f]));
  const stages = TAHAP.map((s) => ({
    key: s,
    count: byStage[s]?.count ?? 0,
    label: STAGE_LABELS[s] || s,
    value: formatRupiah(byStage[s]?.value ?? 0),
  }));

  const adaData = stages.some((s) => s.count > 0);

  // Revisi 25 Agustus 2026: footer "Conversion Rate" DIHAPUS — sebelumnya
  // dihitung sendiri di sini sebagai TRANSACTION count / NEW count, dua-duanya
  // snapshot state HARI INI dari populasi yang tidak terkait (sebagian besar
  // customer TRANSACTION sekarang sudah lama keluar dari NEW), jadi bukan
  // conversion rate yang valid secara statistik. Metrik konversi sungguhan
  // (berbasis transisi pipeline periode) ada di Laporan > Sales Report. Lebih
  // baik tidak menampilkan angka daripada menampilkan angka yang salah makna
  // — prinsip yang sama dipegang di seluruh sistem atribusi lead.
  return (
    <SectionCard title="Deal Pipeline">
      {q.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-btn" />)}
        </div>
      ) : q.isError ? (
        <p className="t-secondary py-8 text-center">Gagal memuat data pipeline.</p>
      ) : !adaData ? (
        <p className="t-secondary py-8 text-center">Belum ada data pipeline pada periode ini.</p>
      ) : (
        <Funnel stages={stages} />
      )}
    </SectionCard>
  );
}
