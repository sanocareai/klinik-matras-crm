import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw, Loader2, Upload, AlertTriangle, Search } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TableSkeletonRows } from "@/components/ui/table.jsx";
import {
  LABEL_REFERENSI, STATUS_REFERENSI, ANTREAN_REFERENSI, JENIS_REFERENSI, bolehImpor, teksSumber, teksJumlah, teksTanggal, teksPerBulan, KETERANGAN_BULAN, TEKS_T0, teksDokumenResmi, TEKS_GERBANG_IMPOR, TEKS_GERBANG_OPERASIONAL, TEKS_SEGARKAN,
} from "../riwayatReferensiLogic.js";

function pengguna() {
  try { return JSON.parse(localStorage.getItem("user")) || {}; } catch { return {}; }
}
const bacaBerkas = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Berkas tidak terbaca")); r.readAsText(file, "utf-8"); });

const FILTER = [
  { key: "semua", label: "Semua referensi", params: {} },
  { key: "antrean", label: "Antrean penyelesaian", params: { antrean: "ADA" } },
  { key: "periksa", label: "Penerimaan perlu pemeriksaan", params: { status: "PERLU_PEMERIKSAAN" } },
  { key: "resmi", label: "Sudah ada di resmi", params: { status: "SUDAH_ADA_DI_RESMI" } },
  { key: "belum", label: "Belum diverifikasi", params: { status: "BELUM_DIVERIFIKASI" } },
];

function PanelImpor({ onSelesai }) {
  const [pakai, setPakai] = useState(null); const [beli, setBeli] = useState(null); const [mulai, setMulai] = useState("");
  const [alias, setAlias] = useState(""); const [pv, setPv] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const [hasil, setHasil] = useState(null);

  function bodi() {
    const a = {};
    for (const baris of alias.split("\n")) { const [n, k] = baris.split("="); if (n?.trim() && k?.trim()) a[n.trim()] = k.trim(); }
    return { ...(pakai ? { pakaiCsv: pakai.teks, namaBerkasPakai: pakai.nama } : {}), ...(beli ? { beliCsv: beli.teks, namaBerkasBeli: beli.nama } : {}), alias: a, ...(mulai ? { mulai: new Date(mulai).toISOString() } : {}) };
  }
  async function pilih(e, set) { const f = e.target.files?.[0]; if (!f) return; try { set({ nama: f.name, teks: await bacaBerkas(f) }); setPv(null); setHasil(null); } catch (x) { setErr(x.message); } }
  async function pratinjau() {
    setBusy(true); setErr(""); setHasil(null);
    try { setPv(await api.pratinjauRiwayatReferensi(bodi())); } catch (x) { setErr(x.message); setPv(null); } finally { setBusy(false); }
  }
  async function simpan() {
    if (!pv) return; setBusy(true); setErr("");
    try { const h = await api.imporRiwayatReferensi({ ...bodi(), konfirmasiHash: pv.hashKonten }); setHasil(h); setPv(null); onSelesai(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <Card className="p-4" data-testid="panel-impor-referensi">
      <p className="text-[13px] font-bold text-ink">Impor catatan referensi dari file</p>
      <p className="mt-0.5 text-[11.5px] text-ink3">Menyimpan <b>catatan referensi</b> saja. Tidak membuat movement, saldo, GR, Material Issue, adjustment, atau jurnal. Selalu pratinjau dulu.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-[12px] text-ink2">Rekap Pemakaian Bahan (CSV)
          <input type="file" accept=".csv,text/csv" onChange={(e) => pilih(e, setPakai)} className="mt-1 block w-full text-[12px]" data-testid="berkas-pemakaian" /></label>
        <label className="text-[12px] text-ink2">Data Pembelian Supplier (CSV, opsional)
          <input type="file" accept=".csv,text/csv" onChange={(e) => pilih(e, setBeli)} className="mt-1 block w-full text-[12px]" data-testid="berkas-pembelian" /></label>
        <label className="text-[12px] text-ink2">T0 (opsional; hanya peringatan, bukan syarat impor)
          <input type="datetime-local" value={mulai} onChange={(e) => { setMulai(e.target.value); setPv(null); }} className="mt-1 block w-full rounded-btn border border-border bg-surface px-2 py-1 text-[12px]" /></label>
        <label className="text-[12px] text-ink2">Alias keputusan manusia (satu per baris: NAMA DI FILE=KODE-MATERIAL)
          <textarea value={alias} onChange={(e) => { setAlias(e.target.value); setPv(null); }} rows={2} className="mt-1 block w-full rounded-btn border border-border bg-surface px-2 py-1 text-[12px]" /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={pratinjau} disabled={busy || (!pakai && !beli)} data-testid="btn-pratinjau-referensi">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Pratinjau
        </Button>
        {pv && <Button size="sm" onClick={simpan} disabled={busy} data-testid="btn-simpan-referensi"><Upload size={14} /> Simpan sebagai catatan referensi</Button>}
      </div>
      {err && <p className="mt-2 text-[12px] text-red" data-testid="galat-referensi">{err}</p>}
      {pv && (
        <div className="mt-3 rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5 text-[12px] text-ink2" data-testid="hasil-pratinjau-referensi">
          <p className="font-bold text-ink">Pratinjau (belum disimpan)</p>
          <p>{pv.ringkasan.baris} baris: {pv.ringkasan.pemakaianOrderBahan} pemakaian order+bahan, {pv.ringkasan.penerimaanTerbuktiTanpaGR} penerimaan terbukti tiba. Estimasi dilewati: {pv.ringkasan.estimasiDilewati}. {TEKS_T0}</p>
          <p>Tanggal order per bulan: {teksPerBulan(pv.ringkasan.perBulanTanggalOrder) || "—"}. <i>{KETERANGAN_BULAN}</i></p>
          <p>Status: {Object.entries(pv.ringkasan.status).map(([k, v]) => `${STATUS_REFERENSI[k]?.label || k} ${v}`).join(" · ")}</p>
          <p data-testid="antrean-pratinjau">Antrean penyelesaian ({pv.ringkasan.jumlahAntrean} baris): {Object.keys(pv.ringkasan.antrean).length ? Object.entries(pv.ringkasan.antrean).map(([k, v]) => `${ANTREAN_REFERENSI[k] || k} ${v}`).join(" · ") : "kosong"}</p>
          <p>Cakupan tanggal order: {pv.ringkasan.cakupan.tanggalOrderDari || "—"} s/d {pv.ringkasan.cakupan.tanggalOrderSampai || "—"}. Tanggal pemakaian: {pv.ringkasan.tanggalPemakaian}.</p>
        </div>
      )}
      {hasil && <p className="mt-3 text-[12px] text-green" data-testid="hasil-impor-referensi">Tersimpan: {hasil.baru} baru, {hasil.direvisi} revisi, {hasil.dilewati} dilewati (sudah sama). {hasil.catatan}</p>}
    </Card>
  );
}

export default function RiwayatReferensiTab() {
  const [ringkasan, setRingkasan] = useState(null); const [baris, setBaris] = useState([]); const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("semua"); const [q, setQ] = useState(""); const [loading, setLoading] = useState(true); const [err, setErr] = useState(""); const [buka, setBuka] = useState(null);
  const [laman, setLaman] = useState(0); const [impor, setImpor] = useState(false); const [catatSegar, setCatatSegar] = useState(""); const [sedangSegar, setSedangSegar] = useState(false);
  const boleh = useMemo(() => bolehImpor(pengguna().roles || (pengguna().role ? [pengguna().role] : [])), []);
  const params = FILTER.find((f) => f.key === filter)?.params || {};

  const muat = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [r, l] = await Promise.all([api.getRiwayatReferensiRingkasan(), api.getRiwayatReferensi({ ...params, ...(q.trim() ? { q: q.trim() } : {}), limit: 50, offset: laman * 50 })]);
      setRingkasan(r); setBaris(l.baris); setTotal(l.total);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [filter, q, laman]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { muat(); }, [muat]);
  // Membuka tab = HANYA GET (baca-saja). Menyimpan snapshot status sebagai revisi adalah tindakan MANUAL pemegang izin tulis.
  async function simpanSnapshot() {
    if (!window.confirm("Simpan snapshot status sebagai revisi baru pada catatan referensi? Ini menulis catatan referensi + audit (bukan transaksi, tidak mengubah saldo).")) return;
    setSedangSegar(true); setErr("");
    try { const h = await api.segarkanRiwayatReferensi(); setCatatSegar(h.direvisi > 0 ? `${h.direvisi} catatan disimpan sebagai revisi baru (riwayat lama tetap tersimpan).` : "Tidak ada perubahan status yang perlu disimpan."); await muat(); } catch (e) { setErr(e.message); } finally { setSedangSegar(false); }
  }

  return (
    <div className="space-y-3" data-testid="tab-riwayat-referensi">
      <div className="flex items-start gap-2 rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5" data-testid="label-referensi">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange" />
        <div className="text-[12px] text-ink2"><p className="font-bold text-ink">{LABEL_REFERENSI}</p>
          <p>{TEKS_SEGARKAN}</p>
          <p>Angka di sini berasal dari file Gudang dan tidak mengubah saldo. Saldo resmi = ledger (GR, Material Issue, Stock Count, Adjustment). Barang yang terbukti tiba tetapi belum ada GR adalah catatan pemeriksaan, bukan stok masuk.</p></div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" data-testid="gerbang-terpisah">
        <div className="rounded-btn border-l-[3px] border-green bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="gerbang-impor"><p>{TEKS_GERBANG_IMPOR}</p></div>
        <div className="rounded-btn border-l-[3px] border-orange bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="gerbang-operasional"><p>{TEKS_GERBANG_OPERASIONAL}</p></div>
      </div>

      {ringkasan && (
        <Card className="p-3" data-testid="ringkasan-referensi">
          <div className="mb-2 grid gap-2 sm:grid-cols-3">
            <div className="rounded-btn bg-inset px-3 py-2" data-testid="kartu-cakupan"><p className="text-[11px] font-bold uppercase text-ink3">Cakupan tanggal sumber</p>
              <p className="text-[12px] text-ink2">Tanggal order {ringkasan.cakupan.tanggalOrderDari || "—"} s/d {ringkasan.cakupan.tanggalOrderSampai || "—"}; pembelian aktual s/d {ringkasan.cakupan.tanggalKirimSampai || "—"}. <b>Setelah tanggal itu belum ada data.</b></p>
              <p className="mt-1 text-[11px] text-ink3" data-testid="per-bulan-order">Tanggal order per bulan — {teksPerBulan(ringkasan.perBulanTanggalOrder) || "—"}. {KETERANGAN_BULAN}</p></div>
            <div className="rounded-btn bg-redbg px-3 py-2" data-testid="kartu-antrean"><p className="text-[11px] font-bold uppercase text-red">Antrean penyelesaian</p>
              <p className="text-[20px] font-extrabold text-red" data-testid="jumlah-antrean">{ringkasan.jumlahAntrean}</p>
              <p className="text-[11px] text-ink2">baris yang tidak bisa dipetakan/dibandingkan otomatis. <button type="button" className="font-medium text-accent underline" onClick={() => { setFilter("antrean"); setLaman(0); }}>Lihat antrean</button></p></div>
            <div className="rounded-btn bg-inset px-3 py-2" data-testid="kartu-t0"><p className="text-[11px] font-bold uppercase text-ink3">T0 dan dokumen resmi</p>
              <p className="text-[12px] text-ink2">{TEKS_T0}</p><p className="text-[11px] text-ink3">Dokumen resmi sesudah T0 yang cocok: {ringkasan.resmiSetelahT0}. {ringkasan.t0 ? `T0 tercatat ${new Date(ringkasan.t0).toLocaleString("id-ID")}.` : "T0 belum dicatat."}</p></div>
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {Object.entries(ringkasan.perStatus).map(([k, v]) => <Badge key={k} variant={STATUS_REFERENSI[k]?.tone || "neutral"} title={STATUS_REFERENSI[k]?.arti}>{STATUS_REFERENSI[k]?.label || k}: {v}</Badge>)}
            {Object.entries(ringkasan.perAntrean).map(([k, v]) => <Badge key={k} variant="red">{ANTREAN_REFERENSI[k] || k}: {v}</Badge>)}
          </div>
          <p className="mt-2 text-[11.5px] text-ink3">{catatSegar && <b>{catatSegar} </b>}{ringkasan.revisiTertinggal > 0 ? `${ringkasan.revisiTertinggal} catatan punya status terkini yang berbeda dari snapshot tersimpan (tampilan sudah terkini). ` : ""}{ringkasan.imporTerakhir ? `Impor terakhir ${new Date(ringkasan.imporTerakhir.waktuImpor).toLocaleString("id-ID")}.` : "Belum ada impor."} {ringkasan.tanggalPemakaian}</p>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTER.map((f) => <Button key={f.key} size="sm" variant={filter === f.key ? "primary" : "secondary"} onClick={() => { setFilter(f.key); setLaman(0); }}>{f.label}</Button>)}
        <input value={q} onChange={(e) => { setQ(e.target.value); setLaman(0); }} placeholder="Cari order / bahan" className="rounded-btn border border-border bg-surface px-2 py-1 text-[12px]" data-testid="cari-referensi" />
        <Button size="sm" variant="ghost" onClick={muat} title="Muat ulang (hanya membaca)"><RefreshCw size={14} /></Button>
        {boleh && <Button size="sm" variant="secondary" onClick={simpanSnapshot} disabled={sedangSegar} data-testid="btn-simpan-snapshot" title={TEKS_SEGARKAN}>{sedangSegar ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Simpan snapshot status (manual)</Button>}
        {boleh && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setImpor((v) => !v)}><Upload size={14} /> Impor dari file</Button>}
      </div>
      {impor && boleh && <PanelImpor onSelesai={muat} />}
      {err && <p className="text-[12px] text-red">{err}</p>}

      <TableWrap>
        <Table>
          <THead><TR><TH>Jenis · order</TH><TH>Bahan</TH><TH>Jumlah (satuan file)</TH><TH>Tanggal</TH><TH>Status</TH><TH>Sumber</TH></TR></THead>
          <TBody>
            {loading ? <TableSkeletonRows rows={6} cols={6} /> : baris.length === 0 ? (
              <TR><TD colSpan={6}><EmptyState icon={FileText} title="Belum ada catatan referensi" description="Impor dari file (Rekap Pemakaian Bahan / Data Pembelian) untuk melihat riwayat di sini." compact /></TD></TR>
            ) : baris.map((r) => (
              <React.Fragment key={r.id}>
                <TR className="cursor-pointer" onClick={() => setBuka(buka === r.id ? null : r.id)} data-testid="baris-referensi">
                  <TD><span className="text-[11px] text-ink3">{JENIS_REFERENSI[r.jenis]}</span><br />{r.nomorOrder || r.suratJalan || "—"}</TD>
                  <TD>{r.material ? <><b>{r.material.kode}</b><br /><span className="text-[11px] text-ink3">{r.material.nama} · master {r.material.satuan}</span></> : <><i>{r.namaDiFile}</i><br /><span className="text-[11px] text-red">belum terpetakan</span></>}</TD>
                  <TD>{teksJumlah(r)}</TD>
                  <TD className="text-[11.5px]">{teksTanggal(r)}</TD>
                  <TD><Badge variant={STATUS_REFERENSI[r.statusVerifikasi]?.tone || "neutral"} title={STATUS_REFERENSI[r.statusVerifikasi]?.arti}>{STATUS_REFERENSI[r.statusVerifikasi]?.label || r.statusVerifikasi}</Badge>{r.antrean && <><br /><span className="text-[11px] text-red">{ANTREAN_REFERENSI[r.antrean]}</span></>}</TD>
                  <TD className="text-[11px] text-ink3">{teksSumber(r)}</TD>
                </TR>
                {buka === r.id && (
                  <TR><TD colSpan={6} className="bg-inset text-[12px]" data-testid="detail-referensi">
                    <p className="font-bold text-ink">{r.label}</p>
                    <p>Arti status: {STATUS_REFERENSI[r.statusVerifikasi]?.arti}</p>
                    <p>Label bulan di file: {r.labelBulanFile || "—"} (tidak dipakai sebagai bukti waktu). Diimpor {r.waktuImpor ? new Date(r.waktuImpor).toLocaleString("id-ID") : "—"} · revisi {r.revisi}.</p>
                    {r.alasanBlocker?.length > 0 && <ul className="mt-1 list-disc pl-5 text-red">{r.alasanBlocker.map((a, i) => <li key={i}>{a}</li>)}</ul>}
                    {r.peringatan?.length > 0 && <ul className="mt-1 list-disc pl-5 text-orange">{r.peringatan.map((a, i) => <li key={i}>{a}</li>)}</ul>}
                    {r.dokumenResmi && <p className="mt-1">Dokumen resmi terkait: {teksDokumenResmi(r.dokumenResmi)} {r.dokumenResmi.qty != null ? `(qty ${r.dokumenResmi.qty})` : ""} — sumber kebenaran adalah dokumen resmi itu.</p>}
                  </TD></TR>
                )}
              </React.Fragment>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <div className="flex items-center gap-2 text-[12px] text-ink3">
        <span>{total} baris</span>
        <Button size="sm" variant="ghost" disabled={laman === 0} onClick={() => setLaman((n) => n - 1)}>Sebelumnya</Button>
        <Button size="sm" variant="ghost" disabled={(laman + 1) * 50 >= total} onClick={() => setLaman((n) => n + 1)}>Berikutnya</Button>
      </div>
    </div>
  );
}
