import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Loader2, ListChecks } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";
import { formatRupiah } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { toApiParams } from "@/lib/dateRange.js";

// AOV TIM — DUA metrik terpisah (Okt 2026): "AOV Order Masuk Tim" (order DIBUAT di periode) dan "AOV Order Lunas Tim" (order yang MENJADI LUNAS di periode, termasuk yang dibuat bulan lalu).
// SEMUA angka datang dari server (GET /analytics/sales-aov): pembilang dan penyebut tiap metrik dari SATU himpunan order, dan daftar drilldown (GET /analytics/sales-aov/orders) memakai himpunan yang sama —
// tidak ada penjumlahan atau pembagian di layar ini. Aturan cakupan Tim (Team Lead, tanpa atribusi, PKR, batal, nota kredit, refund) ditulis di backend/src/services/salesAov.js.
const UKURAN_HALAMAN = 30;
const NAMA_ATRIBUSI = { PEMILIK_ORDER: "Pemilik order", PERCAKAPAN: "Percakapan yang dipegang" };

export function useAovTim(range) {
  const dari = range?.from; const sampai = range?.to;
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let batal = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.getSalesAov(toApiParams({ from: dari, to: sampai }))
      .then((data) => { if (!batal) setState({ data, loading: false, error: null }); })
      .catch((err) => { if (!batal) setState({ data: null, loading: false, error: err.message || "Gagal memuat" }); });
    return () => { batal = true; };
  }, [dari, sampai]);
  return state;
}

function Angka({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-[11px] text-ink3">{label}</p>
      <p className="m-0 mt-0.5 break-words text-[14px] font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="m-0 text-[10.5px] text-ink3">{sub}</p>}
    </div>
  );
}

function KartuMetrik({ m, periode, onBuka, testid }) {
  return (
    <div className="flex flex-col gap-3 rounded-card bg-surface p-5 shadow-card" data-testid={testid}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <p className="m-0 text-[13px] font-medium text-ink3">{m.label}</p>
          <InfoTooltip text={`${m.ringkas} Rumus: ${m.rumus}. Tanggal acuan: ${m.tanggalAcuan}.`} />
        </span>
      </div>
      <p className="m-0 min-w-0 break-words text-[26px] font-extrabold leading-tight tabular-nums text-ink" data-testid={`${testid}-aov`}>
        {m.jumlahOrder > 0 ? formatRupiah(m.aov) : "—"}
      </p>
      <p className="m-0 text-[12px] leading-snug text-ink2">{m.ringkas}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3">
        <Angka label="Jumlah order" value={m.jumlahOrder.toLocaleString("id-ID")} />
        <Angka label="Total nilai bersih" value={formatRupiah(m.totalNilaiBersih)} sub={m.totalNotaKredit > 0 ? `nilai kotor ${formatRupiah(m.totalNilaiKotor)} − nota ${formatRupiah(m.totalNotaKredit)}` : undefined} />
      </div>
      <p className="m-0 text-[11px] text-ink3">Periode WIB: {periode.label}{periode.semuaWaktu ? "" : " (batas akhir = awal hari berikutnya)"}</p>
      <p className="m-0 text-[11px] text-ink3">Rumus: {m.rumus}.</p>
      {(m.orderRp0 > 0 || m.orderBernota > 0 || m.orderBerefund > 0 || m.orderLintasPeriode > 0) && (
        <p className="m-0 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink3">
          {m.orderRp0 > 0 && <span>{m.orderRp0} order Rp0 (tetap dihitung)</span>}
          {m.orderBernota > 0 && <span>{m.orderBernota} order bernota kredit</span>}
          {m.orderBerefund > 0 && <span>{m.orderBerefund} order berrefund</span>}
          {m.orderLintasPeriode > 0 && <span>{m.orderLintasPeriode} order dibuat sebelum periode ({formatRupiah(m.nilaiLintasPeriode)})</span>}
        </p>
      )}
      <button type="button" onClick={() => onBuka(m.metrik)} className="btn btn-ghost btn-sm mt-auto self-start" data-testid={`${testid}-buka`}>
        <ListChecks size={14} /> Lihat {m.jumlahOrder.toLocaleString("id-ID")} order
      </button>
    </div>
  );
}

export function KartuAovTim({ range }) {
  const { data, loading, error } = useAovTim(range);
  const [buka, setBuka] = useState(null); // "masuk" | "lunas"
  if (loading && !data) return <div className="flex items-center gap-2 rounded-card bg-surface p-5 text-[13px] text-ink3 shadow-card"><Loader2 size={16} className="animate-spin" /> Memuat AOV Tim…</div>;
  if (error || !data) return <p className="m-0 rounded-card bg-surface p-5 text-[12.5px] text-red shadow-card">Gagal memuat AOV Tim: {error}</p>;
  const { masuk, lunas, periode } = data;
  return (
    <section className="flex flex-col gap-3" aria-label="AOV Tim" data-testid="aov-tim">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <KartuMetrik m={masuk} periode={periode} onBuka={setBuka} testid="aov-masuk" />
        <KartuMetrik m={lunas} periode={periode} onBuka={setBuka} testid="aov-lunas" />
      </div>
      <details className="rounded-card bg-surface p-4 text-[12px] leading-relaxed text-ink2 shadow-card" data-testid="aov-catatan">
        <summary className="cursor-pointer text-[12.5px] font-semibold text-ink">Cakupan Tim &amp; selisih terhadap angka lain</summary>
        <ul className="m-0 mt-2 list-disc pl-5">
          {data.catatan.map((c) => <li key={c}>{c}</li>)}
          <li>Tim saat ini: {data.tim.jumlahAnggota} akun ({data.tim.anggota.map((a) => a.nama + (a.teamLead ? " — Team Lead" : "")).join(", ")}).</li>
        </ul>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] text-[12px]">
            <thead><tr className="border-b border-line text-left text-[11px] text-ink3"><th className="pb-1.5 pr-2 font-medium">Dikecualikan dari Tim</th><th className="pb-1.5 pr-2 text-right font-medium">Masuk</th><th className="pb-1.5 text-right font-medium">Lunas</th></tr></thead>
            <tbody>
              {[
                ["Tanpa atribusi Sales", (m) => `${m.diagnosa.tanpaAtribusi.jumlahOrder} order · ${formatRupiah(m.diagnosa.tanpaAtribusi.totalNilaiBersih)}`],
                ["Pemilik di luar Tim (mis. Sales nonaktif)", (m) => `${m.diagnosa.pemilikLuarTim.jumlahOrder} order · ${formatRupiah(m.diagnosa.pemilikLuarTim.totalNilaiBersih)}`],
                ["Order Penjualan Karyawan (PKR)", (m) => `${m.diagnosa.pkrDikecualikan} order`],
                ["Dibatalkan / Menunggu / Spam", (m) => `${m.diagnosa.dibatalkanDikecualikan} / ${m.diagnosa.menungguDikecualikan} / ${m.diagnosa.spamDikecualikan} order`],
                ["AOV seluruh perusahaan (pembanding)", (m) => `${m.pembandingPerusahaan.jumlahOrder} order · AOV ${formatRupiah(m.pembandingPerusahaan.aov)}`],
              ].map(([nama, f]) => (
                <tr key={nama} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-2">{nama}</td><td className="py-1.5 pr-2 text-right tabular-nums">{f(masuk)}</td><td className="py-1.5 text-right tabular-nums">{f(lunas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 mt-2 text-[11.5px] text-ink3">
          Dashboard dan Ringkasan Laporan menampilkan AOV <strong>seluruh perusahaan</strong> untuk order yang <strong>dibuat</strong> di periode (sama dengan baris “AOV seluruh perusahaan” kolom Masuk).
          Laporan Sales per orang menjumlahkan per Sales, jadi order yang percakapannya dipegang dua anggota Tim terhitung di keduanya; kartu di atas menghitung tiap order satu kali.
        </p>
      </details>
      <DaftarAovModal metrik={buka} range={range} data={data} onClose={() => setBuka(null)} />
    </section>
  );
}

function DaftarAovModal({ metrik, range, data, onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(""); const [qTunda, setQTunda] = useState("");
  const [state, setState] = useState({ orders: [], total: 0, ringkasan: null, ringkasanTersaring: null, hasMore: false, loading: false, error: null });
  useEffect(() => { const t = setTimeout(() => setQTunda(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!metrik) { setQ(""); setQTunda(""); } }, [metrik]);
  const dari = range?.from; const sampai = range?.to;
  const muat = useCallback(async (offset, tambah) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await api.getSalesAovOrders({ ...toApiParams({ from: dari, to: sampai }), metrik, q: qTunda || undefined, limit: UKURAN_HALAMAN, offset });
      setState((s) => ({ orders: tambah ? [...s.orders, ...r.orders] : r.orders, total: r.total, ringkasan: r.ringkasan, ringkasanTersaring: r.ringkasanTersaring, hasMore: r.hasMore, loading: false, error: null }));
    } catch (err) { setState((s) => ({ ...s, loading: false, error: err.message || "Gagal memuat" })); }
  }, [dari, sampai, metrik, qTunda]);
  useEffect(() => { if (metrik) muat(0, false); }, [metrik, muat]);
  const m = metrik ? data[metrik] : null;
  const lunas = metrik === "lunas";
  return (
    <Modal open={!!metrik} onOpenChange={(o) => { if (!o) onClose(); }} title={m ? `Daftar order — ${m.label}` : ""} description={m ? `${m.rumus}. Periode WIB ${data.periode.label}.` : ""} className="w-[860px] max-w-[96vw]">
      {m && (
        <div data-testid="aov-daftar">
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-btn bg-inset px-3 py-2 sm:grid-cols-4">
            <Angka label="Jumlah order" value={(state.ringkasan?.jumlahOrder ?? m.jumlahOrder).toLocaleString("id-ID")} />
            <Angka label="Total nilai bersih" value={formatRupiah(state.ringkasan?.totalNilaiBersih ?? m.totalNilaiBersih)} />
            <Angka label="AOV" value={formatRupiah(state.ringkasan?.aov ?? m.aov)} />
            <Angka label="Cocok dengan kartu" value={state.ringkasan && state.ringkasan.jumlahOrder === m.jumlahOrder && state.ringkasan.totalNilaiBersih === m.totalNilaiBersih ? "Ya" : state.ringkasan ? "Tidak — muat ulang" : "…"} />
          </div>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nomor order, pelanggan, atau Sales…" aria-label="Cari order" className="mb-2 w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink" data-testid="aov-cari" />
          <p className="m-0 mb-2 text-[11.5px] text-ink3" data-testid="aov-hasil">
            Menampilkan {state.orders.length.toLocaleString("id-ID")} dari {state.total.toLocaleString("id-ID")} order
            {state.ringkasanTersaring ? ` (hasil pencarian: total ${formatRupiah(state.ringkasanTersaring.totalNilaiBersih)})` : ""}
          </p>
          {state.error && <p className="py-4 text-center text-[12.5px] text-red">Gagal memuat: {state.error}</p>}
          <div className="max-h-[52vh] overflow-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink3">
                  <th className="pb-2 pr-2 font-medium">Order</th><th className="pb-2 pr-2 font-medium">Pelanggan</th><th className="pb-2 pr-2 font-medium">Sales</th>
                  <th className="pb-2 pr-2 font-medium">Dibuat</th>{lunas && <th className="pb-2 pr-2 font-medium">Lunas</th>}
                  <th className="pb-2 text-right font-medium">Nilai bersih</th>
                </tr>
              </thead>
              <tbody>
                {state.orders.map((o) => (
                  <tr key={o.id} className="border-b border-line last:border-0" data-testid="aov-baris">
                    <td className="py-2 pr-2 text-ink2">
                      {o.orderNumber || "—"}
                      {o.rp0 && <span className="ml-1.5 rounded-full bg-inset px-1.5 py-0.5 text-[10px] font-medium text-ink3">Rp0</span>}
                    </td>
                    <td className="py-2 pr-2 text-ink2">
                      <button type="button" onClick={() => navigate(`/customers?id=${o.customerId}`)} className="inline-flex items-center gap-1 text-left hover:text-accent hover:underline">{o.customerName || "—"} <ExternalLink size={10} /></button>
                    </td>
                    <td className="py-2 pr-2 text-ink2" title={NAMA_ATRIBUSI[o.atribusi]}>{o.sales || "—"}</td>
                    <td className="py-2 pr-2 tabular-nums text-ink3">{formatTanggalPendek(o.tanggalDibuat)}</td>
                    {lunas && (
                      <td className="py-2 pr-2 tabular-nums text-ink3">
                        {formatTanggalPendek(o.tanggalLunas)}
                        {o.lintasPeriode && <span className="ml-1.5 rounded-full bg-orangebg px-1.5 py-0.5 text-[10px] font-medium text-orange" title={`Dibuat ${formatTanggalPendek(o.tanggalDibuat)} — sebelum periode`}>lintas periode</span>}
                      </td>
                    )}
                    <td className="py-2 text-right font-semibold tabular-nums text-ink">
                      {formatRupiah(o.nilaiBersih)}
                      {o.notaKredit > 0 && <span className="mt-0.5 block text-[10.5px] font-medium text-ink3">kotor {formatRupiah(o.nilaiKotor)} − nota {formatRupiah(o.notaKredit)}</span>}
                      {o.refundAktif > 0 && <span className="mt-0.5 block text-[10.5px] font-medium text-orange">refund {formatRupiah(o.refundAktif)}</span>}
                    </td>
                  </tr>
                ))}
                {!state.loading && state.orders.length === 0 && !state.error && (
                  <tr><td colSpan={lunas ? 6 : 5} className="py-8 text-center text-[12.5px] text-ink3">Tidak ada order pada periode ini.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-center">
            {state.loading ? <span className="flex items-center gap-2 text-[12.5px] text-ink3"><Loader2 size={14} className="animate-spin" /> Memuat…</span>
              : state.hasMore ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => muat(state.orders.length, true)} data-testid="aov-muat-lagi">Muat lagi ({(state.total - state.orders.length).toLocaleString("id-ID")} order tersisa)</button> : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default KartuAovTim;
