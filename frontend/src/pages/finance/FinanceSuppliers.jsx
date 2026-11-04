import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useUrlTab } from "@/lib/useUrlTab.js";
import "@/styles/sanss-finance-tagihan.css";
import "@/styles/sanss-finance-po.css";
import { PanelDetail, klikBuka } from "@/features/finance/PanelDetail.jsx";
import { specOtomatis } from "@/features/finance/detailSpecs.js";
import { Plus, Building2, FileText, Banknote, Pencil, History, Ban, CheckCircle2, CalendarClock, Wallet, ArrowLeft, ArrowRight, GlifKaca, ikonMenuApple, UbinApple } from "@/components/ikApple.jsx";
import { Card, CardContent } from "@/components/ui/card.jsx";
import DaftarTagihan, { RingkasanTagihan } from "@/features/finance/tagihan/DaftarTagihan.jsx";
import RincianTagihan from "@/features/finance/tagihan/RincianTagihan.jsx";
import CatatTagihan from "@/features/finance/tagihan/CatatTagihan.jsx";
import UbahTagihan from "@/features/finance/tagihan/UbahTagihan.jsx";
import { DialogAlasan, DialogSetujui, Galat } from "@/features/finance/tagihan/DialogTagihan.jsx";
import { ModalFaktur } from "@/features/finance/po/RincianPO.jsx";
import { masukTab, statusTempo, teksCari, hitungTab, formatUangTepat, LABEL_TEMPO } from "@/features/finance/tagihan/tagihanLogika.js";
import { hariIniWIB } from "@/features/finance/po/poKontrol.js";
import { PemilihSupplier, TanggalPO } from "@/features/finance/po/KontrolPO.jsx";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, ColGroup, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { LEBAR_NOMOR } from "@/features/finance/tierTagihan.js";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { NominalDenganBiaya, nominalTeks } from "@/features/finance/biayaAdminTampil.jsx";
import CaraBayarTransfer from "@/features/finance/CaraBayarTransfer.jsx";
import { BIAYA_KOSONG, denganBiaya, biayaTransferLengkap } from "@/features/finance/biayaTransfer.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, tanggalPendek, LABEL_STATUS,
} from "@/features/finance/shared.jsx";
import { KenapaBeda } from "@/features/finance/kontrak.jsx";
import FilterBar, { cocok } from "@/features/finance/FilterBar.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { RowActions, AKSI_COL_WIDTH, AKSI_COL_WIDTH_MENU_ONLY } from "@/features/finance/RowActions.jsx";
import { RiwayatVersiDialog, KoreksiDialog, InfoDialog } from "@/features/finance/KoreksiAman.jsx";
import { aksiTagihan as matriksTagihan, aksiPembayaranSupplier } from "@/features/finance/matriksAksi.js";
import { bentukItemMenu, adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import { formDariSupplier, payloadPerubahan, galatForm, rekeningBerubah, supplierBisaDipilih } from "@/features/finance/supplierEditLogic.js";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import PilihJenisTagihan, { bodyJenis, jenisLengkap } from "@/features/finance/JenisTagihan.jsx";
import { resetSaatBuka } from "@/features/finance/resetSaatBuka.jsx";
import JadwalAgingUtang from "@/features/finance/JadwalAgingUtang.jsx";
import { TabelUangMukaSupplier } from "@/features/finance/UangMukaSupplierTabel.jsx";
import { ModalTerapkanUangMuka } from "@/features/finance/UangMukaPO.jsx";
import { useKelayakanFaktur, useTawaranUangMuka, BannerUangMuka } from "@/features/finance/uangMukaFaktur/PenerapanUangMuka.jsx";
import { KartuKpiApple, KolomCari, ChipNada, KosongDaftar } from "@/features/finance/DaftarGaya.jsx";
import { SelectPO } from "@/features/finance/po/KontrolPO.jsx";
import { fakturPerluPeriksaUangMuka, fakturBerisikoBayarKedua, cekNominalBayar, ringkasKelayakan, teksCakupanPeriksa, BATAS_PERIKSA_UANG_MUKA } from "@/features/finance/uangMukaFaktur/kelayakanLogika.js";
import TerminFaktur from "@/features/finance/TerminFaktur.jsx";
import { daftarPilihanTermin, payloadTerminSupplier, bodyTermin, galatTermin, TERMIN_AWAL, bolehMencatatFinance } from "@/features/finance/terminLogic.js";

// Tagihan: SATU pintu "Ubah tagihan" (dialog kemampuan per status; lihat tagihan/UbahTagihan.jsx + kemampuanUbah). Edit/Edit Informasi/Koreksi tidak lagi menjadi tiga menu terpisah.
// Tolak, Batalkan, dan Setujui memakai dialog aplikasi (bukan window.prompt/confirm); aturan alasan wajib dan endpoint-nya sama seperti sebelumnya.
function aksiTagihan(b, { setUbahUntuk, setVersiUntuk, setAlasanUntuk, setSetujuiUntuk, setUangMukaUntuk, supplierAdaUangMuka }) {
  const lepas = new Set(["edit", "info", "koreksi"]);
  const items = bentukItemMenu(matriksTagihan(b, { admin: adminSaatIni() }), {
    versi: () => setVersiUntuk(b),
    tolak: () => setAlasanUntuk({ jenis: "tolak", b }),
    batalkan: () => setAlasanUntuk({ jenis: "batalkan", b }),
  }).filter((it) => !lepas.has(it.key));
  // Uang muka supplier: tawarkan penerapan bila supplier punya saldo uang muka & faktur masih bersisa. Tetap dikonfirmasi Finance di dialog.
  if (["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(b.status) && supplierAdaUangMuka?.has(b.supplierId) && b.sisa > 0) {
    items.unshift({ key: "uang-muka", label: "Terapkan Uang Muka", icon: Wallet, hint: "Kurangi sisa utang faktur dengan uang muka supplier yang belum diterapkan.", onClick: () => setUangMukaUntuk(b) });
  }
  items.unshift({ key: "ubah", label: "Ubah tagihan", icon: Pencil, hint: "Lihat apa yang bisa diubah menurut status tagihan.", onClick: () => setUbahUntuk(b) });
  const itemsApple = () => ikonMenuApple(items);
  if (["DRAFT", "MENUNGGU_APPROVAL"].includes(b.status)) {
    return {
      primary: {
        label: "Setujui", variant: "secondary",
        disabled: !b.billType,
        title: !b.billType ? "Pilih Jenis Tagihan dulu lewat Ubah tagihan (mis. Bahan Baku untuk kain/busa) supaya tidak salah tercatat sebagai beban" : undefined,
        onClick: () => setSetujuiUntuk(b),
      },
      items: itemsApple(),
    };
  }
  return { primary: null, items: itemsApple() };
}

// Pembayaran supplier: koreksi langsung tidak tersedia — Batalkan (jurnal dibalik, alokasi ke tagihan dilepas) lalu catat ulang.
function aksiPembayaran(p, { aksi, setVersiPay }) {
  return ikonMenuApple(bentukItemMenu(aksiPembayaranSupplier(p, { admin: adminSaatIni() }), {
    versi: () => setVersiPay(p),
    batalkan: () => {
      const alasan = window.prompt(`Alasan membatalkan pembayaran ${p.paymentNumber}? Jurnalnya dibalik dan tagihan kembali terbuka, lalu catat ulang pembayaran yang benar:`);
      if (alasan?.trim()) return aksi(() => api.cancelFinanceSupplierPayment(p.id, alasan.trim()));
    },
  }));
}

// Nominal dicari sebagai angka polos maupun berformat titik ("1500000" / "1.500.000").
const angka = (x) => `${Math.round(Number(x) || 0)} ${(Number(x) || 0).toLocaleString("id-ID")}`;
const unik = (arr) => [...new Set(arr.filter(Boolean))].sort().map((v) => [v, v]);
const opsiPil = (semua, pasangan) => [{ nilai: "", label: semua }, ...pasangan.map(([nilai, label]) => ({ nilai, label }))];


// SUPPLIER & UTANG USAHA — master supplier, tagihan masuk, dan pembayaran.
//
// ⚠️ TAGIHAN YANG MENAUT PENERIMAAN BARANG TIDAK MENYENTUH STOK SAMA
// SEKALI. Kuantitas sudah tercatat gudang saat putaway; yang dikerjakan di
// sini murni sisi rupiahnya: menutup akun "Utang Barang Belum Ditagih" dan
// melahirkan Utang Usaha yang sebenarnya. Selisih antara nilai tagihan
// supplier dan nilai penerimaan masuk akun Selisih Harga Pembelian — nilai
// persediaan yang SUDAH tercatat tidak pernah diubah surut.

const TAB = [
  { key: "tagihan", label: "Tagihan supplier", Icon: FileText, penjelasan: "Tagihan yang datang dari supplier — begitu disetujui, jadi utang resmi di buku besar." },
  { key: "aging", label: "Jadwal pembayaran", Icon: CalendarClock, penjelasan: "Utang supplier menurut tanggal jatuh tempo — status barang, faktur, dan pembayaran dipisahkan. Barang boleh sudah dipakai Produksi walau faktur belum dibayar." },
  { key: "pembayaran", label: "Pembayaran", Icon: Banknote, penjelasan: "Riwayat uang yang sudah dikeluarkan untuk melunasi tagihan supplier." },
  { key: "supplier", label: "Master Supplier", Icon: Building2, penjelasan: "Data lengkap para supplier — kontak, termin pembayaran, dan rekening tujuan transfer." },
];

// Judul halaman mengikuti bagian yang terbuka; menu hub (Tagihan supplier · Jadwal pembayaran) tetap satu-satunya navigasi utama.
const JUDUL_TAB = { tagihan: "Tagihan supplier", aging: "Jadwal pembayaran", pembayaran: "Pembayaran supplier", supplier: "Daftar supplier" };
const SUBJUDUL_TAB = {
  tagihan: "Periksa tagihan, jatuh tempo, dan pembayaran supplier.",
  aging: "Utang supplier menurut jatuh tempo, dan jadwal pembayarannya.",
  pembayaran: "Riwayat pembayaran ke supplier dan tagihan yang dilunasinya.",
  supplier: "Data supplier, termin, rekening, dan sisa utang per supplier.",
};

export default function FinanceSuppliers() {
  const [panelRincian, setPanelRincian] = useState(null); // panel detail samping (klik baris)
  const [tab, setTab] = useUrlTab(["tagihan", "aging", "pembayaran", "supplier"], "tagihan"); // ?tab= (deep-link hub Pembelian & Supplier)
  const [suppliers, setSuppliers] = useState([]);
  const [bills, setBills] = useState([]);
  const [editUntuk, setEditUntuk] = useState(null);
  const [ubahUntuk, setUbahUntuk] = useState(null); // dialog "Ubah tagihan" (pintu tunggal)
  const [fakturPOUntuk, setFakturPOUntuk] = useState(null);
  const [alasanUntuk, setAlasanUntuk] = useState(null); // { jenis: "tolak" | "batalkan", b }
  const [setujuiUntuk, setSetujuiUntuk] = useState(null);
  const [versiUntuk, setVersiUntuk] = useState(null);
  const [infoUntuk, setInfoUntuk] = useState(null);
  const [koreksiUntuk, setKoreksiUntuk] = useState(null);
  const [versiPay, setVersiPay] = useState(null);
  const [payments, setPayments] = useState([]);
  const [aging, setAging] = useState(null);
  const [unbilled, setUnbilled] = useState([]);
  const [kategori, setKategori] = useState([]);
  const [kategoriBeli, setKategoriBeli] = useState([]);
  const [metodeInfo, setMetodeInfo] = useState(null);
  const [rekening, setRekening] = useState([]);
  const [uangMuka, setUangMuka] = useState(null); // ringkasan uang muka per supplier (server)
  const [versiData, setVersiData] = useState(0); // naik tiap data berhasil dimuat ulang → pemeriksaan uang muka per faktur diulang
  const [uangMukaUntuk, setUangMukaUntuk] = useState(null); // faktur yang akan diberi uang muka
  const [rincianTagihan, setRincianTagihan] = useState(null); // tagihan yang rinciannya dibuka (panel Tagihan supplier)
  const [tabB, setTabB] = useState(null); // kelompok status daftar tagihan; null = belum dipilih (ditentukan sekali setelah data termuat)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [tentang, setTentang] = useState(false);
  const [modal, setModal] = useState(null);
  const [editSupplier, setEditSupplier] = useState(null); // baris supplier yang sedang diedit (modal Edit Supplier)
  // Pencarian & filter per tab (sisi-klien) — state tiap tab terpisah.
  const [spCari] = useSearchParams(); // ?cari= : tautan dalam (mis. dari detail PO) membuka daftar dengan pencarian terisi
  const cariAwal = spCari.get("cari") || "";
  const [qB, setQB] = useState(cariAwal);
  const [fSupB, setFSupB] = useState("");
  const [fTempo, setFTempo] = useState("");
  const [qP, setQP] = useState(cariAwal);
  const [fSupP, setFSupP] = useState("");
  const [fRek, setFRek] = useState("");
  const [fStatusP, setFStatusP] = useState("");
  const [qS, setQS] = useState("");
  const [fStatusS, setFStatusS] = useState("");
  const [fUtang, setFUtang] = useState("");

  const supplierAdaUangMuka = useMemo(() => new Set((uangMuka?.suppliers || []).filter((s) => s.uangMukaBelumDiterapkan > 0).map((s) => s.supplierId)), [uangMuka]);

  // `senyap`: segarkan data TANPA membongkar halaman (HalamanFinance mengganti isi dengan spinner saat loading) — dipakai agar form Catat Pembayaran yang sedang terbuka
  // tidak kehilangan isiannya ketika uang muka diterapkan dari dalamnya. (Dipakai juga sebagai onClick: argumen event diabaikan.)
  const muat = useCallback(async (opsi) => {
    const senyap = opsi?.senyap === true;
    if (!senyap) setLoading(true);
    setError(null);
    try {
      const [s, b, p, ag, ub, k, r, kb, mi, um] = await Promise.all([
        api.getFinanceSuppliers({ includeInactive: "1" }), // nonaktif ikut dimuat supaya bisa difilter & diaktifkan lagi; pilihan tagihan/bayar hanya yang aktif
        api.getFinanceBills(),
        api.getFinanceSupplierPayments(),
        api.getFinancePayables(),
        api.getFinanceUnbilledReceipts().catch(() => ({ receipts: [] })),
        api.getFinanceExpenseCategories(),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
        api.getFinancePurchaseCategories().catch(() => ({ categories: [] })),
        api.getFinanceInventoryMethod().catch(() => null),
        api.getUangMukaSupplierRingkasan().catch(() => null),
      ]);
      setSuppliers(s.suppliers);
      setBills(b.bills);
      setPayments(p.payments);
      setAging(ag);
      setUnbilled(ub.receipts);
      setKategori(k.categories);
      setKategoriBeli(kb.categories || []);
      setMetodeInfo(mi);
      setUangMuka(um);
      setRekening((r.accounts || []).filter((a) => a.active));
      setVersiData((n) => n + 1);
    } catch (e) {
      if (senyap) setPesan(e.message || "Gagal menyegarkan data supplier"); else setError(e.message || "Gagal memuat data supplier");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModal(null);
      setEditSupplier(null);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }
  // Menu baris & menu rincian memakai satu pembangun; membuka dialog apa pun menutup panel rincian lebih dulu.
  const dariBaris = (setter) => (x) => { setRincianTagihan(null); setter(x); };
  const aksiBaris = (b) => aksiTagihan(b, { setUbahUntuk: dariBaris(setUbahUntuk), setVersiUntuk: dariBaris(setVersiUntuk), setAlasanUntuk: dariBaris(setAlasanUntuk), setSetujuiUntuk: dariBaris(setSetujuiUntuk), setUangMukaUntuk: dariBaris(setUangMukaUntuk), supplierAdaUangMuka });
  const suppliersAktif = useMemo(() => supplierBisaDipilih(suppliers), [suppliers]);
  const bolehCatat = useMemo(() => { try { return bolehMencatatFinance(JSON.parse(localStorage.getItem("user") || "null")); } catch { return false; } }, []);
  const tawaran = useTawaranUangMuka({ bolehPost: bolehCatat, onSelesai: muat });
  // Edit supplier: galat server DITAMPILKAN di dalam dialog (dialog tidak boleh tertutup/terkunci saat gagal) → fungsi ini melempar ulang ke dialog.
  async function simpanEditSupplier(awal, perubahan) {
    if (Object.keys(perubahan).length === 0) { setEditSupplier(null); return; }
    await api.updateFinanceSupplier(awal.id, perubahan);
    setEditSupplier(null);
    await muat();
  }
  async function ubahStatusSupplier(s) {
    try { await api.updateFinanceSupplier(s.id, { active: !s.active }); await muat(); } catch (e) { setPesan(e.message); }
  }

  const menunggu = bills.filter((b) => b.status === "MENUNGGU_APPROVAL");
  const lewatTempo = (aging?.baris || []).filter((b) => b.hariLewat > 0);

  const hariIni = hariIniWIB();
  const tabAktifB = tabB ?? (hitungTab(bills, hariIni).proses > 0 ? "proses" : "semua");
  const billsTampil = useMemo(() => bills.filter((b) =>
    masukTab(b, tabAktifB, hariIni) &&
    (!fSupB || b.supplier?.name === fSupB) &&
    (!fTempo || statusTempo(b, hariIni) === fTempo) &&
    cocok(qB, ...teksCari(b, angka), tanggalPendek(b.billDate), b.dueDate ? tanggalPendek(b.dueDate) : "")
  ), [bills, qB, fSupB, fTempo, tabAktifB, hariIni]);
  // Uang muka yang tertaut ke PO faktur yang sama: kelayakan diputuskan SERVER (kandidat per faktur). Hanya baris yang tampil, bersisa, milik supplier yang punya saldo uang muka
  // diperiksa (maks. 60); tiap penyegaran data memeriksa ulang (versiData masuk kunci).
  const kandidatPeriksa = useMemo(() => billsTampil.filter((b) => fakturPerluPeriksaUangMuka(b) && supplierAdaUangMuka.has(b.supplierId)), [billsTampil, supplierAdaUangMuka]);
  const idKelayakan = useMemo(() => kandidatPeriksa.slice(0, BATAS_PERIKSA_UANG_MUKA).map((b) => `${b.id}:${b.sisa}:${versiData}`), [kandidatPeriksa, versiData]);
  const kelayakan = useKelayakanFaktur(idKelayakan);
  // Jujur soal cakupan: bila kandidat melebihi batas atau ada yang gagal diperiksa, daftar menyatakannya — baris tanpa penanda BUKAN berarti sudah diperiksa.
  const statusPeriksaUm = useMemo(() => ({ total: kandidatPeriksa.length, diperiksa: Math.min(kandidatPeriksa.length, BATAS_PERIKSA_UANG_MUKA), terpotong: kandidatPeriksa.length > BATAS_PERIKSA_UANG_MUKA, gagal: Object.keys(kelayakan.galat).length, onCoba: kelayakan.muatUlang }), [kandidatPeriksa, kelayakan.galat, kelayakan.muatUlang]);
  const paymentsTampil = useMemo(() => payments.filter((p) =>
    (!fSupP || p.supplier?.name === fSupP) &&
    (!fRek || p.cashAccount?.name === fRek) &&
    (!fStatusP || (fStatusP === "batal") === !!p.cancelledAt) &&
    cocok(qP, p.paymentNumber, p.date, tanggalPendek(p.date), p.supplier?.name, p.cashAccount?.name, (p.allocations || []).map((a) => a.bill?.billNumber).join(" "), angka(p.amount), p.cancelledAt ? "dibatalkan" : "terposting")
  ), [payments, qP, fSupP, fRek, fStatusP]);
  const ringkasBayar = useMemo(() => {
    const aktif = paymentsTampil.filter((p) => !p.cancelledAt);
    return { total: aktif.reduce((s, p) => s + Number(p.amount || 0), 0), jumlah: aktif.length, batal: paymentsTampil.length - aktif.length };
  }, [paymentsTampil]);
  const suppliersTampil = useMemo(() => suppliers.filter((s) =>
    (!fStatusS || (fStatusS === "aktif") === !!s.active) &&
    (!fUtang || (fUtang === "ada") === (Number(s.sisaUtang) > 0)) &&
    cocok(qS, s.code, s.name, s.phone, s.email, s.paymentTermDays, s.bankName, s.bankAccount, angka(s.sisaUtang), s.active ? "aktif" : "nonaktif")
  ), [suppliers, qS, fStatusS, fUtang]);

  return (
    <HalamanFinance
      title={JUDUL_TAB[tab]}
      subtitle={SUBJUDUL_TAB[tab]}
      loading={loading}
      error={error}
      onRetry={muat}
      actions={(
        <>
          {/* Export mengikuti TAB AKTIF: baris yang tampil setelah pencarian/filter sisi-klien dikirim sebagai `ids` (urutan layar). */}
          {tab !== "aging" && <TombolExportExcel
            modul="supplier-utang"
            ambilBody={() => {
              if (tab === "tagihan") {
                return {
                  filter: { tab }, ids: billsTampil.map((b) => b.id),
                  filterLabel: labelFilterAktif([["Tab", "Tagihan supplier"], ["Kelompok", { proses: "Perlu diproses", belum: "Belum lunas", lunas: "Lunas" }[tabAktifB]], ["Supplier", fSupB], ["Jatuh tempo", LABEL_TEMPO[fTempo]], ["Pencarian", qB.trim()]]),
                };
              }
              if (tab === "pembayaran") {
                return {
                  filter: { tab }, ids: paymentsTampil.map((p) => p.id),
                  filterLabel: labelFilterAktif([["Tab", "Pembayaran"], ["Supplier", fSupP], ["Dari rekening", fRek], ["Status", fStatusP && (fStatusP === "batal" ? "Dibatalkan" : "Terposting")], ["Pencarian", qP.trim()]]),
                };
              }
              return {
                filter: { tab }, ids: suppliersTampil.map((s) => s.id),
                filterLabel: labelFilterAktif([["Tab", "Master Supplier"], ["Status", fStatusS && (fStatusS === "aktif" ? "Aktif" : "Nonaktif")], ["Utang", fUtang && (fUtang === "ada" ? "Ada sisa utang" : "Lunas")], ["Pencarian", qS.trim()]]),
              };
            }}
          />}
          {tab !== "aging" && <Button size="sm" disabled={tab === "tagihan" && !bolehCatat} title={tab === "tagihan" && !bolehCatat ? "Akun Anda tidak punya izin mencatat tagihan (Finance/Akuntan)." : undefined} onClick={() => setModal(tab === "supplier" ? "supplier" : tab === "pembayaran" ? "bayar" : "tagihan")} data-testid="catat-tagihan">
            <Plus size={14} />
            {tab === "supplier" ? "Supplier Baru" : tab === "pembayaran" ? "Catat Pembayaran" : "Catat tagihan"}
          </Button>}
          {tab === "aging" && <Button size="sm" onClick={() => setModal("bayar")}><Banknote size={14} /> Catat Pembayaran</Button>}
          {tab === "supplier" && <TombolExportExcel modul="uang-muka-supplier" label="Export Uang Muka" ambilBody={() => ({ filter: {} })} />}
        </>
      )}
    >
      {pesan && (
        <Card className="bg-redbg">
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p className="text-[13px] text-ink">{pesan}</p>
            <Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
          </CardContent>
        </Card>
      )}

      {tab === "tagihan" && (
        <>
        <RingkasanTagihan
          aging={aging} bills={bills} uangMuka={uangMuka} unbilled={unbilled}
          onTab={(k) => { setTab("tagihan"); setTabB(k); }}
          onLihatUangMuka={() => setTab("supplier")}
          onLihatPenerimaan={() => setModal("tagihan-penerimaan")}
        />

        <div className="fin-tg-tentang" data-testid="tentang-angka">
          <Pembuka buka={tentang} onToggle={() => setTentang((v) => !v)} id="tentang-angka-isi" className="fin-tg-tentang-tombol">Tentang angka dan pencatatan</Pembuka>
          {tentang && (
            <div id="tentang-angka-isi" className="fin-tg-tentang-isi">
              <p><strong>Sisa utang</strong>: sisa faktur yang sudah DISETUJUI dan belum lunas (setelah uang muka diterapkan), dihitung server. Sisa PO yang belum ditagih bukan utang. <strong>Uang muka</strong> adalah aset, bukan stok dan bukan biaya; tidak mengurangi sisa utang sampai diterapkan ke faktur.</p>
              <Penjelasan>
                Tagihan yang menaut dokumen penerimaan barang <strong>tidak menyentuh stok sama sekali</strong> — kuantitasnya sudah dicatat Gudang saat putaway. Yang dikerjakan di sini murni sisi rupiah: menutup “Utang Barang Belum Ditagih” dan melahirkan Utang Usaha. Selisih antara tagihan supplier dan nilai penerimaan masuk akun Selisih Harga Pembelian, bukan mengubah nilai persediaan yang sudah tercatat.
              </Penjelasan>
              <KenapaBeda metrik={["utang_supplier","pembelian_aktif","komitmen_belum_dibayar","uang_keluar_kas","persediaan_nilai"]} />
            </div>
          )}
        </div>
        </>
      )}

      {/* Navigasi utama Pembelian & Supplier hanya di menu hub; di sini cuma jalan pendukung (bukan baris tab kedua). */}
      {(tab === "tagihan" || tab === "pembayaran" || tab === "supplier") && (
        <nav className="fin-tg-pendukung" aria-label="Terkait tagihan supplier" data-testid="nav-pendukung">
          {tab !== "tagihan" && <button type="button" className="fin-tg-kembali" onClick={() => setTab("tagihan")} data-testid="kembali-tagihan"><ArrowLeft size={15} aria-hidden="true" /> Tagihan supplier</button>}
          {tab !== "pembayaran" && <button type="button" className="fin-tg-pendukung-tombol" onClick={() => setTab("pembayaran")} data-testid="buka-pembayaran"><Banknote size={15} aria-hidden="true" /> Pembayaran</button>}
          {tab !== "supplier" && <button type="button" className="fin-tg-pendukung-tombol" onClick={() => setTab("supplier")} data-testid="buka-supplier"><Building2 size={15} aria-hidden="true" /> Daftar supplier</button>}
        </nav>
      )}
      {tab !== "tagihan" && tab !== "aging" && <p className="fin-tg-info" data-nada="biru" data-testid="info-tab">{TAB.find((t) => t.key === tab)?.penjelasan}</p>}

      {tab === "aging" && (
        <JadwalAgingUtang suppliers={suppliersAktif} rekening={rekening} bolehJadwal={(() => { try { return bolehMencatatFinance(JSON.parse(localStorage.getItem("user") || "null")); } catch { return false; } })()} onBukaPembayaran={() => setModal("bayar")} />
      )}

      {tab === "tagihan" && (
        <DaftarTagihan
          bills={bills} billsTampil={billsTampil} tab={tabAktifB} onTab={setTabB} hariIni={hariIni}
          q={qB} onQ={setQB} fSup={fSupB} onFSup={setFSupB} fTempo={fTempo} onFTempo={setFTempo}
          onReset={() => { setQB(""); setFSupB(""); setFTempo(""); }}
          aksi={aksiBaris} kelayakanUm={kelayakan.peta} statusPeriksaUm={statusPeriksaUm}
          onBuka={setRincianTagihan} onCatat={() => setModal("tagihan")}
        />
      )}

      {tab === "pembayaran" && (
        <>
        <section className="fin-kw-baris" data-kolom="3" aria-label="Ringkasan pembayaran supplier" data-testid="kartu-pembayaran">
          <KartuKpiApple ikon="uang" warna="hijau" label="Total dibayar (terposting)" nilai={formatUang(ringkasBayar.total)} ket={`${ringkasBayar.jumlah} pembayaran sesuai filter, dari ${payments.length} yang dimuat`} testid="kpi-total-dibayar" />
          <KartuKpiApple ikon="centang" warna="biru" label="Pembayaran terposting" nilai={ringkasBayar.jumlah} ket="Menutup tagihan supplier; satu pembayaran bisa melunasi beberapa tagihan" testid="kpi-bayar-terposting" />
          <KartuKpiApple ikon="larang" warna={ringkasBayar.batal > 0 ? "merah" : "grafit"} label="Dibatalkan" nilai={ringkasBayar.batal} ket="Jurnal dibalik dan tagihan kembali terbuka" testid="kpi-bayar-batal" />
        </section>
        <section className="fin-tg-panel" aria-label="Daftar pembayaran supplier">
          <div className="fin-tg-alat">
            <div className="fin-tg-cari" style={{ justifyContent: "flex-start" }}>
              <KolomCari nilai={qP} onUbah={setQP} placeholder="Cari nomor, supplier, tagihan, nominal…" ariaLabel="Cari pembayaran" testid="cari-pembayaran" />
              <div className="fin-tg-pilih"><SelectPO value={fSupP} onChange={setFSupP} ariaLabel="Supplier" opsi={opsiPil("Semua supplier", unik(payments.map((p) => p.supplier?.name)))} /></div>
              <div className="fin-tg-pilih"><SelectPO value={fRek} onChange={setFRek} ariaLabel="Dari rekening" opsi={opsiPil("Semua rekening", unik(payments.map((p) => p.cashAccount?.name)))} /></div>
              <div className="fin-tg-pilih"><SelectPO value={fStatusP} onChange={setFStatusP} ariaLabel="Status" opsi={opsiPil("Semua status", [["posting", "Terposting"], ["batal", "Dibatalkan"]])} /></div>
            </div>
          </div>
          <p className="fin-tg-jumlah" role="status" aria-live="polite" data-testid="jumlah-pembayaran">
            {paymentsTampil.length === payments.length ? `${payments.length} pembayaran` : `${paymentsTampil.length} dari ${payments.length} pembayaran`}
            {(qP || fSupP || fRek || fStatusP) && <button type="button" className="fin-tg-reset" onClick={() => { setQP(""); setFSupP(""); setFRek(""); setFStatusP(""); }}>Atur ulang</button>}
          </p>
          {paymentsTampil.length === 0 ? (
            <KosongDaftar testid="pembayaran-kosong" ikon="uang" judul={payments.length === 0 ? "Belum ada pembayaran" : "Tidak ada pembayaran yang cocok"} ket={payments.length === 0 ? "Pembayaran ke supplier muncul di sini setelah dicatat." : "Ubah kata kunci atau filter."} />
          ) : (
            <div className="fin-dl-tabel" role="table" aria-label="Pembayaran ke supplier" style={{ "--kolom-sedang": "minmax(240px, 2.4fr) 110px 150px 130px 60px", "--kolom-lebar": "minmax(240px, 2.2fr) 110px minmax(130px, 1fr) minmax(150px, 1.4fr) 150px 130px 60px" }}>
              <div className="fin-dl-judul" role="row">
                <span role="columnheader">Pembayaran</span><span role="columnheader">Tanggal</span><span role="columnheader" className="fin-dl-lebar">Dari rekening</span><span role="columnheader" className="fin-dl-lebar">Tagihan</span>
                <span role="columnheader" className="kanan">Nominal</span><span role="columnheader">Status</span><span role="columnheader" className="fin-sr-saja">Tindakan</span>
              </div>
              {paymentsTampil.map((p) => {
                const tagihan = p.allocations.map((a) => a.bill?.billNumber).filter(Boolean).join(", ");
                return (
                  <div
                    key={p.id} className="fin-dl-baris" role="row" tabIndex={0} data-testid="baris-pembayaran" data-garis={p.cancelledAt ? "merah" : undefined}
                    onClick={(e) => { if (e.target.closest("button, a, input, select, [role='menuitem'], [data-tanpa-detail]")) return; setPanelRincian(specOtomatis(p)); }}
                    onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setPanelRincian(specOtomatis(p)); } }}
                    aria-label={`Pembayaran ${p.paymentNumber} ke ${p.supplier?.name || "supplier"}. Buka rincian`}
                  >
                    <div className="fin-dl-sel fin-dl-utama" role="cell">
                      <UbinApple nama="uang" ukuran={40} />
                      <span className="fin-dl-teks"><span className="fin-dl-judul-baris" title={p.supplier?.name}>{p.supplier?.name}</span><span className="fin-dl-nomor">{p.paymentNumber}</span></span>
                    </div>
                    <div className="fin-dl-sel" role="cell"><span className="fin-dl-label">Tanggal</span>{tanggalPendek(p.date)}</div>
                    <div className="fin-dl-sel fin-dl-lebar" role="cell"><span className="fin-dl-label">Dari rekening</span>{p.cashAccount?.name || "—"}</div>
                    <div className="fin-dl-sel fin-dl-lebar" role="cell"><span className="fin-dl-label">Tagihan</span><span className="fin-dl-sub" title={tagihan || "—"}>{tagihan || "—"}</span></div>
                    <div className="fin-dl-sel fin-dl-angka" role="cell"><span className="fin-dl-label">Nominal</span><NominalDenganBiaya d={p} /></div>
                    <div className="fin-dl-sel" role="cell"><span className="fin-dl-label">Status</span><ChipNada nada={p.cancelledAt ? "merah" : "hijau"}>{p.cancelledAt ? "Dibatalkan" : "Terposting"}</ChipNada></div>
                    <div className="fin-dl-sel fin-dl-aksi" role="cell" data-tanpa-detail>
                      <RowActions gayaApple primary={null} items={aksiPembayaran(p, { aksi, setVersiPay })} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        </>
      )}

      {tab === "supplier" && (
        <>
        <TabelUangMukaSupplier data={uangMuka} />
        <section className="fin-tg-panel" aria-label="Daftar supplier">
          <div className="fin-tg-alat">
            <div className="fin-tg-cari" style={{ justifyContent: "flex-start" }}>
              <KolomCari nilai={qS} onUbah={setQS} placeholder="Cari kode, nama, kontak, bank…" ariaLabel="Cari supplier" testid="cari-supplier" />
              <div className="fin-tg-pilih"><SelectPO value={fStatusS} onChange={setFStatusS} ariaLabel="Status" opsi={opsiPil("Semua status", [["aktif", "Aktif"], ["nonaktif", "Nonaktif"]])} /></div>
              <div className="fin-tg-pilih"><SelectPO value={fUtang} onChange={setFUtang} ariaLabel="Utang" opsi={opsiPil("Semua utang", [["ada", "Ada sisa utang"], ["lunas", "Lunas"]])} /></div>
            </div>
          </div>
          <p className="fin-tg-jumlah" role="status" aria-live="polite" data-testid="jumlah-supplier">
            {suppliersTampil.length === suppliers.length ? `${suppliers.length} supplier` : `${suppliersTampil.length} dari ${suppliers.length} supplier`}
            {(qS || fStatusS || fUtang) && <button type="button" className="fin-tg-reset" onClick={() => { setQS(""); setFStatusS(""); setFUtang(""); }}>Atur ulang</button>}
          </p>
          {suppliers.length === 0 ? (
            <KosongDaftar testid="supplier-kosong" ikon="gedung" judul="Belum ada supplier" ket="Daftarkan supplier yang tagihannya perlu dilacak." />
          ) : suppliersTampil.length === 0 ? (
            <KosongDaftar testid="supplier-tak-cocok" ikon="gedung" judul="Tidak ada supplier yang cocok" ket="Ubah kata kunci atau filter." />
          ) : (
            <div className="fin-dl-tabel" role="table" aria-label="Daftar supplier" style={{ "--kolom-sedang": "minmax(240px, 2.4fr) 150px 120px 60px", "--kolom-lebar": "minmax(240px, 2.2fr) minmax(130px, 1fr) 110px minmax(150px, 1.4fr) 150px 110px 60px" }}>
              <div className="fin-dl-judul" role="row">
                <span role="columnheader">Supplier</span><span role="columnheader" className="fin-dl-lebar">Kontak</span><span role="columnheader" className="fin-dl-lebar">Termin</span><span role="columnheader" className="fin-dl-lebar">Rekening</span>
                <span role="columnheader" className="kanan">Sisa utang</span><span role="columnheader">Status</span><span role="columnheader" className="fin-sr-saja">Tindakan</span>
              </div>
              {suppliersTampil.map((s) => (
                <div
                  key={s.id} className="fin-dl-baris" role="row" tabIndex={0} data-testid="baris-supplier"
                  onClick={(e) => { if (e.target.closest("button, a, input, select, [role='menuitem'], [data-tanpa-detail]")) return; setPanelRincian(specOtomatis(s)); }}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setPanelRincian(specOtomatis(s)); } }}
                  aria-label={`Supplier ${s.name}. Buka rincian`}
                >
                  <div className="fin-dl-sel fin-dl-utama" role="cell">
                    <UbinApple nama="gedung" ukuran={40} />
                    <span className="fin-dl-teks"><span className="fin-dl-judul-baris" title={s.name}>{s.name}</span><span className="fin-dl-nomor">{s.code}</span></span>
                  </div>
                  <div className="fin-dl-sel fin-dl-lebar" role="cell"><span className="fin-dl-label">Kontak</span><span className="fin-dl-sub">{s.phone || s.email || "—"}</span></div>
                  <div className="fin-dl-sel fin-dl-lebar" role="cell"><span className="fin-dl-label">Termin</span>{s.paymentTermType === "TUNAI" ? "Tunai/COD" : s.paymentTermType === "TANGGAL_KHUSUS" ? "Tanggal khusus" : s.paymentTermDays ? `${s.paymentTermDays} hari` : "—"}</div>
                  <div className="fin-dl-sel fin-dl-lebar" role="cell"><span className="fin-dl-label">Rekening</span><span className="fin-dl-sub">{s.bankAccount ? `${s.bankName || ""} ${s.bankAccount}`.trim() : "—"}</span></div>
                  <div className="fin-dl-sel fin-dl-angka" role="cell"><span className="fin-dl-label">Sisa utang</span><strong><Uang value={s.sisaUtang} nolSebagaiStrip /></strong></div>
                  <div className="fin-dl-sel" role="cell"><span className="fin-dl-label">Status</span><ChipNada nada={s.active ? "hijau" : "netral"}>{s.active ? "Aktif" : "Nonaktif"}</ChipNada></div>
                  <div className="fin-dl-sel fin-dl-aksi" role="cell" data-tanpa-detail>
                    <RowActions gayaApple primary={null} items={[
                      { label: "Edit data supplier", icon: Pencil, onClick: () => setEditSupplier(s) },
                      s.active
                        ? { label: "Nonaktifkan", icon: Ban, destructive: true, confirmText: `Nonaktifkan ${s.name}? Supplier tidak bisa menerima tagihan baru, tetapi utang yang ada tetap bisa dibayar.`, onClick: () => ubahStatusSupplier(s) }
                        : { label: "Aktifkan kembali", icon: CheckCircle2, onClick: () => ubahStatusSupplier(s) },
                    ]} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        </>
      )}

      <ModalSupplier open={modal === "supplier"} onClose={() => setModal(null)} onSubmit={(d) => aksi(() => api.createFinanceSupplier(d))} />
      <ModalSupplier
        key={editSupplier?.id ?? "edit-kosong"}
        open={!!editSupplier} supplier={editSupplier} onClose={() => setEditSupplier(null)}
        onSubmit={(perubahan) => simpanEditSupplier(editSupplier, perubahan)}
      />
      {(modal === "tagihan" || modal === "tagihan-penerimaan") && (
        <CatatTagihan
          key={modal} asalAwal={modal === "tagihan-penerimaan" ? "PENERIMAAN" : "PO"}
          suppliers={suppliersAktif} unbilled={unbilled} kategori={kategori} kategoriBeli={kategoriBeli} metodeInfo={metodeInfo}
          onClose={() => setModal(null)} onTersimpan={async () => { setModal(null); await muat(); }}
        />
      )}
      {rincianTagihan && (
        <RincianTagihan
          b={bills.find((x) => x.id === rincianTagihan.id) || rincianTagihan} spec={specOtomatis(bills.find((x) => x.id === rincianTagihan.id) || rincianTagihan)}
          aksi={aksiBaris} bolehPost={bolehCatat} onTerapkanUm={dariBaris(setUangMukaUntuk)}
          onClose={() => setRincianTagihan(null)} onRiwayat={(x) => { setRincianTagihan(null); setVersiUntuk(x); }}
        />
      )}
      {ubahUntuk && (() => {
        const bk = bills.find((x) => x.id === ubahUntuk.id) || ubahUntuk;
        return (
          <UbahTagihan
            b={bk} admin={adminSaatIni()} bolehPost={bolehCatat} onClose={() => setUbahUntuk(null)}
            onPilih={(kunci) => {
              if (kunci === "pembayaran") { setUbahUntuk(null); setQP(bk.billNumber); setTab("pembayaran"); return; }
              if (kunci === "versi-baru") { const baru = bills.find((x) => x.billNumber === bk.replacedBy?.billNumber); setUbahUntuk(null); if (baru) setRincianTagihan(baru); else setVersiUntuk(bk); return; }
              setUbahUntuk(null);
              if (kunci === "faktur-po") setFakturPOUntuk(bk);
              else if (kunci === "isi") setEditUntuk(bk);
              else if (kunci === "info") setInfoUntuk(bk);
              else if (kunci === "koreksi") setKoreksiUntuk(bk);
              else if (kunci === "batalkan") setAlasanUntuk({ jenis: "batalkan", b: bk });
              else setVersiUntuk(bk);
            }}
          />
        );
      })()}
      {fakturPOUntuk && (
        <ModalFaktur
          key={fakturPOUntuk.id} editBillId={fakturPOUntuk.id}
          po={{ id: fakturPOUntuk.purchaseOrderId, poNumber: fakturPOUntuk.purchaseOrder?.poNumber || "", supplier: { id: fakturPOUntuk.supplierId, name: fakturPOUntuk.supplier?.name || "" } }}
          onClose={() => setFakturPOUntuk(null)} onSaved={async () => { setFakturPOUntuk(null); await muat(); }}
        />
      )}
      {alasanUntuk && (
        <DialogAlasan
          destruktif
          judul={alasanUntuk.jenis === "tolak" ? `Tolak ${alasanUntuk.b.billNumber}` : `Batalkan ${alasanUntuk.b.billNumber}`}
          deskripsi={alasanUntuk.jenis === "tolak" ? "Tagihan yang ditolak tidak menjadi utang dan tidak bisa diaktifkan kembali. Catat tagihan baru bila perlu." : "Jurnal utangnya dibalik, lalu catat ulang tagihan dengan data yang benar. Diblokir server bila masih ada pembayaran aktif."}
          label={alasanUntuk.jenis === "tolak" ? "Alasan penolakan" : "Alasan pembatalan"} tombol={alasanUntuk.jenis === "tolak" ? "Tolak tagihan" : "Batalkan tagihan"}
          contoh={alasanUntuk.jenis === "tolak" ? "mis. nomor faktur tidak sesuai" : "mis. salah supplier"}
          onClose={() => setAlasanUntuk(null)}
          onSubmit={async (alasan) => {
            if (alasanUntuk.jenis === "tolak") await api.rejectFinanceBill(alasanUntuk.b.id, alasan); else await api.cancelFinanceBill(alasanUntuk.b.id, alasan);
            setAlasanUntuk(null); await muat();
          }}
        />
      )}
      {setujuiUntuk && (
        <DialogSetujui b={setujuiUntuk} onClose={() => setSetujuiUntuk(null)} onSubmit={async () => { const b = setujuiUntuk; await api.approveFinanceBill(b.id); setSetujuiUntuk(null); await muat(); tawaran.mulai(b.id, b.supplierRef || b.billNumber); }} />
      )}
      {editUntuk && (
        <ModalEditTagihan
          bill={editUntuk} suppliers={supplierBisaDipilih(suppliers, { tetapSertakanId: editUntuk.supplierId })} kategori={kategori} kategoriBeli={kategoriBeli} metodeInfo={metodeInfo} unbilled={unbilled} onClose={() => setEditUntuk(null)}
          onSubmit={async (d) => { await api.editFinanceBill(editUntuk.id, d); setEditUntuk(null); await muat(); }}
        />
      )}
      {infoUntuk && (
        <InfoDialog
          jenis="bills" doc={infoUntuk} nomor={infoUntuk.billNumber} judulRingkas={`${infoUntuk.supplier?.name || ""} · ${formatUang(infoUntuk.amount)}`}
          kolom={[{ kunci: "supplierRef", label: "Nomor faktur supplier" }, { kunci: "dueDate", label: "Jatuh tempo", tipe: "tanggal" }]}
          awal={{ supplierRef: infoUntuk.supplierRef || "", dueDate: infoUntuk.dueDate ? String(infoUntuk.dueDate).slice(0, 10) : "" }}
          onClose={() => setInfoUntuk(null)} onSaved={() => { setInfoUntuk(null); muat(); }}
        />
      )}
      {koreksiUntuk && (
        <KoreksiDialog
          tanpaPin
          jenis="bills" doc={koreksiUntuk} nomor={koreksiUntuk.billNumber} judulRingkas={`Tagihan disetujui · ${koreksiUntuk.jenisTagihan?.label || "tanpa jenis"} · ${formatUang(koreksiUntuk.amount)}`}
          kolom={[
            { kunci: "supplierId", label: "Supplier", tipe: "pilih", opsi: suppliers.filter((x) => x.active !== false || x.id === koreksiUntuk.supplierId).map((x) => ({ id: x.id, name: x.name })), wajib: true },
            { kunci: "billDate", label: "Tanggal tagihan", tipe: "tanggal", wajib: true },
            { kunci: "amount", label: "Nominal tagihan", tipe: "uang", wajib: true },
            { kunci: "description", label: "Keterangan", wajib: true },
            ...(["JASA_OPERASIONAL", "BIAYA_PRODUKSI_NON_STOK"].includes(koreksiUntuk.billType)
              ? [{ kunci: "expenseCategoryId", label: "Kategori biaya", tipe: "pilih", opsi: kategori.map((x) => ({ id: x.id, name: x.name })), wajib: true }] : []),
            ...(["MESIN_PERALATAN", "UANG_MUKA_PEMBELIAN"].includes(koreksiUntuk.billType)
              ? [{ kunci: "purchaseCategoryId", label: "Kategori aset", tipe: "pilih", opsi: kategoriBeli.map((x) => ({ id: x.id, name: x.name })), wajib: true }] : []),
          ]}
          awal={{
            supplierId: koreksiUntuk.supplierId, billDate: String(koreksiUntuk.billDate || "").slice(0, 10), amount: Number(koreksiUntuk.amount) || 0,
            description: koreksiUntuk.description || "", expenseCategoryId: koreksiUntuk.expenseCategoryId || "", purchaseCategoryId: koreksiUntuk.purchaseCategoryId || "",
          }}
          onClose={() => setKoreksiUntuk(null)} onSaved={() => { setKoreksiUntuk(null); muat(); }}
        />
      )}
      {versiPay && <RiwayatVersiDialog jenis="supplier-payments" id={versiPay.id} nomor={versiPay.paymentNumber} onClose={() => setVersiPay(null)} />}
      {versiUntuk && <RiwayatVersiDialog jenis="bills" id={versiUntuk.id} nomor={versiUntuk.billNumber} onClose={() => setVersiUntuk(null)} />}
      {uangMukaUntuk && <ModalTerapkanUangMuka billId={uangMukaUntuk.id} nomorFaktur={uangMukaUntuk.supplierRef || uangMukaUntuk.billNumber} bolehPost={bolehCatat} onClose={() => setUangMukaUntuk(null)} onSaved={async () => { setUangMukaUntuk(null); await muat(); }} />}
      {tawaran.elemen}
      <ModalBayarSupplier
        open={modal === "bayar"} onClose={() => setModal(null)}
        suppliers={suppliersAktif} bills={bills} rekening={rekening} bolehPost={bolehCatat} supplierAdaUangMuka={supplierAdaUangMuka} onRefresh={() => muat({ senyap: true })}
        onSubmit={async (d, kunci) => { await api.createFinanceSupplierPayment(d, kunci); setModal(null); await muat(); }}
      />
      <PanelDetail spec={panelRincian} onClose={() => setPanelRincian(null)} />
    </HalamanFinance>
  );
}

// Dua mode: BARU (supplier kosong → onSubmit(seluruh isian)) dan EDIT (supplier terisi → onSubmit(hanya bidang yang berubah); kode tidak bisa diubah).
// Mode edit: galat server tampil di dalam dialog dan tombol dilepas lagi (dialog tidak boleh terkunci).
function ModalSupplierIsi({ open, onClose, onSubmit, supplier = null }) {
  const edit = !!supplier;
  const [f, setF] = useState(() => (edit ? formDariSupplier(supplier) : { code: "", name: "", phone: "", email: "", address: "", paymentTermDays: "", paymentTermPilihan: "", bankName: "", bankAccount: "", bankHolder: "", notes: "" }));
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState(null);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const galatLokal = edit ? galatForm(f) : (f.name.trim() ? null : "Nama supplier wajib diisi");
  const perubahan = edit ? payloadPerubahan(supplier, f) : null;
  const adaPerubahan = !edit || Object.keys(perubahan).length > 0;
  const rekeningGanti = edit && rekeningBerubah(supplier, f);

  async function kirim() {
    setSibuk(true); setGalat(null);
    try { await onSubmit(edit ? perubahan : { ...f, ...payloadTerminSupplier(f.paymentTermPilihan) }); }
    catch (e) { setGalat(e?.message || "Gagal menyimpan supplier"); setSibuk(false); }
  }
  return (
    <Modal
      open={open} onOpenChange={(v) => { if (!v && !sibuk) onClose(); }}
      title={edit ? `Edit Supplier ${supplier.code}` : "Supplier Baru"}
      description={edit ? "Mengubah data master saja — tidak ada jurnal, dan sisa utang tidak berubah. Setiap perubahan tercatat di riwayat aktivitas." : undefined}
      footer={(
        <div className="flex w-full flex-col gap-2">
          {rekeningGanti && (
            <p role="alert" data-testid="peringatan-rekening" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">
              Data rekening bank berubah. Pastikan sudah dikonfirmasi langsung ke supplier (telepon/kontak resmi) sebelum menyimpan — rekening palsu adalah modus penipuan pembayaran yang umum. Perubahan ini ditandai khusus di riwayat.
            </p>
          )}
          {galatLokal && edit && <p className="text-[12px] text-red" data-testid="galat-lokal-supplier">{galatLokal}</p>}
          {galat && <p role="alert" data-testid="galat-server-supplier" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] leading-snug text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <TombolAksi onClick={kirim} disabled={!!galatLokal || !adaPerubahan || sibuk}>{edit ? "Simpan Perubahan" : "Simpan"}</TombolAksi>
          </div>
        </div>
      )}
    >
      <div className="space-y-3">
        <Field label="Nama supplier" required><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Kode" hint={edit ? "Kode tidak bisa diubah" : "Kosongkan untuk dibuatkan otomatis"}><Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="SUP-004" disabled={edit} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Telepon"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><Input value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        </div>
        <Field label="Alamat"><Input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        <Field label="Termin pembayaran" hint="Bawaan saja: PO/faktur menyimpan salinannya sendiri, jadi mengubah ini tidak mengubah dokumen lama. Jatuh tempo = tanggal faktur supplier + hari termin.">
          <Pilihan value={f.paymentTermPilihan} onChange={(v) => set("paymentTermPilihan", v)} aria-label="Termin pembayaran">
            {daftarPilihanTermin(f.paymentTermPilihan).map((p) => <option key={p.nilai} value={p.nilai}>{p.label}</option>)}
          </Pilihan>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Bank"><Input value={f.bankName} onChange={(e) => set("bankName", e.target.value)} /></Field>
          <Field label="No. rekening"><Input value={f.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} /></Field>
        </div>
        <Field label="Atas nama"><Input value={f.bankHolder} onChange={(e) => set("bankHolder", e.target.value)} /></Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

const SET_KOSONG = new Set();

// Catat Pembayaran ke Supplier. Pengaman uang muka: sebelum uang keluar, form memeriksa ulang uang muka yang tertaut ke PO tiap faktur (kontrak server), menawarkan "Terapkan uang muka",
// memvalidasi ulang nominal setelah sisa berubah, dan meminta konfirmasi eksplisit bila pengguna tetap membayar padahal uang muka PO itu belum diterapkan. Pembayaran baru TIDAK diblokir.
function ModalBayarSupplierIsi({ open, onClose, suppliers, bills, rekening, onSubmit, bolehPost = true, supplierAdaUangMuka = SET_KOSONG, onRefresh }) {
  const [f, setF] = useState({ supplierId: "", date: "", cashAccountId: "", reference: "", notes: "", ...BIAYA_KOSONG });
  const [alokasi, setAlokasi] = useState({});
  const [galat, setGalat] = useState("");
  const [catatanSisa, setCatatanSisa] = useState("");
  const [terapkanUntuk, setTerapkanUntuk] = useState(null); // faktur yang uang mukanya diterapkan dari dalam form ini
  const [risiko, setRisiko] = useState(null); // faktur yang masih punya uang muka PO belum diterapkan → dialog konfirmasi
  const [paham, setPaham] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  // Kunci idempotensi: sama untuk klik ganda/retry isian yang SAMA (server memutar ulang hasil pertama), baru bila isian berubah.
  const kunciRef = useRef({ isi: "", kunci: "" });
  const kunciBayar = (isi) => {
    if (kunciRef.current.isi !== isi) kunciRef.current = { isi, kunci: `sp-${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10)}` };
    return kunciRef.current.kunci;
  };

  const tagihanTerbuka = useMemo(
    () => bills.filter((b) => b.supplierId === f.supplierId && ["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(b.status) && b.sisa > 0),
    [bills, f.supplierId]
  );

  // Sisa yang dilihat saat nominal diisi. Bila data tagihan dimuat ulang (mis. uang muka baru diterapkan) dan sisanya berubah, nominal lama DIKOSONGKAN —
  // jangan mempertahankan angka yang kini bisa membuat pembayaran berlebih.
  const sisaDilihat = useRef({});
  const alokasiRef = useRef(alokasi);
  alokasiRef.current = alokasi;
  useEffect(() => {
    const bersih = {};
    const dikosongkan = [];
    for (const [id, v] of Object.entries(alokasiRef.current)) {
      const b = tagihanTerbuka.find((x) => x.id === id);
      const lama = sisaDilihat.current[id];
      if (b && (lama === undefined || Number(b.sisa) === Number(lama))) bersih[id] = v;
      else if (Number(v) > 0) { dikosongkan.push((bills.find((x) => x.id === id) || {}).billNumber || id); delete sisaDilihat.current[id]; }
    }
    if (dikosongkan.length > 0) {
      setAlokasi(bersih);
      setCatatanSisa(`Sisa tagihan ${dikosongkan.join(", ")} berubah. Nominal dikosongkan — isi ulang sesuai sisa terbaru sebelum menyimpan.`);
    }
  }, [tagihanTerbuka, bills]);

  const isiNominal = (b, v) => { sisaDilihat.current[b.id] = b.sisa; setCatatanSisa(""); setAlokasi((s) => ({ ...s, [b.id]: v })); };
  const alokasiAktif = useMemo(
    () => Object.fromEntries(Object.entries(alokasi).filter(([id, v]) => Number(v) > 0 && tagihanTerbuka.some((b) => b.id === id))),
    [alokasi, tagihanTerbuka]
  );
  // Kelayakan uang muka (server) untuk peringatan di tiap baris: faktur atas PO milik supplier yang punya saldo uang muka. Batas BATAS_PERIKSA_UANG_MUKA faktur — tetapi faktur yang
  // nominalnya SUDAH diisi selalu ikut diperiksa (didahulukan), dan Simpan memeriksa ulang semua faktur terpilih langsung ke server (lihat simpan()).
  const kandidatBayar = useMemo(() => (open && supplierAdaUangMuka.has(f.supplierId) ? tagihanTerbuka.filter(fakturPerluPeriksaUangMuka) : []), [open, f.supplierId, tagihanTerbuka, supplierAdaUangMuka]);
  const idKelayakan = useMemo(() => {
    const terpilih = kandidatBayar.filter((b) => alokasiAktif[b.id] !== undefined);
    const lain = kandidatBayar.filter((b) => alokasiAktif[b.id] === undefined).slice(0, Math.max(0, BATAS_PERIKSA_UANG_MUKA - terpilih.length));
    return [...terpilih, ...lain].map((b) => `${b.id}:${b.sisa}`);
  }, [kandidatBayar, alokasiAktif]);
  const kel = useKelayakanFaktur(idKelayakan);
  const cakupanBayar = teksCakupanPeriksa({ total: kandidatBayar.length, diperiksa: Math.min(kandidatBayar.length, BATAS_PERIKSA_UANG_MUKA), terpotong: kandidatBayar.length > BATAS_PERIKSA_UANG_MUKA, gagal: Object.keys(kel.galat).length });
  const total = Object.values(alokasiAktif).reduce((s, v) => s + (Number(v) || 0), 0);
  const adaLebih = tagihanTerbuka.some((b) => Number(alokasiAktif[b.id]) > 0 && cekNominalBayar(alokasiAktif[b.id], b.sisa).lebih);
  const rek = rekening.find((r) => r.id === f.cashAccountId);
  const valid = f.supplierId && f.cashAccountId && total > 0 && biayaTransferLengkap(rek, f) && !adaLebih;

  async function kirim() {
    setGalat("");
    const body = { ...denganBiaya(f), allocations: Object.entries(alokasiAktif).map(([billId, amount]) => ({ billId, amount: Number(amount) })) };
    try { await onSubmit(body, kunciBayar(JSON.stringify(body))); }
    catch (e) { setGalat(e?.message || "Gagal menyimpan pembayaran. Isian Anda tetap ada; coba lagi."); }
  }
  async function simpan() {
    setGalat("");
    // Pengaman saat uang akan keluar: SETIAP faktur yang nominalnya diisi diperiksa ulang langsung ke server (bukan dari hasil yang di-cache/dibatasi), di luar batas peringatan baris.
    // Bila pemeriksaan gagal, pembayaran TIDAK disimpan diam-diam — pengguna diminta mengulang (Simpan lagi memeriksa ulang).
    const dipilih = tagihanTerbuka.filter((b) => Number(alokasiAktif[b.id]) > 0 && fakturPerluPeriksaUangMuka(b));
    const peta = new Map();
    try { for (const b of dipilih) peta.set(b.id, ringkasKelayakan(await api.getKandidatUangMukaFaktur(b.id))); }
    catch (e) { setGalat(`Uang muka untuk faktur yang Anda pilih belum bisa diperiksa (${e?.message || "gangguan"}). Pembayaran BELUM disimpan; tekan Simpan lagi untuk memeriksa ulang.`); return undefined; }
    const berisiko = fakturBerisikoBayarKedua(tagihanTerbuka, alokasiAktif, peta);
    if (berisiko.length > 0) { setPaham(false); setRisiko(berisiko); return undefined; }
    return kirim();
  }

  return (
    <>
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Catat Pembayaran ke Supplier"
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi disabled={!valid} onClick={simpan} data-testid="simpan-pembayaran-supplier">Simpan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Supplier" required>
          <Pilihan value={f.supplierId} onChange={(v) => { set("supplierId", v); setAlokasi({}); setCatatanSisa(""); }}>
            <option value="">— pilih —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} · sisa {formatUangTepat(s.sisaUtang)}</option>)}
          </Pilihan>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Dibayar dari" required>
            <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
              <option value="">— pilih —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </Field>
        </div>
        <CaraBayarTransfer rekening={rek} nominal={total} value={f} onChange={(b) => setF((s) => ({ ...s, ...b }))} />

        {f.supplierId && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink">Tagihan yang dibayar</p>
            {tagihanTerbuka.length === 0 ? (
              <p className="text-[13px] text-ink3">Tidak ada tagihan terbuka untuk supplier ini.</p>
            ) : (
              <div className="space-y-2">
                {tagihanTerbuka.map((b) => {
                  const lebih = Number(alokasiAktif[b.id]) > 0 && cekNominalBayar(alokasiAktif[b.id], b.sisa).lebih;
                  return (
                    <div key={b.id} className="space-y-1.5" data-testid={`bayar-baris-${b.billNumber}`}>
                      <div className="grid grid-cols-[1fr_190px] items-center gap-2">
                        <div className="min-w-0 text-[13px]">
                          <span className="block truncate font-medium">{b.billNumber} · {b.description}</span>
                          <span className="text-[11px] text-ink3">
                            sisa {formatUangTepat(b.sisa)}{b.dueDate ? ` · jatuh tempo ${tanggalPendek(b.dueDate)}` : " · jatuh tempo belum diisi"}
                          </span>
                        </div>
                        <div className="fin-tg-bayar-isi">
                          <InputUang
                            value={alokasi[b.id] ?? ""}
                            onChange={(v) => isiNominal(b, v)}
                            max={b.sisa} step="0.01"
                            aria-label={`Nominal untuk ${b.billNumber}`}
                          />
                          <button type="button" className="fin-tg-lunasi" data-testid={`lunasi-${b.billNumber}`} onClick={() => isiNominal(b, String(Number(b.sisa)))}>Lunasi</button>
                        </div>
                      </div>
                      {lebih && <p role="alert" className="m-0 text-[12px] text-red" data-testid={`lebih-sisa-${b.billNumber}`}>Nominal melebihi sisa tagihan {formatUangTepat(b.sisa)}. Kurangi nominal.</p>}
                      <BannerUangMuka
                        r={kel.peta.get(b.id)} galat={kel.galat[b.id]} onCoba={kel.muatUlang} kompak bolehPost={bolehPost}
                        onTerapkan={() => setTerapkanUntuk({ billId: b.id, nomor: b.supplierRef || b.billNumber })}
                      />
                    </div>
                  );
                })}
                {cakupanBayar && <p role="status" data-testid="batas-periksa-bayar" className="m-0 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink2">{cakupanBayar} Faktur yang Anda isi nominalnya selalu diperiksa ulang saat Simpan.</p>}
                {catatanSisa && <p role="status" data-testid="catatan-sisa-berubah" className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">{catatanSisa}</p>}
                <div className="rounded-lg bg-inset px-3 py-2 text-[13px]" data-testid="total-kas-keluar">
                  Total dibayar dari kas: <strong>{formatUangTepat(total)}</strong>
                  <span className="block text-[11.5px] text-ink3">Ini uang keluar nyata dari rekening{rek ? ` ${rek.name}` : ""}. Menerapkan uang muka ke faktur tidak termasuk di sini.</span>
                </div>
              </div>
            )}
          </div>
        )}

        <Field label="Referensi transfer"><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <Galat pesan={galat} testid="galat-bayar-supplier" />
      </div>
    </Modal>
    {terapkanUntuk && (
      <ModalTerapkanUangMuka
        billId={terapkanUntuk.billId} nomorFaktur={terapkanUntuk.nomor} bolehPost={bolehPost}
        onClose={() => setTerapkanUntuk(null)} onSaved={async () => { setTerapkanUntuk(null); await onRefresh?.(); }}
      />
    )}
    {risiko && (
      <Modal
        open onOpenChange={(v) => !v && setRisiko(null)} title="Uang muka PO ini belum diterapkan"
        description="Periksa dulu agar uang yang sudah dibayar tidak dibayar dua kali."
        className="fin-tg-modal fin-tg-dlg w-[540px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
        footer={
          <>
            <Button variant="neutral" onClick={() => setRisiko(null)} className="max-sm:min-h-11 max-sm:px-4" data-testid="kembali-periksa">Kembali</Button>
            <button type="button" onClick={() => { const b = risiko[0]; const t = tagihanTerbuka.find((x) => x.id === b.id); setRisiko(null); setTerapkanUntuk({ billId: b.id, nomor: t?.supplierRef || b.nomor }); }} disabled={!bolehPost} title={bolehPost ? undefined : "Akun Anda tidak punya izin menerapkan uang muka (Finance/Akuntan)."} className="tb-menyala" data-testid="terapkan-dulu"><GlifKaca nama="koin" size={18} /><span>Terapkan uang muka dulu</span></button>
            <TombolAksi variant="destructive" disabled={!paham} data-testid="tetap-bayar" onClick={async () => { setRisiko(null); await kirim(); }}>Tetap catat pembayaran</TombolAksi>
          </>
        }
      >
        <div className="space-y-3" data-testid="konfirmasi-risiko-bayar">
          <p className="m-0 text-[13px] text-ink">Pembayaran kas <strong>{formatUangTepat(total)}</strong> akan keluar dari {rek ? rek.name : "rekening terpilih"}. Untuk faktur berikut masih ada uang muka PO yang belum diterapkan:</p>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {risiko.map((x) => (
              <li key={x.id} className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">
                <strong>{x.nomor}</strong>: dibayar kas {formatUangTepat(x.nominalKas)}; uang muka belum diterapkan {formatUangTepat(x.uangMuka)} (bisa mengurangi tagihan ini hingga {formatUangTepat(x.bisaDiterapkan)}).
              </li>
            ))}
          </ul>
          <p className="m-0 text-[12.5px] text-ink2">Bila uang muka itu sebenarnya sudah menutup tagihan, pembayaran ini menjadi pembayaran kedua. Pembayaran baru tetap boleh bila uang muka hanya menutup sebagian atau memang tidak dipakai untuk faktur ini.</p>
          <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-ink max-sm:min-h-11">
            <input type="checkbox" checked={paham} onChange={(e) => setPaham(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="paham-risiko" />
            <span>Saya paham risikonya dan nominal {formatUangTepat(total)} ini benar-benar harus dibayar dari kas.</span>
          </label>
        </div>
      </Modal>
    )}
    </>
  );
}

// Edit tagihan yang BELUM disetujui (belum ada jurnal): semua isian boleh berubah; server memvalidasi ulang.
function ModalEditTagihan({ bill, suppliers, kategori, kategoriBeli, metodeInfo = null, unbilled = [], onClose, onSubmit }) {
  const asli = {
    supplierId: bill.supplierId || "", supplierRef: bill.supplierRef || "", billDate: String(bill.billDate || "").slice(0, 10),
    dueDate: bill.dueDate ? String(bill.dueDate).slice(0, 10) : "", amount: Number(bill.amount) || 0,
    description: bill.description || "", billType: bill.billType || "", goodsReceiptId: bill.goodsReceiptId || "",
    expenseCategoryId: bill.expenseCategoryId || "", purchaseCategoryId: bill.purchaseCategoryId || "",
  };
  const [f, setF] = useState(asli);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [catatanLepas, setCatatanLepas] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  // Ganti supplier: pilihan yang hanya berlaku untuk supplier lama (penerimaan tertaut) dilepas dengan pemberitahuan — tidak dipindahkan diam-diam.
  function gantiSupplier(v) {
    if (v === f.supplierId) return;
    if (f.goodsReceiptId) { setF((x) => ({ ...x, supplierId: v, goodsReceiptId: "" })); setCatatanLepas("Penerimaan yang tertaut dilepas karena supplier diganti. Pilih penerimaan milik supplier baru bila tagihan ini memang dari penerimaan barang."); }
    else set("supplierId", v);
  }
  async function simpan() {
    setGalat("");
    try { await onSubmit({ ...beda, reason: alasan.trim() }); }
    catch (e) { setGalat(e?.message || "Gagal menyimpan perubahan. Isian Anda tetap ada; coba lagi."); }
  }
  const grTertaut = bill.goodsReceipt ? { ...bill.goodsReceipt, nilaiTerima: bill.goodsReceipt.nilaiTerima ?? null } : null;
  const KUNCI_JENIS = ["billType", "goodsReceiptId", "expenseCategoryId", "purchaseCategoryId"];

  const beda = {};
  for (const k of Object.keys(asli)) {
    if (KUNCI_JENIS.includes(k)) continue;
    const sama = k === "amount" ? Number(f[k]) === Number(asli[k]) : (f[k] || "") === (asli[k] || "");
    if (!sama) beda[k] = k === "amount" ? Number(f[k]) : f[k];
  }
  // Jenis & akun tujuan dikirim sebagai satu kesatuan bila salah satunya berubah (server memvalidasi ulang kombinasinya).
  const jenisBerubah = KUNCI_JENIS.some((k) => (f[k] || "") !== (asli[k] || ""));
  if (jenisBerubah) Object.assign(beda, bodyJenis(f));
  const namaSup = (id) => (id === bill.supplierId ? bill.supplier?.name : suppliers.find((x) => x.id === id)?.name) || "—";
  const ringkasanBeda = Object.entries(beda).flatMap(([k, v]) => {
    if (k === "supplierId") return [{ label: "Supplier", lama: namaSup(asli.supplierId), baru: namaSup(v) }];
    if (k === "amount") return [{ label: "Nominal", lama: formatUangTepat(asli.amount), baru: formatUangTepat(v) }];
    if (k === "billDate") return [{ label: "Tanggal tagihan", lama: asli.billDate ? tanggalPendek(asli.billDate) : "—", baru: v ? tanggalPendek(v) : "—" }];
    if (k === "dueDate") return [{ label: "Jatuh tempo", lama: asli.dueDate ? tanggalPendek(asli.dueDate) : "—", baru: v ? tanggalPendek(v) : "—" }];
    if (k === "supplierRef") return [{ label: "Nomor faktur", lama: asli.supplierRef || "—", baru: v || "—" }];
    if (k === "description") return [{ label: "Keterangan", lama: asli.description || "—", baru: v || "—" }];
    return [];
  }).concat(jenisBerubah ? [{ label: "Jenis / dokumen asal", lama: bill.jenisTagihan?.label || "—", baru: "diubah" }] : []);
  const valid = Object.keys(beda).length > 0 && alasan.trim() && f.supplierId && f.description.trim() && Number(f.amount) > 0 && jenisLengkap(f, metodeInfo);

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Ubah isi ${bill.billNumber}`}
      description={`${formatUangTepat(bill.amount)} · ${bill.supplier?.name || ""}`}
      className="fin-tg-modal w-[640px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={simpan} disabled={!valid} data-testid="simpan-ubah-isi">Simpan perubahan</TombolAksi></>}
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          Tagihan ini belum disetujui, jadi belum ada jurnal — semua isian boleh diubah. Setelah disetujui, perubahan lewat Informasi dokumen atau Koreksi transaksi (Ubah tagihan).
        </p>
        <Field label="Supplier" required>
          <PemilihSupplier suppliers={suppliers} value={f.supplierId} namaCadangan={bill.supplier?.name} memuat={false} onPilih={gantiSupplier} />
        </Field>
        {catatanLepas && <p className="fin-tg-info" data-nada="jingga" role="status" data-testid="catatan-lepas-penerimaan">{catatanLepas}</p>}
        <Field label="Keterangan" required><Input value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nomor faktur supplier"><Input value={f.supplierRef} onChange={(e) => set("supplierRef", e.target.value)} /></Field>
          <Field label="Nominal tagihan" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} step="0.01" aria-label="Nominal tagihan" /></Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal tagihan"><TanggalPO value={f.billDate} onChange={(v) => set("billDate", v)} bolehKosong ariaLabel="Tanggal tagihan" /></Field>
          <Field label="Jatuh tempo" hint="Mengganti dari termin supplier hanya boleh admin keuangan (alasan perubahan di bawah dipakai)"><TanggalPO value={f.dueDate} onChange={(v) => set("dueDate", v)} bolehKosong ariaLabel="Jatuh tempo" /></Field>
        </div>
        {!bill.billType && (
          <p className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">
            Tagihan lama ini belum punya Jenis Tagihan dan belum bisa disetujui. Pilih jenisnya — kain, busa, per, dan bahan stok lain adalah <strong>Bahan Baku / Stok</strong>, bukan Overhead Produksi.
          </p>
        )}
        <PilihJenisTagihan
          f={f} set={set} kategori={kategori} kategoriBeli={kategoriBeli} unbilled={unbilled} grTertaut={grTertaut} metodeInfo={metodeInfo}
          namaSupplier={suppliers.find((x) => x.id === f.supplierId)?.name || ""}
        />
        <Field label="Alasan perubahan" required hint="Wajib — tercatat di riwayat audit">
          <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah ketik nominal" />
        </Field>
        {ringkasanBeda.length > 0 && (
          <section className="fin-tg-ubah-beda" data-testid="ringkasan-perubahan" aria-label="Ringkasan perubahan">
            <h4>Yang akan berubah</h4>
            <ul>{ringkasanBeda.map((r) => <li key={r.label}><span>{r.label}</span><s>{r.lama}</s><ArrowRight size={12} aria-hidden="true" /><strong>{r.baru}</strong></li>)}</ul>
          </section>
        )}
        <Galat pesan={galat} testid="galat-ubah-isi" />
      </div>
    </Modal>
  );
}

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalSupplier = resetSaatBuka(ModalSupplierIsi);

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalBayarSupplier = resetSaatBuka(ModalBayarSupplierIsi);
