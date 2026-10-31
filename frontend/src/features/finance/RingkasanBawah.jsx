import React, { useId, useState } from "react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { api } from "@/api.js";
import { LABEL_SUMBER_JURNAL, Uang, formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { IsiKenapaBeda } from "@/features/finance/kontrak.jsx";
import { KETERANGAN_UMUR, dasarUmurTertua } from "@/features/finance/ringkasanTampilan.js";
import { Pembuka, InfoBuka, Cakupan, angkaId } from "@/features/finance/RingkasanKecil.jsx";
import { formatTanggalPendek } from "@/utils/formatDate.js";

// Bagian bawah Ringkasan Keuangan: tagihan pelanggan, pencatatan terbaru, pemeriksaan angka, penjelasan, informasi sistem.
// HANYA menyajikan angka yang sudah dikirim API; tidak ada perhitungan akuntansi baru.

const TANPA_DATA = "Tidak tersedia";
const WARNA_UMUR = { belum: "var(--ord-delivered-dot)", "1_30": "#F3C969", "31_60": "#EE9A3A", "61_90": "#E4572E", "90_plus": "#B3261E" };
const LABEL_UMUR = { belum: "Belum jatuh tempo", "1_30": "1–30 hari", "31_60": "31–60 hari", "61_90": "61–90 hari", "90_plus": "Lebih dari 90 hari" };

// ─── Tagihan pelanggan ──────────────────────────────────────────────────────

export function TagihanPelanggan({ piutang, aging, teratas, navigate }) {
  const bp = piutang.pembayaranBelumTercatat;
  const daftar = [...(teratas ?? [])].sort((a, b) => (Number(b.hariLewat) || 0) - (Number(a.hariLewat) || 0)).slice(0, 5);
  const bagian = aging.bagian.filter((x) => x.nilai > 0);
  return (
    <section className="fin-panel" aria-labelledby="fin-tg-judul" data-testid="panel-tagihan-pelanggan">
      <header className="fin-panel-kepala">
        <h2 id="fin-tg-judul" className="fin-panel-judul">Tagihan pelanggan</h2>
        <p className="fin-panel-sub fin-cakupan-baris"><Cakupan>Posisi terbaru</Cakupan><span>Tiga angka ini berbeda dan tidak dijumlahkan.</span></p>
      </header>
      <div className="fin-tg-stat">
        <div className="fin-tg-sel">
          <p className="fin-tg-label">Piutang di buku besar <InfoBuka label="Piutang di buku besar">Saldo Piutang Usaha di buku besar: pendapatan yang sudah diakui tetapi belum dilunasi menurut jurnal. Terdiri dari tagihan operasional dan order yang sudah lunas di CRM tetapi pembayarannya belum diverifikasi.</InfoBuka></p>
          <p className="fin-tg-nilai">{formatUang(piutang.bukuBesar)}</p>
          <p className="fin-tg-sub">Termasuk {formatUang(piutang.menungguVerifikasi.total)} ({angkaId(piutang.menungguVerifikasi.jumlah)} order lunas di CRM, menunggu verifikasi)</p>
        </div>
        <div className="fin-tg-sel">
          <p className="fin-tg-label">Tagihan operasional <InfoBuka label="Tagihan operasional">Daftar tagihan yang harus ditagih tim (order diserahkan, belum lunas). Bagian dari piutang buku besar; tidak termasuk order yang sudah lunas di CRM.</InfoBuka></p>
          <p className="fin-tg-nilai">{formatUang(piutang.operasional)}</p>
          <p className="fin-tg-sub">Order diserahkan, belum lunas menurut CRM</p>
        </div>
        <div className="fin-tg-sel">
          <p className="fin-tg-label">Pembayaran belum tercatat <InfoBuka label="Pembayaran belum tercatat">Uang yang menurut CRM sudah diterima (status Lunas) tetapi belum punya catatan pembayaran dan rekening, sehingga belum ada jurnal kas. Ini BUKAN piutang dan tidak dijumlahkan dengan piutang.</InfoBuka></p>
          <p className="fin-tg-nilai">{bp.jumlah === null ? <span className="fin-redup">{TANPA_DATA}</span> : `${angkaId(bp.jumlah)} order`}</p>
          <p className="fin-tg-sub">{bp.total === null ? "Data tidak dapat dimuat" : `Senilai ${formatUang(bp.total)} · bukan piutang`}</p>
        </div>
      </div>

      <div className="fin-umur">
        <div className="fin-umur-kepala">
          <h3>Umur tagihan pelanggan</h3>
          <InfoBuka label="Umur tagihan pelanggan">{KETERANGAN_UMUR} Ringkasan di sini memakai tagihan operasional (belum lunas menurut CRM).</InfoBuka>
        </div>
        {aging.total === 0 ? (
          <p className="fin-kosong">Tidak ada tagihan operasional terbuka.</p>
        ) : (
          <>
            <div className="fin-umur-bar" role="img" aria-label={`Komposisi umur: ${bagian.map((x) => `${LABEL_UMUR[x.key]} ${x.persen}%`).join(", ")}`}>
              {bagian.map((x) => <span key={x.key} style={{ width: `${x.persen}%`, background: WARNA_UMUR[x.key] }} />)}
            </div>
            <ul className="fin-umur-legenda">
              {bagian.map((x) => (
                <li key={x.key}><span className="fin-umur-titik" style={{ background: WARNA_UMUR[x.key] }} aria-hidden="true" /><span>{LABEL_UMUR[x.key]}</span><b>{formatUang(x.nilai)}</b></li>
              ))}
            </ul>
            <p className="fin-umur-ringkas">
              <span>Sudah berumur: <b>{formatUang(aging.lewatJatuhTempo)}</b></span>
              {aging.tertua && <span>Tertua: <b>{aging.tertua.hari} hari</b> · {aging.tertua.order ?? "Order"} · {formatUang(aging.tertua.sisa)} · {dasarUmurTertua(aging.tertua)}</span>}
            </p>
          </>
        )}
        {daftar.length > 0 && (
          <>
            <h3 className="fin-umur-sub">Tagihan tertua</h3>
            <ul className="fin-tua">
              {daftar.map((b) => (
                <li key={b.orderId} className="fin-tua-item">
                  <span className="fin-tua-order">{b.orderNumber || "—"}</span>
                  <span className="fin-tua-nama" title={b.customerName}>{b.customerName}</span>
                  <span className="fin-tua-sisa"><Uang value={b.sisaTagihan} /></span>
                  <span className="fin-tua-umur">
                    {b.hariLewat > 0
                      ? <span className={`fin-chip ${b.hariLewat > 60 ? "fin-chip-red" : b.hariLewat > 30 ? "fin-chip-perhatian" : "fin-chip-neutral"}`}>{b.hariLewat} hari</span>
                      : <span className="fin-redup">belum jatuh tempo</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <Button variant="tertiary" size="sm" className="fin-panel-aksi" onClick={() => navigate("/finance/receivables")}>Lihat semua tagihan <ArrowRight size={14} aria-hidden="true" /></Button>
      </div>
    </section>
  );
}

// ─── Pencatatan terbaru (jurnal) ────────────────────────────────────────────

const JURNAL_AWAL = 5;
export function PencatatanTerbaru({ jurnal, navigate }) {
  const [semua, setSemua] = useState(false);
  const idDaftar = useId();
  const lengkap = jurnal ?? [];
  const daftar = semua ? lengkap : lengkap.slice(0, JURNAL_AWAL);
  return (
    <section className="fin-panel" aria-labelledby="fin-pt-judul" data-testid="panel-pencatatan-terbaru">
      <header className="fin-panel-kepala">
        <h2 id="fin-pt-judul" className="fin-panel-judul">Pencatatan terbaru</h2>
        <p className="fin-panel-sub fin-cakupan-baris"><Cakupan>Semua periode</Cakupan><span>Jurnal terbaru di buku besar; tidak mengikuti periode terpilih. Setiap transaksi keuangan otomatis dicatat sebagai satu jurnal.</span></p>
      </header>
      {daftar.length === 0 ? <p className="fin-kosong">Belum ada pencatatan.</p> : (
        <ul id={idDaftar} className="fin-jr">
          {daftar.map((e) => (
            <li key={e.id}>
              <button type="button" className="fin-jr-item" onClick={() => navigate("/finance/journal")}>
                <span className="fin-jr-tgl">{tanggalPendek(e.date)}</span>
                <span className="fin-jr-ket" title={e.description}>{e.description}</span>
                <span className="fin-chip fin-chip-neutral fin-jr-sumber">{LABEL_SUMBER_JURNAL[e.source] || e.source}</span>
                <span className="fin-jr-nilai"><Uang value={e.total} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="fin-panel-aksi-baris">
        {lengkap.length > JURNAL_AWAL
          ? <Pembuka buka={semua} onToggle={() => setSemua((v) => !v)} id={idDaftar} className="fin-panel-tautan">{semua ? `Tampilkan ${JURNAL_AWAL} saja` : `Tampilkan ${angkaId(lengkap.length)} jurnal terbaru`}</Pembuka>
          : <span />}
        <Button variant="tertiary" size="sm" className="fin-panel-aksi" onClick={() => navigate("/finance/journal")}>Lihat semua jurnal <ArrowRight size={14} aria-hidden="true" /></Button>
      </div>
      <p className="fin-panel-sub fin-catatan-tipis">Halaman jurnal membuka bulan berjalan; ubah rentang tanggal di sana untuk periode lain.</p>
    </section>
  );
}

// ─── Pemeriksaan angka (hitung ganda & konsistensi; dimuat saat dibuka) ─────

function PemeriksaanAngka() {
  const [buka, setBuka] = useState(false);
  const [s, setS] = useState({ loading: false, data: null, error: null });
  const id = useId();
  function toggle() {
    const baru = !buka;
    setBuka(baru);
    if (baru && !s.data && !s.loading) {
      setS({ loading: true, data: null, error: null });
      api.getFinanceAuditKonsistensi()
        .then((data) => setS({ loading: false, data, error: null }))
        .catch((e) => setS({ loading: false, data: null, error: e.message || "Gagal memuat" }));
    }
  }
  const d = s.data;
  return (
    <div className="fin-akor">
      <Pembuka buka={buka} onToggle={toggle} id={id} className="fin-akor-tombol" ikon>
        <ShieldCheck size={16} aria-hidden="true" /> <span className="fin-akor-judul">Pemeriksaan angka</span>
        {d && <span className={`fin-chip ${d.ringkasan.perluDitinjau ? "fin-chip-perhatian" : "fin-chip-green"}`}>{d.ringkasan.perluDitinjau ? `${d.ringkasan.perluDitinjau} perlu ditinjau` : "Tidak ada hitung ganda"}</span>}
      </Pembuka>
      {buka && (
        <div id={id} className="fin-akor-isi">
          {s.loading && <p className="fin-redup"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Memeriksa…</p>}
          {s.error && <p className="fin-redup">Belum bisa dimuat: {s.error}</p>}
          {d && (
            <>
              <p className="fin-redup">Pemeriksaan hitung ganda dan konsistensi angka. Hanya membaca data — tidak ada yang diubah. Dijalankan {formatTanggalPendek(d.dibuatPada)}.</p>
              <ul className="fin-pa">
                {d.pemeriksaan.map((p) => (
                  <li key={p.kunci}>
                    <div className="fin-pa-kepala"><b>{p.judul}</b><span className={`fin-chip ${p.status === "OK" ? "fin-chip-green" : "fin-chip-perhatian"}`}>{p.status === "OK" ? "Tidak ada hitung ganda" : `${p.jumlahTemuan} perlu ditinjau`}</span></div>
                    <p className="fin-redup">{p.pertanyaan}</p>
                    {p.catatan && <p className="fin-redup">{p.catatan}</p>}
                    {p.status !== "OK" && p.nilai > 0 && <p className="fin-perhatian">Nilai terdampak {formatUang(p.nilai)}</p>}
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="neutral" onClick={() => { setS({ loading: false, data: null, error: null }); setBuka(false); }}>Tutup</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function KenapaAngkaBeda({ periode }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  return (
    <div className="fin-akor">
      <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-akor-tombol"><span className="fin-akor-judul">Kenapa angkanya berbeda?</span></Pembuka>
      {buka && (
        <div id={id} className="fin-akor-isi">
          <IsiKenapaBeda metrik={["uang_masuk_terverifikasi", "kas_masuk_pelanggan", "pendapatan_diakui", "piutang_usaha", "uang_keluar_kas", "beban_diakui"]} from={periode.from} to={periode.to} denganJembatan />
        </div>
      )}
    </div>
  );
}

function InfoSistem({ gate }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  return (
    <div className="fin-akor">
      <Pembuka buka={buka} onToggle={() => setBuka((v) => !v)} id={id} className="fin-akor-tombol">
        <ShieldCheck size={16} aria-hidden="true" /> <span className="fin-akor-judul">Gerbang verifikasi pembayaran</span>
        <span className={`fin-chip ${gate.enabled ? "fin-chip-green" : "fin-chip-neutral"}`}>{gate.enabled ? "Aktif" : "Tidak aktif"}</span>
      </Pembuka>
      {buka && (
        <div id={id} className="fin-akor-isi">
          <p>
            {gate.enabled
              ? "Status bayar order di CRM hanya bergerak setelah pembayaran diverifikasi finance. Pembayaran yang tercatat sebelum gerbang ini dinyalakan tetap dihitung apa adanya."
              : "Status bayar order di CRM mengikuti SELURUH pembayaran yang tercatat, terverifikasi atau belum. Verifikasi di sini murni pencocokan setoran. Nyalakan gerbangnya di Pengaturan kalau tim sudah siap."}
          </p>
        </div>
      )}
    </div>
  );
}

export function PanelPendukung({ gate, periode }) {
  return (
    <section className="fin-panel" aria-labelledby="fin-pd-judul" data-testid="panel-pendukung">
      <header className="fin-panel-kepala">
        <h2 id="fin-pd-judul" className="fin-panel-judul">Pemeriksaan dan penjelasan</h2>
        <p className="fin-panel-sub">Buka saat dibutuhkan.</p>
      </header>
      <PemeriksaanAngka />
      <KenapaAngkaBeda periode={periode} />
      <InfoSistem gate={gate} />
    </section>
  );
}

