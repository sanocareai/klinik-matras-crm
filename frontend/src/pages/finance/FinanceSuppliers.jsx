import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useUrlTab } from "@/lib/useUrlTab.js";
import "@/styles/sanss-finance-tagihan.css";
import "@/styles/sanss-finance-po.css";
import { PanelDetail, klikBuka } from "@/features/finance/PanelDetail.jsx";
import { specOtomatis } from "@/features/finance/detailSpecs.js";
import { Plus, Building2, FileText, Banknote, Pencil, History, Ban, CheckCircle2, CalendarClock, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import DaftarTagihan, { RingkasanTagihan } from "@/features/finance/tagihan/DaftarTagihan.jsx";
import RincianTagihan from "@/features/finance/tagihan/RincianTagihan.jsx";
import CatatTagihan from "@/features/finance/tagihan/CatatTagihan.jsx";
import { masukTab, statusTempo, teksCari, hitungTab, LABEL_TEMPO } from "@/features/finance/tagihan/tagihanLogika.js";
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
import TerminFaktur from "@/features/finance/TerminFaktur.jsx";
import { daftarPilihanTermin, payloadTerminSupplier, bodyTermin, galatTermin, TERMIN_AWAL, bolehMencatatFinance } from "@/features/finance/terminLogic.js";

// Tagihan: belum disetujui = Edit bebas (belum ada jurnal). Sudah disetujui = jurnal sudah ada, JANGAN diubah —
// Batalkan (jurnal dibalik; diblokir server kalau sudah ada pembayaran aktif) lalu catat ulang.
function aksiTagihan(b, { aksi, setEditUntuk, setVersiUntuk, setInfoUntuk, setKoreksiUntuk, setUangMukaUntuk, supplierAdaUangMuka }) {
  // Isi menu dari matriks aksi (features/finance/matriksAksi.js): tindakan yang tidak tersedia tetap tampil dengan alasannya.
  const items = bentukItemMenu(matriksTagihan(b, { admin: adminSaatIni() }), {
    edit: () => setEditUntuk(b),
    info: () => setInfoUntuk(b),
    koreksi: () => setKoreksiUntuk(b),
    versi: () => setVersiUntuk(b),
    tolak: () => {
      const alasan = window.prompt("Alasan penolakan tagihan:");
      if (alasan?.trim()) return aksi(() => api.rejectFinanceBill(b.id, alasan.trim()));
    },
    batalkan: () => {
      const alasan = window.prompt(`Alasan membatalkan tagihan ${b.billNumber}? Jurnal utangnya akan dibalik, lalu catat ulang tagihan dengan data yang benar:`);
      if (alasan?.trim()) return aksi(() => api.cancelFinanceBill(b.id, alasan.trim()));
    },
  });
  // Uang muka supplier: tawarkan penerapan bila supplier punya saldo uang muka & faktur masih bersisa. Tetap dikonfirmasi Finance di dialog.
  if (["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(b.status) && supplierAdaUangMuka?.has(b.supplierId) && b.sisa > 0) {
    items.unshift({ key: "uang-muka", label: "Terapkan Uang Muka", icon: Wallet, hint: "Kurangi sisa utang faktur dengan uang muka supplier yang belum diterapkan.", onClick: () => setUangMukaUntuk(b) });
  }
  if (["DRAFT", "MENUNGGU_APPROVAL"].includes(b.status)) {
    return {
      primary: {
        label: "Setujui", variant: "secondary",
        disabled: !b.billType,
        title: !b.billType ? "Pilih Jenis Tagihan dulu lewat Edit (mis. Bahan Baku untuk kain/busa) supaya tidak salah tercatat sebagai beban" : undefined,
        confirmText: `Setujui tagihan ${b.billNumber} sebesar ${formatUang(b.amount)} (${b.jenisTagihan?.label || "tanpa jenis"})? Utang akan masuk buku besar.`,
        onClick: () => aksi(() => api.approveFinanceBill(b.id)),
      },
      items,
    };
  }
  return { primary: null, items };
}

// Pembayaran supplier: koreksi langsung tidak tersedia — Batalkan (jurnal dibalik, alokasi ke tagihan dilepas) lalu catat ulang.
function aksiPembayaran(p, { aksi, setVersiPay }) {
  return bentukItemMenu(aksiPembayaranSupplier(p, { admin: adminSaatIni() }), {
    versi: () => setVersiPay(p),
    batalkan: () => {
      const alasan = window.prompt(`Alasan membatalkan pembayaran ${p.paymentNumber}? Jurnalnya dibalik dan tagihan kembali terbuka, lalu catat ulang pembayaran yang benar:`);
      if (alasan?.trim()) return aksi(() => api.cancelFinanceSupplierPayment(p.id, alasan.trim()));
    },
  });
}

// Nominal dicari sebagai angka polos maupun berformat titik ("1500000" / "1.500.000").
const angka = (x) => `${Math.round(Number(x) || 0)} ${(Number(x) || 0).toLocaleString("id-ID")}`;
const unik = (arr) => [...new Set(arr.filter(Boolean))].sort().map((v) => [v, v]);


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
  { key: "aging", label: "Jadwal & Aging", Icon: CalendarClock, penjelasan: "Utang supplier menurut tanggal jatuh tempo — status barang, faktur, dan pembayaran dipisahkan. Barang boleh sudah dipakai Produksi walau faktur belum dibayar." },
  { key: "pembayaran", label: "Pembayaran", Icon: Banknote, penjelasan: "Riwayat uang yang sudah dikeluarkan untuk melunasi tagihan supplier." },
  { key: "supplier", label: "Master Supplier", Icon: Building2, penjelasan: "Data lengkap para supplier — kontak, termin pembayaran, dan rekening tujuan transfer." },
];

export default function FinanceSuppliers() {
  const [panelRincian, setPanelRincian] = useState(null); // panel detail samping (klik baris)
  const [tab, setTab] = useUrlTab(["tagihan", "aging", "pembayaran", "supplier"], "tagihan"); // ?tab= (deep-link hub Pembelian & Supplier)
  const [suppliers, setSuppliers] = useState([]);
  const [bills, setBills] = useState([]);
  const [editUntuk, setEditUntuk] = useState(null);
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

  const muat = useCallback(async () => {
    setLoading(true);
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
    } catch (e) {
      setError(e.message || "Gagal memuat data supplier");
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
  const suppliersAktif = useMemo(() => supplierBisaDipilih(suppliers), [suppliers]);
  const bolehCatat = useMemo(() => { try { return bolehMencatatFinance(JSON.parse(localStorage.getItem("user") || "null")); } catch { return false; } }, []);
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
  const paymentsTampil = useMemo(() => payments.filter((p) =>
    (!fSupP || p.supplier?.name === fSupP) &&
    (!fRek || p.cashAccount?.name === fRek) &&
    (!fStatusP || (fStatusP === "batal") === !!p.cancelledAt) &&
    cocok(qP, p.paymentNumber, p.date, tanggalPendek(p.date), p.supplier?.name, p.cashAccount?.name, (p.allocations || []).map((a) => a.bill?.billNumber).join(" "), angka(p.amount), p.cancelledAt ? "dibatalkan" : "terposting")
  ), [payments, qP, fSupP, fRek, fStatusP]);
  const suppliersTampil = useMemo(() => suppliers.filter((s) =>
    (!fStatusS || (fStatusS === "aktif") === !!s.active) &&
    (!fUtang || (fUtang === "ada") === (Number(s.sisaUtang) > 0)) &&
    cocok(qS, s.code, s.name, s.phone, s.email, s.paymentTermDays, s.bankName, s.bankAccount, angka(s.sisaUtang), s.active ? "aktif" : "nonaktif")
  ), [suppliers, qS, fStatusS, fUtang]);

  return (
    <HalamanFinance
      title={tab === "tagihan" ? "Tagihan supplier" : "Supplier & Utang"}
      subtitle={tab === "tagihan" ? "Periksa tagihan, jatuh tempo, dan pembayaran supplier." : "Tagihan masuk dari supplier, pembayarannya, dan sisa utang per supplier."}
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

      <div className="fin-tg-tab-halaman" role="tablist" aria-label="Bagian Supplier & Utang">
        {TAB.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="fin-tg-seg-item" data-aktif={tab === t.key ? "1" : "0"} onClick={() => setTab(t.key)} data-testid={`tab-halaman-${t.key}`}>
            <t.Icon size={15} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>
      {tab !== "tagihan" && <p className="text-[13px] leading-relaxed text-ink3">{TAB.find((t) => t.key === tab)?.penjelasan}</p>}

      {tab === "aging" && (
        <JadwalAgingUtang suppliers={suppliersAktif} rekening={rekening} bolehJadwal={(() => { try { return bolehMencatatFinance(JSON.parse(localStorage.getItem("user") || "null")); } catch { return false; } })()} onBukaPembayaran={() => setModal("bayar")} />
      )}

      {tab === "tagihan" && (
        <DaftarTagihan
          bills={bills} billsTampil={billsTampil} tab={tabAktifB} onTab={setTabB} hariIni={hariIni}
          q={qB} onQ={setQB} fSup={fSupB} onFSup={setFSupB} fTempo={fTempo} onFTempo={setFTempo}
          onReset={() => { setQB(""); setFSupB(""); setFTempo(""); }}
          aksi={(b) => aksiTagihan(b, { aksi, setEditUntuk, setVersiUntuk, setInfoUntuk, setKoreksiUntuk, setUangMukaUntuk, supplierAdaUangMuka })}
          onBuka={setRincianTagihan} onCatat={() => setModal("tagihan")}
        />
      )}

      {tab === "pembayaran" && (
        <>
        <FilterBar
          q={qP} onQ={setQP}
          placeholder="Cari nomor, supplier, tagihan, nominal…"
          filters={[
            { key: "sup", label: "Supplier", value: fSupP, onChange: setFSupP, options: unik(payments.map((p) => p.supplier?.name)) },
            { key: "rek", label: "Dari rekening", value: fRek, onChange: setFRek, options: unik(payments.map((p) => p.cashAccount?.name)) },
            { key: "status", label: "Status", value: fStatusP, onChange: setFStatusP, options: [["posting", "Terposting"], ["batal", "Dibatalkan"]] },
          ]}
          ringkasan={paymentsTampil.length === payments.length ? `${payments.length} pembayaran` : `${paymentsTampil.length} dari ${payments.length} pembayaran`}
          onReset={() => { setQP(""); setFSupP(""); setFRek(""); setFStatusP(""); }}
        />
        <Card className="overflow-hidden">
          <JudulKartu
            title="Pembayaran ke Supplier"
            description="Satu pembayaran bisa melunasi beberapa tagihan sekaligus."
            info="Cocok untuk transfer gabungan akhir bulan — satu kali transfer ke supplier, dialokasikan ke beberapa tagihan yang jatuh tempo bersamaan."
          />
          {paymentsTampil.length === 0 ? (
            <CardContent><p className="py-6 text-center text-[13px] text-ink3">{payments.length === 0 ? "Belum ada pembayaran." : "Tidak ada pembayaran yang cocok dengan pencarian ini."}</p></CardContent>
          ) : (
            <TableWrap className="dh-table">
              <Table fixed>
                <ColGroup widths={[LEBAR_NOMOR, 92, 160, 150, null, 128, 116, AKSI_COL_WIDTH_MENU_ONLY]} />
                <THead>
                  <TR>
                    <TH sticky width={LEBAR_NOMOR}>Nomor</TH>
                    <TH width={92} className="whitespace-nowrap">Tanggal</TH>
                    <TH width={160}>Supplier</TH>
                    <TH width={150}>Dari Rekening</TH>
                    <TH>Tagihan</TH>
                    <TH numeric width={128}>Nominal</TH>
                    <TH width={116}>Status</TH>
                    <TH width={AKSI_COL_WIDTH_MENU_ONLY} />
                  </TR>
                </THead>
                <TBody>
                  {paymentsTampil.map((p) => (
                    <TR key={p.id} {...klikBuka(() => setPanelRincian(specOtomatis(p)))}>
                      <TD sticky className="font-mono text-[12px]">
                        <span className="block min-w-0 truncate overflow-hidden whitespace-nowrap" title={p.paymentNumber} data-sel="nomor">{p.paymentNumber}</span>
                      </TD>
                      <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(p.date)}</TD>
                      <TD truncate>{p.supplier?.name}</TD>
                      <TD truncate>{p.cashAccount?.name}</TD>
                      <TD truncate className="text-[12px]" title={p.allocations.map((a) => a.bill?.billNumber).join(", ") || "—"}>
                        {p.allocations.map((a) => a.bill?.billNumber).join(", ") || "—"}
                      </TD>
                      <TD numeric><NominalDenganBiaya d={p} /></TD>
                      <TD>{p.cancelledAt ? <Badge variant="red">Dibatalkan</Badge> : <Badge variant="green">Terposting</Badge>}</TD>
                      <TD><RowActions primary={null} items={aksiPembayaran(p, { aksi, setVersiPay })} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
        </>
      )}

      {tab === "supplier" && (
        <>
        <TabelUangMukaSupplier data={uangMuka} />
        <FilterBar
          q={qS} onQ={setQS}
          placeholder="Cari kode, nama, kontak, bank…"
          filters={[
            { key: "status", label: "Status", value: fStatusS, onChange: setFStatusS, options: [["aktif", "Aktif"], ["nonaktif", "Nonaktif"]] },
            { key: "utang", label: "Utang", value: fUtang, onChange: setFUtang, options: [["ada", "Ada sisa utang"], ["lunas", "Lunas"]] },
          ]}
          ringkasan={suppliersTampil.length === suppliers.length ? `${suppliers.length} supplier` : `${suppliersTampil.length} dari ${suppliers.length} supplier`}
          onReset={() => { setQS(""); setFStatusS(""); setFUtang(""); }}
        />
        <Card className="overflow-hidden">
          <JudulKartu
            title="Master Supplier"
            description="Entitas supplier baru ada sejak modul Finance. Kolom supplier di dokumen Gudang tetap teks bebas
              seperti sebelumnya — penautannya dilakukan per tagihan, bukan dengan memigrasikan riwayat lama."
            info="Daftarkan supplier di sini dulu sebelum mencatat tagihannya — data kontak & termin pembayaran yang tersimpan di sini yang dipakai menghitung jatuh tempo otomatis."
          />
          {suppliers.length === 0 ? (
            <CardContent>
              <EmptyState icon={Building2} title="Belum ada supplier" description="Daftarkan supplier yang tagihannya perlu dilacak." />
            </CardContent>
          ) : suppliersTampil.length === 0 ? (
            <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada supplier yang cocok dengan pencarian ini.</p></CardContent>
          ) : (
            <TableWrap className="dh-table">
              <Table fixed>
                <THead>
                  <TR>
                    <TH sticky width={100}>Kode</TH>
                    <TH width={180}>Nama</TH>
                    <TH width={150}>Kontak</TH>
                    <TH width={100}>Termin</TH>
                    <TH>Rekening</TH>
                    <TH numeric width={140}>Sisa Utang</TH>
                    <TH width={100}>Status</TH>
                    <TH width={AKSI_COL_WIDTH_MENU_ONLY}>Aksi</TH>
                  </TR>
                </THead>
                <TBody>
                  {suppliersTampil.map((s) => (
                    <TR key={s.id} {...klikBuka(() => setPanelRincian(specOtomatis(s)))}>
                      <TD sticky className="font-mono text-[12px]">{s.code}</TD>
                      <TD truncate className="font-medium">{s.name}</TD>
                      <TD truncate className="text-[12px] text-ink2">{s.phone || s.email || "—"}</TD>
                      <TD className="whitespace-nowrap text-[12px]">{s.paymentTermType === "TUNAI" ? "Tunai/COD" : s.paymentTermType === "TANGGAL_KHUSUS" ? "Tanggal khusus" : s.paymentTermDays ? `${s.paymentTermDays} hari` : "—"}</TD>
                      <TD truncate className="text-[12px] text-ink2">
                        {s.bankAccount ? `${s.bankName || ""} ${s.bankAccount}`.trim() : "—"}
                      </TD>
                      <TD numeric><Uang value={s.sisaUtang} nolSebagaiStrip /></TD>
                      <TD>{s.active ? <Badge variant="green">Aktif</Badge> : <Badge variant="neutral">Nonaktif</Badge>}</TD>
                      <TD>
                        <RowActions primary={null} items={[
                          { label: "Edit data supplier", icon: Pencil, onClick: () => setEditSupplier(s) },
                          s.active
                            ? { label: "Nonaktifkan", icon: Ban, destructive: true, confirmText: `Nonaktifkan ${s.name}? Supplier tidak bisa menerima tagihan baru, tetapi utang yang ada tetap bisa dibayar.`, onClick: () => ubahStatusSupplier(s) }
                            : { label: "Aktifkan kembali", icon: CheckCircle2, onClick: () => ubahStatusSupplier(s) },
                        ]} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
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
          aksi={(b) => aksiTagihan(b, { aksi: async (fn) => { setRincianTagihan(null); await aksi(fn); }, setEditUntuk: (x) => { setRincianTagihan(null); setEditUntuk(x); }, setVersiUntuk, setInfoUntuk: (x) => { setRincianTagihan(null); setInfoUntuk(x); }, setKoreksiUntuk: (x) => { setRincianTagihan(null); setKoreksiUntuk(x); }, setUangMukaUntuk: (x) => { setRincianTagihan(null); setUangMukaUntuk(x); }, supplierAdaUangMuka })}
          onClose={() => setRincianTagihan(null)} onRiwayat={(x) => { setRincianTagihan(null); setVersiUntuk(x); }}
        />
      )}
      {editUntuk && (
        <ModalEditTagihan
          bill={editUntuk} suppliers={supplierBisaDipilih(suppliers, { tetapSertakanId: editUntuk.supplierId })} kategori={kategori} kategoriBeli={kategoriBeli} metodeInfo={metodeInfo} unbilled={unbilled} onClose={() => setEditUntuk(null)}
          onSubmit={(d) => aksi(async () => { await api.editFinanceBill(editUntuk.id, d); setEditUntuk(null); })}
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
      {uangMukaUntuk && <ModalTerapkanUangMuka billId={uangMukaUntuk.id} nomorFaktur={uangMukaUntuk.supplierRef || uangMukaUntuk.billNumber} onClose={() => setUangMukaUntuk(null)} onSaved={async () => { setUangMukaUntuk(null); await muat(); }} />}
      <ModalBayarSupplier
        open={modal === "bayar"} onClose={() => setModal(null)}
        suppliers={suppliersAktif} bills={bills} rekening={rekening}
        onSubmit={(d, kunci) => aksi(() => api.createFinanceSupplierPayment(d, kunci))}
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

function ModalBayarSupplierIsi({ open, onClose, suppliers, bills, rekening, onSubmit }) {
  const [f, setF] = useState({ supplierId: "", date: "", cashAccountId: "", reference: "", notes: "", ...BIAYA_KOSONG });
  const [alokasi, setAlokasi] = useState({});
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

  const total = Object.values(alokasi).reduce((s, v) => s + (Number(v) || 0), 0);
  const rek = rekening.find((r) => r.id === f.cashAccountId);
  const valid = f.supplierId && f.cashAccountId && total > 0 && biayaTransferLengkap(rek, f);

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Catat Pembayaran ke Supplier"
      className="w-[560px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi
            disabled={!valid}
            onClick={() => {
              const body = {
                ...denganBiaya(f),
                allocations: Object.entries(alokasi)
                  .filter(([, v]) => Number(v) > 0)
                  .map(([billId, amount]) => ({ billId, amount: Number(amount) })),
              };
              return onSubmit(body, kunciBayar(JSON.stringify(body)));
            }}
          >
            Simpan
          </TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Supplier" required>
          <Pilihan value={f.supplierId} onChange={(v) => { set("supplierId", v); setAlokasi({}); }}>
            <option value="">— pilih —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} · sisa {formatUang(s.sisaUtang)}</option>)}
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
                {tagihanTerbuka.map((b) => (
                  <div key={b.id} className="grid grid-cols-[1fr_140px] items-center gap-2">
                    <div className="min-w-0 text-[13px]">
                      <span className="block truncate font-medium">{b.billNumber} · {b.description}</span>
                      <span className="text-[11px] text-ink3">
                        sisa {formatUang(b.sisa)}{b.dueDate ? ` · jatuh tempo ${tanggalPendek(b.dueDate)}` : " · jatuh tempo belum diisi"}
                      </span>
                    </div>
                    <InputUang
                      value={alokasi[b.id] ?? ""}
                      onChange={(v) => setAlokasi((s) => ({ ...s, [b.id]: v }))}
                      max={b.sisa}
                    />
                  </div>
                ))}
                <div className="rounded-lg bg-inset px-3 py-2 text-[13px]">
                  Total dibayar: <strong>{formatUang(total)}</strong>
                </div>
              </div>
            )}
          </div>
        )}

        <Field label="Referensi transfer"><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
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
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
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
  const valid = Object.keys(beda).length > 0 && alasan.trim() && f.supplierId && f.description.trim() && Number(f.amount) > 0 && jenisLengkap(f, metodeInfo);

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Edit ${bill.billNumber}`}
      description={`${formatUang(bill.amount)} · ${bill.supplier?.name || ""}`}
      className="fin-tg-modal w-[640px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={() => onSubmit({ ...beda, reason: alasan.trim() })} disabled={!valid}>Simpan Perubahan</TombolAksi></>}
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          Tagihan ini belum disetujui, jadi belum ada jurnal — semua isian boleh diubah. Setelah disetujui, cara mengoreksinya adalah Batalkan lalu catat ulang.
        </p>
        <Field label="Supplier" required>
          <PemilihSupplier suppliers={suppliers} value={f.supplierId} namaCadangan={bill.supplier?.name} memuat={false} onPilih={(v) => set("supplierId", v)} />
        </Field>
        <Field label="Keterangan" required><Input value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nomor faktur supplier"><Input value={f.supplierRef} onChange={(e) => set("supplierRef", e.target.value)} /></Field>
          <Field label="Nominal tagihan" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
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
      </div>
    </Modal>
  );
}

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalSupplier = resetSaatBuka(ModalSupplierIsi);

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalBayarSupplier = resetSaatBuka(ModalBayarSupplierIsi);
