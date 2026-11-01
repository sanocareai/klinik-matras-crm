import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/api.js";
import { HalamanFinance, formatUang } from "@/features/finance/shared.jsx";
import { useTertunda } from "@/features/finance/FilterBar.jsx";
import { KpiStatis } from "@/features/finance/PengeluaranPanels.jsx";
import {
  StripInvoice, PeringatanManual, ToolbarInvoice, DaftarInvoice, RincianInvoice, FormJatuhTempo,
} from "@/features/finance/InvoicePanels.jsx";
import { IkDokumen, IkKoin } from "@/components/financeIconsBiaya.jsx";
import { IkTempoLewat, IkTempoBelum } from "@/components/financeIconsInvoice.jsx";
import { filterInvoice, adaFilterLokal, jumlahFilterAktif, kpiInvoice, kalimatHasil, cakupanKpi } from "@/features/finance/invoiceTampilan.js";

// INVOICE PELANGGAN — sisi FINANCE dari invoice yang sudah ada.
//
// ⚠️ HALAMAN INI TIDAK MEMBUAT INVOICE. Invoice lahir OTOMATIS sebagai
// draft begitu order dibuat (sales tidak perlu langkah tambahan), dan
// isinya — item, harga, alamat, pengiriman ke customer lewat WA/PDF —
// tetap dikelola dari Rincian Pesanan di CRM. Yang dikerjakan di sini
// hanya pekerjaan yang memang milik finance: memastikan tagihan punya
// JATUH TEMPO, dan menindaklanjuti yang sudah lewat.
//
// Nominalnya DITURUNKAN dari sumber yang sama dengan invoice yang dikirim
// ke customer (services/invoice.js#hitungNominal) — bukan dihitung ulang.
//
// Tampilan (daftar, KPI, rincian, form jatuh tempo): features/finance/InvoicePanels.jsx + invoiceTampilan.js. File ini hanya memuat data
// dan menyambungkan tindakan; endpoint, filter server/lokal, dan penulisan jatuh tempo SAMA dengan sebelumnya.

export default function FinanceInvoices() {
  const [panelRincian, setPanelRincian] = useState(null); // invoice yang rinciannya terbuka (panel samping, klik baris)
  const [jatuhTempo, setJatuhTempo] = useState("");
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fSumber, setFSumber] = useState("");
  const [fSales, setFSales] = useState("");
  const [fTempo, setFTempo] = useState("");
  const searchTunda = useTertunda(search);
  const pernahMuat = useRef(false);
  // Respons permintaan LAMA yang terlambat tidak boleh menimpa pencarian/tab yang baru dipilih: hanya permintaan terakhir yang mengisi layar.
  const urutan = useRef(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [aturTempo, setAturTempo] = useState(null);

  // { diam: true } = muat ulang tanpa layar "memuat" supaya kolom cari tidak
  // hilang dan kursor tidak lepas. Argumen lain (mis. event onRetry) diabaikan.
  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    const saya = ++urutan.current;
    if (!diam) setLoading(true);
    setError(null);
    try {
      const hasil = await api.getFinanceInvoices({ jatuhTempo, search: searchTunda.trim() });
      if (saya !== urutan.current) return;
      setData(hasil);
    } catch (e) {
      if (saya !== urutan.current) return;
      if (diam) setPesan(e.message || "Gagal menyegarkan daftar");
      else setError(e.message || "Gagal memuat invoice");
    } finally {
      if (!diam && saya === urutan.current) setLoading(false);
    }
  }, [jatuhTempo, searchTunda]);

  useEffect(() => {
    muat({ diam: pernahMuat.current });
    pernahMuat.current = true;
  }, [muat]);

  async function simpanTempo(orderId, dueDate) {
    try {
      // Endpoint LAMA yang sudah dipakai CRM — tidak ada jalur tulis kedua
      // untuk kolom yang sama.
      await api.updateOrderInvoice(orderId, { dueDate: dueDate || null });
      setAturTempo(null);
      await muat({ diam: true });
    } catch (e) {
      setPesan(e.message);
    }
  }

  const semuaInvoice = data?.invoices || [];
  const kpi = kpiInvoice(data);

  // Pencarian (nomor/pelanggan) dikerjakan server; filter di panel hanya
  // menyaring baris yang sudah termuat.
  const opsiSales = useMemo(
    () => [...new Set(semuaInvoice.map((i) => i.salesName).filter(Boolean))].sort(),
    [semuaInvoice]
  );
  const filterLokal = { fStatus, fSumber, fSales, fTempo };
  const invoices = useMemo(() => filterInvoice(semuaInvoice, filterLokal), [semuaInvoice, fStatus, fSumber, fSales, fTempo]); // eslint-disable-line react-hooks/exhaustive-deps
  const disaringLokal = adaFilterLokal(filterLokal);
  const hasil = kalimatHasil({ tampil: invoices.length, termuat: semuaInvoice.length, terpotong: kpi.terpotong });
  const cakupan = cakupanKpi({ terpotong: kpi.terpotong, mencari: !!searchTunda.trim() });
  const aktif = jumlahFilterAktif({ q: search, fStatus, fSumber, fSales, fTempo, jatuhTempo });

  function aturUlangFilter() {
    setSearch(""); setFStatus(""); setFSumber(""); setFSales(""); setFTempo(""); setJatuhTempo("");
  }

  const filter = {
    status: { nilai: fStatus, ubah: setFStatus }, sales: { nilai: fSales, ubah: setFSales },
    sumber: { nilai: fSumber, ubah: setFSumber }, tempo: { nilai: fTempo, ubah: setFTempo },
  };
  const bukaAturTempo = (inv) => { setPanelRincian(null); setAturTempo(inv); };

  return (
    <HalamanFinance
      className="fin-halaman"
      title="Invoice pelanggan"
      subtitle="Tagihan ke pelanggan, sisa yang belum dibayar, dan jatuh tempo — posisi terkini."
      loading={loading}
      error={error}
      onRetry={muat}
    >
      <div className="fin-ring fin-inv">
        {pesan && (
          <div className="fin-inv-pesan" role="alert">
            <p>{pesan}</p>
            <button type="button" className="fin-tombol" onClick={() => setPesan(null)}><span>Tutup</span></button>
          </div>
        )}

        <StripInvoice />

        <section aria-label="Angka utama" className="fin-kpi-grid fin-inv-kpi-grid">
          <KpiStatis
            nada="biru" Ikon={IkDokumen} label="Invoice di daftar" nilai={kpi.jumlah.toLocaleString("id-ID")}
            ket="Sesuai pencarian dan tab jatuh tempo"
            info="Jumlah invoice yang ikut dalam hasil pencarian dan tab jatuh tempo yang aktif. Invoice gabungan dihitung satu, bukan per order anggotanya. Filter status, sales, sumber, dan tempo di panel bawah hanya menyaring tampilan dan tidak mengubah angka ini."
          />
          <KpiStatis
            nada="muda" Ikon={IkKoin} label="Sisa tagihan belum lunas" nilai={formatUang(kpi.sisaBelumLunas)}
            ket={cakupan.ket}
            info={`Total SISA tagihan dari invoice yang belum lunas dan tidak dibatalkan. Bukan total nilai invoice, dan bagian yang sudah dibayar tidak ikut dijumlahkan. Tidak terpengaruh filter status, sales, sumber, dan tempo di panel bawah. ${cakupan.info}`}
          />
          <KpiStatis
            nada="lavender" Ikon={IkTempoLewat} label="Lewat jatuh tempo" nilai={kpi.lewat.toLocaleString("id-ID")}
            penanda={kpi.lewat > 0 ? "Perlu ditindaklanjuti" : undefined}
            ket={kpi.terpotong ? "Dari 500 invoice terbaru" : "Tanggal tempo lewat, masih ada sisa"}
            info={`Invoice yang tanggal jatuh temponya sudah lewat tetapi masih ada sisa tagihan. Dasarnya hanya tanggal jatuh tempo invoice, bukan tanggal order. Pilih tab “Lewat jatuh tempo” untuk menyaring daftar. ${cakupan.info}`}
          />
          <KpiStatis
            nada="lime" Ikon={IkTempoBelum} label="Belum ada jatuh tempo" nilai={kpi.tanpaTempo.toLocaleString("id-ID")}
            ket={kpi.terpotong ? "Dari 500 invoice terbaru" : "Umur dihitung dari tanggal order"}
            info={`Invoice belum lunas yang belum pernah diatur tanggal jatuh temponya. Selama belum diatur, umur tagihan dihitung dari tanggal order dibuat — atur tanggal jatuh tempo yang sebenarnya lewat ikon kalender di barisnya. ${cakupan.info}`}
          />
        </section>

        <PeringatanManual jumlah={kpi.manual} />

        <section className="fin-panel fin-inv-panel" aria-label="Daftar invoice" data-testid="panel-daftar-invoice">
          <ToolbarInvoice
            tempo={jatuhTempo} setTempo={setJatuhTempo} kpi={kpi} q={search} setQ={setSearch} f={filter}
            opsiSales={opsiSales} hasil={hasil} aktif={aktif} onReset={aturUlangFilter}
          />
          <DaftarInvoice
            invoices={invoices} onBuka={setPanelRincian} onAturTempo={setAturTempo}
            kosongAwal={!disaringLokal && !jatuhTempo && !search.trim()} onReset={aturUlangFilter}
          />
        </section>
      </div>

      <FormJatuhTempo invoice={aturTempo} onClose={() => setAturTempo(null)} onSubmit={simpanTempo} />
      <RincianInvoice invoice={panelRincian} onClose={() => setPanelRincian(null)} onAturTempo={bukaAturTempo} />
    </HalamanFinance>
  );
}
