import React, { useId, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, ChevronRight, Copy, Info, Pencil, Search, Trash2, Wallet, X, Check, FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Button } from "@/components/ui/button.jsx";
import { formatUang, tanggalPendek, Pilihan } from "@/features/finance/shared.jsx";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import { LogoBank } from "@/features/finance/RingkasanPanels.jsx";
import { RowActions } from "@/features/finance/RowActions.jsx";
import { useKontrak, IsiDefinisi } from "@/features/finance/kontrakData.jsx";
import { IkKasBank } from "@/components/financeIcons.jsx";
import { jenisRekening } from "@/features/finance/ringkasanTampilan.js";
import {
  LABEL_JENIS, nomorSamar, warnaKartu, statusPencocokan, catatanKartu, kalimatRekening,
} from "@/features/finance/kasbank/kasBankTampilan.js";

// Panel-panel halaman Kas & Bank (gaya: styles/sanss-finance-kasbank.css, kelas fin-ks*; memakai kartu/chip/pembuka dari sanss-finance.css).
// HANYA presentasi: data, endpoint, aksi rekening/transfer, izin, dan angka datang dari FinanceCash.jsx / server tanpa perubahan.

/** Teks uang tanpa membuang pecahan dari server: bulat → tanpa desimal; ada sen → 2 desimal. Negatif tetap bertanda (kurung) seperti formatUang. */
export function tampilUang(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const adaSen = Math.abs(Math.round(n * 100) % 100) !== 0;
  return formatUang(n, { sen: adaSen });
}

export function ChipKs({ nada = "netral", children, className = "" }) {
  return <span className={`fin-chip fin-ks-chip-${nada} ${className}`}>{children}</span>;
}

// ── Rincian (panel samping; layar penuh di HP) ───────────────────────────────────────────────────────────────────────────────
// Satu komponen untuk rincian rekening, mutasi, dan transfer. Dirender ke dalam .app-shell supaya gaya fin-ks berlaku.
// spec: { judul, sub, logo?, chip?: {label,nada}, ringkas?: [[label, nilai, nada?]], bagian: [{judul, baris:[[label, nilai]]}], catatan?: [{teks, nada?}], aksi?: node }
export function RincianKb({ spec, onClose }) {
  const wadah = typeof document !== "undefined" ? document.querySelector(".app-shell") : undefined;
  const sebelum = React.useRef(null); // elemen yang fokus saat rincian dibuka — fokus dikembalikan ke sana saat ditutup
  const s = spec;
  return (
    <Dialog.Root open={!!s} onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal container={wadah}>
        <Dialog.Overlay className="fin-ks-r-lapisan" />
        <Dialog.Content
          aria-label={s ? `Rincian ${s.judul}` : "Rincian"} aria-describedby={undefined} className="fin-ks-rincian"
          onOpenAutoFocus={() => { sebelum.current = document.activeElement; }}
          onCloseAutoFocus={(e) => { e.preventDefault(); sebelum.current?.focus?.(); }}
        >
          {s && (
            <>
              <div className="fin-ks-r-kepala">
                {s.logo}
                <div className="fin-ks-r-judulwrap">
                  <Dialog.Title className="fin-ks-r-judul">{s.judul}</Dialog.Title>
                  {s.sub && <p className="fin-ks-r-sub">{s.sub}</p>}
                </div>
                {s.chip && <ChipKs nada={s.chip.nada}>{s.chip.label}</ChipKs>}
                <Dialog.Close aria-label="Tutup" className="fin-ks-r-tutup"><X size={18} aria-hidden="true" /></Dialog.Close>
              </div>
              <div className="fin-ks-r-badan">
                {s.ringkas?.length > 0 && (
                  <div className="fin-ks-r-ringkas">
                    {s.ringkas.map(([label, nilai, nada], i) => (
                      <div key={label ?? i} className={`fin-ks-r-ubin${nada ? ` fin-ks-r-${nada}` : ""}`}>
                        <p className="fin-ks-r-label">{label}</p>
                        <p className="fin-ks-r-nilai">{nilai}</p>
                      </div>
                    ))}
                  </div>
                )}
                {(s.bagian || []).map((b, i) => {
                  const isi = (b.baris || []).filter(([, v]) => v !== null && v !== undefined && v !== "");
                  if (!isi.length) return null;
                  return (
                    <section key={b.judul ?? i} className="fin-ks-r-bagian">
                      <h3 className="fin-ks-r-bagian-judul">{b.judul}</h3>
                      <dl className="fin-ks-r-daftar">
                        {isi.map(([label, nilai]) => <div key={label} className="fin-ks-r-baris"><dt>{label}</dt><dd>{nilai}</dd></div>)}
                      </dl>
                    </section>
                  );
                })}
                {(s.catatan || []).map((c, i) => <p key={i} className={`fin-ks-r-catatan${c.nada ? ` fin-ks-r-catatan-${c.nada}` : ""}`}>{c.teks}</p>)}
              </div>
              {s.aksi && <div className="fin-ks-r-kaki">{s.aksi}</div>}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Tombol salin kecil: salin teks ke papan klip (gagal diam-diam bila izin ditolak; teks tetap terbaca). */
export function TombolSalin({ teks, label = "Salin nomor rekening" }) {
  const [ok, setOk] = useState(false);
  async function salin() {
    try { await navigator.clipboard.writeText(String(teks)); setOk(true); setTimeout(() => setOk(false), 1600); } catch { /* izin papan klip ditolak */ }
  }
  return (
    <button type="button" className="fin-ks-salin" onClick={salin} aria-label={label} title={label}>
      {ok ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}<span>{ok ? "Tersalin" : "Salin"}</span>
    </button>
  );
}

// ── Total saldo pembukuan ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function TotalSaldo({ total, cakupan }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  const kontrak = useKontrak();
  const m = kontrak?.peta?.get?.("kas_bank_buku");
  return (
    <section className="fin-ks-total" aria-label="Total saldo pembukuan">
      <div className="fin-ks-total-baris">
        <span className="fin-ks-total-ubin" aria-hidden="true"><IkKasBank size={30} /></span>
        <div className="fin-ks-total-isi">
          <p className="fin-ks-total-label">Total saldo pembukuan</p>
          <p className="fin-ks-total-nilai">{tampilUang(total)}</p>
          <p className="fin-ks-total-ket">Posisi per {tanggalPendek(cakupan.posisi)} · {cakupan.aktif} rekening aktif · Bukan saldo rekening koran</p>
        </div>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pill fin-ks-total-btn" ikonKiri={<Info size={16} aria-hidden="true" />}>Tentang saldo</Pembuka>
      </div>
      {buka && (
        <div id={id} className="fin-ks-total-penjelasan">
          {m && <IsiDefinisi m={m} />}
          <p>Angka ini adalah saldo <b>menurut buku besar</b>: hasil seluruh jurnal yang menyentuh rekening, dihitung sampai posisi {tanggalPendek(cakupan.posisi)}. Hanya <b>{cakupan.aktif} rekening aktif</b> yang dijumlahkan{cakupan.nonaktif > 0 ? `; ${cakupan.nonaktif} rekening nonaktif tidak ikut dihitung` : ""}. Semua rekening dihitung dalam Rupiah.</p>
          <p>Saldo menurut rekening koran bank atau hitung fisik kas ditampilkan terpisah pada tiap kartu rekening dan bisa berbeda (transfer yang belum masuk, biaya admin yang belum dicatat). Warna kartu hanya menandai jenis rekening, bukan kecocokan saldo.</p>
        </div>
      )}
    </section>
  );
}

/** Strip pencocokan belum aktif: informasi saja (tanpa tombol aktivasi). */
export function StripPencocokan({ tampil }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  if (!tampil) return null;
  return (
    <section className="fin-ks-strip" role="note" aria-label="Status fitur pencocokan bank">
      <div className="fin-ks-strip-baris">
        <Info size={18} aria-hidden="true" className="fin-ks-strip-ikon" />
        <div className="fin-ks-strip-teks">
          <p className="fin-ks-strip-judul">Pencocokan bank belum aktif</p>
          <p className="fin-ks-strip-isi">Mutasi pembukuan tersedia. Rekening koran belum dapat diimpor.</p>
        </div>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pill fin-ks-strip-btn">Lihat penjelasan</Pembuka>
      </div>
      {buka && <p id={id} className="fin-ks-strip-lengkap">Impor rekening koran dan pencocokan diaktifkan oleh Admin/Owner di Finance › Pengaturan (Rekonsiliasi Bank V2). Selama belum aktif, Mutasi Buku dan laporan jurnal tanpa rekening tetap bisa dipakai, dan saldo di kartu adalah saldo pembukuan.</p>}
    </section>
  );
}

/** Jurnal lama pada akun Kas/Bank yang tidak menyebut rekening: ringkas, penjelasan lengkap lewat tombol. Tidak memetakan atau mengoreksi apa pun. */
export function BannerTanpaRekening({ ex }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  if (!ex || !(ex.jumlahTerbuka > 0)) return null;
  const netto = String(ex.nilaiBersih).startsWith("-") ? "keluar " : "masuk ";
  return (
    <section className="fin-ks-peringatan" role="note" data-testid="banner-exception-tanpa-rekening">
      <div className="fin-ks-peringatan-baris">
        <AlertTriangle size={20} aria-hidden="true" className="fin-ks-peringatan-ikon" />
        <div className="fin-ks-peringatan-teks">
          <p className="fin-ks-peringatan-judul">{ex.jumlahTerbuka.toLocaleString("id-ID")} jurnal lama tidak menyebut rekening</p>
          <p className="fin-ks-peringatan-isi">Uang itu tidak muncul di saldo rekening mana pun.</p>
        </div>
        <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-pill fin-ks-peringatan-btn">Lihat rincian</Pembuka>
      </div>
      {buka && (
        <p id={id} className="fin-ks-peringatan-lengkap">
          <b>{ex.jumlahTerbuka} jurnal lama</b> pada akun Kas/Bank tidak menyebut rekening (netto {netto}{formatUang(String(ex.nilaiBersih).replace("-", ""))}): {ex.items.filter((i) => !i.ditinjau).slice(0, 3).map((i) => `${i.nomor} ${i.keluar ? `−${formatUang(i.keluar)}` : `+${formatUang(i.masuk)}`} “${i.keterangan}”`).join("; ")}.
          Uang itu tidak muncul di saldo rekening mana pun. Rekeningnya tidak ditebak — lihat tab Rekonsiliasi tiap rekening bank.
        </p>
      )}
    </section>
  );
}

// ── Daftar rekening ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function ToolbarRekening({ q, setQ, jenis, setJenis, status, setStatus, tampil, total, aktif, onReset }) {
  return (
    <div className="fin-ks-toolbar">
      <div className="fin-ks-cari-baris">
        <label className="fin-ks-cari">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama rekening atau bank…" aria-label="Cari rekening" />
        </label>
        <Pilihan value={jenis} onChange={setJenis} aria-label="Jenis rekening" className="fin-ks-pilih">
          <option value="">Semua jenis</option>{Object.entries(LABEL_JENIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Pilihan>
        <Pilihan value={status} onChange={setStatus} aria-label="Status rekening" className="fin-ks-pilih">
          <option value="">Semua status</option><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option>
        </Pilihan>
      </div>
      <div className="fin-ks-hasil">
        <p className="fin-ks-hasil-teks" aria-live="polite">{kalimatRekening({ tampil, total })}</p>
        {aktif > 0 && <button type="button" className="fin-tombol" onClick={onReset}><X size={15} aria-hidden="true" /><span>Atur ulang filter</span></button>}
      </div>
    </div>
  );
}

function SaldoKartu({ a, k, kartuTermuat, kartuGagal, sakelarAktif }) {
  const st = statusPencocokan({ kind: a.kind, k, sakelarAktif, kartuTermuat, kartuGagal });
  const catatan = catatanKartu({ k: a.active ? k : null, sakelarAktif });
  return (
    <>
      <div className="fin-ks-saldo">
        <span className="fin-ks-label-kecil">Saldo pembukuan</span>
        {a.active ? <span className="fin-ks-saldo-nilai">{tampilUang(a.saldo)}</span> : <span className="fin-ks-saldo-tak">Saldo tidak tersedia — rekening nonaktif</span>}
      </div>
      <div className="fin-ks-status">
        {!a.active ? <ChipKs nada="redup">Nonaktif · tidak ikut total saldo</ChipKs> : (
          <span className={`fin-ks-pencocokan fin-ks-pc-${st.nada}`} title={st.sumber ? `Sumber: ${st.sumber}` : undefined}>
            <FileText size={14} aria-hidden="true" />
            <span>{st.label}{st.tanggal ? ` · ${tanggalPendek(st.tanggal)}` : ""}{st.kode === "selisih" ? ` · ${tampilUang(st.selisih)}` : ""}</span>
          </span>
        )}
        {catatan.map((c) => <span key={c.kode} className="fin-ks-sekunder">{c.tanggal ? `Direkonsiliasi sampai ${tanggalPendek(c.tanggal)}` : c.teks}</span>)}
      </div>
    </>
  );
}

function KartuRekening({ a, k, kartuTermuat, kartuGagal, sakelarAktif, onBuka, onRincian, onEdit, onHapus }) {
  const { jenis } = jenisRekening(a);
  const kas = a.kind === "KAS";
  const sekunder = kas ? "Kas tunai" : `${(a.bankName || (a.kind === "EWALLET" ? "E-wallet" : "Bank")).trim()}${a.accountNumber ? ` · ${nomorSamar(a.accountNumber)}` : ""}`;
  const items = [
    { key: "rincian", label: "Rincian rekening", onClick: onRincian },
    { key: "edit", label: "Edit", icon: Pencil, onClick: onEdit },
    ...(a.accountNumber ? [{ key: "salin", label: "Salin nomor rekening", icon: Copy, onClick: () => { try { navigator.clipboard.writeText(String(a.accountNumber)); } catch { /* izin papan klip ditolak */ } } }] : []),
    { key: "hapus", label: "Hapus", icon: Trash2, destructive: true, onClick: onHapus },
  ];
  return (
    <li className={`fin-ks-kartu fin-ks-w-${warnaKartu(a)}`} data-testid={`kartu-${a.id}`} data-aktif={String(!!a.active)} data-jenis={jenis}
      onClick={(e) => {
        if (!e.currentTarget.contains(e.target)) return; // peristiwa dari menu/dialog yang dirender lewat portal — abaikan
        if (e.target.closest("button, a, [role='menuitem'], [data-tanpa-detail]")) return;
        onBuka();
      }}>
      <div className="fin-ks-kartu-atas">
        <LogoBank r={a} />
        <div className="fin-ks-nama-wrap">
          <span className="fin-ks-nama" title={a.name}>{a.name}</span>
          <span className="fin-ks-sekunder" title={sekunder}>{sekunder}</span>
        </div>
        <div className="fin-ks-menu" data-tanpa-detail><RowActions primary={null} items={items} /></div>
      </div>
      <SaldoKartu a={a} k={k} kartuTermuat={kartuTermuat} kartuGagal={kartuGagal} sakelarAktif={sakelarAktif} />
      <div className="fin-ks-kartu-bawah">
        <button type="button" className="fin-ks-buka" onClick={onBuka} aria-label={`Buka rekening ${a.name}`}>Buka rekening <ChevronRight size={16} aria-hidden="true" /></button>
      </div>
    </li>
  );
}

export function DaftarRekening({ semua, tampil, kartuDari, kartuTermuat, kartuGagal, sakelarAktif, onBuka, onRincian, onEdit, onHapus, onBaru, onReset }) {
  if (semua.length === 0) {
    return (
      <div className="fin-ks-kosong">
        <EmptyState icon={Wallet} title="Belum ada rekening" description="Tanpa rekening, pembayaran yang masuk tidak punya tempat dan akan menumpuk di Data Belum Lengkap."
          action={<Button size="sm" onClick={onBaru}>Tambah rekening</Button>} />
      </div>
    );
  }
  if (tampil.length === 0) {
    return <div className="fin-ks-kosong"><EmptyState icon={Search} title="Tidak ada rekening yang cocok" description="Coba kata kunci lain atau atur ulang filter." action={<button type="button" className="fin-tombol" onClick={onReset}><span>Atur ulang filter</span></button>} /></div>;
  }
  return (
    <ul className="fin-ks-kartu-daftar" aria-label="Daftar rekening" data-testid="kartu-rekening">
      {tampil.map((a) => (
        <KartuRekening key={a.id} a={a} k={kartuDari(a.id)} kartuTermuat={kartuTermuat} kartuGagal={kartuGagal} sakelarAktif={sakelarAktif}
          onBuka={() => onBuka(a)} onRincian={() => onRincian(a)} onEdit={() => onEdit(a)} onHapus={() => onHapus(a)} />
      ))}
    </ul>
  );
}

