import React, { useId, useState } from "react";
import { Receipt, Search } from "lucide-react";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Uang, Pilihan, tanggalPendek, LABEL_DIVISI, SelBukti } from "@/features/finance/shared.jsx";
import { useKontrak, IsiDefinisi } from "@/features/finance/kontrakData.jsx";
import { IsiKenapaBeda } from "@/features/finance/kontrak.jsx";
import { NominalDenganBiaya } from "@/features/finance/biayaAdminTampil.jsx";
import { RowActions } from "@/features/finance/RowActions.jsx";
import { klikBuka } from "@/features/finance/PanelDetail.jsx";
import { LogoBank } from "@/features/finance/RingkasanPanels.jsx";
import { Pembuka, Cakupan } from "@/features/finance/RingkasanKecil.jsx";
import { LABEL_STATUS } from "@/features/finance/shared.jsx";
import {
  STATUS_TAB, teksMode, nadaStatus, statusBukti, sumberDana, kalimatBatas, jumlahFilterAktif,
} from "@/features/finance/pengeluaranTampilan.js";
import { Info, Filter, X } from "lucide-react";

// Panel-panel halaman Pengeluaran (gaya: styles/sanss-finance-biaya.css, dikunci ke .fin-by; kontrol & KPI memakai bahasa visual Ringkasan).
// HANYA presentasi: data, filter, endpoint, aksi baris, dan hak akses datang dari FinanceExpenses.jsx tanpa perubahan.

/** KPI statis (tidak dapat diklik) — kelas kartu sama dengan Ringkasan agar warna/ubin/tipografi identik. */
export function KpiStatis({ nada, Ikon, label, nilai, ket, info, metrik, penanda }) {
  const kontrak = useKontrak();
  const m = metrik ? kontrak?.peta.get(metrik) : null;
  return (
    <div className={`fin-kpi fin-kpi-statis fin-kpi-${nada}`} role="group" aria-label={`${label}: ${nilai}. ${ket}`}>
      <div className="fin-kpi-atas">
        {Ikon && <span className="fin-kpi-ubin" aria-hidden="true"><Ikon size={22} /></span>}
        <div className="fin-kpi-label">
          <span>{label}</span>
          {(m || info) && (
            <InfoTooltip lebar={304} text={<>
              {m && <IsiDefinisi m={m} />}
              {info && <span className="block" style={m ? { marginTop: 8 } : undefined}>{info}</span>}
            </>} />
          )}
        </div>
      </div>
      {penanda && <p className="fin-kpi-penanda">{penanda}</p>}
      <p className="fin-kpi-nilai">{String(nilai).split(".").map((s, i, arr) => (i < arr.length - 1 ? <React.Fragment key={i}>{s}.<wbr /></React.Fragment> : s))}</p>
      <p className="fin-kpi-ket">{ket}</p>
    </div>
  );
}

/** Strip penjelasan singkat + "Tentang angka" (penjelasan lengkap pengakuan beban, reimbursement, utang, dan pasangan angka). */
export function StripBiaya({ milikSendiri, periode }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  return (
    <section className="fin-by-strip" aria-label="Catatan angka pengeluaran">
      <div className="fin-by-strip-baris">
        <Info size={18} aria-hidden="true" className="fin-by-strip-ikon" />
        <p className="fin-by-strip-teks">Biaya dicatat saat disetujui. Pembayaran dapat terjadi di waktu berbeda.</p>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pill fin-pill-info" ikonKiri={<Info size={16} aria-hidden="true" />}>Tentang angka</Pembuka>
      </div>
      {buka && (
        <div id={id} className="fin-by-strip-isi">
          <p>Beban diakui di buku besar saat pengeluaran <b>disetujui</b>, bukan saat dibuat — pengajuan yang belum tentu disetujui bukan beban.</p>
          <p>Untuk reimbursement (uang ditalangi karyawan) dan utang, pengakuan beban dan keluarnya uang adalah dua kejadian terpisah: beban tetap masuk bulan ini walau uangnya baru diganti bulan depan.</p>
          <p className="fin-asli">Istilah asli sistem: reimbursement = penggantian uang karyawan yang menalangi biaya.</p>
          <IsiKenapaBeda metrik={["pengeluaran_aktif", "pembelian_aktif", "uang_muka_operasional_saldo", "komitmen_belum_dibayar", "uang_keluar_kas", "beban_diakui"]} from={periode?.from} to={periode?.to} />
        </div>
      )}
      {milikSendiri && <p className="fin-by-catatan">Anda melihat pengajuan milik sendiri saja. Persetujuan dan pembayaran dikerjakan tim Finance.</p>}
    </section>
  );
}

/** Toolbar: tahap proses, pencarian, filter utama, "Filter lainnya", jumlah hasil & batas data — satu panel. */
export function ToolbarBiaya({ status, setStatus, q, setQ, f, kategori, rekening, atur, onReset, hasil, perStatus }) {
  const [lain, setLain] = useState(false);
  const idLain = useId();
  const aktif = jumlahFilterAktif({ fKategori: f.kategori.nilai, fDivisi: f.divisi.nilai, fMode: f.mode.nilai, fRekening: f.rekening.nilai, fBukti: f.bukti.nilai, q });
  const lainAktif = [f.rekening.nilai, f.bukti.nilai].filter(Boolean).length;
  return (
    <div className="fin-by-toolbar">
      <div className="fin-seg" role="group" aria-label="Tahap proses">
        {STATUS_TAB.map((t) => (
          <button key={t.key || "semua"} type="button" className="fin-seg-item" aria-pressed={status === t.key} onClick={() => setStatus(t.key)}>
            {t.label}{perStatus && t.key && perStatus[t.key]?.jumlah ? <span className="fin-seg-n">{perStatus[t.key].jumlah.toLocaleString("id-ID")}</span> : null}
          </button>
        ))}
      </div>
      <div className="fin-by-cari-baris">
        <label className="fin-by-cari">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, keterangan, penerima, nominal…" aria-label="Cari pengeluaran" />
        </label>
        <Pilihan value={f.kategori.nilai} onChange={f.kategori.ubah} aria-label="Kategori" className="fin-by-pilih">
          <option value="">Kategori</option>{kategori.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </Pilihan>
        <Pilihan value={f.divisi.nilai} onChange={f.divisi.ubah} aria-label="Divisi" className="fin-by-pilih">
          <option value="">Divisi</option>{Object.entries(LABEL_DIVISI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Pilihan>
        <Pilihan value={f.mode.nilai} onChange={f.mode.ubah} aria-label="Cara bayar" className="fin-by-pilih">
          <option value="">Cara bayar</option>{Object.entries({ LANGSUNG: "Bayar langsung", REIMBURSEMENT: "Reimbursement", UTANG: "Utang" }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Pilihan>
        <Pembuka buka={lain} onToggle={() => setLain((v) => !v)} id={idLain} className="fin-pill fin-by-lain" ikonKiri={<Filter size={16} aria-hidden="true" />}>
          Filter lainnya{lainAktif > 0 && <span className="fin-lencana" aria-label={`${lainAktif} filter aktif`}>{lainAktif}</span>}
        </Pembuka>
      </div>
      {lain && (
        <div id={idLain} className="fin-by-lain-isi">
          <label className="fin-by-isian"><span>Rekening / bank</span>
            <Pilihan value={f.rekening.nilai} onChange={f.rekening.ubah} aria-label="Rekening atau bank">
              <option value="">Semua rekening</option>{rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </label>
          <label className="fin-by-isian"><span>Status bukti</span>
            <Pilihan value={f.bukti.nilai} onChange={f.bukti.ubah} aria-label="Status bukti">
              <option value="">Semua</option><option value="ada">Ada nota</option><option value="tanpa">Tanpa nota</option><option value="terverifikasi">Terverifikasi</option><option value="belum">Belum diverifikasi</option>
            </Pilihan>
          </label>
        </div>
      )}
      <div className="fin-by-hasil">
        <p className="fin-by-hasil-teks" aria-live="polite">{hasil.teks}</p>
        {aktif > 0 && <button type="button" className="fin-tombol" onClick={onReset}><X size={15} aria-hidden="true" /><span>Atur ulang filter</span></button>}
      </div>
      {hasil.catatan && <p className="fin-by-catatan">{hasil.catatan}</p>}
    </div>
  );
}

// klikBuka() juga mengembalikan { clickable } khusus <TR>; di <li> prop itu dibuang. Klik pada tombol/tautan/pilihan di dalam baris tidak membuka rincian.
const propBaris = (buka) => { const { clickable, ...sisa } = klikBuka(buka); return sisa; };

function ChipStatus({ status }) {
  const nada = nadaStatus(status);
  return <span className={`fin-chip fin-chip-${nada === "perhatian" ? "perhatian" : nada === "biru" ? "biru" : nada}`}>{LABEL_STATUS[status] || status}</span>;
}

function SumberDana({ e, peta }) {
  const s = sumberDana(e, peta);
  if (!s.ada) return <span className="fin-by-sekunder">{s.teks}</span>;
  return (
    <span className="fin-by-sumber" title={`Sumber dana: ${s.nama}${s.namaBank ? ` (${s.namaBank})` : ""}`}>
      <LogoBank r={s.rekening} />
      <span className="fin-by-sumber-nama">{s.nama}</span>
    </span>
  );
}

function BarisBiaya({ e, peta, aksi, renderAksi, onBuka }) {
  const b = statusBukti(e);
  return (
    <li className="fin-by-baris" data-testid="baris-pengeluaran" {...propBaris(() => onBuka(e))}>
      <div className="fin-by-ket">
        <span className="fin-by-nama" title={e.description}>{e.description}</span>
        <span className="fin-by-nomor">{e.expenseNumber}</span>
        {e.reimburseTo && <span className="fin-by-sekunder" title={`ditalangi ${e.reimburseTo.name}`}>ditalangi {e.reimburseTo.name}</span>}
        {e.supplier && <span className="fin-by-sekunder" title={`ke ${e.supplier.name}`}>ke {e.supplier.name}</span>}
        {!e.supplier && e.payeeName && e.payeeName.trim().toLowerCase() !== (e.reimburseTo?.name || "").trim().toLowerCase() && <span className="fin-by-sekunder" title={`ke ${e.payeeName}`}>ke {e.payeeName}</span>}
      </div>
      <div className="fin-by-tgl"><span className="fin-by-label-kecil">Tanggal</span>{tanggalPendek(e.date)}</div>
      <div className="fin-by-klas">
        <span className="fin-by-label-kecil">Divisi / kategori</span>
        <span className="fin-by-isi" title={LABEL_DIVISI[e.division] || e.division}>{LABEL_DIVISI[e.division] || e.division}</span>
        <span className="fin-by-sekunder" title={e.category?.name}>{e.category?.name}</span>
      </div>
      <div className="fin-by-bayar">
        <span className="fin-by-label-kecil">Cara bayar / sumber dana</span>
        <span className="fin-chip fin-chip-neutral fin-by-mode" title="Cara bayar">{teksMode(e.mode)}</span>
        <SumberDana e={e} peta={peta} />
      </div>
      <div className="fin-by-nominal"><span className="fin-by-label-kecil">Nominal</span><NominalDenganBiaya d={e} /></div>
      <div className="fin-by-status">
        <ChipStatus status={e.status} />
        <span className={`fin-by-bukti fin-by-bukti-${b.nada}`}>
          <SelBukti doc={e} jenis="expenses" aksi={aksi} compact />
          <span className="fin-by-bukti-teks" title={b.sub ? `${b.label} (${b.sub})` : b.label}>{b.label}</span>
        </span>
      </div>
      <div className="fin-by-aksi" data-tanpa-detail>{renderAksi(e)}</div>
    </li>
  );
}

export function DaftarBiaya({ expenses, peta, aksi, renderAksi, onBuka, kosongAwal, onBaru, onReset }) {
  if (expenses.length === 0) {
    return (
      <div className="fin-by-kosong">
        <EmptyState
          icon={Receipt}
          title={kosongAwal ? "Belum ada pengeluaran" : "Tidak ada hasil"}
          description={kosongAwal ? "Belum ada pengeluaran pada periode ini." : "Tidak ada pengeluaran yang cocok dengan filter ini."}
          action={kosongAwal ? <Button size="sm" onClick={onBaru}>Catat pengeluaran</Button> : <button type="button" className="fin-tombol" onClick={onReset}><span>Atur ulang filter</span></button>}
        />
      </div>
    );
  }
  return (
    <div className="fin-by-daftar">
      <div className="fin-by-kepala" aria-hidden="true">
        <span>Keterangan / nomor</span><span>Tanggal</span><span>Divisi / kategori</span><span>Cara bayar / sumber dana</span><span className="fin-kanan">Nominal</span><span>Status / bukti</span><span className="fin-kanan">Tindakan</span>
      </div>
      <ul className="fin-by-baris-daftar" aria-label="Daftar pengeluaran">
        {expenses.map((e) => <BarisBiaya key={e.id} e={e} peta={peta} aksi={aksi} renderAksi={renderAksi} onBuka={onBuka} />)}
      </ul>
    </div>
  );
}

export { Cakupan, kalimatBatas };
