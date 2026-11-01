import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useUrlTab } from "@/lib/useUrlTab.js";
import { ChevronDown, ChevronUp, ShieldCheck, Split, Eye, PenLine, FileEdit, History } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { api } from "@/api.js";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import { HalamanFinance, formatUang, TombolAksi, periodeDefault, tanggalJam, InputUang } from "@/features/finance/shared.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { KenapaBeda } from "@/features/finance/kontrak.jsx";
import KartuSelisihSalesFinance from "@/features/finance/KartuSelisihSalesFinance.jsx";
import { saringPembayaran } from "@/features/finance/saringPembayaran.js";
import { nilaiBersihOrder } from "@/utils/format.js";
import { EditInfoDialog, KoreksiPembayaranDialog, RiwayatPembayaranDialog, VerifikasiDialog } from "@/features/finance/KoreksiPembayaran.jsx";
import RingkasanAntrean from "@/features/finance/verifikasi/RingkasanAntrean.jsx";
import DaftarPembayaran from "@/features/finance/verifikasi/DaftarPembayaran.jsx";
import AntreanKlaim from "@/features/finance/verifikasi/AntreanKlaim.jsx";
import PanelPemeriksaan from "@/features/finance/verifikasi/PanelPemeriksaan.jsx";
import { modelPembayaran } from "@/features/finance/verifikasi/modelPemeriksaan.jsx";
import {
  ANTREAN, LABEL_CARA_BAYAR, LABEL_TAB_EXPORT, SEMUA_PERIODE, TAB_URL, antreanDari, buatPenjaga, kunciAntrean, konteksRekon, labelPeriode, ringkasPeriode, statusServer, teksGerbang,
} from "@/features/finance/verifikasi/verifikasiLogic.js";
import "@/styles/sanss-finance-pemasukan.css";
import "@/styles/sanss-finance-verifikasi.css";

// VERIFIKASI PEMBAYARAN (dulu "Pembayaran & Verifikasi"). Redesain tampilan 1 Nov 2026 (gaya Ringkasan/Pemasukan Finance). TAMPILAN SAJA: endpoint, rumus,
// jurnal, izin, gerbang verifikasi, dan penyaringan tidak berubah.
//
// Halaman ini TIDAK mencatat pembayaran baru — itu dikerjakan Sales (saat konfirmasi order) dan driver (di stop pengiriman). Di sini Finance MEMERIKSA
// bukti dan rekening tujuan, lalu memverifikasi, dan bila perlu memecah satu pembayaran ke beberapa order.
// Verifikasi memakai endpoint LAMA (POST /armada/payments/:id/verify untuk jalan cepat; POST /finance/pembayaran/:id/verifikasi untuk dialog dengan pilihan
// rekening) — tidak dibuatkan jalur kedua. "Bukti terunggah" bukan "bukti terverifikasi", dan halaman ini tidak mencocokkan mutasi bank.
//
// Dua antrean yang BERBEDA (tidak dijumlahkan): order ditandai lunas oleh Sales (belum ada catatan pembayaran) dan pembayaran menunggu verifikasi.
// Komponen presentasi ada di features/finance/verifikasi/*.

const SARING_AWAL = Object.freeze({ q: "", metode: "", verif: "", alokasi: "", bukti: "", rekening: "" });

// Aksi PALING RELEVAN jadi tombol utama; sisanya masuk menu titik-tiga. Foto bukti dilihat lewat panel pemeriksaan (klik baris atau "Periksa").
function aksiPembayaran(p, { verifikasi, setAlokasiUntuk, bukaDialog, periksa }) {
  // B3.7 — menu untuk uang masuk terverifikasi (dan versi yang sudah diganti): tombol nonaktif TETAP tampil beserta alasan + arah tindakan dari server.
  const m = p.menuKoreksi;
  const nonaktif = (x) => (x && !x.aktif ? { disabled: true, alasan: [x.alasan, x.arah].filter(Boolean).join(" ") } : {});
  const menuB37 = m && (p.terverifikasi || p.replacesPaymentId || p.replacedBy) ? [
    { separator: true },
    { key: "info", label: "Edit Informasi", icon: FileEdit, onClick: () => bukaDialog("info", p), ...nonaktif(m.editInfo) },
    { key: "koreksi", label: "Koreksi Pembayaran", icon: PenLine, onClick: () => bukaDialog("koreksi", p), ...nonaktif(m.koreksi) },
    { key: "riwayat", label: "Riwayat Perubahan", icon: History, onClick: () => bukaDialog("riwayat", p) },
  ] : [];
  const items = [
    { key: "periksa", label: "Periksa bukti dan rincian", icon: Eye, onClick: () => periksa(p) },
    !p.cancelledAt && !p.terverifikasi && { key: "atur", label: "Atur rekening & verifikasi", icon: ShieldCheck, onClick: () => bukaDialog("verifikasi", p) },
    !p.cancelledAt && { key: "alokasi", label: "Bagi ke beberapa order", icon: Split, onClick: () => setAlokasiUntuk(p) },
    ...menuB37,
  ].filter(Boolean);
  if (!p.cancelledAt && !p.terverifikasi) {
    // Tanpa rekening tercatat → buka dialog pilih rekening dulu (bukan verifikasi buta); dengan rekening → verifikasi langsung seperti biasa.
    return { primary: { label: "Verifikasi", variant: "secondary", onClick: () => (p.cashAccount ? verifikasi(p) : bukaDialog("verifikasi", p)) }, items };
  }
  return { primary: { label: "Periksa", variant: "neutral", onClick: () => periksa(p) }, items: items.filter((x) => x.key !== "periksa") };
}

/** Pemilih antrean: tiga pilihan utama + "Lainnya" (<select> asli: keyboard dan picker HP). Semua pilihan lama tetap tersedia. */
function PemilihAntrean({ tab, onTab }) {
  const lainnya = ANTREAN.filter((t) => !t.utama);
  const lainnyaAktif = lainnya.find((t) => t.id === tab);
  return (
    <nav className="fin-pm-nav" aria-label="Antrean verifikasi" data-testid="nav-antrean">
      <div role="tablist" aria-label="Antrean utama" className="fin-pm-seg">
        {ANTREAN.filter((t) => t.utama).map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-testid={`antrean-${t.id}`} onClick={() => onTab(t.id)} className="fin-pm-seg-item">{t.label}</button>
        ))}
        <label className="fin-pm-seg-item fin-pm-lainnya" data-aktif={lainnyaAktif ? "1" : "0"} data-testid="antrean-lainnya">
          <span>{lainnyaAktif ? lainnyaAktif.label : "Lainnya"}</span>
          <ChevronDown size={14} aria-hidden="true" />
          <select aria-label="Antrean lainnya" value={lainnyaAktif ? tab : "__"} onChange={(e) => e.target.value !== "__" && onTab(e.target.value)}>
            <option value="__" disabled>Lainnya</option>
            {lainnya.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>
    </nav>
  );
}

function Pembuka({ buka, onToggle, id, children }) {
  return (
    <button type="button" className="fin-pm-pembuka" aria-expanded={buka} aria-controls={id} onClick={onToggle}>
      {children}{buka ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
    </button>
  );
}

/** Bantuan yang bisa dibuka: cara kerja + gerbang verifikasi yang berlaku, penjelasan angka berbeda, dan selisih Sales–Finance. Tidak ada angka baru di sini. */
function Bantuan({ gate, periode, ke, selisihTerbuka = false }) {
  const [buka, setBuka] = useState({ kerja: false, beda: false, selisih: selisihTerbuka });
  const idDasar = useId();
  const alih = (k) => setBuka((s) => ({ ...s, [k]: !s[k] }));
  return (
    <section className="fin-panel fin-vf-bantuan" aria-label="Bantuan dan rekonsiliasi" data-testid="bantuan-verifikasi">
      <div className="fin-panel-kepala"><h2 className="fin-panel-judul">Bantuan</h2></div>
      <div className="fin-vf-bantuan-tombol">
        <Pembuka buka={buka.kerja} id={`${idDasar}-kerja`} onToggle={() => alih("kerja")}>Cara kerja dan gerbang verifikasi</Pembuka>
        <Pembuka buka={buka.beda} id={`${idDasar}-beda`} onToggle={() => alih("beda")}>Kenapa angkanya berbeda?</Pembuka>
        <Pembuka buka={buka.selisih} id={`${idDasar}-selisih`} onToggle={() => alih("selisih")}>Selisih angka Sales dan Finance</Pembuka>
      </div>
      {buka.kerja && (
        <div id={`${idDasar}-kerja`} className="fin-pm-lanjut-isi fin-vf-penjelasan" data-testid="cara-kerja">
          <p><strong>Gerbang verifikasi saat ini.</strong> {teksGerbang(gate)}</p>
          <p><strong>Tiga hal yang berbeda.</strong> (1) Klaim pembayaran dari Sales: pengajuan dengan tanggal, nominal, metode, dan bukti bila ada; belum mengubah status order atau saldo. (2) Order ditandai lunas oleh Sales: status di CRM tanpa catatan pembayaran. (3) Pembayaran tercatat yang menunggu verifikasi: catatan uang masuk yang belum diperiksa Finance. Ketiganya dihitung dari sumber berbeda dan tidak dijumlahkan menjadi satu angka.</p>
          <p>Halaman ini tidak mencatat pembayaran baru: pembayaran dicatat Sales (saat konfirmasi order) dan driver (di stop pengiriman). Finance memeriksa bukti dan rekening tujuan, lalu memverifikasi.</p>
          <p>Pemeriksaan di sini berdasarkan bukti yang diunggah. Ini bukan pencocokan otomatis dengan mutasi bank.</p>
          <p>Pembayaran yang sudah tercatat tidak pernah diedit atau dihapus diam-diam. Koreksi nominal, tanggal, rekening, metode, order, atau pembagian membalik jurnal lama dan membuat versi pengganti dengan jurnal baru — semuanya tercatat siapa, kapan, dan alasannya.</p>
        </div>
      )}
      {buka.beda && (
        <div id={`${idDasar}-beda`} className="fin-vf-bantuan-isi">
          <KenapaBeda metrik={["payment_tercatat", "uang_masuk_terverifikasi", "klaim_lunas_menunggu", "kas_masuk_pelanggan"]} from={periode.from} to={periode.to} denganJembatan />
        </div>
      )}
      {buka.selisih && (
        <div id={`${idDasar}-selisih`} className="fin-vf-bantuan-isi">
          <KartuSelisihSalesFinance from={periode.from} to={periode.to} onTinjauMenunggu={() => ke("perlu")} onTinjauKlaim={() => ke("klaim")} />
        </div>
      )}
    </section>
  );
}

export default function FinancePayments() {
  const [tab, setTabUrl] = useUrlTab(TAB_URL, "perlu"); // ?tab= (deep-link hub Penjualan & Piutang)
  const [periode, setPeriode] = useState(periodeDefault);
  const [hasil, setHasil] = useState(null); // { tabData, semua, _kunci }
  const [galat, setGalat] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [pesan, setPesan] = useState(null);
  const [alokasiUntuk, setAlokasiUntuk] = useState(null);
  const [dialog, setDialog] = useState(null); // { jenis: "verifikasi" | "info" | "koreksi" | "riwayat", p }
  const bukaDialog = (jenis, p) => { setPanel(null); setDialog({ jenis, p }); };
  const [panel, setPanel] = useState(null); // model panel pemeriksaan (pembayaran atau klaim)
  const [filter, setFilter] = useState(SARING_AWAL);
  const [klaimIds, setKlaimIds] = useState(null); // orderId klaim lama yang TAMPIL (dilaporkan AntreanKlaim) — untuk Export Excel
  const [akun, setAkun] = useState([]);
  const [ringkasan, setRingkasan] = useState(null);
  const [galatRingkasan, setGalatRingkasan] = useState(null);
  const [berbukti, setBerbukti] = useState(null);
  const [versiKlaim, setVersiKlaim] = useState(0);
  const penjagaMuat = useRef(buatPenjaga());
  const penjagaRingkasan = useRef(buatPenjaga());

  const antreanId = kunciAntrean(tab); // "lunas_crm" (tautan Rekonsiliasi) → "klaim"
  const rekon = konteksRekon(tab);
  const antrean = antreanDari(antreanId);
  const kunci = `${tab}|${periode.from}|${periode.to}`;
  const ke = useCallback((id) => { setTabUrl(id); window.scrollTo?.({ top: 0 }); }, [setTabUrl]);
  const ubahFilter = useCallback((k, v) => setFilter((s) => ({ ...s, [k]: v })), []);

  const muat = useCallback(async () => {
    const saya = penjagaMuat.current.mulai(); // setiap pergantian tab/periode membuat respons lama tidak boleh menimpa pilihan baru
    // Tab "Ditandai lunas oleh Sales" memuat datanya sendiri (AntreanKlaim).
    if (antreanId === "klaim") { setMemuat(false); setGalat(null); return; }
    setMemuat(true); setGalat(null);
    try {
      // Angka periode di atas daftar selalu menghitung SEMUA pembayaran periode ini, apa pun tab yang dibuka.
      const [tabData, semua] = await Promise.all([
        // Tab "Perlu verifikasi" = antrean pekerjaan: Payment menunggu dari PERIODE MANA PUN (bukan hanya bulan terpilih) — kalau tidak, Payment akhir bulan lalu yang belum
        // diverifikasi hilang dari antrean begitu bulan berganti (kasus RES-21092026-130, 30 Sep → tak terlihat di Oktober). Angka periode tetap per periode (query ke-2).
        api.getFinanceCustomerPayments(antreanId === "perlu" ? { from: SEMUA_PERIODE.from, to: SEMUA_PERIODE.to, status: "belum_verifikasi" } : { ...periode, status: statusServer(antreanId) }),
        antreanId === "semua" ? null : api.getFinanceCustomerPayments({ ...periode, status: "" }),
      ]);
      if (!penjagaMuat.current.terbaru(saya)) return;
      setHasil({ tabData, semua: (semua || tabData).payments || [], _kunci: kunci });
    } catch (e) {
      if (penjagaMuat.current.terbaru(saya)) setGalat(e.message || "Gagal memuat pembayaran");
    } finally {
      if (penjagaMuat.current.terbaru(saya)) setMemuat(false);
    }
  }, [periode, antreanId, kunci]);
  useEffect(() => { muat(); }, [muat]);

  // Ringkasan dua antrean (semua periode, sumber sama dengan kartu "Menunggu verifikasi" di Pemasukan). Dimuat sekali dan setelah tindakan berhasil.
  const muatRingkasan = useCallback(async () => {
    const saya = penjagaRingkasan.current.mulai();
    try {
      const r = await api.getFinancePemasukanRingkasan({ from: periode.from, to: periode.to });
      if (penjagaRingkasan.current.terbaru(saya)) { setRingkasan(r); setGalatRingkasan(null); }
    } catch (e) { if (penjagaRingkasan.current.terbaru(saya)) setGalatRingkasan(e.message || "Gagal memuat"); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.getFinanceCashAccounts().then((r) => setAkun(r?.accounts ?? [])).catch(() => setAkun([])); muatRingkasan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setelahTindakan = useCallback(async () => { await Promise.all([muat(), muatRingkasan()]); setVersiKlaim((n) => n + 1); }, [muat, muatRingkasan]);

  // Verifikasi cepat (rekening sudah tercatat): endpoint lama. Klik ganda dicegah RowActions selama proses; galat tampil di atas daftar.
  async function verifikasi(p) {
    try { await api.verifyPayment(p.id); await setelahTindakan(); } catch (e) { setPesan(e.message); }
  }

  const dataIni = hasil && hasil._kunci === kunci ? hasil : null;
  const payments = dataIni?.tabData?.payments ?? [];
  const semuaPeriode = dataIni?.semua ?? [];
  const gate = dataIni?.tabData?.gate ?? hasil?.tabData?.gate;
  const cutoff = dataIni?.tabData?.cutoff ?? hasil?.tabData?.cutoff;
  const angka = useMemo(() => ringkasPeriode(semuaPeriode), [semuaPeriode]);

  // Saringan pencarian + chip = fungsi murni SAMA yang dibuktikan identik dengan versi server Export Excel (tes paritas) — bukan logika inline.
  const tampil = useMemo(() => saringPembayaran(payments, filter), [payments, filter]);

  // EXPORT EXCEL — periode + tab (status) + SELURUH saringan layar dikirim sebagai PARAMETER (server menjalankan query & saringan yang sama tanpa batas 300 baris layar).
  // Tab "Ditandai lunas oleh Sales" tidak punya daftar pembayaran: hanya sheet klaim (tanpa periode). Tab "Perlu verifikasi" memuat pembayaran + klaim.
  function ambilBodyExport() {
    const hanyaKlaim = antreanId === "klaim";
    const sertakanKlaim = hanyaKlaim || antreanId === "perlu";
    const opsiMetode = [...new Set(payments.map((p) => p.method).filter(Boolean))];
    const namaRek = (id) => payments.find((p) => p.cashAccount?.id === id)?.cashAccount?.name || akun.find((a) => a.id === id)?.name;
    return {
      ...(hanyaKlaim ? {} : { periode: { from: periode.from, to: periode.to } }),
      filter: {
        status: hanyaKlaim ? "" : antreanId === "perlu" ? "belum_verifikasi" : statusServer(antreanId),
        ...(hanyaKlaim ? {} : { q: filter.q.trim(), metode: filter.metode, verif: filter.verif, alokasi: filter.alokasi, bukti: filter.bukti, rekening: filter.rekening }),
        ...(sertakanKlaim ? { sertakanKlaim: true, hanyaKlaim, ...(klaimIds ? { klaimIds } : {}) } : {}),
      },
      filterLabel: labelFilterAktif([
        ["Tab", LABEL_TAB_EXPORT[antreanId] || "Semua"],
        ["Cara bayar", filter.metode && (opsiMetode.includes(filter.metode) ? LABEL_CARA_BAYAR[filter.metode] || filter.metode : filter.metode)],
        ["Rekening", filter.rekening && namaRek(filter.rekening)],
        ["Status", { terverifikasi: "Sudah diverifikasi", belum: "Menunggu verifikasi", dibatalkan: "Dibatalkan" }[filter.verif]],
        ["Dibagi ke order lain", { ada: "Ya, dibagi", tanpa: "Tidak dibagi" }[filter.alokasi]],
        ["Foto bukti", { ada: "Ada foto", tanpa: "Tanpa foto" }[filter.bukti]],
        ["Pencarian", filter.q.trim()],
      ]),
    };
  }

  // ── Panel pemeriksaan pembayaran ──
  const aksiPanelPembayaran = (p) => {
    const m = p.menuKoreksi;
    const nonaktif = (x) => (x && !x.aktif ? { disabled: true, alasan: [x.alasan, x.arah].filter(Boolean).join(" ") } : {});
    const bisaVerifikasi = !p.cancelledAt && !p.terverifikasi;
    const berKoreksi = m && (p.terverifikasi || p.replacesPaymentId || p.replacedBy);
    return [
      bisaVerifikasi && { key: "verifikasi", label: "Verifikasi…", utama: true, onClick: () => bukaDialog("verifikasi", p) },
      !p.cancelledAt && { key: "alokasi", label: "Bagi ke beberapa order", onClick: () => { setPanel(null); setAlokasiUntuk(p); } },
      berKoreksi && { key: "info", label: "Edit informasi", onClick: () => bukaDialog("info", p), ...nonaktif(m.editInfo) },
      berKoreksi && { key: "koreksi", label: "Koreksi pembayaran", onClick: () => bukaDialog("koreksi", p), ...nonaktif(m.koreksi) },
    ].filter(Boolean);
  };
  const periksa = (p) => setPanel(modelPembayaran(p, { gate, cutoff, aksi: aksiPanelPembayaran(p), onRiwayatLengkap: () => bukaDialog("riwayat", p) }));
  const periksaModel = (m) => setPanel(m);

  const tampilKlaim = antreanId === "perlu" || antreanId === "klaim";
  const tampilBayar = antreanId !== "klaim";

  return (
    <HalamanFinance
      className="fin-halaman" title={rekon ? "Rekonsiliasi Sales–Finance" : "Verifikasi pembayaran"}
      subtitle={rekon ? "Cocokkan klaim dan status lunas dari Sales dengan pembayaran yang tercatat." : "Periksa bukti dan rekening tujuan sebelum pembayaran masuk pembukuan."}
      actions={<div className="fin-pm-aksi"><TombolExportExcel modul="pembayaran" disabled={memuat} ambilBody={ambilBodyExport} /></div>}
      loading={false} error={null}
    >
      <div className="fin-ring fin-pm fin-vf" data-testid="halaman-verifikasi" data-tab={antreanId} data-konteks={rekon ? "rekonsiliasi" : "verifikasi"}>
        <RingkasanAntrean ringkasan={ringkasan} galat={galatRingkasan} onCoba={muatRingkasan} berbukti={berbukti} ke={ke} />
        <PemilihAntrean tab={antreanId} onTab={ke} />

        {pesan && (
          <p className="fin-pm-pesan fin-pm-pesan-galat" role="alert" data-testid="pesan-galat">{pesan} <button type="button" className="fin-pm-reset" onClick={() => setPesan(null)}>Tutup</button></p>
        )}

        {tampilKlaim && (
          <AntreanKlaim
            ringkas={antreanId === "perlu"} versiMuat={versiKlaim} onTampil={setKlaimIds} onData={setBerbukti} onPeriksa={periksaModel}
            onBerubah={() => { muatRingkasan(); if (antreanId === "perlu") muat(); }}
          />
        )}
        {tampilBayar && (
          <DaftarPembayaran
            antrean={antrean} periode={{ ...periode, label: labelPeriode(periode.from, periode.to) }} onPeriode={setPeriode}
            payments={payments} semuaDimuat={semuaPeriode} tampil={tampil} angka={angka}
            filter={filter} onFilter={ubahFilter} onReset={() => setFilter(SARING_AWAL)}
            akun={akun} aksiBaris={(p) => aksiPembayaran(p, { verifikasi, setAlokasiUntuk, bukaDialog, periksa })} onPeriksa={periksa}
            memuat={memuat || !dataIni} galat={galat} onCoba={muat}
          />
        )}

        <Bantuan key={rekon ? "rekon" : "verifikasi"} gate={gate} periode={periode} ke={ke} selisihTerbuka={rekon} />
      </div>

      <ModalAlokasi
        payment={alokasiUntuk}
        onClose={() => setAlokasiUntuk(null)}
        onSaved={async () => { setAlokasiUntuk(null); await setelahTindakan(); }}
        onError={setPesan}
      />

      {dialog?.jenis === "verifikasi" && <VerifikasiDialog p={dialog.p} cutoff={cutoff} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await setelahTindakan(); }} />}
      {dialog?.jenis === "riwayat" && <RiwayatPembayaranDialog p={dialog.p} onClose={() => setDialog(null)} />}
      {dialog?.jenis === "info" && <EditInfoDialog p={dialog.p} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await setelahTindakan(); }} />}
      {dialog?.jenis === "koreksi" && <KoreksiPembayaranDialog p={dialog.p} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await setelahTindakan(); }} />}

      <PanelPemeriksaan model={panel} onClose={() => setPanel(null)} />
    </HalamanFinance>
  );
}

/**
 * Alokasi satu pembayaran ke beberapa order.
 *
 * Aturannya tegas dan ditegakkan backend juga: TOTAL alokasi wajib PERSIS
 * sama dengan nominal pembayaran. Menerima kurang berarti ada uang yang
 * hilang dari pembukuan; menerima lebih berarti mengarang uang. Sisa yang
 * belum teralokasi ditampilkan hidup di bawah supaya tidak perlu menghitung
 * di kepala.
 */
function ModalAlokasi({ payment, onClose, onSaved, onError }) {
  const [baris, setBaris] = useState([]);

  useEffect(() => {
    if (!payment) return;
    setBaris(
      payment.finAllocations.length > 0
        ? payment.finAllocations.map((a) => ({ orderNumber: a.order?.orderNumber || "", orderId: a.orderId, amount: String(a.amount) }))
        : [{ orderNumber: payment.order?.orderNumber || "", orderId: payment.orderId, amount: String(payment.amount) }]
    );
  }, [payment]);

  if (!payment) return null;

  const total = baris.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const sisa = (payment.amount || 0) - total;
  const valid = Math.abs(sisa) < 0.005 && baris.every((b) => b.orderId && Number(b.amount) > 0);

  function ubah(i, k, v) {
    setBaris((s) => s.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)));
  }

  async function simpan() {
    try {
      await api.setFinancePaymentAllocations(
        payment.id,
        baris.map((b) => ({ orderId: b.orderId, amount: Number(b.amount) }))
      );
      await onSaved();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title="Bagi Pembayaran ke Beberapa Order"
      description={`${formatUang(payment.amount)} · ${LABEL_CARA_BAYAR[payment.method] || payment.method} · ${tanggalJam(payment.createdAt)}`}
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={simpan} disabled={!valid}>Simpan Pembagian</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-ink2">
          Satu pembayaran bisa dibagi ke beberapa order — misalnya pelanggan transfer sekali untuk dua order
          sekaligus. Pembukuannya otomatis menyesuaikan dengan pembagian yang baru.
        </p>

        {baris.map((b, i) => (
          <div key={i} className="grid grid-cols-[1fr_140px_32px] items-end gap-2">
            <Field label={i === 0 ? "Untuk order" : undefined}>
              <OrderPicker
                value={b.orderId}
                onChange={(id, order) => {
                  ubah(i, "orderId", id);
                  ubah(i, "orderNumber", order?.orderNumber || "");
                }}
                // Order asal pembayaran ini ditawarkan lebih dulu: memecah
                // pembayaran hampir selalu berarti "sebagian tetap di order
                // ini, sisanya pindah".
                saran={payment.order ? [{
                  id: payment.orderId,
                  orderNumber: payment.order.orderNumber,
                  customerName: payment.order.customer?.name,
                  value: nilaiBersihOrder(payment.order),
                  paymentStatus: payment.order.paymentStatus,
                }] : []}
                saranLabel="Order asal pembayaran ini"
                placeholder="Cari order…"
              />
            </Field>
            <Field label={i === 0 ? "Nominal" : undefined}>
              <InputUang value={b.amount} onChange={(v) => ubah(i, "amount", v)} />
            </Field>
            <Button
              variant="neutral" size="icon"
              disabled={baris.length <= 1}
              onClick={() => setBaris((s) => s.filter((_, idx) => idx !== i))}
              aria-label="Hapus baris"
            >
              ×
            </Button>
          </div>
        ))}

        <Button
          size="sm" variant="tertiary" className="px-0"
          onClick={() => setBaris((s) => [...s, { orderId: "", orderNumber: "", amount: "" }])}
        >
          + Tambah order
        </Button>

        <div className={`rounded-lg px-3 py-2 text-[13px] ${Math.abs(sisa) < 0.005 ? "bg-greenbg text-green" : "bg-orangebg text-orange"}`}>
          Total yang dibagi {formatUang(total)} dari {formatUang(payment.amount)}
          {Math.abs(sisa) >= 0.005 && ` — ${sisa > 0 ? "kurang" : "lebih"} ${formatUang(Math.abs(sisa))}`}
        </div>
      </div>
    </Modal>
  );
}
