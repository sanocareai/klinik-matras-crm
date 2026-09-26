import React, { useEffect, useState } from "react";
import { api } from "@/api.js";
import { HalamanFinance } from "@/features/finance/shared.jsx";
import { WORKSPACES_UI, URUTAN_WORKSPACE } from "@/features/pengajuanBiaya/logika.js";
import PengajuanBiayaWorkspace from "@/pages/pengajuanBiaya/PengajuanBiayaWorkspace.jsx";

// HUB PENGAJUAN BIAYA DIVISI (C2) — satu tempat bagi Finance/Admin/Owner untuk melihat dan mencatat pengajuan SEMUA divisi
// (Produksi, Gudang, Marketing, Management, HR-GA). Tidak ada halaman salinan per divisi: setiap tab memakai komponen workspace yang sama.
// Tab yang tampil = workspace yang diizinkan SERVER untuk pengguna ini (403 = tidak tampil); tidak ada akses lintas divisi implisit.

export default function PengajuanBiayaHub() {
  const [tersedia, setTersedia] = useState(null);
  const [aktif, setAktif] = useState("");

  useEffect(() => {
    let batal = false;
    Promise.allSettled(URUTAN_WORKSPACE.map((ws) => api.getExpenseSubmissionConfig(ws).then(() => ws))).then((hasil) => {
      if (batal) return;
      const ok = hasil.filter((h) => h.status === "fulfilled").map((h) => h.value);
      setTersedia(ok); setAktif((a) => a || ok[0] || "");
    });
    return () => { batal = true; };
  }, []);

  return (
    <HalamanFinance title="Pengajuan Biaya Divisi" subtitle="Lihat dan catat pengajuan biaya semua divisi. Persetujuan dan pembayaran tetap di Finance › Pengeluaran." loading={tersedia === null}>
      {tersedia && tersedia.length === 0 ? (
        <p className="rounded-xl bg-inset px-4 py-6 text-center text-[13px] text-ink3" data-testid="hub-kosong">Anda tidak punya akses ke pengajuan biaya divisi mana pun.</p>
      ) : (
        <>
          <div role="tablist" aria-label="Divisi" className="flex flex-wrap gap-2" data-testid="hub-tab">
            {(tersedia || []).map((ws) => (
              <button key={ws} type="button" role="tab" aria-selected={aktif === ws} onClick={() => setAktif(ws)}
                className={`min-h-11 rounded-xl px-4 text-[13px] font-medium ${aktif === ws ? "bg-accent text-white" : "bg-inset text-ink2 hover:text-ink"}`}>
                {WORKSPACES_UI[ws].singkat || WORKSPACES_UI[ws].judul.replace("Pengajuan Biaya ", "")}
              </button>
            ))}
          </div>
          {aktif && <PengajuanBiayaWorkspace key={aktif} workspace={aktif} embedded />}
        </>
      )}
    </HalamanFinance>
  );
}
