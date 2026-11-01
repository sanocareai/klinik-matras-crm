import React from "react";
import { ArrowRight, ArrowLeftRight, Search, TrendingUp, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Pilihan, tanggalPendek } from "@/features/finance/shared.jsx";
import { LogoBank } from "@/features/finance/RingkasanPanels.jsx";
import { klikBuka } from "@/features/finance/PanelDetail.jsx";
import { ChipKs, tampilUang } from "@/features/finance/kasbank/KasBankPanels.jsx";
import { statusTransfer, komponenTransfer, kalimatTransfer, petaRekening } from "@/features/finance/kasbank/kasBankTampilan.js";

// Daftar Transfer antar-rekening dan Pemasukan Lain (gaya: sanss-finance-kasbank.css). HANYA presentasi: data, aksi menu (Koreksi/Riwayat/Batalkan), dan izin dari FinanceCash.jsx.

const propBaris = (buka) => { const { clickable, ...sisa } = klikBuka(buka); return sisa; };

function Pihak({ rek, nama }) {
  return (
    <span className="fin-ks-pihak" title={nama}>
      {rek ? <LogoBank r={rek} /> : <span className="fin-logo fin-logo-ikon" data-jenis="BANK_LAIN" aria-hidden="true" />}
      <span className="fin-ks-pihak-nama">{nama || "—"}</span>
    </span>
  );
}

export function ToolbarTransfer({ q, setQ, dari, setDari, ke, setKe, status, setStatus, opsiDari, opsiKe, hasil, aktif, onReset }) {
  return (
    <div className="fin-ks-toolbar">
      <div className="fin-ks-cari-baris">
        <label className="fin-ks-cari">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, rekening, nominal…" aria-label="Cari transfer" />
        </label>
        <Pilihan value={dari} onChange={setDari} aria-label="Dari rekening" className="fin-ks-pilih"><option value="">Dari</option>{opsiDari.map((n) => <option key={n} value={n}>{n}</option>)}</Pilihan>
        <Pilihan value={ke} onChange={setKe} aria-label="Ke rekening" className="fin-ks-pilih"><option value="">Ke</option>{opsiKe.map((n) => <option key={n} value={n}>{n}</option>)}</Pilihan>
        <Pilihan value={status} onChange={setStatus} aria-label="Status transfer" className="fin-ks-pilih"><option value="">Status</option><option value="posting">Terposting</option><option value="batal">Dibatalkan</option></Pilihan>
      </div>
      <div className="fin-ks-hasil">
        <p className="fin-ks-hasil-teks" aria-live="polite">{hasil.teks}</p>
        {aktif > 0 && <button type="button" className="fin-tombol" onClick={onReset}><X size={15} aria-hidden="true" /><span>Atur ulang filter</span></button>}
      </div>
      {hasil.catatan && <p className="fin-ks-catatan">{hasil.catatan}</p>}
    </div>
  );
}

function BarisTransfer({ t, peta, nominal, renderAksi, onBuka }) {
  const st = statusTransfer(t);
  const asal = peta.get(t.fromAccountId) || peta.get(t.fromAccount?.id);
  const tujuan = peta.get(t.toAccountId) || peta.get(t.toAccount?.id);
  return (
    <li className="fin-ks-trf" data-status={st.kode} data-testid="baris-transfer" {...propBaris(() => onBuka(t))}>
      <div className="fin-ks-t-nomor">
        <span className="fin-ks-t-no">{t.transferNumber}</span>
        <span className="fin-ks-sekunder fin-ks-t-tglsisip">{tanggalPendek(t.date)}</span>
        {(t.reference || t.notes) && <span className="fin-ks-sekunder" title={t.reference || t.notes}>{t.reference || t.notes}</span>}
      </div>
      <div className="fin-ks-t-tgl"><span className="fin-ks-label-kecil">Tanggal</span>{tanggalPendek(t.date)}</div>
      <div className="fin-ks-t-arah">
        <Pihak rek={asal} nama={t.fromAccount?.name} />
        <ArrowRight size={16} aria-hidden="true" className="fin-ks-t-panah" />
        <Pihak rek={tujuan} nama={t.toAccount?.name} />
      </div>
      <div className="fin-ks-t-nominal"><span className="fin-ks-label-kecil">Nominal</span><span className="fin-ks-nilai">{nominal(t)}</span></div>
      <div className="fin-ks-t-status"><ChipKs nada={st.nada}>{st.label}</ChipKs></div>
      <div className="fin-ks-t-aksi" data-tanpa-detail>{renderAksi(t)}</div>
    </li>
  );
}

export function DaftarTransfer({ transfers, tampil, accounts, nominal, renderAksi, onBuka, onBaru, onReset }) {
  if (transfers.length === 0) {
    return <div className="fin-ks-kosong"><EmptyState icon={ArrowLeftRight} title="Belum ada transfer" description="Belum ada perpindahan uang antar rekening pada periode ini." action={onBaru ? <Button size="sm" onClick={onBaru}>Catat transfer</Button> : null} /></div>;
  }
  if (tampil.length === 0) {
    return <div className="fin-ks-kosong"><EmptyState icon={Search} title="Tidak ada hasil" description="Tidak ada transfer yang cocok dengan pencarian atau filter ini." action={<button type="button" className="fin-tombol" onClick={onReset}><span>Atur ulang filter</span></button>} /></div>;
  }
  const peta = petaRekening(accounts);
  return (
    <div className="fin-ks-daftar fin-ks-daftar-trf">
      <div className="fin-ks-kepala fin-ks-kepala-trf" aria-hidden="true">
        <span>Transfer / nomor</span><span>Tanggal</span><span>Dari → Ke</span><span className="fin-kanan">Nominal</span><span>Status</span><span className="fin-kanan">Menu</span>
      </div>
      <ul className="fin-ks-baris-daftar" aria-label="Daftar transfer antar-rekening">
        {tampil.map((t) => <BarisTransfer key={t.id} t={t} peta={peta} nominal={nominal} renderAksi={renderAksi} onBuka={onBuka} />)}
      </ul>
    </div>
  );
}

/** Spec rincian transfer (untuk RincianKb): nilai transfer, biaya admin, total keluar dari asal, diterima tujuan — hanya yang dikirim server. */
export function specTransfer(t, { aksi } = {}) {
  const st = statusTransfer(t);
  const k = komponenTransfer(t);
  return {
    judul: t.transferNumber, sub: `${t.fromAccount?.name || "—"} → ${t.toAccount?.name || "—"}`, chip: { label: st.label, nada: st.nada },
    ringkas: [
      ["Nilai transfer", tampilUang(k.nilai)],
      ["Biaya admin", k.biaya > 0 ? tampilUang(k.biaya) : "Tidak ada"],
      ["Total keluar dari rekening asal", k.totalKeluar != null ? tampilUang(k.totalKeluar) : "—", "oranye"],
      ["Diterima rekening tujuan", k.diterima != null ? tampilUang(k.diterima) : "—", "hijau"],
    ],
    bagian: [
      { judul: "Transfer", baris: [["Tanggal", tanggalPendek(t.date)], ["Dari rekening", t.fromAccount?.name], ["Ke rekening", t.toAccount?.name], ["Referensi", t.reference], ["Catatan", t.notes ?? t.note], ["Dicatat oleh", t.createdBy?.name]] },
      ...(t.cancelledAt ? [{ judul: "Pembatalan", baris: [["Dibatalkan pada", tanggalPendek(t.cancelledAt)], ["Alasan", t.cancelReason]] }] : []),
    ],
    catatan: [
      { teks: "Transfer antar-rekening memindahkan uang milik perusahaan yang sama: bukan pendapatan dan bukan beban. Biaya admin dicatat terpisah dari nilai transfer." },
      ...(t.cancelledAt ? [{ teks: "Transfer ini dibatalkan; jurnalnya sudah dibalik dan riwayatnya tetap tersimpan.", nada: "peringatan" }] : []),
    ],
    aksi,
  };
}

// ── Pemasukan Lain (akses lama dipertahankan; ringkasan & analisis ada di halaman Pemasukan) ───────────────────────────────────────
export function ToolbarPemasukanLain({ q, setQ, akun, setAkun, masuk, setMasuk, opsiAkun, opsiMasuk, hasil, aktif, onReset }) {
  return (
    <div className="fin-ks-toolbar">
      <div className="fin-ks-cari-baris">
        <label className="fin-ks-cari">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor, keterangan, nominal…" aria-label="Cari pemasukan lain" />
        </label>
        <Pilihan value={akun} onChange={setAkun} aria-label="Akun pendapatan" className="fin-ks-pilih"><option value="">Akun</option>{opsiAkun.map((n) => <option key={n} value={n}>{n}</option>)}</Pilihan>
        <Pilihan value={masuk} onChange={setMasuk} aria-label="Masuk ke rekening" className="fin-ks-pilih"><option value="">Masuk ke</option>{opsiMasuk.map((n) => <option key={n} value={n}>{n}</option>)}</Pilihan>
      </div>
      <div className="fin-ks-hasil">
        <p className="fin-ks-hasil-teks" aria-live="polite">{hasil}</p>
        {aktif > 0 && <button type="button" className="fin-tombol" onClick={onReset}><X size={15} aria-hidden="true" /><span>Atur ulang filter</span></button>}
      </div>
    </div>
  );
}

function BarisPemasukan({ i, peta, renderAksi, onBuka, nominal }) {
  const rek = peta.get(i.cashAccountId) || peta.get(i.cashAccount?.id);
  return (
    <li className="fin-ks-trf fin-ks-pml" data-testid="baris-pemasukan-lain" {...propBaris(() => onBuka(i))}>
      <div className="fin-ks-t-nomor">
        <span className="fin-ks-t-no">{i.incomeNumber}</span>
        <span className="fin-ks-nama-baris" title={i.description}>{i.description}</span>
      </div>
      <div className="fin-ks-t-tgl"><span className="fin-ks-label-kecil">Tanggal</span>{tanggalPendek(i.date)}</div>
      <div className="fin-ks-t-arah">
        <span className="fin-ks-akun" title={i.account ? `${i.account.code} · ${i.account.name}` : undefined}>{i.account ? `${i.account.code} · ${i.account.name}` : "—"}</span>
        <ArrowRight size={16} aria-hidden="true" className="fin-ks-t-panah" />
        <Pihak rek={rek} nama={i.cashAccount?.name} />
      </div>
      <div className="fin-ks-t-nominal"><span className="fin-ks-label-kecil">Nominal</span><span className="fin-ks-nilai">{nominal(i)}</span></div>
      <div className="fin-ks-t-status"><ChipKs nada={i.cancelledAt ? "merah" : "hijau"}>{i.cancelledAt ? "Dibatalkan" : "Terposting"}</ChipKs></div>
      <div className="fin-ks-t-aksi" data-tanpa-detail>{renderAksi(i)}</div>
    </li>
  );
}

export function DaftarPemasukanLain({ incomes, tampil, accounts, nominal, renderAksi, onBuka, onBaru, onReset }) {
  if (incomes.length === 0) {
    return <div className="fin-ks-kosong"><EmptyState icon={TrendingUp} title="Belum ada pemasukan lain" description="Pemasukan di luar order (jual barang bekas, bunga bank, klaim asuransi) pada periode ini belum ada." action={onBaru ? <Button size="sm" onClick={onBaru}>Catat pemasukan</Button> : null} /></div>;
  }
  if (tampil.length === 0) {
    return <div className="fin-ks-kosong"><EmptyState icon={Search} title="Tidak ada hasil" description="Tidak ada pemasukan yang cocok dengan pencarian atau filter ini." action={<button type="button" className="fin-tombol" onClick={onReset}><span>Atur ulang filter</span></button>} /></div>;
  }
  const peta = petaRekening(accounts);
  return (
    <div className="fin-ks-daftar fin-ks-daftar-trf">
      <div className="fin-ks-kepala fin-ks-kepala-trf" aria-hidden="true">
        <span>Nomor / keterangan</span><span>Tanggal</span><span>Akun → Masuk ke</span><span className="fin-kanan">Nominal</span><span>Status</span><span className="fin-kanan">Menu</span>
      </div>
      <ul className="fin-ks-baris-daftar" aria-label="Daftar pemasukan lain">
        {tampil.map((i) => <BarisPemasukan key={i.id} i={i} peta={peta} nominal={nominal} renderAksi={renderAksi} onBuka={onBuka} />)}
      </ul>
    </div>
  );
}

export function specPemasukanLain(i, { aksi } = {}) {
  return {
    judul: i.incomeNumber, sub: i.description, chip: i.cancelledAt ? { label: "Dibatalkan", nada: "merah" } : { label: "Terposting", nada: "hijau" },
    ringkas: [["Nominal", tampilUang(i.amount), "hijau"]],
    bagian: [
      { judul: "Pemasukan", baris: [["Tanggal", tanggalPendek(i.date)], ["Keterangan", i.description], ["Akun pendapatan", i.account ? `${i.account.code} · ${i.account.name}` : null], ["Masuk ke rekening", i.cashAccount?.name], ["Catatan", i.notes], ["Dicatat oleh", i.createdBy?.name]] },
      ...(i.cancelledAt ? [{ judul: "Pembatalan", baris: [["Dibatalkan pada", tanggalPendek(i.cancelledAt)], ["Alasan", i.cancelReason]] }] : []),
    ],
    catatan: [{ teks: "Pemasukan di luar order pelanggan. Ringkasan dan analisis pemasukan ada di halaman Pemasukan; pencatatan baru tetap lewat tombol “Catat pemasukan” di sini." }],
    aksi,
  };
}

