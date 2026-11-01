import React, { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, FileText, Search } from "lucide-react";
import { Uang, Pilihan, tanggalPendek } from "@/features/finance/shared.jsx";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import { statusLabel, statusVariant, STATUS_FILTERS } from "@/features/armada/pengajuanBiayaStatus.js";
import { konteksLabel, pesanBukan } from "@/features/pengajuanBiaya/logika.js";

// Presentasi Pengajuan Biaya Divisi di Finance (gaya="finance"). Gaya: styles/sanss-finance-biaya.css (.fin-pbd). HANYA tampilan:
// data, status, form, detail, dan aksi (ajukan/tarik/batalkan/revisi) tetap di PengajuanBiayaWorkspace.jsx; persetujuan & pembayaran tetap di Pengeluaran.

const NADA = { neutral: "neutral", orange: "perhatian", green: "green", red: "red", accent: "biru" };

function ChipPengajuan({ status }) {
  return <span className={`fin-chip fin-chip-${NADA[statusVariant(status)] || "neutral"}`}>{statusLabel(status)}</span>;
}

const inisial = (nama) => String(nama || "?").trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";

/** Kepala divisi terpilih: nama + satu kalimat kebutuhan, "Panduan pengajuan" (penjelasan lengkap & tautan modul lain), dan tindakan. */
export function KepalaDivisi({ ui, ringkas, workspace, arahan, aksi }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  return (
    <div className="fin-pbd-bagian">
      <div className="fin-pbd-kepala">
        <p className="fin-pbd-judul">{ui.singkat || ui.judul}<small> · {ringkas}</small></p>
        <div className="fin-pbd-tindakan">
          <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pill fin-pill-info">Panduan pengajuan</Pembuka>
          {aksi}
        </div>
      </div>
      <p className="fin-by-catatan fin-pbd-alur">
        Persetujuan dan pembayaran dilakukan melalui <Link to="/finance/expenses" className="fin-nav fin-nav-teks">Pengeluaran<ChevronRight size={14} aria-hidden="true" /></Link>
      </p>
      {buka && (
        <div id={id} className="fin-pbd-panduan" data-testid="bukan-stok">
          <p>{pesanBukan(workspace)}</p>
          {arahan?.length > 0 && (
            <p className="fin-pbd-tautan-baris">
              {arahan.map((a) => <Link key={a.path} to={a.path} className="fin-nav fin-nav-teks">{a.ke}<ChevronRight size={14} aria-hidden="true" /></Link>)}
            </p>
          )}
          <p>Pengajuan yang disetujui menjadi pengeluaran di Finance. Koreksi setelah masuk buku besar dilakukan Finance lewat Pengeluaran, bukan dari halaman ini.</p>
        </div>
      )}
    </div>
  );
}

/** Toolbar terpadu: satu pencarian + satu filter status (yang sudah ada). */
export function ToolbarPengajuan({ q, setQ, status, setStatus, jumlah, kosongFilter, onReset }) {
  return (
    <div className="fin-by-toolbar">
      <div className="fin-by-cari-baris">
        <label className="fin-by-cari">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, vendor, mesin, gudang…" aria-label="Cari pengajuan" />
        </label>
        <Pilihan value={status} onChange={setStatus} aria-label="Filter status" className="fin-by-pilih">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s ? statusLabel(s) : "Semua status"}</option>)}
        </Pilihan>
      </div>
      <div className="fin-by-hasil">
        <p className="fin-by-hasil-teks" aria-live="polite">{jumlah.toLocaleString("id-ID")} pengajuan{kosongFilter ? "" : " · sesuai filter"}</p>
        {!kosongFilter && <button type="button" className="fin-tombol" onClick={onReset}><span>Atur ulang filter</span></button>}
      </div>
    </div>
  );
}

/** Daftar pengajuan: Pengajuan/nomor | Pengaju | Nominal | Status | Rincian. Seluruh baris membuka rincian yang sudah ada. */
export function DaftarPengajuan({ rows, cfg, jenisLabel, onBuka }) {
  return (
    <div className="fin-pbd-daftar-bungkus">
      <div className="fin-pbd-kepala-tabel" aria-hidden="true">
        <span>Pengajuan / nomor</span><span>Pengaju</span><span className="fin-kanan">Nominal</span><span>Status</span><span className="fin-kanan">Rincian</span>
      </div>
      <ul className="fin-pbd-daftar" aria-label="Daftar pengajuan biaya">
        {rows.map((r) => {
          const konteks = konteksLabel(r, cfg) || r.vendorName || "";
          const pengaju = r.requestedBy?.name || r.picNameSnapshot || "";
          return (
            <li key={r.id}>
              <button type="button" className="fin-pbd-baris" onClick={() => onBuka(r)} data-testid="baris-pengajuan">
                <span className="fin-pbd-ket">
                  <span className="fin-pbd-nama">{jenisLabel(r.expenseType)}</span>
                  <span className="fin-pbd-nomor">{r.submissionNumber} · {tanggalPendek(r.date)}</span>
                  {konteks && <span className="fin-by-sekunder" title={konteks}>{konteks}</span>}
                </span>
                <span className="fin-pbd-pengaju">
                  {pengaju ? <><span className="fin-pbd-avatar" aria-hidden="true">{inisial(pengaju)}</span><span className="fin-pbd-pengaju-nama">{pengaju}</span></> : <span className="fin-redup">—</span>}
                </span>
                <span className="fin-pbd-nominal"><Uang value={r.amount} /></span>
                <span className="fin-pbd-status"><ChipPengajuan status={r.status} /></span>
                <span className="fin-pbd-rincian">Rincian<ChevronRight size={16} aria-hidden="true" /></span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Keadaan kosong: awal (belum pernah ada pengajuan di divisi ini) vs hasil filter kosong. Tombol hanya bila `aksi` diberikan. */
export function KosongPengajuan({ awal, aksi, onReset }) {
  return (
    <div className="fin-pbd-kosong" data-testid="kosong">
      <span className="fin-pbd-kosong-ikon" aria-hidden="true"><FileText size={26} /></span>
      <h3>{awal ? "Belum ada pengajuan di divisi ini" : "Tidak ada hasil"}</h3>
      <p>{awal ? "Ajukan kebutuhan divisi untuk memulai proses pengajuan." : "Tidak ada pengajuan yang cocok dengan pencarian atau filter ini."}</p>
      {awal ? aksi : <button type="button" className="fin-tombol" onClick={onReset}><span>Atur ulang filter</span></button>}
    </div>
  );
}
