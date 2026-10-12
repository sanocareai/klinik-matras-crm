import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PanelDetail, klikBuka } from "@/features/finance/PanelDetail.jsx";
import { specOtomatis } from "@/features/finance/detailSpecs.js";
import { useNavigate } from "react-router-dom";
import { Undo2, HelpCircle, SlidersHorizontal, Search, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useUrlTab } from "@/lib/useUrlTab.js";
import { specDetailPiutang } from "@/features/finance/PiutangDetail.jsx";
import {
  TAB_PIUTANG, TAB_PIUTANG_KUNCI, STATUS_BAYAR_OPSI, LABEL_STATUS_BAYAR, URUT_OPSI, UMUR_OPSI, barisUntukTab, saringPiutang, jumlahFilterAktif,
  ringkasDiagnosis, kelompokPerluTindakan, labelScopeExport, teksNominal, periodeBawaanPiutang,
} from "@/features/finance/piutangLogic.js";
import { VARIAN_TINGKAT } from "@/features/finance/diagnosisPiutangLogic.js";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { NominalDenganBiaya, nominalTeks } from "@/features/finance/biayaAdminTampil.jsx";
import CaraBayarTransfer from "@/features/finance/CaraBayarTransfer.jsx";
import { BIAYA_KOSONG, denganBiaya, biayaTransferLengkap, bodyBiayaTransfer } from "@/features/finance/biayaTransfer.js";
import { RiwayatVersiDialog, KoreksiDialog, InfoDialog } from "@/features/finance/KoreksiAman.jsx";
import { aksiRefund as matriksRefund } from "@/features/finance/matriksAksi.js";
import { KenapaBeda } from "@/features/finance/kontrak.jsx";
import { bentukItemMenu, adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, tanggalPendek, LABEL_STATUS, PeriodePicker, periodeDefault,
} from "@/features/finance/shared.jsx";
import FilterBar, { cocok } from "@/features/finance/FilterBar.jsx";
import DiagnosisPiutang from "@/features/finance/DiagnosisPiutang.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { RowActions, AKSI_COL_WIDTH } from "@/features/finance/RowActions.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import { resetSaatBuka } from "@/features/finance/resetSaatBuka.jsx";

// Refund: belum disetujui = Edit bebas (belum ada jurnal); sudah disetujui = jurnal sudah ada, JANGAN diubah —
// pilihannya Batalkan (jurnal dibalik resmi, status bayar order dihitung ulang) lalu ajukan ulang dengan data yang benar.
function aksiRefund(r, { aksi, setEditUntuk, setVersiUntuk, setInfoUntuk, setKoreksiUntuk }) {
  const items = bentukItemMenu(matriksRefund(r, { admin: adminSaatIni() }), {
    edit: () => setEditUntuk(r),
    info: () => setInfoUntuk(r),
    koreksi: () => setKoreksiUntuk(r),
    versi: () => setVersiUntuk(r),
    tolak: () => {
      const alasan = window.prompt("Alasan penolakan refund:");
      if (alasan?.trim()) return aksi(() => api.rejectFinanceRefund(r.id, alasan.trim()));
    },
    batalkan: () => {
      const alasan = window.prompt(`Alasan membatalkan refund ${r.refundNumber}? Jurnalnya akan dibalik dan uang dianggap kembali ke rekening. Untuk mengoreksi, ajukan refund baru setelah ini:`);
      if (alasan?.trim()) return aksi(() => api.cancelFinanceRefund(r.id, alasan.trim()));
    },
  });
  if (r.status === "MENUNGGU_APPROVAL") {
    return {
      primary: {
        label: "Setujui", variant: "secondary",
        confirmText: `Setujui refund ${formatUang(r.amount)} untuk order ${r.order?.orderNumber}? Uang akan keluar dari ${r.cashAccount?.name}.`,
        onClick: () => aksi(() => api.approveFinanceRefund(r.id)),
      },
      items,
    };
  }
  return { primary: null, items };
}

// PIUTANG & REFUND — siapa berutang ke kita, berapa, dan sudah lewat berapa lama.
//
// ⚠️ ANGKA DI SINI BUKAN "nilai order dikurangi pembayaran". Piutang dihitung dari SALDO AKUN Piutang Usaha per order di buku besar, jadi order yang BELUM
// DISERAHKAN tidak muncul — uang yang sudah dibayar untuk order yang belum jadi adalah UANG MUKA (kewajiban kita), bukan tagihan ke customer.
//
// Desain ulang (Okt 2026): daftar piutang tampil di layar pertama; diagnosis/penjelasan panjang pindah ke tab & drawer bantuan. TIDAK ada rumus yang berubah:
// semua kartu, tab, badge, drawer, dan Export membaca read-model server yang sama (umurPiutang + diagnosisPiutang); klien hanya menyaring/mengurutkan/melabeli.
export default function FinanceReceivables() {
  const navigate = useNavigate();
  const [panelRefund, setPanelRefund] = useState(null); // drawer detail refund (spec otomatis); piutang memakai detail order (terpilih)
  const [terpilih, setTerpilih] = useState(null); // baris piutang yang drawer-nya terbuka
  const [detail, setDetail] = useState({ id: null, data: null, galat: "", memuat: false });
  const [data, setData] = useState(null);
  const [diag, setDiag] = useState(undefined); // undefined = belum dimuat; null = gagal
  const [diagGalat, setDiagGalat] = useState(null);
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalRefund, setModalRefund] = useState(false);
  const [editUntuk, setEditUntuk] = useState(null);
  const [versiUntuk, setVersiUntuk] = useState(null);
  const [infoUntuk, setInfoUntuk] = useState(null);
  const [koreksiUntuk, setKoreksiUntuk] = useState(null);
  const [rekening, setRekening] = useState([]);
  const [periode, setPeriode] = useState(periodeBawaanPiutang); // posisi HARI INI (jatuh tempo & ≤7 hari relatif ke posisi ini)
  const [bantuan, setBantuan] = useState(false);
  const [lembarFilter, setLembarFilter] = useState(false);
  const [tab, setTab] = useUrlTab(TAB_PIUTANG_KUNCI, "daftar");

  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fUmur, setFUmur] = useState("");
  const [fSales, setFSales] = useState("");
  const [urut, setUrut] = useState("sisa");
  const [qRefund, setQRefund] = useState("");
  const [fStatusRefund, setFStatusRefund] = useState("");

  const muatDiagnosis = useCallback(async () => {
    setDiagGalat(null);
    try { setDiag(await api.getFinancePiutangDiagnosis({ to: periode.to })); } catch (e) { setDiag(null); setDiagGalat(e.message || "Gagal memuat diagnosis piutang"); }
  }, [periode.to]);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ar, rf, rk] = await Promise.all([
        api.getFinanceReceivables({ to: periode.to }),
        api.getFinanceRefunds(),
        api.getFinanceCashAccounts(),
      ]);
      setData(ar);
      setRefunds(rf.refunds);
      setRekening(rk.accounts.filter((a) => a.active));
    } catch (e) {
      setError(e.message || "Gagal memuat piutang");
    } finally {
      setLoading(false);
    }
    muatDiagnosis(); // tidak menahan daftar: kartu "Perlu Tindakan" & strip menyusul bila diagnosis lambat/gagal
  }, [periode.to, muatDiagnosis]);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModalRefund(false);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  // Detail order untuk drawer.
  const bukaDetail = useCallback(async (row) => {
    setTerpilih(row);
    setDetail({ id: row.orderId, data: null, galat: "", memuat: true });
    try {
      const d = await api.getFinancePiutangOrder(row.orderId, { to: periode.to });
      setDetail((s) => (s.id === row.orderId ? { id: row.orderId, data: d, galat: "", memuat: false } : s));
    } catch (e) {
      setDetail((s) => (s.id === row.orderId ? { id: row.orderId, data: null, galat: e.message || "Gagal memuat rincian order", memuat: false } : s));
    }
  }, [periode.to]);
  const tutupDetail = () => { setTerpilih(null); setDetail({ id: null, data: null, galat: "", memuat: false }); };

  const semuaBaris = data?.baris || [];
  const daftarSales = useMemo(() => [...new Set(semuaBaris.map((b) => b.salesName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id")), [semuaBaris]);
  const barisTab = useMemo(() => barisUntukTab(semuaBaris, tab), [semuaBaris, tab]);
  const baris = useMemo(() => saringPiutang(barisTab, { q, status: fStatus, umur: fUmur, sales: fSales, urut }), [barisTab, q, fStatus, fUmur, fSales, urut]);
  const jt = data?.jatuhTempo ?? { lewat: { jumlah: 0, total: 0 }, tujuhHari: { jumlah: 0, total: 0 } };
  const ringkasDiag = useMemo(() => ringkasDiagnosis(diag), [diag]);
  const kelompok = useMemo(() => kelompokPerluTindakan(diag), [diag]);
  const refundMenunggu = refunds.filter((r) => r.status === "MENUNGGU_APPROVAL");
  const statusRefund = useMemo(() => [...new Set(refunds.map((r) => r.status).filter(Boolean))], [refunds]);
  const refundTampil = useMemo(() => refunds.filter((r) =>
    (!fStatusRefund || r.status === fStatusRefund)
    && cocok(qRefund, r.refundNumber, r.order?.orderNumber, r.order?.customer?.name, r.reason, teksNominal(r.amount)),
  ), [refunds, qRefund, fStatusRefund]);
  const filterAktif = Boolean(q.trim() || fStatus || fUmur || fSales || urut !== "sisa");
  const resetFilter = () => { setQ(""); setFStatus(""); setFUmur(""); setFSales(""); setUrut("sisa"); };

  // EXPORT EXCEL — persis yang tampil: id baris yang TAMPIL (urutan layar); server memuat ulang lewat fungsi baca yang sama dengan layar.
  // Label menjelaskan tab & filter aktif supaya berkas tidak ambigu (apa yang diekspor, dari tab mana, pada posisi tanggal berapa).
  function ambilBodyExport() {
    const refundSemua = tab === "refund" ? refundTampil : refunds;
    const piutangIds = (tab === "daftar" || tab === "jatuh-tempo" ? baris : semuaBaris).map((b) => b.orderId);
    return {
      periode: { from: periode.from, to: periode.to },
      filter: { piutangIds, refundIds: refundSemua.map((r) => r.id) },
      filterLabel: labelFilterAktif([
        ...labelScopeExport(tab, { jumlahTampil: baris.length, jumlahTotal: semuaBaris.length, filterAktif }),
        ["Status bayar", fStatus && LABEL_STATUS_BAYAR[fStatus]],
        ["Kelompok umur", UMUR_OPSI.find(([k]) => k === fUmur)?.[1]],
        ["Sales", fSales],
        ["Urut", URUT_OPSI.find(([k]) => k === urut)?.[1]],
        ["Cari piutang", q.trim()],
        ["Status refund", tab === "refund" && fStatusRefund && (LABEL_STATUS[fStatusRefund] || fStatusRefund)],
        ["Cari refund", tab === "refund" && qRefund.trim()],
        ["Posisi per", tanggalPendek(periode.to)],
      ]),
    };
  }

  const tampilBaris = tab === "daftar" || tab === "jatuh-tempo";
  const filterTerlihat = tampilBaris;
  const hitungTab = { daftar: semuaBaris.length, "jatuh-tempo": jt.lewat.jumlah, "perlu-tindakan": diag ? diag.perluTindakan?.jumlah ?? 0 : null, refund: refundMenunggu.length || null, diagnosis: null };

  const specDrawer = terpilih
    ? specDetailPiutang(terpilih, detail.data, {
      memuat: detail.memuat, galat: detail.galat,
      onCobaLagi: () => bukaDetail(terpilih),
      onBukaVerifikasi: () => navigate("/finance/payments"),
      onBukaInvoice: () => navigate("/finance/invoices"),
    })
    : panelRefund;
  const panelRincian = specDrawer;

  return (
    <HalamanFinance
      title="Piutang & Refund"
      subtitle={`Order diserahkan & belum lunas — posisi per ${tanggalPendek(periode.to)}.`}
      loading={loading}
      error={error}
      onRetry={muat}
      actions={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
          <Button size="sm" variant="tertiary" onClick={() => setBantuan(true)} data-testid="bantuan-piutang" aria-label="Bagaimana angka ini dihitung?" title="Bagaimana angka ini dihitung?" className="max-sm:min-h-11 max-sm:px-2.5"><HelpCircle size={14} /> <span className="max-sm:hidden">Bagaimana angka ini dihitung?</span></Button>
          <TombolExportExcel modul="piutang-refund" disabled={loading} ambilBody={ambilBodyExport} />
          <Button size="sm" onClick={() => setModalRefund(true)}><Undo2 size={14} /> Ajukan Refund</Button>
        </div>
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

      {/* Empat kartu ringkas — semua dari kontrak server (umurPiutang.total/jatuhTempo, diagnosis.perluTindakan). */}
      <div className="flex gap-2 overflow-x-auto pb-1 max-sm:-mx-4 max-sm:px-4 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-4" data-testid="kartu-piutang">
        <KartuRingkas
          label="Total Piutang Aktif" value={formatUang(data?.total ?? 0)} sub={`${semuaBaris.length} order`}
          onClick={() => { setTab("daftar"); resetFilter(); }}
          info="Saldo akun Piutang Usaha per order yang benar-benar terbuka di buku besar (order yang sudah diserahkan dan belum lunas)."
        />
        <KartuRingkas
          label="Jatuh Tempo" value={formatUang(jt.lewat.total)} sub={`${jt.lewat.jumlah} order lewat jatuh tempo`} tone={jt.lewat.total > 0 ? "red" : "default"}
          onClick={() => setTab("jatuh-tempo")}
          info="Piutang yang sudah lewat jatuh tempo (jatuh tempo invoice; kalau tidak ada, dari tanggal order)."
        />
        <KartuRingkas
          label="Jatuh Tempo ≤7 Hari" value={formatUang(jt.tujuhHari.total)} sub={`${jt.tujuhHari.jumlah} order`} tone={jt.tujuhHari.total > 0 ? "orange" : "default"}
          onClick={() => { setTab("daftar"); setFUmur("tujuh_hari"); }}
          info="Piutang yang jatuh tempo hari ini sampai 7 hari ke depan."
        />
        <KartuRingkas
          label="Perlu Tindakan" value={diag ? `${diag.perluTindakan?.jumlah ?? 0} order` : diagGalat ? "—" : "…"}
          sub={diagGalat ? "diagnosis gagal dimuat" : "perlu penjelasan / koreksi"} tone={(diag?.perluTindakan?.jumlah ?? 0) > 0 ? "orange" : "default"}
          onClick={() => setTab("perlu-tindakan")}
          info="Order yang saldo/statusnya tidak sesuai tagihan sah — lunas di CRM tanpa Payment, belum tercatat di buku, saldo kredit, dll. Rinciannya di tab Perlu Tindakan."
        />
      </div>

      {/* Strip diagnosis ringkas (hanya di tab bawaan): penjelasan panjang dipindah ke tab Diagnosis. */}
      {tab === "daftar" && (ringkasDiag || (data?.menungguVerifikasi?.jumlah ?? 0) > 0) && (
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-1.5 text-[12.5px] text-ink", ringkasDiag && !ringkasDiag.cocok ? "bg-orangebg" : "bg-inset")} data-testid="strip-diagnosis">
          {ringkasDiag && <Badge variant={ringkasDiag.cocok ? "green" : "orange"}>{ringkasDiag.cocok ? "Saldo buku cocok" : "Saldo buku tidak cocok"}</Badge>}
          {ringkasDiag && <span>{ringkasDiag.perluTindakan} order perlu tindakan</span>}
          {(data?.menungguVerifikasi?.jumlah ?? 0) > 0 && (
            <span data-testid="catatan-menunggu-verifikasi" className="max-sm:hidden">
              · {data.menungguVerifikasi.jumlah} order lunas di CRM menunggu verifikasi ({formatUang(data.menungguVerifikasi.total)}, tidak dihitung piutang){" "}
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => navigate("/finance/payments")}>Buka verifikasi</button>
            </span>
          )}
          <button type="button" className="ml-auto font-semibold text-accent hover:underline max-sm:min-h-11" onClick={() => setTab("diagnosis")}>Lihat diagnosis</button>
        </div>
      )}

      {/* Tab sticky */}
      <div className="sticky top-0 z-30 -mx-1 bg-background/95 px-1 backdrop-blur-sm" data-testid="tab-piutang">
        <div role="tablist" aria-label="Bagian Piutang & Refund" className="flex gap-1 overflow-x-auto border-b border-line">
          {TAB_PIUTANG.map((t) => {
            const aktif = tab === t.key;
            const n = hitungTab[t.key];
            return (
              <button
                key={t.key} type="button" role="tab" id={`tab-piutang-${t.key}`} aria-selected={aktif} data-testid={`tab-${t.key}`} onClick={() => setTab(t.key)}
                className={cn("-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-semibold max-sm:min-h-11", aktif ? "border-accent text-accent" : "border-transparent text-ink3 hover:text-ink")}
              >
                {t.label}
                {n != null && n > 0 && <span className="rounded-full bg-inset px-1.5 text-[10.5px] font-bold tabular-nums text-ink2">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter sticky (Daftar Piutang & Jatuh Tempo) */}
      {filterTerlihat && (
        <BarFilterPiutang
          q={q} onQ={setQ} status={fStatus} onStatus={setFStatus} umur={fUmur} onUmur={setFUmur} sales={fSales} onSales={setFSales} urut={urut} onUrut={setUrut}
          daftarSales={daftarSales} jumlah={baris.length} total={barisTab.length} onReset={resetFilter} onBukaLembar={() => setLembarFilter(true)}
        />
      )}

      {tampilBaris && (
        <DaftarPiutang
          baris={baris} adaData={barisTab.length > 0} tab={tab} onBuka={bukaDetail}
          onVerifikasi={() => navigate("/finance/payments")} onInvoice={() => navigate("/finance/invoices")}
        />
      )}

      {tab === "perlu-tindakan" && (
        <PerluTindakan diag={diag} galat={diagGalat} kelompok={kelompok} onBuka={(b) => b.orderId && bukaDetail({
          orderId: b.orderId, orderNumber: b.orderNumber, customerName: b.customerName, salesName: b.salesName, sisaTagihan: b.nilai, nilaiOrder: b.nilai,
          tagihanDiakui: null, sudahDilunasi: null, hariLewat: 0, dueDate: null, statusBayar: null,
        })} />
      )}

      {tab === "refund" && (
        <section className="space-y-3" data-testid="panel-refund">
          <FilterBar
            q={qRefund} onQ={setQRefund}
            placeholder="Cari nomor, order, pelanggan…"
            filters={[{ key: "status", label: "Status", value: fStatusRefund, onChange: setFStatusRefund, options: statusRefund.map((s) => [s, LABEL_STATUS[s] || s]) }]}
            ringkasan={`${refundTampil.length} refund${refundTampil.length !== refunds.length ? ` dari ${refunds.length}` : ""}`}
            onReset={() => { setQRefund(""); setFStatusRefund(""); }}
          />
          <DaftarRefund
            refunds={refunds} refundTampil={refundTampil} refundMenunggu={refundMenunggu}
            aksiBaris={(r) => aksiRefund(r, { aksi, setEditUntuk, setVersiUntuk, setInfoUntuk, setKoreksiUntuk })} onBuka={(r) => setPanelRefund(specOtomatis(r))}
          />
        </section>
      )}

      {tab === "diagnosis" && (
        <section className="space-y-3" data-testid="panel-diagnosis">
          <Penjelasan>
            Piutang dihitung dari saldo akun <strong>Piutang Usaha</strong> per order di buku besar — bukan dari “nilai order dikurangi pembayaran”. Akibatnya order yang
            <strong> belum diserahkan</strong> tidak muncul di daftar: uang yang sudah dibayar untuk order itu masih berstatus <strong>uang muka</strong> (kewajiban kita ke customer).
          </Penjelasan>
          <DiagnosisPiutang data={diag === undefined ? null : diag} galat={diagGalat} onReload={muatDiagnosis} />
          <KenapaBeda metrik={["piutang_usaha", "refund_diberikan", "uang_masuk_terverifikasi", "uang_muka_pelanggan"]} />
        </section>
      )}

      {/* Drawer bantuan: cara angka dihitung */}
      <Modal
        open={bantuan} onOpenChange={setBantuan} title="Bagaimana angka ini dihitung?"
        description="Semua angka di halaman ini dibaca dari server — layar tidak menghitung ulang."
        footer={<Button variant="neutral" onClick={() => setBantuan(false)} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}
      >
        <div className="space-y-3 text-[13px] leading-relaxed text-ink2" data-testid="isi-bantuan">
          <p className="m-0"><strong className="text-ink">Total Piutang Aktif</strong> = jumlah saldo akun Piutang Usaha per order yang masih terbuka (positif) di buku besar, order yang sudah diserahkan dan belum lunas.</p>
          <p className="m-0"><strong className="text-ink">Jatuh Tempo</strong> = bagian piutang yang sudah lewat jatuh tempo. Acuan: jatuh tempo invoice; bila tidak ada, tanggal order (kolom Umur menyebutkan).</p>
          <p className="m-0"><strong className="text-ink">Jatuh Tempo ≤7 Hari</strong> = jatuh tempo hari ini sampai 7 hari ke depan.</p>
          <p className="m-0"><strong className="text-ink">Perlu Tindakan</strong> = order yang saldonya bukan tagihan sah (lunas di CRM tanpa Payment, belum tercatat di buku, saldo kredit, nilai berubah setelah diakui, dst).</p>
          <p className="m-0">Order yang <strong className="text-ink">belum diserahkan</strong> tidak masuk piutang: uang yang sudah dibayar masih <strong className="text-ink">uang muka</strong> (kewajiban kepada pelanggan).</p>
          <KenapaBeda metrik={["piutang_usaha", "refund_diberikan", "uang_masuk_terverifikasi", "uang_muka_pelanggan"]} />
        </div>
      </Modal>

      {/* Bottom sheet filter (mobile) */}
      <LembarFilter
        open={lembarFilter} onClose={() => setLembarFilter(false)}
        status={fStatus} onStatus={setFStatus} umur={fUmur} onUmur={setFUmur} sales={fSales} onSales={setFSales} urut={urut} onUrut={setUrut}
        daftarSales={daftarSales} onReset={resetFilter} jumlah={baris.length}
      />

      {editUntuk && (
        <ModalEditRefund
          refund={editUntuk} rekening={rekening} onClose={() => setEditUntuk(null)}
          onSubmit={(d) => aksi(async () => { await api.editFinanceRefund(editUntuk.id, d); setEditUntuk(null); })}
        />
      )}
      {infoUntuk && (
        <InfoDialog
          jenis="refunds" doc={infoUntuk} nomor={infoUntuk.refundNumber} judulRingkas={`Order ${infoUntuk.order?.orderNumber || ""} · ${formatUang(infoUntuk.amount)}`}
          kolom={[{ kunci: "alasanRefund", label: "Alasan refund" }]}
          awal={{ alasanRefund: infoUntuk.reason || "" }}
          onClose={() => setInfoUntuk(null)} onSaved={() => { setInfoUntuk(null); muat(); }}
        />
      )}
      {koreksiUntuk && (
        <KoreksiDialog
          tanpaPin
          jenis="refunds" doc={koreksiUntuk} nomor={koreksiUntuk.refundNumber} judulRingkas={`Refund disetujui · order ${koreksiUntuk.order?.orderNumber || ""} · ${formatUang(koreksiUntuk.amount)}`}
          kolom={[
            { kunci: "amount", label: "Nominal refund", tipe: "uang", wajib: true },
            { kunci: "date", label: "Tanggal refund", tipe: "tanggal", wajib: true },
            { kunci: "cashAccountId", label: "Rekening sumber pengembalian", tipe: "pilih", opsi: rekening.map((x) => ({ id: x.id, name: x.name })), wajib: true },
          ]}
          awal={{ amount: Number(koreksiUntuk.amount) || 0, date: String(koreksiUntuk.date || "").slice(0, 10), cashAccountId: koreksiUntuk.cashAccountId || "" }}
          onClose={() => setKoreksiUntuk(null)} onSaved={() => { setKoreksiUntuk(null); muat(); }}
        />
      )}
      {versiUntuk && <RiwayatVersiDialog jenis="refunds" id={versiUntuk.id} nomor={versiUntuk.refundNumber} onClose={() => setVersiUntuk(null)} />}
      <ModalRefund
        open={modalRefund}
        onClose={() => setModalRefund(false)}
        rekening={rekening}
        piutang={data?.baris || []}
        onSubmit={(d) => aksi(() => api.createFinanceRefund(d))}
      />
      <PanelDetail spec={panelRincian} onClose={() => { tutupDetail(); setPanelRefund(null); }} />
    </HalamanFinance>
  );
}

// Kartu ringkas padat (≈72px) supaya Daftar Piutang tampil di layar pertama. Nilai dari server; klik = pindah tab/filter.
function KartuRingkas({ label, value, sub, tone = "default", onClick, info }) {
  const warna = tone === "red" ? "text-red" : tone === "orange" ? "text-orange" : "text-ink";
  return (
    <button type="button" onClick={onClick} title={info} className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-left transition-colors hover:bg-hovertint max-sm:min-h-[44px] max-sm:w-[170px] max-sm:shrink-0">
      <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-ink3">{label}</span>
      <span className={cn("block truncate text-[17px] font-bold leading-tight tabular-nums", warna)}>{value}</span>
      <span className="block truncate text-[11.5px] text-ink3">{sub}</span>
    </button>
  );
}

// ── Bar filter sticky ────────────────────────────────────────────────────────────────────────────
function PilihFilter({ label, value, onChange, opsi, kosongLabel, className }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink3", className)}>
      {label}
      <Pilihan value={value} onChange={onChange} className="text-[13px] font-normal normal-case tracking-normal">
        <option value="">{kosongLabel}</option>
        {opsi.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Pilihan>
    </label>
  );
}

function BarFilterPiutang({ q, onQ, status, onStatus, umur, onUmur, sales, onSales, urut, onUrut, daftarSales, jumlah, total, onReset, onBukaLembar }) {
  const n = jumlahFilterAktif({ status, umur, sales, urut });
  const aktif = Boolean(q.trim()) || n > 0;
  return (
    <div className="fin-glass sticky top-[46px] z-20 space-y-1 px-3 py-2" data-testid="filter-piutang">
      <div className="flex items-center gap-2">
        <div className="fin-search min-w-0 flex-1 sm:max-w-[380px]">
          <Search size={16} className="shrink-0 text-ink3" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="Cari order / pelanggan…" aria-label="Cari order atau pelanggan" enterKeyHint="search" autoComplete="off" data-testid="cari-piutang" />
        </div>
        <Button size="sm" variant="neutral" onClick={onBukaLembar} className="sm:hidden max-sm:min-h-11" data-testid="buka-filter">
          <SlidersHorizontal size={14} /> Filter{n > 0 ? ` (${n})` : ""}
        </Button>
        <div className="hidden min-w-0 flex-1 items-end gap-2 sm:flex">
          <PilihFilter label="Status" value={status} onChange={onStatus} opsi={STATUS_BAYAR_OPSI} kosongLabel="Semua status" className="w-[150px]" />
          <PilihFilter label="Kelompok umur" value={umur} onChange={onUmur} opsi={UMUR_OPSI} kosongLabel="Semua umur" className="w-[170px]" />
          <PilihFilter label="Sales" value={sales} onChange={onSales} opsi={daftarSales.map((s) => [s, s])} kosongLabel="Semua sales" className="w-[150px]" />
          <PilihFilter label="Urutkan" value={urut} onChange={onUrut} opsi={URUT_OPSI} kosongLabel="Sisa terbesar" className="w-[150px]" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11.5px] leading-none text-ink3">
        <span data-testid="ringkas-filter">{jumlah} piutang{jumlah !== total ? ` dari ${total}` : ""}</span>
        {aktif && <button type="button" className="font-semibold text-accent hover:underline max-sm:min-h-11" onClick={onReset}>Reset filter</button>}
      </div>
    </div>
  );
}

function LembarFilter({ open, onClose, status, onStatus, umur, onUmur, sales, onSales, urut, onUrut, daftarSales, onReset, jumlah }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[201] flex max-h-[85vh] flex-col rounded-t-2xl bg-surface p-4 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
          data-testid="lembar-filter"
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-[15px] font-bold text-ink">Filter piutang</Dialog.Title>
            <Dialog.Close aria-label="Tutup" className="flex h-10 w-10 items-center justify-center rounded-lg text-ink3 hover:bg-hovertint"><X size={16} /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
            <PilihFilter label="Status pembayaran" value={status} onChange={onStatus} opsi={STATUS_BAYAR_OPSI} kosongLabel="Semua status" />
            <PilihFilter label="Kelompok umur" value={umur} onChange={onUmur} opsi={UMUR_OPSI} kosongLabel="Semua umur" />
            <PilihFilter label="Sales" value={sales} onChange={onSales} opsi={daftarSales.map((s) => [s, s])} kosongLabel="Semua sales" />
            <PilihFilter label="Urutkan" value={urut} onChange={onUrut} opsi={URUT_OPSI} kosongLabel="Sisa terbesar" />
          </div>
          <div className="mt-2 flex gap-2">
            <Button variant="neutral" className="min-h-11 flex-1" onClick={onReset}>Reset</Button>
            <Button className="min-h-11 flex-1" onClick={onClose}>Lihat {jumlah} piutang</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Daftar piutang: tabel (desktop) + kartu ringkas (mobile) ──────────────────────────────────────────────────────────
function BadgeUmur({ b }) {
  if (b.hariLewat > 0) return <Badge variant={b.hariLewat > 60 ? "red" : b.hariLewat > 30 ? "orange" : "neutral"}>{b.hariLewat} hari</Badge>;
  if (b.hariLewat >= -7) return <Badge variant="orange">{b.hariLewat === 0 ? "hari ini" : `${Math.abs(b.hariLewat)} hr lagi`}</Badge>;
  return <span className="text-ink3">belum</span>;
}
const BadgeStatus = ({ status }) => <Badge variant={status === "DIBAYAR_SEBAGIAN" ? "accent" : "neutral"}>{LABEL_STATUS_BAYAR[status] || "—"}</Badge>;

function DaftarPiutang({ baris, adaData, tab, onBuka, onVerifikasi, onInvoice }) {
  if (baris.length === 0) {
    return (
      <Card><CardContent><p className="py-8 text-center text-[13px] text-ink3" data-testid="piutang-kosong">
        {adaData ? "Tidak ada piutang yang cocok dengan pencarian/filter." : tab === "jatuh-tempo" ? "Tidak ada piutang yang lewat jatuh tempo." : "Tidak ada piutang terbuka."}
      </p></CardContent></Card>
    );
  }
  return (
    <>
      <Card className={cn("overflow-hidden", TABLE_VIEW_CLASS)} data-testid="tabel-piutang">
        <TableWrap className="dh-table">
          <Table fixed>
            <THead>
              <TR>
                <TH sticky>Order / Pelanggan</TH>
                <TH width={92} hideBelow="wide">Tanggal</TH>
                <TH numeric width={124} hideBelow="wide">Total Tagihan</TH>
                <TH numeric width={124} hideBelow="wide">Sudah Dibayar</TH>
                <TH numeric width={130}>Sisa</TH>
                <TH width={96}>Umur</TH>
                <TH width={124}>Status</TH>
                <TH width={AKSI_COL_WIDTH}>Aksi</TH>
              </TR>
            </THead>
            <TBody>
              {baris.map((b) => (
                <TR key={b.orderId} {...klikBuka(() => onBuka(b))} data-testid="baris-piutang">
                  <TD sticky>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{b.orderNumber || "—"}</div>
                      <div className="truncate text-[12px] text-ink2">{b.customerName}{b.salesName ? ` · ${b.salesName}` : ""}</div>
                    </div>
                  </TD>
                  <TD hideBelow="wide" className="whitespace-nowrap text-[12px]">{b.tanggalOrder ? tanggalPendek(b.tanggalOrder) : "—"}</TD>
                  <TD hideBelow="wide" numeric><Uang value={b.tagihanDiakui} /></TD>
                  <TD hideBelow="wide" numeric><Uang value={b.sudahDilunasi} nolSebagaiStrip /></TD>
                  <TD numeric><Uang value={b.sisaTagihan} className="font-bold" /></TD>
                  <TD><BadgeUmur b={b} /></TD>
                  <TD><BadgeStatus status={b.statusBayar} /></TD>
                  <TD>
                    <RowActions
                      primary={{ label: "Detail", variant: "neutral", title: "Buka rincian order", onClick: () => onBuka(b) }}
                      items={[
                        { label: "Buka verifikasi pembayaran", onClick: onVerifikasi },
                        { label: "Buka invoice", onClick: onInvoice },
                      ]}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <ul className={cn("m-0 list-none space-y-2 p-0", CARD_VIEW_CLASS)} data-testid="kartu-daftar-piutang">
        {baris.map((b) => (
          <li key={b.orderId}>
            <button
              type="button" onClick={() => onBuka(b)} data-testid="kartu-piutang-baris"
              className="w-full rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:bg-hovertint max-sm:min-h-[44px]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 truncate text-[13px] font-semibold text-ink">{b.customerName}</p>
                  <p className="m-0 truncate font-mono text-[11.5px] text-ink3">{b.orderNumber || "—"}{b.salesName ? ` · ${b.salesName}` : ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink3">Sisa tagihan</p>
                  <p className="m-0 text-[17px] font-bold tabular-nums text-ink">{formatUang(b.sisaTagihan)}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <BadgeStatus status={b.statusBayar} />
                <BadgeUmur b={b} />
                <span className="text-[11.5px] text-ink3">{b.tanggalOrder ? tanggalPendek(b.tanggalOrder) : ""}{b.tagihanDiakui != null ? ` · tagihan ${formatUang(b.tagihanDiakui)}` : ""}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── Perlu Tindakan ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function PerluTindakan({ diag, galat, kelompok, onBuka }) {
  if (galat) return <Card className="bg-redbg"><CardContent className="py-3"><p className="m-0 text-[13px] text-ink">{galat}</p></CardContent></Card>;
  if (diag === undefined) return <Card><CardContent><p className="py-6 text-center text-[13px] text-ink3">Memuat daftar tindakan…</p></CardContent></Card>;
  if (!diag || kelompok.length === 0) {
    return <Card><CardContent><p className="py-8 text-center text-[13px] text-ink3" data-testid="tindakan-kosong">Tidak ada order yang perlu tindakan — semua saldo adalah tagihan sah.</p></CardContent></Card>;
  }
  return (
    <div className="space-y-4" data-testid="panel-perlu-tindakan">
      <p className="m-0 text-[12.5px] text-ink3">Order di bawah ini <strong>bukan piutang normal</strong>: tidak dicampur di Daftar Piutang. Penjelasan dan tindakan dari diagnosis server.</p>
      {kelompok.map((g) => (
        <Card key={g.kode} className="overflow-hidden" data-testid={`kelompok-${g.kode}`}>
          <JudulKartu title={<>{g.label} <Badge variant={VARIAN_TINGKAT[g.tingkat] ?? "neutral"}>{g.baris.length} order</Badge></>} />
          <CardContent className="space-y-2">
            {g.baris.map((b) => (
              <button
                key={`${g.kode}-${b.orderId}`} type="button" disabled={!b.orderId} onClick={() => onBuka(b)}
                className="w-full rounded-lg border border-line p-3 text-left hover:bg-hovertint max-sm:min-h-[44px]" data-testid="baris-tindakan"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 text-[13px] font-medium text-ink">{b.orderNumber || "—"} · {b.customerName}</p>
                    {b.salesName && <p className="m-0 text-[12px] text-ink3">{b.salesName}</p>}
                  </div>
                  <Uang value={b.nilai} className="text-[14px] font-bold" />
                </div>
                <p className="m-0 mt-1.5 text-[12.5px] leading-relaxed text-ink2">{b.penjelasan}</p>
                <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-ink"><strong>Tindakan:</strong> {b.tindakan}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Refund (tabel + kartu mobile) ────────────────────────────────────────────────────────────────────────────────────────
function DaftarRefund({ refunds, refundTampil, refundMenunggu, aksiBaris, onBuka }) {
  return (
    <Card className="overflow-hidden">
      <JudulKartu
        title="Refund ke Pelanggan"
        description={<>
          Pengembalian uang yang BENAR-BENAR pernah diterima. Berbeda dari membatalkan entri pembayaran (itu untuk salah input — uangnya tidak pernah masuk).
          {refundMenunggu.length > 0 && ` ${refundMenunggu.length} menunggu persetujuan.`}
        </>}
        info="Sistem otomatis menolak refund yang nilainya melebihi uang yang pernah benar-benar diterima untuk order itu — jadi tidak mungkin 'mengeluarkan' uang yang sebenarnya belum pernah masuk."
      />
      {refundTampil.length === 0 ? (
        <CardContent><p className="py-6 text-center text-[13px] text-ink3">{refunds.length > 0 ? "Tidak ada refund yang cocok dengan pencarian/filter." : "Belum ada refund."}</p></CardContent>
      ) : (
        <>
          <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
            <Table fixed>
              <THead>
                <TR>
                  <TH sticky width={124}>Nomor</TH><TH width={78}>Tanggal</TH>
                  <TH width={128} hideBelow="2xl">Order</TH><TH width={140}>Pelanggan</TH><TH>Alasan</TH>
                  <TH numeric width={108}>Nominal</TH><TH width={116}>Status</TH><TH width={AKSI_COL_WIDTH}>Aksi</TH>
                </TR>
              </THead>
              <TBody>
                {refundTampil.map((r) => {
                  const a = aksiBaris(r);
                  return (
                    <TR key={r.id} {...klikBuka(() => onBuka(r))}>
                      <TD sticky className="font-mono text-[12px]">{r.refundNumber}</TD>
                      <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(r.date)}</TD>
                      <TD hideBelow="2xl" truncate className="font-medium">{r.order?.orderNumber || "—"}</TD>
                      <TD truncate>{r.order?.customer?.name || "—"}</TD>
                      <TD truncate>{r.reason}</TD>
                      <TD numeric><NominalDenganBiaya d={r} /></TD>
                      <TD><StatusBadge status={r.status} /></TD>
                      <TD><RowActions primary={a.primary} items={a.items} /></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
          <CardList className={CARD_VIEW_CLASS}>
            {refundTampil.map((r) => {
              const a = aksiBaris(r);
              return (
                <RowCard
                  key={r.id}
                  onClick={() => onBuka(r)}
                  title={r.refundNumber}
                  status={<StatusBadge status={r.status} />}
                  subtitle={r.order?.customer?.name || "—"}
                  fields={[
                    { label: "Tanggal", value: tanggalPendek(r.date) },
                    { label: "Nominal", value: nominalTeks(r) },
                    { label: "Order", value: r.order?.orderNumber },
                    { label: "Alasan", value: r.reason, span: true },
                  ]}
                  actions={<RowActions primary={a.primary} items={a.items} />}
                />
              );
            })}
          </CardList>
        </>
      )}
    </Card>
  );
}

function ModalRefundIsi({ open, onClose, rekening, piutang, onSubmit }) {
  const [f, setF] = useState({ orderId: "", date: "", amount: "", reason: "", cashAccountId: "", ...BIAYA_KOSONG });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const rek = rekening.find((r) => r.id === f.cashAccountId);
  const valid = f.orderId && f.reason.trim() && f.cashAccountId && Number(f.amount) > 0 && biayaTransferLengkap(rek, f);

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Ajukan Refund"
      description="Pengembalian uang ke pelanggan. Butuh persetujuan sebelum uang benar-benar keluar."
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(denganBiaya(f, f.mode === "LANGSUNG"))} disabled={!valid}>Ajukan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Order" required
          hint="Cari nomor order atau nama pelanggan. Order dengan piutang terbuka muncul duluan."
        >
          <OrderPicker
            value={f.orderId}
            onChange={(id) => set("orderId", id)}
            // Piutang terbuka ditawarkan sebagai saran tanpa perlu mengetik —
            // itu kasus refund yang paling sering. Bentuknya disamakan dengan
            // item hasil pencarian order supaya OrderPicker tidak perlu tahu
            // dua bentuk data yang berbeda.
            saran={piutang.slice(0, 8).map((b) => ({
              id: b.orderId,
              orderNumber: b.orderNumber,
              customerName: b.customerName,
              value: b.nilaiOrder,
              paymentStatus: b.orderStatus === "CANCELLED" ? null : "DP",
            }))}
            saranLabel="Piutang terbuka"
          />
        </Field>
        <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
        <Field
          label="Nominal" required
          hint="Tidak boleh melebihi uang yang pernah benar-benar diterima untuk order itu"
        >
          <InputUang value={f.amount} onChange={(v) => set("amount", v)} />
        </Field>
        <Field label="Alasan" required>
          <Input value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Order dibatalkan customer" />
        </Field>
        <Field label="Uang keluar dari" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <CaraBayarTransfer rekening={rek} nominal={f.amount} value={f} onChange={(b) => setF((s) => ({ ...s, ...b }))} />
      </div>
    </Modal>
  );
}

// Edit refund yang BELUM disetujui: semua isian boleh berubah, server memvalidasi ulang (batas uang yang pernah diterima,
// biaya transfer). Yang dikirim hanya kolom yang berubah + alasan perubahan (tercatat di riwayat audit).
function ModalEditRefund({ refund, rekening, onClose, onSubmit }) {
  const asli = {
    date: String(refund.date || "").slice(0, 10), amount: Number(refund.amount) || 0, reason: refund.reason || "",
    cashAccountId: refund.cashAccountId || "",
    paymentMethod: refund.paymentMethod || "TUNAI", transferFeeType: refund.transferFeeType || "",
    transferFeeAmount: refund.transferFeeType === "LAINNYA" ? Number(refund.transferFeeAmount) || 0 : "",
  };
  const [f, setF] = useState(asli);
  const [alasan, setAlasan] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const rek = rekening.find((r) => r.id === f.cashAccountId);

  const beda = {};
  for (const k of ["date", "amount", "reason", "cashAccountId"]) {
    const sama = k === "amount" ? Number(f[k]) === Number(asli[k]) : (f[k] || "") === (asli[k] || "");
    if (!sama) beda[k] = k === "amount" ? Number(f[k]) : f[k];
  }
  const biayaBerubah = f.paymentMethod !== asli.paymentMethod || f.transferFeeType !== asli.transferFeeType
    || String(f.transferFeeAmount) !== String(asli.transferFeeAmount) || f.cashAccountId !== asli.cashAccountId;
  const ada = Object.keys(beda).length > 0 || biayaBerubah;
  const valid = ada && alasan.trim() && f.reason.trim() && f.cashAccountId && Number(f.amount) > 0 && biayaTransferLengkap(rek, f);

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Edit ${refund.refundNumber}`}
      description={`${formatUang(refund.amount)} · order ${refund.order?.orderNumber || "—"}`}
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit({ ...beda, ...(biayaBerubah ? bodyBiayaTransfer(f) : {}), alasanPerubahan: alasan.trim() })} disabled={!valid}>Simpan Perubahan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
          Refund ini belum disetujui, jadi belum ada jurnal — semua isian boleh diubah. Server memeriksa ulang batas nominal dan biaya transfer.
        </p>
        <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
        <Field label="Nominal" required hint="Tidak boleh melebihi uang yang pernah benar-benar diterima untuk order itu"><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        <Field label="Alasan refund" required><Input value={f.reason} onChange={(e) => set("reason", e.target.value)} /></Field>
        <Field label="Uang keluar dari" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <CaraBayarTransfer rekening={rek} nominal={f.amount} value={f} onChange={(b) => setF((x) => ({ ...x, ...b }))} />
        <Field label="Alasan perubahan" required hint="Wajib — tercatat di riwayat audit">
          <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. salah ketik nominal" />
        </Field>
      </div>
    </Modal>
  );
}

// Formulir dikosongkan setiap dibuka (lihat features/finance/resetSaatBuka.jsx).
const ModalRefund = resetSaatBuka(ModalRefundIsi);
