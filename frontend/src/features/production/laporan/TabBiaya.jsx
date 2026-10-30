import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Card } from "@/components/ui/card.jsx";
import { BadgeBiaya, DasarTanggal, Galat, Info, Memuat, PanelLanjut, Paginasi, selectCls, useMuat } from "./parts.jsx";
import { LABEL_ALASAN_LINGKUP, LABEL_STATUS_BAHAN, angka, daftarMasalah, jumlahFilterLanjut, rupiah, rupiahDiketahui, tautanLengkapi, tglPendek } from "./laporanModel.js";

// Nilai order/unit diketahui bila minimal satu baris pemakaian DIBEKUKAN; selain itu "Belum diketahui" (bukan Rp 0).
const unitAdaNilai = (u) => u.bahan.some((b) => b.termasukHpp);
// Pemakaian tampil positif (jumlah yang dipakai); pengembalian bertanda minus (mengurangi); koreksi/susut mengikuti arah stok.
const tandaJumlah = (b) => (b.jenis === "PEMAKAIAN" || b.jenis === "SUSUT" ? "" : b.jenis === "PENGEMBALIAN" ? "−" : b.arah === "MASUK" ? "+" : "−");
const LABEL_BUKTI = { BELUM_DIDUKUNG_BUKTI: "belum didukung bukti", ADA_CATATAN_BUKTI: "ada catatan bukti (belum diverifikasi Finance)" };

const PAGE_SIZE = 25;
// Tindakan Lengkapi tersedia bila order punya masalah atau belum punya pemakaian bahan sama sekali.
const perluLengkapi = (o) => o.jumlahMasalah > 0 || o.barisPemakaian === 0;

export default function TabBiaya({ qs, meta, filters, onFilters, page, onPage }) {
  const navigate = useNavigate();
  const lengkapi = (e, o) => { e.stopPropagation(); navigate(tautanLengkapi(o.orderNumber)); };
  const [buka, setBuka] = useState(null); // orderId yang rinciannya dibuka
  const k = `${qs}&page=${page}&pageSize=${PAGE_SIZE}`;
  const { data: d, loading, error } = useMuat(() => api.getLaporan("biaya-order", k), `b:${k}`);
  const set = (key) => (e) => { onFilters({ ...filters, [key]: e.target.value }); onPage(1); };
  const def = (key) => meta?.definisi?.find((x) => x.key === key);
  return (
    <div className="min-w-0 space-y-3" data-testid="tab-biaya">
      <div className="flex flex-wrap items-end gap-2">
        <label className="relative min-w-[200px] flex-1 text-[11px] font-medium text-ink3">Cari order, pelanggan, atau unit
          <Search size={14} className="absolute left-2.5 top-[27px] text-ink3" aria-hidden />
          <input className={`${selectCls} mt-0.5 pl-8`} value={filters.qOrder} onChange={set("qOrder")} placeholder="mis. RES-… atau nama" data-testid="cari-order" />
        </label>
        <label className="min-w-[150px] text-[11px] font-medium text-ink3">Status biaya
          <select className={`${selectCls} mt-0.5`} value={filters.status} onChange={set("status")} data-testid="filter-status">
            <option value="">Semua</option>{meta?.statusBiaya?.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="min-w-[180px] text-[11px] font-medium text-ink3">Masalah
          <select className={`${selectCls} mt-0.5`} value={filters.masalah} onChange={set("masalah")} data-testid="filter-masalah">
            <option value="">Semua</option><option value="ada">Ada masalah (apa saja)</option>
            {Object.entries(meta?.masalah ?? {}).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
          </select>
        </label>
      </div>
      <PanelLanjut jumlah={jumlahFilterLanjut({ ...filters, status: "", masalah: "" })}>
        <label className="text-[11px] font-medium text-ink3">Urutkan
          <select className={`${selectCls} mt-0.5`} value={filters.urut} onChange={set("urut")} data-testid="filter-urut">
            <option value="masalah">Masalah terbanyak</option><option value="nilai">HPP diketahui terbesar</option><option value="order">Nomor order terbaru</option><option value="terlama">Pemakaian terlama</option>
          </select>
        </label>
        <label className="text-[11px] font-medium text-ink3">Alasan masuk lingkup
          <select className={`${selectCls} mt-0.5`} value={filters.alasan} onChange={set("alasan")} data-testid="filter-alasan">
            <option value="">Semua</option><option value="TANPA_PEMAKAIAN">Tanpa pemakaian bahan</option>
            {Object.entries(meta?.alasanLingkup ?? {}).map(([key, v]) => <option key={key} value={key}>{v}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pt-5 text-[12.5px] text-ink2"><input type="checkbox" checked={!!filters.hanyaPemakaian} onChange={(e) => { onFilters({ ...filters, hanyaPemakaian: e.target.checked }); onPage(1); }} data-testid="filter-hanya-pemakaian" />
          Hanya order yang punya pemakaian bahan pada periode</label>
      </PanelLanjut>

      <Galat pesan={error} />
      {!d ? <Memuat tampil={loading} /> : (
        <div className={`min-w-0 space-y-3 ${loading ? "opacity-60" : ""}`}>
          <p className="m-0 text-[12.5px] text-ink2" data-testid="ringkas-biaya">
            <b className="tabular-nums">{angka(d.ringkas.order)}</b> order · <b className="tabular-nums">{angka(d.ringkas.unit)}</b> unit · <b className="tabular-nums">{angka(d.ringkas.barisPemakaian)}</b> baris pemakaian
            {" "}({angka(d.ringkas.orderDenganPemakaian)} dengan pemakaian · <span data-testid="jml-tanpa-pemakaian">{angka(d.ringkas.orderTanpaPemakaian)}</span> tanpa pemakaian)
            {d.izinHarga && <> · HPP Bahan diketahui <b className="tabular-nums" data-testid="total-hpp">{rupiah(d.ringkas.nilaiDiketahui)}</b>{d.ringkas.nilaiGuard ? <span className="text-ink3" data-testid="total-guard"> (termasuk SANO GUARD {rupiah(d.ringkas.nilaiGuard)}: biaya perakitan belum tersedia)</span> : null}</>}
            {" "}· {angka(d.ringkas.perStatus.LENGKAP)} Lengkap · {angka(d.ringkas.perStatus.PARSIAL)} Parsial · {angka(d.ringkas.perStatus.BELUM_DIKETAHUI)} Belum diketahui
            <Info text={`${def("hpp_diketahui")?.formula ?? ""} ${def("status_biaya")?.formula ?? ""}`} />
          </p>
          {d.rows.length === 0 && <Card className="p-4 text-[13px] text-ink3" data-testid="kosong-biaya">Tidak ada order pada periode dan filter ini.</Card>}

          {d.rows.length > 0 && (
            <>
              <div className="hidden min-w-0 overflow-x-auto rounded-card bg-surface md:block" data-testid="tabel-biaya">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink3">
                    <th className="px-3 py-2">Order</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2 text-right">Baris pemakaian</th>{d.izinHarga && <th className="px-3 py-2 text-right">HPP Bahan diketahui</th>}<th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Masalah</th><th className="px-3 py-2"><span className="sr-only">Tindakan</span></th>
                  </tr></thead>
                  <tbody>
                    {d.rows.map((o) => (
                      <tr key={o.orderId} className="cursor-pointer border-b border-line/60 hover:bg-hovertint" onClick={() => setBuka(o.orderId)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setBuka(o.orderId); }} data-testid={`baris-${o.orderNumber}`} role="button" aria-label={`Rincian bahan order ${o.orderNumber}`}>
                        <td className="px-3 py-2"><b>{o.orderNumber}</b><span className="block text-[11.5px] text-ink3">{o.pelanggan ?? "—"} · {o.alasanLingkup.map((a) => LABEL_ALASAN_LINGKUP[a] ?? a).join(", ")}</span></td>
                        <td className="px-3 py-2 tabular-nums">{o.unitDikerjakan}/{o.unitDalamOrder}<span className="block text-[11px] text-ink3">dikerjakan/total</span></td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.barisPemakaian ? angka(o.barisPemakaian) : <span className="text-ink3">belum ada</span>}</td>
                        {d.izinHarga && <td className="px-3 py-2 text-right font-semibold tabular-nums">{o.status === "BELUM_DIKETAHUI" ? "—" : rupiah(o.nilaiDiketahui)}{o.nilaiGuard ? <span className="block text-[10.5px] font-normal text-orange">termasuk SANO GUARD</span> : null}</td>}
                        <td className="px-3 py-2"><BadgeBiaya status={o.status} label={o.statusLabel} /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.jumlahMasalah > 0 ? <Badge variant="warning">{o.jumlahMasalah}</Badge> : "—"}</td>
                        <td className="px-3 py-2 text-right">{perluLengkapi(o) && <Button size="sm" variant="secondary" className="min-h-[32px]" onClick={(e) => lengkapi(e, o)} data-testid={`lengkapi-${o.orderNumber}`}>Lengkapi</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="m-0 list-none space-y-2 p-0 md:hidden" data-testid="kartu-biaya">
                {d.rows.map((o) => (
                  <li key={o.orderId}>
                    <button type="button" onClick={() => setBuka(o.orderId)} data-testid={`kartu-${o.orderNumber}`} className="w-full min-w-0 cursor-pointer rounded-card border-0 bg-surface p-3 text-left">
                      <span className="flex items-start justify-between gap-2"><b className="min-w-0 break-words text-[13.5px]">{o.orderNumber}</b><BadgeBiaya status={o.status} label={o.statusLabel} /></span>
                      <span className="mt-0.5 block break-words text-[11.5px] text-ink3">{o.pelanggan ?? "—"}</span>
                      <span className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] text-ink2">
                        <span>Unit {o.unitDikerjakan}/{o.unitDalamOrder}</span><span>{o.barisPemakaian ? `Pemakaian ${angka(o.barisPemakaian)}` : "Belum ada pemakaian"}</span>
                        {d.izinHarga && <span className="font-semibold">{o.status === "BELUM_DIKETAHUI" ? "HPP —" : `HPP ${rupiah(o.nilaiDiketahui)}`}</span>}<span>{o.jumlahMasalah > 0 ? `${o.jumlahMasalah} masalah` : "Tanpa masalah"}</span>
                      </span>
                    </button>
                    {perluLengkapi(o) && <Button size="sm" variant="secondary" className="mt-1.5 min-h-[36px] w-full" onClick={(e) => lengkapi(e, o)} data-testid={`lengkapi-${o.orderNumber}`}>Lengkapi di Order Produksi</Button>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <Paginasi page={d.page} pageSize={d.pageSize} total={d.total} onPage={onPage} />
          <DasarTanggal teks={d.dasarTanggal} />
          <p className="m-0 text-[11.5px] text-ink3">Cakupan: {angka(d.cakupan.unitNonBatal)} unit non-batal · {angka(d.cakupan.orderRelevan)} order dalam lingkup periode. Nilai kosong (—) = belum diketahui, bukan Rp 0. Pemakaian lama tidak dihitung dengan harga terbaru.</p>
          <DasarTanggal testid="dasar-lingkup" teks={`lingkup order — ${d.dasarLingkup}`} />
        </div>
      )}
      {buka && <RincianOrder orderId={buka} qs={qs} meta={meta} onTutup={() => setBuka(null)} />}
    </div>
  );
}

function RincianOrder({ orderId, qs, meta, onTutup }) {
  const navigate = useNavigate();
  const { data: d, error } = useMuat(() => api.getLaporanOrder(orderId, qs), `o:${orderId}:${qs}`);
  return (
    <Modal open onOpenChange={(o) => { if (!o) onTutup(); }} title={d ? `Rincian bahan — ${d.orderNumber}` : "Rincian bahan"} className="w-[min(1000px,96vw)]">
      <div className="min-w-0 space-y-4" data-testid="rincian-order">
        <Galat pesan={error} />
        {!d && !error && <Memuat tampil />}
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <BadgeBiaya status={d.status} label={d.statusLabel} />
              <span>{d.pelanggan}</span>
              {d.izinHarga && <span>HPP Bahan diketahui <b className="tabular-nums" data-testid="rincian-total">{d.status === "BELUM_DIKETAHUI" ? "Belum diketahui" : rupiah(d.total.nilaiDiketahui)}</b>{d.total.nilaiGuard ? <span className="text-ink3"> · termasuk SANO GUARD {rupiah(d.total.nilaiGuard)}</span> : null}</span>}
              {d.izinHarga && d.total.susut ? <span className="text-ink3">Susut (terpisah) {rupiah(d.total.susut)}</span> : null}
              <span className="text-ink3">{angka(d.total.barisPemakaian)} baris pemakaian · periode {tglPendek(d.periode.from)}–{tglPendek(d.periode.to)}</span>
              {(d.jumlahMasalah > 0 || d.total.barisPemakaian === 0) && <Button size="sm" variant="secondary" className="min-h-[32px]" onClick={() => navigate(tautanLengkapi(d.orderNumber))} data-testid="rincian-lengkapi">Lengkapi di Order Produksi</Button>}
            </div>
            {daftarMasalah(d.masalah, meta?.masalah).length > 0 && (
              <Card className="p-3" data-testid="rincian-masalah">
                <h3 className="m-0 text-[13px] font-bold text-ink">Perlu ditindaklanjuti ({d.jumlahMasalah})</h3>
                <ul className="m-0 mt-1.5 list-none space-y-1 p-0 text-[12.5px]">
                  {daftarMasalah(d.masalah, meta?.masalah).map((m) => <li key={m.key}><b className="tabular-nums">{m.n}</b> {m.label}<span className="block text-[11.5px] text-ink3">→ {m.aksi}</span></li>)}
                </ul>
              </Card>
            )}
            {d.catatanGuard && <p className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="catatan-guard">{d.catatanGuard}</p>}
            {d.unit.map((u) => (
              <section key={u.unitId} className="min-w-0" data-testid={`unit-${u.unitCode}`}>
                <h3 className="m-0 flex flex-wrap items-baseline gap-x-3 text-[13.5px] font-bold text-ink">{u.unitCode}
                  <span className="text-[11.5px] font-normal text-ink3">{u.ringkas.barisPemakaian} baris{d.izinHarga ? ` · ${rupiahDiketahui(u.ringkas.nilaiDiketahui, unitAdaNilai(u))}` : ""}{u.pernyataanTanpaBahan ? " · dinyatakan tanpa bahan baru" : ""}</span></h3>
                {u.bahan.length === 0 ? <p className="m-0 mt-1 text-[12.5px] text-ink3">Tidak ada pemakaian bahan pada periode ini{u.kelengkapan.includes("BAHAN_BELUM_DICATAT") ? " — bahan belum dicatat" : ""}.</p> : (
                  <div className="mt-1.5 min-w-0 overflow-x-auto rounded-card bg-surface">
                    <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
                      <thead><tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-ink3">
                        <th className="px-2.5 py-1.5">Bahan</th><th className="px-2.5 py-1.5 text-right">Jumlah</th>{d.izinHarga && <><th className="px-2.5 py-1.5 text-right">Harga</th><th className="px-2.5 py-1.5 text-right">Subtotal</th></>}
                        <th className="px-2.5 py-1.5">Tgl pemakaian</th><th className="px-2.5 py-1.5">Harga sejak</th><th className="px-2.5 py-1.5">Status · sumber</th>
                      </tr></thead>
                      <tbody>
                        {u.bahan.map((b) => (
                          <tr key={b.movementId} className="border-b border-line/60 align-top" data-testid={`bahan-${b.kode}-${b.jenis}`}>
                            <td className="px-2.5 py-1.5"><b>{b.bahan}</b><span className="block text-[11px] text-ink3">{b.kode} · {b.jenis}</span>{b.guard && <span className="mt-0.5 inline-block rounded-chip bg-orangebg px-1.5 text-[10.5px] font-semibold text-orange" data-testid="tanda-guard">SANO GUARD · perakitan belum tersedia</span>}</td>
                            <td className="px-2.5 py-1.5 text-right tabular-nums">{tandaJumlah(b)}{angka(b.qty)} {b.satuan}</td>
                            {d.izinHarga && <><td className="px-2.5 py-1.5 text-right tabular-nums">{b.harga == null ? "—" : rupiah(b.harga)}</td><td className="px-2.5 py-1.5 text-right font-semibold tabular-nums">{b.subtotal == null ? "—" : rupiah(b.subtotal)}</td></>}
                            <td className="px-2.5 py-1.5 tabular-nums">{tglPendek(b.tanggalPemakaian)}<span className="block text-[10.5px] text-ink3">{b.dasarTanggal === "DILAPORKAN" ? "dilaporkan (pembetulan)" : b.dasarTanggal === "CATATAN_HISTORIS" ? "catatan historis" : "hari pencatatan"}</span></td>
                            <td className="px-2.5 py-1.5 tabular-nums">{b.tanggalDasarHarga ? tglPendek(b.tanggalDasarHarga) : "—"}</td>
                            <td className="px-2.5 py-1.5">{LABEL_STATUS_BAHAN[b.status] ?? b.status}{b.sumberHarga && <span className="block text-[10.5px] text-ink3">{b.sumberHarga === "PENERAPAN_DISETUJUI" ? "penerapan disetujui" : "dibekukan saat posting"}{b.labelBukti ? ` · ${LABEL_BUKTI[b.labelBukti] ?? b.labelBukti}` : ""}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
            {d.catatanFinance && <p className="m-0 text-[11.5px] text-ink3" data-testid="catatan-finance">{d.catatanFinance}</p>}
            <DasarTanggal teks={d.dasarTanggal} />
          </>
        )}
      </div>
    </Modal>
  );
}
