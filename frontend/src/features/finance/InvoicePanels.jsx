import React, { useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, ChevronRight, FileText, Filter, Info, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { Uang, Pilihan, tanggalPendek, formatUang, TombolAksi } from "@/features/finance/shared.jsx";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import { klikBuka } from "@/features/finance/PanelDetail.jsx";
import { IkAturTempo } from "@/components/financeIconsInvoice.jsx";
import {
  STATUS_INVOICE, TAB_TEMPO, labelStatus, nadaStatus, statusBayar, keteranganBayar, statusDokumen, sumberAngka, keadaanTempo, tanggalWibDalamHari,
} from "@/features/finance/invoiceTampilan.js";

// Panel-panel halaman Invoice Pelanggan (gaya: styles/sanss-finance-invoice.css, dikunci ke .fin-inv).
// HANYA presentasi: data, filter, endpoint, penulisan jatuh tempo (PATCH lama), dan hak akses datang dari FinanceInvoices.jsx tanpa perubahan.

// klikBuka() juga mengembalikan { clickable } khusus <TR>; di <li> prop itu dibuang. Klik pada tombol/tautan/pilihan di dalam baris tidak membuka rincian.
const propBaris = (buka) => { const { clickable, ...sisa } = klikBuka(buka); return sisa; };

function ChipStatus({ nada, children, className = "" }) {
  return <span className={`fin-chip fin-inv-chip-${nada} ${className}`}>{children}</span>;
}

/** Strip penjelasan singkat + "Tentang angka" (apa arti nilai, sisa, dibayar; dasar tanggal; posisi data). */
export function StripInvoice() {
  const [buka, setBuka] = useState(false);
  const id = useId();
  return (
    <section className="fin-inv-strip" aria-label="Catatan angka invoice">
      <div className="fin-inv-strip-baris">
        <Info size={18} aria-hidden="true" className="fin-inv-strip-ikon" />
        <p className="fin-inv-strip-teks">Posisi terkini semua invoice, tanpa pilihan periode.</p>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pill fin-pill-info" ikonKiri={<Info size={16} aria-hidden="true" />}>Tentang angka</Pembuka>
      </div>
      {buka && (
        <div id={id} className="fin-inv-strip-isi">
          <p>Invoice dibuat otomatis saat order dibuat. Halaman ini tidak membuat, mengirim, atau membatalkan invoice, dan tidak mencatat pembayaran masuk.</p>
          <p>Isi invoice (item, harga, alamat) dan pengiriman ke pelanggan lewat WhatsApp atau PDF dikelola dari Rincian Pesanan di CRM. Nominalnya diturunkan dari sumber yang sama dengan invoice yang dikirim ke pelanggan, jadi angkanya tidak berbeda dari dokumen yang sudah mereka terima.</p>
          <p><b>Nilai invoice</b> adalah total tagihan dokumen. <b>Dibayar</b> adalah pembayaran yang tercatat untuk invoice itu. <b>Sisa tagihan</b> adalah selisihnya. Membuat invoice tidak berarti uangnya sudah diterima.</p>
          <p>Daftar menampilkan posisi terkini semua invoice, tanpa pilihan periode. Umur tagihan dihitung dari tanggal jatuh tempo; selama belum diatur, dihitung dari tanggal order dibuat.</p>
          <p className="fin-asli">Istilah asli sistem: status manual = status bayar yang diklik manual di CRM, tanpa entri pembayaran di ledger.</p>
        </div>
      )}
    </section>
  );
}

/** Peringatan jujur: berapa invoice yang angka "dibayar"-nya dari status manual, bukan ledger pembayaran. */
export function PeringatanManual({ jumlah }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  if (!(jumlah > 0)) return null;
  return (
    <section className="fin-inv-peringatan" role="note" aria-label="Invoice dengan status bayar manual">
      <div className="fin-inv-peringatan-baris">
        <AlertTriangle size={20} aria-hidden="true" className="fin-inv-peringatan-ikon" />
        <div className="fin-inv-peringatan-teks">
          <p className="fin-inv-peringatan-judul">{jumlah.toLocaleString("id-ID")} invoice memakai status pembayaran manual.</p>
          <p className="fin-inv-peringatan-isi">Nominal pembayaran mungkin belum tercatat.</p>
        </div>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pill fin-inv-peringatan-btn">Lihat rincian</Pembuka>
      </div>
      {buka && (
        <p id={id} className="fin-inv-peringatan-lengkap">Order-order itu tidak punya satu pun entri pembayaran tercatat — statusnya diklik manual di dropdown CRM. Angka “sudah dibayar”-nya mengikuti status itu apa adanya dan tidak punya rincian siapa menerima, kapan, lewat apa. Baris yang bersangkutan ditandai “Status manual”.</p>
      )}
    </section>
  );
}

/** Toolbar: tab jatuh tempo (filter server), pencarian, status & sales, "Filter lainnya", jumlah hasil & batas data — satu panel. */
export function ToolbarInvoice({ tempo, setTempo, kpi, q, setQ, f, opsiSales, hasil, aktif, onReset }) {
  const [lain, setLain] = useState(false);
  const idLain = useId();
  const lainAktif = [f.sumber.nilai, f.tempo.nilai].filter(Boolean).length;
  const jumlahTab = { lewat: kpi.lewat, belum_diatur: kpi.tanpaTempo };
  return (
    <div className="fin-inv-toolbar">
      <div className="fin-inv-seg" role="group" aria-label="Jatuh tempo">
        {TAB_TEMPO.map((t) => (
          <button key={t.key || "semua"} type="button" className="fin-inv-seg-item" aria-pressed={tempo === t.key} onClick={() => setTempo(t.key)}>
            {t.label}{t.key && jumlahTab[t.key] > 0 ? <span className="fin-inv-seg-n">{jumlahTab[t.key].toLocaleString("id-ID")}</span> : null}
          </button>
        ))}
      </div>
      <div className="fin-inv-cari-baris">
        <label className="fin-inv-cari">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari invoice, order, pelanggan…" aria-label="Cari invoice" />
        </label>
        <Pilihan value={f.status.nilai} onChange={f.status.ubah} aria-label="Status" className="fin-inv-pilih">
          <option value="">Status</option>{Object.entries(STATUS_INVOICE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Pilihan>
        <Pilihan value={f.sales.nilai} onChange={f.sales.ubah} aria-label="Sales" className="fin-inv-pilih">
          <option value="">Sales</option>{opsiSales.map((s) => <option key={s} value={s}>{s}</option>)}
        </Pilihan>
        <Pembuka buka={lain} onToggle={() => setLain((v) => !v)} id={idLain} className="fin-pill fin-inv-lain" ikonKiri={<Filter size={16} aria-hidden="true" />}>
          Filter lainnya{lainAktif > 0 && <span className="fin-lencana" aria-label={`${lainAktif} filter aktif`}>{lainAktif}</span>}
        </Pembuka>
      </div>
      {lain && (
        <div id={idLain} className="fin-inv-lain-isi">
          <label className="fin-inv-isian"><span>Sumber angka dibayar</span>
            <Pilihan value={f.sumber.nilai} onChange={f.sumber.ubah} aria-label="Sumber angka dibayar">
              <option value="">Semua</option><option value="ledger">Ledger</option><option value="manual">Status manual</option>
            </Pilihan>
          </label>
          <label className="fin-inv-isian"><span>Tanggal jatuh tempo</span>
            <Pilihan value={f.tempo.nilai} onChange={f.tempo.ubah} aria-label="Tanggal jatuh tempo">
              <option value="">Semua</option><option value="ada">Sudah diatur</option><option value="belum">Belum diatur</option>
            </Pilihan>
          </label>
        </div>
      )}
      <div className="fin-inv-hasil">
        <p className="fin-inv-hasil-teks" aria-live="polite">{hasil.teks}</p>
        {aktif > 0 && <button type="button" className="fin-tombol" onClick={onReset}><X size={15} aria-hidden="true" /><span>Atur ulang filter</span></button>}
      </div>
      {hasil.catatan && <p className="fin-inv-catatan">{hasil.catatan}</p>}
    </div>
  );
}

function BarisInvoice({ inv, onBuka, onAturTempo }) {
  const ket = keteranganBayar(inv);
  const tempo = keadaanTempo(inv);
  const sumber = sumberAngka(inv);
  const no = inv.invoiceNumber;
  return (
    <li className="fin-inv-baris" data-status={inv.status} data-testid="baris-invoice" {...propBaris(() => onBuka(inv))}>
      <div className="fin-inv-ket">
        <span className="fin-inv-nomor-baris">
          <span className="fin-inv-nomor">{no}</span>
          {inv.jumlahOrder > 1 && <span className="fin-inv-gabung" title="Invoice gabungan: dihitung satu baris">{inv.jumlahOrder} order</span>}
          <span className="fin-inv-tgl-sisip">{tanggalPendek(inv.createdAt)}</span>
        </span>
        <span className="fin-inv-nama" title={inv.customerName || undefined}>{inv.customerName || "—"}</span>
        <span className="fin-inv-sekunder" title={`${inv.orderNumber || "—"}${inv.salesName ? ` · Sales ${inv.salesName}` : ""}`}>{inv.orderNumber || "—"}{inv.salesName ? ` · Sales ${inv.salesName}` : ""}</span>
      </div>
      <div className="fin-inv-tgl"><span className="fin-inv-label-kecil">Dibuat</span>{tanggalPendek(inv.createdAt)}</div>
      <div className="fin-inv-tempo">
        <span className="fin-inv-label-kecil">Jatuh tempo</span>
        {tempo.diatur ? (
          <>
            <span className="fin-inv-isi">{tanggalPendek(inv.dueDate)}</span>
            {tempo.lewat > 0 && <span className="fin-inv-lewat">lewat {tempo.lewat} hari</span>}
          </>
        ) : <span className="fin-inv-redup">belum diatur</span>}
      </div>
      <div className="fin-inv-nilai">
        <span className="fin-inv-label-kecil">Nilai invoice</span>
        <span className="fin-inv-angka"><Uang value={inv.totalTagihan} /></span>
        <span className="fin-inv-sekunder">
          {inv.dibayarTidakRinci && !(inv.dibayar > 0) ? "Dibayar: nominal tidak tercatat" : <>Dibayar <Uang value={inv.dibayar} nolSebagaiStrip />{inv.dibayarTidakRinci ? " · sebagian tidak tercatat" : ""}</>}
        </span>
        {inv.sumber !== "ledger" && <ChipStatus nada={sumber.nada} className="fin-inv-sumber">{sumber.pendek}</ChipStatus>}
      </div>
      <div className="fin-inv-sisa">
        <span className="fin-inv-label-kecil">Sisa tagihan</span>
        <span className="fin-inv-angka fin-inv-angka-sisa"><Uang value={inv.sisa} nolSebagaiStrip /></span>
      </div>
      <div className="fin-inv-status">
        <ChipStatus nada={nadaStatus(inv.status)}>{labelStatus(inv.status)}</ChipStatus>
        {ket && <span className={`fin-inv-bayar fin-inv-bayar-${ket.kode}`}>{ket.kode === "dibatalkan" ? ket.label : `Pembayaran: ${ket.label.toLowerCase()}`}</span>}
      </div>
      <div className="fin-inv-aksi" data-tanpa-detail>
        <button type="button" className="fin-inv-ikon-btn" onClick={() => onAturTempo(inv)} title="Atur jatuh tempo" aria-label={`Atur jatuh tempo ${no}`}>
          <IkAturTempo size={20} />
        </button>
        <button type="button" className="fin-inv-ikon-btn fin-inv-ikon-rincian" onClick={() => onBuka(inv)} title="Buka rincian" aria-label={`Buka rincian ${no}`}>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export function DaftarInvoice({ invoices, onBuka, onAturTempo, kosongAwal, onReset }) {
  if (invoices.length === 0) {
    return (
      <div className="fin-inv-kosong">
        <EmptyState
          icon={FileText}
          title={kosongAwal ? "Belum ada invoice" : "Tidak ada hasil"}
          description={kosongAwal ? "Invoice muncul otomatis begitu order dibuat." : "Belum ada invoice yang cocok dengan filter ini."}
          action={kosongAwal ? null : <button type="button" className="fin-tombol" onClick={onReset}><span>Atur ulang filter</span></button>}
        />
      </div>
    );
  }
  return (
    <div className="fin-inv-daftar">
      <div className="fin-inv-kepala" aria-hidden="true">
        <span>Invoice / pelanggan</span><span>Dibuat</span><span>Jatuh tempo</span><span className="fin-kanan">Nilai invoice</span><span className="fin-kanan">Sisa tagihan</span><span>Status</span><span className="fin-kanan">Tindakan</span>
      </div>
      <ul className="fin-inv-baris-daftar" aria-label="Daftar invoice">
        {invoices.map((inv) => <BarisInvoice key={inv.id} inv={inv} onBuka={onBuka} onAturTempo={onAturTempo} />)}
      </ul>
    </div>
  );
}

// ── Rincian invoice (panel samping; layar penuh di HP) ──────────────────────────────────────────────────────────────────────
// Panel sendiri (bukan PanelDetail bersama) agar halaman Finance lain tidak ikut berubah. Dirender ke dalam .app-shell supaya gaya .fin-inv berlaku.
function Ringkas({ label, nilai, nada }) {
  return (
    <div className={`fin-inv-r-ubin${nada ? ` fin-inv-r-${nada}` : ""}`}>
      <p className="fin-inv-r-label">{label}</p>
      <p className="fin-inv-r-nilai">{nilai}</p>
    </div>
  );
}

function Bagian({ judul, baris }) {
  const isi = baris.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (isi.length === 0) return null;
  return (
    <section className="fin-inv-r-bagian">
      <h3 className="fin-inv-r-bagian-judul">{judul}</h3>
      <dl className="fin-inv-r-daftar">
        {isi.map(([label, nilai]) => (
          <div key={label} className="fin-inv-r-baris"><dt>{label}</dt><dd>{nilai}</dd></div>
        ))}
      </dl>
    </section>
  );
}

export function RincianInvoice({ invoice, onClose, onAturTempo }) {
  const inv = invoice;
  const sebelum = useRef(null); // elemen yang fokus saat rincian dibuka (baris/tombol) — fokus dikembalikan ke sana saat ditutup
  const wadah = typeof document !== "undefined" ? document.querySelector(".app-shell") : undefined;
  const st = inv ? statusBayar(inv) : null;
  const tempo = inv ? keadaanTempo(inv) : null;
  const sumber = inv ? sumberAngka(inv) : null;
  return (
    <Dialog.Root open={!!inv} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal container={wadah}>
        <Dialog.Overlay className="fin-inv-r-lapisan" />
        <Dialog.Content aria-label={inv ? `Rincian ${inv.invoiceNumber}` : "Rincian invoice"} aria-describedby={undefined} className="fin-inv-rincian"
          onOpenAutoFocus={() => { sebelum.current = document.activeElement; }}
          onCloseAutoFocus={(e) => { e.preventDefault(); sebelum.current?.focus?.(); }}>
          {inv && (
            <>
              <div className="fin-inv-r-kepala">
                <div className="fin-inv-r-judulwrap">
                  <Dialog.Title className="fin-inv-r-judul">{inv.invoiceNumber}</Dialog.Title>
                  <p className="fin-inv-r-sub">{inv.customerName || "—"}</p>
                </div>
                <ChipStatus nada={nadaStatus(inv.status)}>{labelStatus(inv.status)}</ChipStatus>
                <Dialog.Close aria-label="Tutup" className="fin-inv-r-tutup"><X size={18} aria-hidden="true" /></Dialog.Close>
              </div>

              <div className="fin-inv-r-badan">
                <div className="fin-inv-r-ringkas">
                  <Ringkas label="Nilai invoice" nilai={formatUang(inv.totalTagihan)} />
                  <Ringkas label="Dibayar" nilai={inv.dibayar > 0 ? formatUang(inv.dibayar) : inv.dibayarTidakRinci ? "Tidak tercatat" : "—"} nada={inv.lunas ? "hijau" : undefined} />
                  <Ringkas label="Sisa tagihan" nilai={inv.sisa > 0 ? formatUang(inv.sisa) : "—"} nada={tempo.lewat > 0 ? "merah" : inv.lunas ? "hijau" : undefined} />
                  <Ringkas label="Jatuh tempo" nilai={tempo.diatur ? tanggalPendek(inv.dueDate) : "Belum diatur"} nada={tempo.lewat > 0 ? "merah" : undefined} />
                </div>

                <Bagian judul="Status" baris={[
                  ["Status dokumen", statusDokumen(inv)],
                  ["Status pembayaran", st.label],
                  ["Keterlambatan", tempo.lewat > 0 ? `Lewat ${tempo.lewat} hari dari jatuh tempo` : null],
                ]} />
                <Bagian judul="Dokumen" baris={[
                  ["No. invoice", inv.invoiceNumber],
                  ["No. order", inv.orderNumber ? `${inv.orderNumber}${inv.jumlahOrder > 1 ? ` (+${inv.jumlahOrder - 1} order digabung)` : ""}` : null],
                  ["Pelanggan", inv.customerName],
                  ["Sales", inv.salesName],
                  ["Dibuat", inv.createdAt ? tanggalPendek(inv.createdAt) : null],
                  ["Dikirim", inv.sentAt ? tanggalPendek(inv.sentAt) : "Belum dikirim"],
                  ["Jatuh tempo", tempo.diatur ? tanggalPendek(inv.dueDate) : "Belum diatur — umur tagihan dihitung dari tanggal order"],
                ]} />
                <Bagian judul="Pembayaran" baris={[
                  ["Dibayar", inv.dibayarTidakRinci && !(inv.dibayar > 0) ? "Nominal tidak tercatat" : formatUang(inv.dibayar)],
                  ["Sisa tagihan", formatUang(inv.sisa)],
                  ["Sumber angka", sumber.label],
                ]} />
                {inv.sumber !== "ledger" && (
                  <p className="fin-inv-r-catatan fin-inv-r-catatan-peringatan">Angka dibayar ini mengikuti status bayar manual di CRM. Tidak ada entri pembayaran di ledger, jadi tidak ada rincian siapa menerima, kapan, atau lewat apa.</p>
                )}
                <p className="fin-inv-r-catatan">Isi invoice (item, harga, alamat), pengiriman, dan dokumen PDF dikelola dari Rincian Pesanan di CRM. Daftar pembayaran per invoice tidak dimuat di halaman ini; lihat Pembayaran &amp; Verifikasi.</p>
              </div>

              <div className="fin-inv-r-kaki">
                <button type="button" className="fin-inv-r-tombol" onClick={() => onAturTempo(inv)}><IkAturTempo size={18} /><span>Atur jatuh tempo</span></button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Form jatuh tempo ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Satu-satunya form pada halaman ini (invoice dibuat & diedit dari Rincian Pesanan di CRM). Penulisan tetap lewat PATCH /orders/:id/invoice yang lama.
export function FormJatuhTempo({ invoice, onClose, onSubmit }) {
  const [tanggal, setTanggal] = useState("");

  useEffect(() => {
    setTanggal(invoice?.dueDate ? String(invoice.dueDate).slice(0, 10) : "");
  }, [invoice]);

  if (!invoice) return null;

  // Pintasan yang mewakili cara tim menyepakati tempo di lapangan
  // ("14 hari dari sekarang"), bukan memaksa menghitung tanggal di kepala.
  function dalamHari(n) {
    setTanggal(tanggalWibDalamHari(n));
  }

  const tempo = keadaanTempo(invoice);
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Jatuh Tempo ${invoice.invoiceNumber}`}
      description={`${invoice.customerName || "—"} · sisa ${formatUang(invoice.sisa)}`}
      className="w-[480px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(invoice.orderId, tanggal)}>Simpan</TombolAksi>
        </>
      }
    >
      <div className="fin-inv-form">
        <section className="fin-inv-form-grup" aria-label="Invoice">
          <dl className="fin-inv-form-ringkas">
            <div><dt>Nilai invoice</dt><dd><Uang value={invoice.totalTagihan} /></dd></div>
            <div><dt>Sisa tagihan</dt><dd><Uang value={invoice.sisa} nolSebagaiStrip /></dd></div>
            <div><dt>Jatuh tempo saat ini</dt><dd>{tempo.diatur ? tanggalPendek(invoice.dueDate) : "Belum diatur"}</dd></div>
          </dl>
        </section>
        <section className="fin-inv-form-grup" aria-label="Tanggal jatuh tempo">
          <Field
            label="Tanggal jatuh tempo"
            hint="Kosongkan untuk melepas tempo — umur tagihan lalu dihitung dari tanggal order, dan laporan menyebutkan acuannya apa adanya."
          >
            <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={tanggal} onChange={setTanggal} />
          </Field>
          <div className="fin-inv-pintas" role="group" aria-label="Pintasan tanggal">
            {[7, 14, 30].map((n) => (
              <button key={n} type="button" className="fin-tombol" onClick={() => dalamHari(n)}>{n} hari dari sekarang</button>
            ))}
            <button type="button" className="fin-tombol" onClick={() => setTanggal("")}>Kosongkan</button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
