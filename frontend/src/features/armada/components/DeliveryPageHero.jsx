import React from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { WorkspaceHero } from "@/components/ui/workspace-hero.jsx";

// Header + hero SATU KOMPONEN dipakai KEDUA mode tampilan Delivery — Papan
// (Armada.jsx) & Daftar (ArmadaJobs.jsx) — D-080, 5 September 2026. Laporan
// owner: "buat mode papan dan list sama-sama seperti ini konsisten". Sebelum
// ini, kedua mode me-render PageHeader BERBEDA TOTAL (judul "Delivery &
// Fulfillment" + hero "Delivery command center" di Papan, VS judul "Jadwal &
// Penugasan" TANPA hero sama sekali di Daftar) — padahal konsepnya SATU
// workspace yang sama, cuma beda cara melihat isinya (papan per-driver vs
// tabel berfilter). SATU komponen di sini = mustahil drift lagi antara
// keduanya secara tidak sengaja di masa depan.
//
// `stats`/`health` WAJIB angka NYATA dari data mode yang memanggil (aturan
// yang sama dengan WorkspaceHero sendiri) — Papan menghitungnya dari board
// per tipe job aktif (driver/available unit), Daftar dari daftar job hasil
// filter yang sedang tampil (driver/selesai/tanpa driver). Keduanya cuma
// kebetulan mengisi 4 kotak yang SAMA BENTUKNYA, BUKAN angka dari sumber
// yang sama — jangan coba menyamakan label/artinya, itu memang beda.
//
// Tanggal SENGAJA satu tanggal pasti (bukan rentang, bukan kosong/"Semua
// tanggal") di KEDUA mode — Papan sudah begitu sejak awal (board per hari,
// GET /armada/board cuma dukung satu tanggal, bukan `from`/`to`), Daftar
// disamakan ke situ (sebelumnya default "Semua tanggal" nullable) supaya
// perilaku date picker konsisten dipindah-pindah mode, bukan cuma tampilan.
export default function DeliveryPageHero({ date, onDateChange, onCreateJob, health, stats }) {
  return (
    <>
      <PageHeader
        title="Delivery & Fulfillment"
        subtitle="Penjadwalan armada, rute, dan proof of delivery."
        actions={
          <div className="flex items-center gap-2">
            <DatePicker value={date} onChange={onDateChange} placeholder="Pilih tanggal" />
            <Button onClick={onCreateJob} className="h-10">
              <Plus className="h-4 w-4" /> Buat Job
            </Button>
          </div>
        }
      />
      {stats && stats.length > 0 && (
        <div className="mb-5">
          <WorkspaceHero
            tone="blue"
            title="Delivery command center"
            subtitle="Pantau jadwal pengambilan & pengiriman hari ini, penugasan driver, dan unit yang belum masuk job."
            health={health}
            stats={stats}
          />
        </div>
      )}
    </>
  );
}
