import React, { useEffect, useRef, useState } from "react";
import { api } from "@/api.js";
import { HalamanFinance } from "@/features/finance/shared.jsx";
import { WORKSPACES_UI, URUTAN_WORKSPACE } from "@/features/pengajuanBiaya/logika.js";
import PengajuanBiayaWorkspace from "@/pages/pengajuanBiaya/PengajuanBiayaWorkspace.jsx";
import { IkMesin, IkGudang, IkMegafon, IkKantor, IkKaryawan } from "@/components/financeIconsBiaya.jsx";

// HUB PENGAJUAN BIAYA DIVISI (C2) — satu tempat bagi Finance/Admin/Owner untuk melihat dan mencatat pengajuan SEMUA divisi
// (Produksi, Gudang, Marketing, Management, HR-GA). Tidak ada halaman salinan per divisi: setiap tab memakai komponen workspace yang sama.
// Tab yang tampil = workspace yang diizinkan SERVER untuk pengguna ini (403 = tidak tampil); tidak ada akses lintas divisi implisit.
// Tampilan (1 Nov 2026): gaya="finance" — pemilih divisi rounded, KPI padat, daftar ringkas; persetujuan/pembayaran TETAP di Finance › Pengeluaran.

const IKON = { PRODUKSI: IkMesin, WAREHOUSE: IkGudang, MARKETING: IkMegafon, MANAGEMENT: IkKantor, HR_GA: IkKaryawan };

export default function PengajuanBiayaHub() {
  const [tersedia, setTersedia] = useState(null);
  const [aktif, setAktif] = useState("");
  const refTab = useRef({});

  useEffect(() => {
    let batal = false;
    Promise.allSettled(URUTAN_WORKSPACE.map((ws) => api.getExpenseSubmissionConfig(ws).then(() => ws))).then((hasil) => {
      if (batal) return;
      const ok = hasil.filter((h) => h.status === "fulfilled").map((h) => h.value);
      setTersedia(ok); setAktif((a) => a || ok[0] || "");
    });
    return () => { batal = true; };
  }, []);

  // Panah kiri/kanan memindahkan pilihan divisi (pola tablist).
  function tombol(e, i) {
    const n = (tersedia || []).length;
    if (!n || (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End")) return;
    e.preventDefault();
    const ke = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
    setAktif(tersedia[ke]); refTab.current[tersedia[ke]]?.focus();
  }

  return (
    <HalamanFinance className="fin-halaman" title="Pengajuan biaya divisi" subtitle="Ajukan kebutuhan divisi dan pantau prosesnya." loading={tersedia === null}>
      {tersedia && tersedia.length === 0 ? (
        <p className="rounded-xl bg-inset px-4 py-6 text-center text-[13px] text-ink3" data-testid="hub-kosong">Anda tidak punya akses ke pengajuan biaya divisi mana pun.</p>
      ) : (
        <div className="fin-ring">
          <div role="tablist" aria-label="Divisi" className="fin-pbd-divisi" data-testid="hub-tab">
            {(tersedia || []).map((ws, i) => {
              const Ikon = IKON[ws];
              return (
                <button key={ws} type="button" role="tab" ref={(el) => { refTab.current[ws] = el; }} aria-selected={aktif === ws} tabIndex={aktif === ws ? 0 : -1}
                  onClick={() => setAktif(ws)} onKeyDown={(e) => tombol(e, i)} className="fin-pbd-divisi-item">
                  {Ikon && <Ikon size={18} />}{WORKSPACES_UI[ws].singkat || WORKSPACES_UI[ws].judul.replace("Pengajuan Biaya ", "")}
                </button>
              );
            })}
          </div>
          {aktif && <PengajuanBiayaWorkspace key={aktif} workspace={aktif} embedded gaya="finance" />}
        </div>
      )}
    </HalamanFinance>
  );
}
