import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Scale, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import { PanelSamping } from "@/components/ui/panel-samping.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import { HalamanFinance, KartuAngka, JudulKartu, Penjelasan, PeriodePicker, Pilihan, Uang } from "@/features/finance/shared.jsx";

// HPP PER ORDER — antrean PIC untuk melengkapi pemakaian unit terkirim, persetujuan biaya tanpa stok (pemakaian pra-SO), dan laporan berdampingan
// (laba rugi jurnal | HPP operasional per order | hasil manajemen sementara + jembatan per baris jurnal). Semua aturan ditegakkan server; halaman ini tidak menghitung nilai sendiri.

const TONE = { red: "red", orange: "orange", amber: "orange", blue: "accent", green: "green" };
const angka = (v) => (v == null ? "—" : Number(v).toLocaleString("id-ID", { maximumFractionDigits: 4 }));
const LABEL_HARGA = { TANPA_HARGA: "Tanpa harga (belum diketahui)", PERLU_KEPUTUSAN: "Harga perlu keputusan", BELUM_DIBEKUKAN: "Belum dibekukan", GAGAL: "Pembekuan gagal" };
const rpAtauKosong = (v) => (v == null ? <span className="text-ink3">belum diketahui</span> : <Uang value={v} />);
const jamWib = (iso) => new Date(iso).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
const labelKandidat = (k) => `${k.jenis === "AWAL_HARI" ? "Awal hari" : `Mulai ${jamWib(k.mulai)} WIB`}${k.harga != null ? ` — Rp${Number(k.harga).toLocaleString("id-ID")}` : ""}`;
const awalBulan = () => { const w = new Date(Date.now() + 7 * 3600e3); const p = (n) => String(n).padStart(2, "0"); return { from: `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-01`, to: `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}` }; };

function Pesan({ pesan, onTutup }) {
  if (!pesan) return null;
  return (
    <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${pesan.jenis === "galat" ? "bg-redbg text-red" : "bg-greenbg text-green"}`} role="status">
      {pesan.teks} <button type="button" className="ml-2 underline" onClick={onTutup}>tutup</button>
    </div>
  );
}

export default function FinanceHppOrder({ awal = "antrean" }) {
  const [periode, setPeriode] = useState(awalBulan);
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState(awal);
  const [error, setError] = useState(null);
  useEffect(() => { api.getHppOrderMeta().then(setMeta).catch((e) => setError(e.message || "Gagal memuat")); }, []);
  return (
    <HalamanFinance title="HPP per Order" subtitle="Lengkapi pemakaian bahan unit terkirim dan baca laba berdampingan: jurnal, HPP operasional, hasil manajemen sementara."
      actions={<PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />} loading={!meta && !error} error={error}>
      {meta && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="antrean"><ClipboardList size={14} className="mr-1" /> Antrean unit</TabsTrigger>
            {meta.izin.menyetujui && <TabsTrigger value="persetujuan"><ShieldCheck size={14} className="mr-1" /> Verifikasi biaya</TabsTrigger>}
            <TabsTrigger value="laporan"><Scale size={14} className="mr-1" /> Laporan berdampingan</TabsTrigger>
          </TabsList>
          <TabsContent value="antrean"><TabAntrean periode={periode} meta={meta} /></TabsContent>
          {meta.izin.menyetujui && <TabsContent value="persetujuan"><TabPersetujuan meta={meta} /></TabsContent>}
          <TabsContent value="laporan"><TabLaporan periode={periode} meta={meta} /></TabsContent>
        </Tabs>
      )}
    </HalamanFinance>
  );
}

// ───────────────────────────── ANTREAN PIC ─────────────────────────────
function TabAntrean({ periode, meta }) {
  const [data, setData] = useState(null); const [error, setError] = useState(null);
  const [status, setStatus] = useState(""); const [q, setQ] = useState("");
  const [pilih, setPilih] = useState(new Set()); const [buka, setBuka] = useState(null);
  const [ket, setKet] = useState(""); const [pesan, setPesan] = useState(null); const [proses, setProses] = useState(false);
  const muat = useCallback(async () => {
    setError(null);
    try { setData(await api.getHppOrderAntrean({ from: periode.from, to: periode.to, status, q })); setPilih(new Set()); } catch (e) { setError(e.message); }
  }, [periode.from, periode.to, status, q]);
  useEffect(() => { muat(); }, [muat]);

  const siap = useMemo(() => (data?.baris ?? []).filter((b) => b.status === "SIAP_DIKONFIRMASI" || b.status === "KONFIRMASI_BASI"), [data]);
  const toggle = (id) => setPilih((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function konfirmasiTerpilih() {
    const baris = siap.filter((b) => pilih.has(b.unitId)); if (!baris.length) return;
    setProses(true); const gagal = [];
    for (const b of baris) { try { await api.konfirmasiHppUnit(b.unitId, b.sidik, ket); } catch (e) { gagal.push(`${b.unitKode}: ${e.message}`); } }
    setProses(false);
    setPesan(gagal.length ? { jenis: "galat", teks: `${baris.length - gagal.length} unit dikonfirmasi; ${gagal.length} gagal — ${gagal.join("; ")}` } : { jenis: "ok", teks: `${baris.length} unit dikonfirmasi pemakaiannya lengkap.` });
    muat();
  }
  if (error) return <Card><CardContent className="py-6 text-red">{error}</CardContent></Card>;
  if (!data) return <Card><CardContent className="py-6 text-ink2">Memuat antrean…</CardContent></Card>;
  const r = data.ringkasan;
  return (
    <div className="space-y-3">
      <Pesan pesan={pesan} onTutup={() => setPesan(null)} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <KartuAngka label="Unit terkirim" value={r.unit} sub={`${r.order} order`} info={data.dasar} />
        <KartuAngka label="Ada pemakaian" value={r.adaPemakaian} sub="belum tentu lengkap" tone="default" />
        <KartuAngka label="HPP lengkap" value={r.hppLengkap} sub={`dari ${r.unit} unit`} tone={r.hppLengkap === r.unit ? "green" : "orange"} />
        <KartuAngka label="Belum ada pemakaian" value={r.perStatus.BELUM_ADA_PEMAKAIAN} tone={r.perStatus.BELUM_ADA_PEMAKAIAN ? "red" : "default"} onClick={() => setStatus("BELUM_ADA_PEMAKAIAN")} />
        {meta.izin.nominal ? <KartuAngka label="Bahan diketahui" value={<Uang value={r.nilaiDiketahui} />} sub="bagian yang bernilai saja" /> : <KartuAngka label="Menunggu persetujuan" value={r.perStatus.MENUNGGU_PERSETUJUAN} />}
      </div>
      <Penjelasan>{data.catatan} {data.tautanSO.teks}</Penjelasan>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Status"><Pilihan value={status} onChange={setStatus}>
          <option value="">Semua ({r.unit})</option>
          {Object.values(data.status).map((s) => <option key={s.key} value={s.key}>{s.label} ({r.perStatus[s.key] ?? 0})</option>)}
        </Pilihan></Field>
        <Field label="Cari order / unit / pelanggan"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="RES-…" /></Field>
        {meta.izin.mencatat && siap.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 md:ml-auto">
            <Field label={`Konfirmasi lengkap (${pilih.size} dipilih)`}><Input value={ket} onChange={(e) => setKet(e.target.value)} placeholder="Diperiksa oleh … dari buku kerja …" /></Field>
            <Button disabled={!pilih.size || ket.trim().length < 5 || proses} onClick={konfirmasiTerpilih}><CheckCircle2 size={14} className="mr-1" /> Konfirmasi terpilih</Button>
          </div>
        )}
      </div>
      <TableWrap>
        <Table>
          <THead><TR>
            <TH className="w-8">{siap.length > 0 && meta.izin.mencatat && <input type="checkbox" aria-label="Pilih semua yang siap" checked={siap.length > 0 && siap.every((b) => pilih.has(b.unitId))} onChange={(e) => setPilih(e.target.checked ? new Set(siap.map((b) => b.unitId)) : new Set())} />}</TH>
            <TH>Diserahkan</TH><TH>Order / unit</TH><TH>Status HPP</TH><TH>Pemakaian tercatat</TH><TH className="text-right">Biaya kosong</TH><TH className="text-right">Tertahan</TH>
            {meta.izin.nominal && <TH className="text-right">Bahan diketahui</TH>}<TH>Langkah berikut</TH><TH />
          </TR></THead>
          <TBody>
            {data.baris.map((b) => (
              <TR key={b.unitId}>
                <TD>{(b.status === "SIAP_DIKONFIRMASI" || b.status === "KONFIRMASI_BASI") && meta.izin.mencatat && <input type="checkbox" aria-label={`Pilih ${b.unitKode}`} checked={pilih.has(b.unitId)} onChange={() => toggle(b.unitId)} />}</TD>
                <TD className="whitespace-nowrap">{b.diserahkan}</TD>
                <TD><div className="font-medium">{b.orderNomor}</div><div className="text-xs text-ink3">{b.unitKode}{b.pelanggan ? ` · ${b.pelanggan}` : ""}</div></TD>
                <TD><Badge variant={TONE[b.tone] ?? "neutral"}>{b.statusLabel}</Badge>{b.pernyataan && <div className="text-xs text-ink3">oleh {b.pernyataan.oleh ?? "—"}: {b.pernyataan.alasan}</div>}</TD>
                <TD>{b.pemakaian.baris ? <span>{b.pemakaian.baris} baris{b.pemakaian.biayaTanpaStok ? ` (${b.pemakaian.biayaTanpaStok} tanpa stok)` : ""}<div className="text-xs text-ink3">{b.pemakaian.bahan.slice(0, 3).join(", ")}{b.pemakaian.bahan.length > 3 ? ` +${b.pemakaian.bahan.length - 3}` : ""}</div></span> : <span className="text-ink3">—</span>}</TD>
                <TD className="text-right">{b.biayaKosong || "—"}{b.perluKeputusanHarga ? <div className="text-xs text-orange">{b.perluKeputusanHarga} harga perlu keputusan</div> : null}</TD>
                <TD className="text-right">{b.catatanTertahan + b.sementara + b.biayaDiajukan || "—"}</TD>
                {meta.izin.nominal && <TD className="text-right">{rpAtauKosong(b.nilaiDiketahui)}</TD>}
                <TD className="max-w-xs text-xs text-ink2">{b.langkah}</TD>
                <TD><Button size="sm" variant="secondary" onClick={() => setBuka(b)}>Buka</Button></TD>
              </TR>
            ))}
            {!data.baris.length && <TR><TD colSpan={10} className="py-6 text-center text-ink3">Tidak ada unit pada filter ini.</TD></TR>}
          </TBody>
        </Table>
      </TableWrap>
      {buka && <PanelUnit baris={buka} meta={meta} onTutup={() => setBuka(null)} onBerubah={muat} />}
    </div>
  );
}

function PanelUnit({ baris, meta, onTutup, onBerubah }) {
  const [d, setD] = useState(null); const [pesan, setPesan] = useState(null); const [form, setForm] = useState(null); const [ket, setKet] = useState("");
  const muat = useCallback(async () => { try { setD(await api.getHppOrderUnit(baris.unitId)); } catch (e) { setPesan({ jenis: "galat", teks: e.message }); } }, [baris.unitId]);
  useEffect(() => { muat(); }, [muat]);
  const selesai = (teks) => { setPesan({ jenis: "ok", teks }); setForm(null); muat(); onBerubah(); };
  async function konfirmasi() { try { await api.konfirmasiHppUnit(baris.unitId, d.status.sidik, ket); selesai("Pemakaian unit dikonfirmasi lengkap."); } catch (e) { setPesan({ jenis: "galat", teks: e.message }); } }
  async function tanpaBahan() { try { await api.nyatakanTanpaBahan(baris.unitId, ket); selesai("Pernyataan tanpa bahan baru tersimpan (pelaku, waktu, dan alasan tercatat)."); } catch (e) { setPesan({ jenis: "galat", teks: e.message }); } }
  return (
    <PanelSamping open onOpenChange={(o) => !o && onTutup()} judul={`${baris.orderNomor} · ${baris.unitKode}`} subjudul={`Diserahkan ${baris.diserahkan}`} lebar={900}>
      <Pesan pesan={pesan} onTutup={() => setPesan(null)} />
      {!d ? <div className="text-ink2">Memuat…</div> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><Badge variant={TONE[d.status.tone] ?? "neutral"}>{d.status.label}</Badge><span className="text-sm text-ink2">{d.status.langkah}</span></div>
          {d.pernyataan && <div className="rounded-lg bg-inset p-2 text-sm">Pernyataan &ldquo;tanpa bahan baru&rdquo; oleh <b>{d.pernyataan.oleh ?? "—"}</b> pada {new Date(d.pernyataan.pada).toLocaleString("id-ID")}: {d.pernyataan.alasan} <span className="text-xs text-ink3">(tercatat di riwayat unit; dicabut lewat Order Produksi)</span></div>}
          <section>
            <JudulKartu title="Baris biaya tercatat" description="Pengeluaran stok unit + biaya tanpa stok. Harga kosong = belum diketahui." />
            <TableWrap><Table><THead><TR><TH>Sumber</TH><TH>Bahan</TH><TH className="text-right">Jumlah</TH><TH>Tanggal pakai</TH><TH>Status harga</TH>{meta.izin.nominal && <TH className="text-right">Nilai</TH>}</TR></THead>
              <TBody>{[...d.baris, ...d.diajukan].map((x) => (
                <TR key={x.id}><TD className="text-xs">{x.sumber === "STOK" ? `Stok (${x.jenis})` : `Tanpa stok${x.statusEntri === "DIAJUKAN" ? " — menunggu persetujuan" : ""}`}</TD><TD>{x.kode}</TD><TD className="text-right">{angka(x.qty)} {x.satuan}</TD>
                  <TD>{x.tanggalPemakaian}{x.waktuPemakaian ? ` ${jamWib(x.waktuPemakaian)}` : ""}</TD>
                  <TD>{x.status === "DIBEKUKAN" ? <Badge variant="green">Bernilai</Badge> : <Badge variant="orange">{LABEL_HARGA[x.status] ?? x.status}</Badge>}{x.sumber !== "STOK" && x.teksDasarHarga && <div className="text-xs text-ink3">{x.teksDasarHarga}</div>}</TD>
                  {meta.izin.nominal && <TD className="text-right">{rpAtauKosong(x.subtotal)}</TD>}</TR>))}
                {!d.baris.length && !d.diajukan.length && <TR><TD colSpan={6} className="text-center text-ink3">Belum ada pemakaian tercatat.</TD></TR>}</TBody></Table></TableWrap>
          </section>
          {d.catatanTertahan.length > 0 && (
            <section>
              <JudulKartu title="Catatan historis tertahan" description="Catatan dari Excel Admin yang belum menjadi biaya. Jalur disarankan dari tanggal pemakaian terhadap tanggal SO bahan." />
              <TableWrap><Table><THead><TR><TH>Catatan</TH><TH className="text-right">Jumlah</TH><TH>Tanggal</TH><TH>Tanggal SO</TH><TH>Jalur</TH><TH /></TR></THead>
                <TBody>{d.catatanTertahan.map((c) => (
                  <TR key={c.id}><TD>{c.nama ?? "—"}<div className="text-xs text-ink3">{c.state}</div></TD><TD className="text-right">{angka(c.qty)}</TD><TD>{c.tanggal ?? "—"}</TD><TD>{c.soTanggal ?? "—"}</TD>
                    <TD>{c.jalurDisarankan === "BIAYA_TANPA_STOK" ? "Biaya tanpa stok" : c.jalurDisarankan === "STOK" ? "Posting Historis / pengeluaran resmi" : "Lengkapi tanggal/bahan dulu"}</TD>
                    <TD>{c.jalurDisarankan === "BIAYA_TANPA_STOK" && meta.izin.mencatat && c.materialId && c.qty != null && <Button size="sm" variant="secondary" onClick={() => setForm({ materialId: c.materialId, qty: c.qty, tanggalPemakaian: c.tanggal, sumberJenis: "CATATAN_HISTORIS", sumberRef: c.id, bukti: `Catatan historis ${c.nama ?? c.id}`, kunciMaterial: true })}>Catat dari catatan ini</Button>}</TD></TR>))}</TBody></Table></TableWrap>
            </section>
          )}
          {meta.izin.mencatat && (
            <section className="space-y-2">
              <JudulKartu title="Lengkapi pemakaian" description="Pilih jalur menurut tanggal pemakaian. Sistem menolak jalur yang salah; tidak ada jumlah, tanggal, atau harga yang ditebak." />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setForm({ sumberJenis: "LAPORAN_PIC" })}>Catat biaya tanpa stok (pada/sebelum SO)</Button>
                <Button variant="tertiary" asChild><a href={`/bengkel/order-produksi?q=${encodeURIComponent(baris.orderNomor ?? baris.unitKode)}`}>Pengeluaran stok resmi (sesudah SO) di Order Produksi</a></Button>
              </div>
              {form && <FormBiaya key={JSON.stringify(form)} unit={d.unit} awal={form} meta={meta} onBatal={() => setForm(null)} onSelesai={(r) => selesai(r?.otomatis ? "Biaya tanpa stok tercatat dan langsung berlaku (dicatat akun admin)." : "Biaya tanpa stok tercatat; berlaku sesudah diverifikasi ADMIN lain.")} />}
              {(d.status.key === "SIAP_DIKONFIRMASI" || d.status.key === "KONFIRMASI_BASI" || d.status.key === "BELUM_ADA_PEMAKAIAN") && (
                <div className="flex flex-wrap items-end gap-2 rounded-lg bg-inset p-3">
                  <Field label={d.status.key === "BELUM_ADA_PEMAKAIAN" ? "Keterangan (hanya bila memang tanpa bahan baru)" : "Keterangan pemeriksaan"}><Input value={ket} onChange={(e) => setKet(e.target.value)} placeholder="Diperiksa oleh … dari …" /></Field>
                  {d.status.key === "BELUM_ADA_PEMAKAIAN"
                    ? (meta.izin.menyatakanTanpaBahan ? <Button variant="neutral" disabled={ket.trim().length < 5} onClick={tanpaBahan}>Nyatakan tanpa bahan baru</Button> : <span className="text-xs text-ink3">Pernyataan tanpa bahan baru hanya oleh pemegang izin rute unit (Production Lead/Admin).</span>)
                    : <Button disabled={ket.trim().length < 5} onClick={konfirmasi}><CheckCircle2 size={14} className="mr-1" /> Konfirmasi pemakaian lengkap</Button>}
                </div>
              )}
              {["BELUM_LENGKAP", "MENUNGGU_PERSETUJUAN"].includes(d.status.key) && <div className="text-xs text-ink3">Konfirmasi lengkap belum tersedia: masih ada biaya kosong, sumber tertunda, atau biaya yang menunggu persetujuan.</div>}
            </section>
          )}
        </div>
      )}
    </PanelSamping>
  );
}

function FormBiaya({ unit, awal, meta, onBatal, onSelesai }) {
  const [m, setM] = useState({ qty: "", tanggalPemakaian: "", jam: "", sumberRef: "", bukti: "", alasan: "", alasanBukanGanda: "", ...awal });
  const [bahan, setBahan] = useState([]); const [pr, setPr] = useState(null); const [galat, setGalat] = useState(null); const [bukanGanda, setBukanGanda] = useState(false); const [kirim, setKirim] = useState(false);
  const [kunci] = useState(() => `biaya-tanpa-stok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`); // satu kunci per formulir: kirim ulang = entri yang sama
  useEffect(() => { api.getMaterials({ active: "true" }).then((r) => setBahan(Array.isArray(r) ? r : r?.items ?? r?.materials ?? [])).catch(() => setBahan([])); }, []);
  const ubah = (k) => (e) => { setM((x) => ({ ...x, [k]: e.target.value })); setPr(null); };
  const pilihNilai = (k) => (v) => { setM((x) => ({ ...x, [k]: v })); setPr(null); }; // Pilihan memanggil onChange(nilai), bukan event
  const catatan = m.sumberJenis === "CATATAN_HISTORIS";
  const masukan = () => ({ unitId: unit.id, materialId: m.materialId, qty: Number(m.qty), tanggalPemakaian: m.tanggalPemakaian, waktuPemakaian: m.jam && m.tanggalPemakaian ? `${m.tanggalPemakaian}T${m.jam}+07:00` : null,
    sumberJenis: m.sumberJenis, sumberRef: m.sumberRef || null, bukti: m.bukti, alasan: m.alasan, konfirmasiBukanGanda: bukanGanda, alasanBukanGanda: m.alasanBukanGanda });
  async function lihat() { setGalat(null); try { setPr(await api.pratinjauBiayaTanpaStok(masukan())); } catch (e) { setGalat(e.message); } }
  async function ajukan() { setKirim(true); setGalat(null); try { const r = await api.ajukanBiayaTanpaStok({ ...masukan(), sidikHarga: pr?.harga?.sidik, sidikGanda: pr?.ganda?.sidik }, kunci); onSelesai(r); } catch (e) { setGalat(e.message); } finally { setKirim(false); } }
  const gandaOk = !pr?.ganda?.perluKonfirmasi || (bukanGanda && m.alasanBukanGanda.trim().length >= 5);
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <div className="grid gap-2 md:grid-cols-3">
        <Field label="Bahan"><Pilihan value={m.materialId ?? ""} onChange={pilihNilai("materialId")} disabled={awal.kunciMaterial}>
          <option value="">Pilih bahan…</option>{bahan.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</Pilihan></Field>
        <Field label="Jumlah (satuan stok)"><Input inputMode="decimal" value={m.qty ?? ""} onChange={ubah("qty")} disabled={catatan} /></Field>
        <Field label="Tanggal pemakaian (dilaporkan)"><Input type="date" value={m.tanggalPemakaian ?? ""} onChange={ubah("tanggalPemakaian")} disabled={catatan} /></Field>
        <Field label="Jam pemakaian (isi HANYA bila tertulis di sumber)"><Input type="time" value={m.jam} onChange={ubah("jam")} /></Field>
        <Field label="Sumber"><Pilihan value={m.sumberJenis} onChange={pilihNilai("sumberJenis")} disabled={catatan}>
          {Object.entries(meta.sumberJenis).filter(([k]) => k !== "CATATAN_HISTORIS" || catatan).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Pilihan></Field>
        {!catatan && <Field label="Rujukan sumber (unik per baris)"><Input value={m.sumberRef} onChange={ubah("sumberRef")} placeholder="mis. laporan PIC 05/11 lembar 2 baris 3" /></Field>}
        <Field label="Bukti"><Input value={m.bukti} onChange={ubah("bukti")} placeholder="Siapa melapor, dokumen/foto apa" /></Field>
        <Field label="Alasan"><Input value={m.alasan} onChange={ubah("alasan")} placeholder="Mengapa belum tercatat" /></Field>
      </div>
      {galat && <div className="text-sm text-red">{galat}</div>}
      {pr && (
        <div className="space-y-1 rounded-lg bg-inset p-3 text-sm">
          <div><b>Jalur:</b> {pr.jalur.label} — {pr.jalur.teks}</div>
          {pr.penghalang.map((x) => <div key={x.kode} className="text-red">{x.pesan}</div>)}
          {pr.harga && (
            <div><b>Harga:</b> {pr.harga.status === "DINILAI" ? (meta.izin.nominal ? <>Rp{Number(pr.harga.harga).toLocaleString("id-ID")} → <Uang value={pr.harga.nilai} /></> : "bernilai") : pr.harga.status === "PERLU_KEPUTUSAN" ? "perlu keputusan penyetuju" : "tanpa harga (belum diketahui)"}
              <div className="text-xs text-ink2">{pr.harga.teks}</div>
              {pr.harga.kandidat && <ul className="ml-4 list-disc text-xs">{pr.harga.kandidat.map((k) => <li key={k.priceId}>{labelKandidat(k)}</li>)}</ul>}
            </div>
          )}
          {pr.ganda.identik.length > 0 && (
            <div className="text-red">{pr.ganda.teks}
              <ul className="ml-4 list-disc">{pr.ganda.identik.slice(0, 8).map((k) => <li key={`${k.kind}-${k.id}`}>{k.kind}: {angka(k.qty)} {k.tanggal ?? ""} {k.catatan ?? ""}</li>)}</ul></div>
          )}
          {pr.ganda.perluKonfirmasi && (
            <div className="space-y-1 text-orange">
              {pr.ganda.mirip.length > 0 && <>Mungkin sudah tercatat ({pr.ganda.mirip.length}):</>}
              <ul className="ml-4 list-disc">{pr.ganda.mirip.slice(0, 8).map((k) => <li key={`${k.kind}-${k.id}`}>{k.kind}: {angka(k.qty)} {k.tanggal ?? ""} {k.catatan ?? ""}</li>)}</ul>
              <label className="flex items-center gap-2"><input type="checkbox" checked={bukanGanda} onChange={(e) => setBukanGanda(e.target.checked)} /> Saya sudah memeriksa: ini pemakaian yang BELUM tercatat.</label>
              <Field label="Alasan bukan duplikat (wajib)"><Input value={m.alasanBukanGanda} onChange={(e) => setM((x) => ({ ...x, alasanBukanGanda: e.target.value }))} placeholder="mis. ISSUE lama untuk panel atas, ini panel bawah" /></Field>
            </div>
          )}
          <ul className="ml-4 list-disc text-ink2">{pr.dampak.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={lihat}>Lihat dampak</Button>
        <Button disabled={!pr?.boleh || kirim || !gandaOk} onClick={ajukan}>{pr?.otomatis ? "Catat (langsung berlaku)" : "Ajukan untuk verifikasi"}</Button>
        <Button variant="neutral" onClick={onBatal}>Batal</Button>
      </div>
    </div>
  );
}

// ───────────────────────────── PERSETUJUAN ─────────────────────────────
function TabPersetujuan({ meta }) {
  const [data, setData] = useState(null); const [pilih, setPilih] = useState(new Set()); const [pesan, setPesan] = useState(null); const [proses, setProses] = useState(false); const [alasan, setAlasan] = useState("");
  const [harga, setHarga] = useState({}); // id → { priceId, alasan } untuk entri PERLU_KEPUTUSAN
  const muat = useCallback(async () => { try { setData(await api.getBiayaTanpaStok("DIAJUKAN")); setPilih(new Set()); } catch (e) { setPesan({ jenis: "galat", teks: e.message }); } }, []);
  useEffect(() => { muat(); }, [muat]);
  const bisa = (b) => b.diajukanOleh !== meta.userId;
  const setH = (id, k, v) => setHarga((h) => ({ ...h, [id]: { ...h[id], [k]: v } }));
  async function massal(aksi) {
    const ids = (data?.baris ?? []).filter((b) => pilih.has(b.id) && bisa(b)); if (!ids.length) return;
    setProses(true); const gagal = [];
    for (const b of ids) {
      try {
        if (aksi === "setujui") {
          const k = b.statusHarga === "PERLU_KEPUTUSAN" ? harga[b.id] : null;
          if (b.statusHarga === "PERLU_KEPUTUSAN" && (!k?.priceId || (k.alasan ?? "").trim().length < 5)) throw new Error("pilih harga + alasan dulu");
          await api.setujuiBiayaTanpaStok(b.id, alasan || null, k);
        } else await api.tolakBiayaTanpaStok(b.id, alasan);
      } catch (e) { gagal.push(`${b.unitKode} ${b.kode}: ${e.message}`); }
    }
    setProses(false); setPesan(gagal.length ? { jenis: "galat", teks: `${ids.length - gagal.length} berhasil; ${gagal.length} gagal — ${gagal.join("; ")}` } : { jenis: "ok", teks: `${ids.length} biaya ${aksi === "setujui" ? "disetujui" : "ditolak"}.` });
    muat();
  }
  if (!data) return <Card><CardContent className="py-6 text-ink2">Memuat…</CardContent></Card>;
  return (
    <div className="space-y-3">
      <Pesan pesan={pesan} onTutup={() => setPesan(null)} />
      <Penjelasan>Biaya bahan per order TANPA pengurangan stok (pemakaian pada/sebelum SO). Pencatatan akun ADMIN langsung berlaku; yang di sini dicatat akun lain dan menunggu verifikasi Anda. Verifikasi memeriksa ulang tautan SO, sumber, kemungkinan duplikat, dan dasar harga per baris. Bila harga berubah pada hari pemakaian, Anda memilih harga dengan alasan (atau tolak dan minta jam pemakaian). Pengajuan Anda sendiri tidak bisa Anda setujui.</Penjelasan>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Catatan / alasan (wajib untuk tolak)"><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} /></Field>
        <Button disabled={!pilih.size || proses} onClick={() => massal("setujui")}>Setujui terpilih ({pilih.size})</Button>
        <Button variant="destructive" disabled={!pilih.size || proses || alasan.trim().length < 5} onClick={() => massal("tolak")}>Tolak terpilih</Button>
      </div>
      <TableWrap><Table>
        <THead><TR><TH className="w-8" /><TH>Diajukan</TH><TH>Order / unit</TH><TH>Bahan</TH><TH className="text-right">Jumlah</TH><TH>Tgl pakai / SO</TH><TH>Sumber & bukti</TH><TH>Dasar harga</TH>{meta.izin.nominal && <TH className="text-right">Nilai</TH>}</TR></THead>
        <TBody>
          {data.baris.map((b) => (
            <TR key={b.id}>
              <TD>{bisa(b) ? <input type="checkbox" aria-label={`Pilih ${b.unitKode}`} checked={pilih.has(b.id)} onChange={() => setPilih((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })} /> : <span className="text-xs text-ink3" title="Pengajuan Anda sendiri">milik Anda</span>}</TD>
              <TD className="whitespace-nowrap text-xs">{new Date(b.diajukanPada).toLocaleString("id-ID")}</TD>
              <TD><div className="font-medium">{b.orderNomor}</div><div className="text-xs text-ink3">{b.unitKode}{b.menggantikanId ? " · koreksi" : ""}</div></TD>
              <TD>{b.kode}</TD><TD className="text-right">{angka(b.qty)} {b.satuan}</TD><TD className="text-xs">{b.tanggalPemakaian}{b.waktuPemakaian ? ` ${jamWib(b.waktuPemakaian)}` : ""} / SO {b.soTanggal}</TD>
              <TD className="max-w-xs text-xs">{meta.sumberJenis[b.sumberJenis]} · <span className="text-ink3">{b.sumberJenis === "CATATAN_HISTORIS" ? "catatan historis" : b.sumberRef}</span><div>{b.bukti}</div><div className="text-ink3">{b.alasan}</div>
                {b.kandidatGanda?.alasanBukanGanda && <div className={b.kandidatGanda.identik?.length ? "text-red" : "text-orange"}>Bukan duplikat menurut pengaju ({b.kandidatGanda.identik?.length ? `${b.kandidatGanda.identik.length} bertanggal & berjumlah SAMA — periksa sumbernya, ` : ""}{b.kandidatGanda.mirip?.length ?? 0} mirip): {b.kandidatGanda.alasanBukanGanda}</div>}</TD>
              <TD className="text-xs">{b.statusHarga === "PERLU_KEPUTUSAN" ? (
                <div className="space-y-1"><Badge variant="orange">Harga berubah di hari itu</Badge>
                  <Pilihan aria-label={`Harga ${b.unitKode}`} value={harga[b.id]?.priceId ?? ""} onChange={(v) => setH(b.id, "priceId", v)}>
                    <option value="">Pilih harga…</option>{(b.kandidatHarga ?? []).map((k) => <option key={k.priceId} value={k.priceId}>{labelKandidat(k)}</option>)}</Pilihan>
                  <Input value={harga[b.id]?.alasan ?? ""} onChange={(e) => setH(b.id, "alasan", e.target.value)} placeholder="Alasan pilihan harga" /></div>
              ) : <span>{b.teksDasarHarga}</span>}</TD>
              {meta.izin.nominal && <TD className="text-right">{rpAtauKosong(b.subtotal)}</TD>}
            </TR>
          ))}
          {!data.baris.length && <TR><TD colSpan={9} className="py-6 text-center text-ink3">Tidak ada biaya yang menunggu persetujuan.</TD></TR>}
        </TBody>
      </Table></TableWrap>
    </div>
  );
}

// ───────────────────────────── LAPORAN BERDAMPINGAN ─────────────────────────────
function TabLaporan({ periode, meta }) {
  const [L, setL] = useState(null); const [error, setError] = useState(null);
  useEffect(() => { setL(null); setError(null); api.getHppOrderLaporan(periode.from, periode.to).then(setL).catch((e) => setError(e.message)); }, [periode.from, periode.to]);
  if (error) return <Card><CardContent className="py-6 text-red">{error}</CardContent></Card>;
  if (!L) return <Card><CardContent className="py-6 text-ink2">Menyusun laporan…</CardContent></Card>;
  const c = L.operasional.cakupan; const j = L.jurnal; const mg = L.manajemen;
  const Baris = ({ label, nilai, tebal, catatan }) => (<div className={`flex justify-between gap-3 py-1 ${tebal ? "border-t border-line font-semibold" : ""}`}><span>{label}{catatan && <div className="text-xs font-normal text-ink3">{catatan}</div>}</span><span className="whitespace-nowrap">{nilai}</span></div>);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <Card><CardContent className="space-y-1 p-4">
          <JudulKartu title="1 · Laba rugi menurut jurnal" description="Angka resmi buku besar. Belum final." />
          {j ? (<>
            <Baris label="Pendapatan bersih" nilai={<Uang value={j.ringkasan.pendapatanBersih} />} />
            {j.akunBebanPokok.map((a) => <Baris key={a.kode} label={`${a.kode} ${a.nama}`} nilai={<Uang value={a.nilai} />} />)}
            <Baris label="Beban pokok (HPP) jurnal" nilai={<Uang value={j.ringkasan.bebanPokok} />} tebal />
            <Baris label="Laba kotor" nilai={<Uang value={j.ringkasan.labaKotor} />} />
            <Baris label="Beban operasional" nilai={<Uang value={j.ringkasan.bebanOperasional} />} />
            <Baris label="Laba bersih jurnal" nilai={<Uang value={j.ringkasan.labaBersih} />} tebal catatan={j.teks} />
          </>) : <div className="text-sm text-ink3">Nominal hanya untuk pemegang akses Finance.</div>}
        </CardContent></Card>
        <Card><CardContent className="space-y-1 p-4">
          <JudulKartu title="2 · HPP operasional per order" description="Order yang pendapatannya diakui pada periode; seluruh pemakaian unitnya." />
          <Baris label="Order berpendapatan diakui" nilai={c.orderDiakui} />
          <Baris label="HPP lengkap" nilai={<Badge variant={c.orderLengkap === c.orderDiakui && c.orderDiakui ? "green" : "orange"}>{c.orderLengkap} order</Badge>} />
          <Baris label="Sebagian bernilai" nilai={`${c.orderParsial} order`} />
          <Baris label="Belum diketahui" nilai={`${c.orderBelumDiketahui} order`} />
          <Baris label="Unit lengkap / total" nilai={`${c.unitLengkap} / ${c.unitDiakui}`} />
          {meta.izin.nominal && <Baris label="Bahan diketahui (order diakui)" nilai={<Uang value={L.operasional.bahanDiakui} />} tebal catatan={`Biaya ${c.unitBelumDiketahui} unit belum diketahui — tidak dihitung Rp0.`} />}
          {meta.izin.nominal && L.operasional.dikeluarkanKarenaNilaiJurnal ? <Baris label="Tidak dihitung lagi (nilai jurnalnya dipakai)" nilai={<Uang value={L.operasional.dikeluarkanKarenaNilaiJurnal} />} catatan="Pergerakan yang belum seluruhnya bernilai operasional memakai nilai jurnal." /> : null}
          {meta.izin.nominal && <Baris label="Susut unit belum dijurnal (operasional)" nilai={<Uang value={L.operasional.susutBelumDijurnal} />} catatan={L.operasional.susutTanpaNilai ? `${L.operasional.susutTanpaNilai} baris susut tanpa nilai — belum diketahui` : null} />}
        </CardContent></Card>
        <Card><CardContent className="space-y-1 p-4">
          <JudulKartu title="3 · Hasil manajemen sementara" description="Laba jurnal dijembatani per baris: hanya yang terbukti terwakili HPP operasional, milik order belum diakui, atau koreksi saldo lama yang dibalik." />
          <Badge variant={mg.status === "LENGKAP" ? "green" : "orange"}>{mg.status === "LENGKAP" ? "HPP lengkap (bukan jurnal)" : "SEMENTARA — belum final"}</Badge>
          <div className="text-xs text-ink2">{mg.teksStatus}</div>
          {mg.baris ? mg.baris.map((x) => <Baris key={x.kunci} label={x.label} nilai={<Uang value={x.nilai} />} tebal={["hpp", "laba"].includes(x.kunci)} />) : <div className="text-sm text-ink3">Nominal hanya untuk pemegang akses Finance.</div>}
          {mg.jembatan && (<div className="mt-2 rounded-lg bg-inset p-2 text-xs"><b>Jembatan dari laba jurnal</b>
            {mg.jembatan.map((x) => <div key={x.kunci} className={`flex justify-between gap-2 ${x.kunci === "hasil" ? "border-t border-line font-semibold" : ""}`}><span>{x.label}</span><Uang value={x.nilai} /></div>)}
            <div className={`mt-1 ${mg.kontrol.cocok ? "text-green" : "text-red"}`}>{mg.kontrol.cocok ? "Kontrol cocok: setiap baris jurnal masuk tepat satu kelompok; jembatan = perhitungan langsung." : `Kontrol TIDAK cocok (selisih ${mg.kontrol.selisih} / klasifikasi ${mg.kontrol.selisihKlasifikasi}) — jangan dipakai.`}</div></div>)}
          {!mg.baris && <div className={`text-xs ${mg.kontrolCocok ? "text-green" : "text-red"}`}>{mg.kontrolCocok ? "Kontrol jembatan cocok." : "Kontrol jembatan tidak cocok."}</div>}
        </CardContent></Card>
      </div>
      {mg.kelompok && (
        <Card><CardContent className="p-4">
          <JudulKartu title="Klasifikasi baris jurnal beban pokok" description={`Tidak ada akun yang dikeluarkan utuh; setiap baris punya alasan. Koreksi saldo lama hanya bila dokumen asalnya mengoreksi periode sebelum ${mg.periodeMulai}.`} />
          <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-5">{mg.kelompok.map((k) => <KartuAngka key={k.key} label={k.label} value={<Uang value={k.nilai} />} sub={`${k.baris} baris · ${k.dibalik ? "dibalik" : "tetap dihitung"}`} info={k.teks} tone={k.key === "PERLU_KLASIFIKASI" && k.baris ? "orange" : "default"} />)}</div>
          <TableWrap><Table><THead><TR><TH>Tanggal</TH><TH>Jurnal</TH><TH>Akun</TH><TH>Order</TH><TH>Kelompok</TH><TH>Alasan</TH><TH className="text-right">Nilai</TH></TR></THead>
            <TBody>{mg.barisJurnal.map((r) => <TR key={r.id}><TD className="whitespace-nowrap text-xs">{r.tanggal}</TD><TD className="text-xs">{r.nomorJurnal}<div className="text-ink3">{r.sumber}</div></TD><TD className="text-xs">{r.akunKode} {r.akunNama}</TD><TD className="text-xs">{r.orderNomor ?? "—"}</TD>
              <TD><Badge variant={r.kelompok === "BEBAN_TETAP_DIHITUNG" ? "neutral" : r.kelompok === "PERLU_KLASIFIKASI" ? "orange" : "accent"}>{L.kelompokJurnal[r.kelompok]?.label ?? r.kelompok}</Badge></TD><TD className="max-w-xs text-xs text-ink2">{r.alasan}</TD><TD className="text-right"><Uang value={r.nilai} /></TD></TR>)}
              {!mg.barisJurnal.length && <TR><TD colSpan={7} className="text-center text-ink3">Tidak ada baris jurnal beban pokok pada periode.</TD></TR>}</TBody></Table></TableWrap>
        </CardContent></Card>
      )}
      <Card><CardContent className="p-4">
        <JudulKartu title="Order berpendapatan diakui" description="Margin hanya ditampilkan bila HPP order lengkap." />
        <TableWrap><Table><THead><TR><TH>Order</TH><TH>Status HPP</TH><TH className="text-right">Unit lengkap</TH>{meta.izin.nominal && <><TH className="text-right">Pendapatan</TH><TH className="text-right">Bahan diketahui</TH><TH className="text-right">Dipakai sebelum periode</TH><TH className="text-right">Margin (bila lengkap)</TH></>}</TR></THead>
          <TBody>{L.operasional.order.map((o) => (
            <TR key={o.orderId}><TD>{o.orderNomor}</TD><TD><Badge variant={o.status === "LENGKAP" ? "green" : o.status === "PARSIAL" ? "orange" : "red"}>{o.status === "LENGKAP" ? "Lengkap" : o.status === "PARSIAL" ? "Sebagian" : "Belum diketahui"}</Badge></TD><TD className="text-right">{o.unitLengkap} / {o.unit}</TD>
              {meta.izin.nominal && <><TD className="text-right"><Uang value={o.pendapatan} /></TD><TD className="text-right">{rpAtauKosong(o.nilaiDiketahui)}</TD><TD className="text-right">{o.bahanSebelumPeriode ? <Uang value={o.bahanSebelumPeriode} /> : "—"}</TD><TD className="text-right">{rpAtauKosong(o.marginDiketahui)}</TD></>}</TR>))}</TBody></Table></TableWrap>
      </CardContent></Card>
      <Card><CardContent className="p-4">
        <JudulKartu title="Biaya order yang pendapatannya belum diakui (terpisah)" description={L.operasional.belumDiakui.teks} />
        <TableWrap><Table><THead><TR><TH>Order</TH><TH>Status order</TH><TH className="text-right">Baris</TH><TH className="text-right">Tanpa nilai</TH>{meta.izin.nominal && <TH className="text-right">Nilai diketahui</TH>}</TR></THead>
          <TBody>{L.operasional.belumDiakui.order.map((g) => <TR key={g.orderId}><TD>{g.orderNomor}</TD><TD>{g.statusOrder}</TD><TD className="text-right">{g.baris}</TD><TD className="text-right">{g.tanpaNilai || "—"}</TD>{meta.izin.nominal && <TD className="text-right"><Uang value={g.nilaiDiketahui} /></TD>}</TR>)}
            {!L.operasional.belumDiakui.order.length && <TR><TD colSpan={5} className="text-center text-ink3">Tidak ada.</TD></TR>}</TBody></Table></TableWrap>
      </CardContent></Card>
      <Penjelasan><b>Pencegahan hitung ganda:</b> {L.pencegahanGanda.join(" ")} {L.saldoLama}</Penjelasan>
    </div>
  );
}
