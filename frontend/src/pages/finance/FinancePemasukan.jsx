import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePeriodeFinance } from "@/lib/periodeBersama.js";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import { HalamanFinance, PeriodePicker, tanggalPendek } from "@/features/finance/shared.jsx";
import LunasBelumDicatat from "@/features/finance/LunasBelumDicatat.jsx";
import DaftarPemasukan from "@/features/finance/pemasukan/DaftarPemasukan.jsx";
import RingkasanPemasukan, { Panel, StripSementara } from "@/features/finance/pemasukan/RingkasanPemasukan.jsx";
import { TAB, indeksRekening, kelasNada, susunAlasan, tabDari, teksRp, tidakDihitung } from "@/features/finance/pemasukan/pemasukanLogic.js";
import "@/styles/sanss-finance-pemasukan.css";

// PEMASUKAN TERPADU — agregator (READ-MODEL). Semua angka & klasifikasi dihitung SERVER; halaman ini hanya menata. Tidak ada tombol "buat pemasukan umum":
// pencatatan baru hanya lewat Pemasukan Lain (validasi akun di server). Uang dari server berupa STRING desimal → diformat tanpa float.
// Redesain tampilan 1 Nov 2026 (gaya Ringkasan Finance; styles/sanss-finance-pemasukan.css): satu header + pemilih kategori, Ringkasan beraksen, daftar satu panel.
// Komponen presentasi ada di features/finance/pemasukan/*. Endpoint, rumus, jurnal, penyaringan server, dan hak akses TIDAK berubah.
export { teksRp };

const PERINGATAN_PENDAPATAN_2026 = "Pendapatan 2026 masih dalam proses rekonsiliasi data sebelum sistem dan backfill order. Angka belum final.";
const Rp = ({ v }) => <span className={`tabular-nums ${String(v).startsWith("-") ? "text-red" : ""}`}>{teksRp(v)}</span>;

function BadgeStatus({ label, nada }) {
  return <span className={`fin-chip fin-chip-${kelasNada(nada)}`}>{label}</span>;
}

// ── PEMILIH KATEGORI ─────────────────────────────────────────────────────────────────────────────────────────
// Tiga pilihan utama + "Kategori lainnya" (<select> asli: keyboard & picker HP; menampilkan nama kategori aktif). Setiap kategori lama tetap dapat dibuka.
function PemilihKategori({ tab, onTab }) {
  const lainnya = TAB.filter((t) => !t.utama);
  const lainnyaAktif = lainnya.find((t) => t.id === tab);
  return (
    <nav className="fin-pm-nav" aria-label="Kategori pemasukan" data-testid="nav-kategori">
      <div role="tablist" aria-label="Kategori utama" className="fin-pm-seg">
        {TAB.filter((t) => t.utama).map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} onClick={() => onTab(t.id)} className="fin-pm-seg-item">{t.label}</button>
        ))}
        <label className="fin-pm-seg-item fin-pm-lainnya" data-aktif={lainnyaAktif ? "1" : "0"} data-testid="kategori-lainnya">
          <span>{lainnyaAktif ? lainnyaAktif.label : "Kategori lainnya"}</span>
          <ChevronDown size={14} aria-hidden="true" />
          <select aria-label="Kategori lainnya" value={lainnyaAktif ? tab : ""} onChange={(e) => e.target.value && onTab(e.target.value)}>
            <option value="" disabled>Kategori lainnya</option>
            {lainnya.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
      </div>
    </nav>
  );
}

// ── DATA SEBELUM PENGGUNAAN SISTEM ───────────────────────────────────────────────────────────────────────────
function DataSebelumSistem({ periode, opsi, indeksRek, onBuka }) {
  const [cutoff, setCutoff] = useState(null);
  const [batches, setBatches] = useState(null);
  const [detail, setDetail] = useState(null);
  const [statusBaris, setStatusBaris] = useState("");
  const [rekon, setRekon] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const [sumber, setSumber] = useState("Notion");
  const berkas = useRef(null);
  const boleh = opsi?.dataSebelumSistem?.boleh;

  const muat = useCallback(async () => {
    try { const [c, b] = await Promise.all([api.getLegacyCutoff(), api.getLegacyBatches()]); setCutoff(c); setBatches(b.items); } catch (e) { setPesan({ galat: true, teks: e.message }); }
  }, []);
  useEffect(() => { muat(); }, [muat]);

  async function jalan(fn, sukses) {
    if (sibuk) return;
    setSibuk(true); setPesan(null);
    try { const h = await fn(); setPesan({ teks: sukses ?? h?.pesan ?? "Selesai" }); await muat(); return h; }
    catch (e) { setPesan({ galat: true, teks: e.message }); }
    finally { setSibuk(false); }
  }
  async function unggah() {
    const f = berkas.current?.files?.[0];
    if (!f) { setPesan({ galat: true, teks: "Pilih berkas CSV atau XLSX ekspor Notion dulu." }); return; }
    const fd = new FormData(); fd.append("file", f); fd.append("sumber", sumber);
    const h = await jalan(() => api.uploadLegacyBatch(fd));
    if (h?.batch) await bukaBatch(h.batch.id);
    if (berkas.current) berkas.current.value = "";
  }
  async function bukaBatch(id, st = statusBaris) {
    try { setDetail(await api.getLegacyBatch(id, { status: st, limit: 100 })); } catch (e) { setPesan({ galat: true, teks: e.message }); }
  }
  async function batal(b) {
    const alasan = window.prompt("Alasan membatalkan impor ini (wajib):");
    if (!alasan?.trim()) return;
    await jalan(() => api.batalLegacyBatch(b.id, alasan.trim()), "Impor dibatalkan. Baris tidak lagi dihitung.");
    setDetail(null);
  }
  async function putuskan(baris, keputusan) {
    await jalan(() => api.keputusanLegacyBaris(baris.id, keputusan), keputusan === "TERIMA" ? "Baris diterima dan dihitung." : "Baris diabaikan.");
    if (detail) await bukaBatch(detail.batch.id);
  }
  async function bukaRekon() {
    try { const [r, p] = await Promise.all([api.getLegacyRekonsiliasi(), api.getLegacyProposal()]); setRekon(r); setProposal(p); } catch (e) { setPesan({ galat: true, teks: e.message }); }
  }

  return (
    <div className="fin-pm-historis">
      <p className="fin-catatan-kaki">{opsi?.labelHistoris ?? "Data sebelum penggunaan sistem berasal dari arsip lama dan belum memengaruhi buku besar sampai proses rekonsiliasi dan posting disetujui."}</p>
      {cutoff && (
        <section className="fin-panel" data-testid="tanggal-acuan-sistem">
          <p><strong>Tanggal acuan sistem:</strong> {cutoff.tanggal ? tanggalPendek(cutoff.tanggal) : "belum ada order di sistem"}. {cutoff.dasar}</p>
          <p className="fin-pm-kaki">Baris arsip bertanggal pada/setelah tanggal acuan tidak dihitung dari arsip (periode itu harus berasal dari order/invoice sistem).</p>
        </section>
      )}
      {pesan && <div role="status" className={`fin-pm-pesan ${pesan.galat ? "fin-pm-pesan-galat" : "fin-pm-pesan-ok"}`}>{pesan.teks}</div>}

      <Panel judul="Impor arsip (CSV / XLSX)" sub="Bukan input bebas: unggah ekspor Notion → pratinjau & validasi → impor. Tidak membuat jurnal, invoice, piutang, atau mengubah saldo Kas & Bank.">
        <div className="fin-pm-isi-panel">
          {boleh ? (
            <div className="fin-pm-impor">
              <input ref={berkas} type="file" accept=".csv,.xlsx" aria-label="Berkas CSV atau XLSX" />
              <Input value={sumber} onChange={(e) => setSumber(e.target.value)} placeholder="Sumber data" className="w-40" aria-label="Sumber data" />
              <Button onClick={unggah} disabled={sibuk}><Upload size={14} className="mr-1" /> Unggah & pratinjau</Button>
            </div>
          ) : <p className="fin-panel-sub">Akun Anda hanya dapat melihat. Impor arsip butuh izin mencatat.</p>}
          <p className="fin-pm-kaki">Kolom dikenali dari judul: tanggal transaksi, nomor/resi, pelanggan, keterangan, nominal, status pembayaran, tanggal pembayaran, metode pembayaran, sumber data. Nomor boleh kosong (sistem membuat ID legacy yang stabil).</p>
        </div>
      </Panel>

      <Panel judul="Batch impor">
        <div className="fin-pm-gulir" tabIndex={0} role="region" aria-label="Tabel batch impor; gulir mendatar bila perlu">
          <TableWrap className="dh-table"><Table fixed>
            <THead>
              <TR>
                <TH>Berkas</TH>
                <TH width={100} hideBelow="2xl" className="whitespace-nowrap">Waktu</TH>
                <TH width={112}>Status</TH>
                <TH numeric width={68} hideBelow="2xl">Baris</TH>
                <TH numeric width={60} hideBelow="2xl">Siap</TH>
                <TH numeric width={70} hideBelow="2xl">Tinjau</TH>
                <TH numeric width={80} hideBelow="2xl">Duplikat</TH>
                <TH numeric width={70} hideBelow="2xl">Di luar</TH>
                <TH numeric width={90} hideBelow="2xl">Tidak valid</TH>
                <TH numeric width={130}>Nilai siap</TH>
                <TH width={240} />
              </TR>
            </THead>
            <TBody>
              {(batches ?? []).length === 0 && <TR><TD colSpan={11} className="py-6 text-center text-ink3">Belum ada impor.</TD></TR>}
              {(batches ?? []).map((b) => (
                <TR key={b.id}>
                  <TD truncate className="font-medium">{b.fileName}<div className="truncate text-[11px] text-ink3">{b.sumberData}</div></TD>
                  <TD hideBelow="2xl" className="whitespace-nowrap">{tanggalPendek(b.dibuatPada)}</TD>
                  <TD><Badge variant={b.status === "IMPORTED" ? "green" : b.status === "CANCELLED" ? "gray" : "orange"}>{{ PREVIEW: "Pratinjau", IMPORTED: "Diimpor", CANCELLED: "Dibatalkan", POSTED: "Diposting" }[b.status]}</Badge></TD>
                  <TD hideBelow="2xl" numeric>{b.totalRows}</TD>
                  <TD hideBelow="2xl" numeric>{b.perStatus.SIAP ?? 0}</TD>
                  <TD hideBelow="2xl" numeric>{b.perStatus.PERLU_DITINJAU ?? 0}</TD>
                  <TD hideBelow="2xl" numeric>{b.perStatus.DUPLIKAT ?? 0}</TD>
                  <TD hideBelow="2xl" numeric>{b.perStatus.DI_LUAR_PERIODE ?? 0}</TD>
                  <TD hideBelow="2xl" numeric>{b.perStatus.TIDAK_VALID ?? 0}</TD>
                  <TD numeric><Rp v={b.nilaiSiap} /></TD>
                  <TD className="whitespace-nowrap">
                    <Button size="sm" variant="outline" onClick={() => bukaBatch(b.id)}>Lihat</Button>{" "}
                    {boleh && b.status === "PREVIEW" && <Button size="sm" disabled={sibuk} onClick={() => jalan(() => api.imporLegacyBatch(b.id), "Batch diimpor ke register (non-posting).")}>Impor</Button>}{" "}
                    {boleh && (b.status === "PREVIEW" || b.status === "IMPORTED") && <Button size="sm" variant="outline" disabled={sibuk} onClick={() => batal(b)}>Batalkan</Button>}
                  </TD>
                </TR>
              ))}
            </TBody></Table></TableWrap>
        </div>
      </Panel>

      <Panel judul="Rekonsiliasi & simulasi" sub="Total per bulan Januari sampai tanggal acuan, dibandingkan dengan jurnal saat ini. Hanya laporan — tidak ada yang diposting.">
        <div className="fin-pm-isi-panel">
          <Button size="sm" variant="outline" onClick={bukaRekon}>Tampilkan rekonsiliasi</Button>
          {rekon && (
            <>
              <div className="fin-pm-gulir" tabIndex={0} role="region" aria-label="Tabel rekonsiliasi per bulan; gulir mendatar bila perlu">
                <TableWrap className="dh-table"><Table fixed>
                  <THead>
                    <TR>
                      <TH width={100}>Bulan</TH>
                      <TH numeric width={120}>Pendapatan</TH>
                      <TH numeric width={110} hideBelow="2xl">Lunas</TH>
                      <TH numeric width={120} hideBelow="2xl">Belum dibayar</TH>
                      <TH numeric width={120} hideBelow="2xl">Tidak diketahui</TH>
                      <TH width={70} hideBelow="2xl">Tinjau</TH>
                      <TH width={150} hideBelow="2xl">Duplikat</TH>
                      <TH numeric width={120}>Jurnal saat ini</TH>
                      <TH numeric width={110}>Selisih</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rekon.perBulan.map((b) => (
                      <TR key={b.bulan}>
                        <TD className="whitespace-nowrap">{b.bulan}</TD>
                        <TD numeric><Rp v={b.pendapatan} /></TD>
                        <TD hideBelow="2xl" numeric><Rp v={b.lunas} /></TD>
                        <TD hideBelow="2xl" numeric><Rp v={b.belumBayar} /></TD>
                        <TD hideBelow="2xl" numeric><Rp v={b.tidakDiketahui} /></TD>
                        <TD hideBelow="2xl">{b.perluDitinjau.jumlah}</TD>
                        <TD hideBelow="2xl" truncate>{b.duplikat.jumlah}{b.duplikat.kemungkinanCocokOrderSistem ? ` (${b.duplikat.kemungkinanCocokOrderSistem} mirip order)` : ""}</TD>
                        <TD numeric><Rp v={b.jurnalSaatIni} /></TD>
                        <TD numeric><Rp v={b.selisihTerhadapJurnal} /></TD>
                      </TR>
                    ))}
                    <TR className="font-semibold">
                      <TD>Total</TD>
                      <TD numeric><Rp v={rekon.total.pendapatan} /></TD>
                      <TD hideBelow="2xl" numeric><Rp v={rekon.total.lunas} /></TD>
                      <TD hideBelow="2xl" numeric><Rp v={rekon.total.belumBayar} /></TD>
                      <TD hideBelow="2xl" numeric><Rp v={rekon.total.tidakDiketahui} /></TD>
                      <TD hideBelow="2xl" /><TD hideBelow="2xl" />
                      <TD numeric><Rp v={rekon.total.jurnalSaatIni} /></TD>
                      <TD numeric><Rp v={rekon.total.selisihTerhadapJurnal} /></TD>
                    </TR>
                  </TBody></Table></TableWrap>
              </div>
              <p className="fin-catatan-kaki">{rekon.simulasi.catatan} Dampak simulasi: laba/pendapatan +{teksRp(rekon.simulasi.labaRugi.pendapatanBertambah)}, piutang +{teksRp(rekon.simulasi.piutang.bertambah)}, kas {teksRp(rekon.simulasi.kas.berubah)} (tidak berubah), total ekuitas +{teksRp(rekon.simulasi.ekuitas.berubah)} (laba +{teksRp(rekon.simulasi.ekuitas.labaBertambah)}, Koreksi Saldo Awal −{teksRp(rekon.simulasi.ekuitas.koreksiSaldoAwalBerkurang)}).</p>
              {proposal && (
                <details className="fin-pm-proposal"><summary>{proposal.status} — proposal jurnal migrasi</summary>
                  <p className="mt-2 text-ink2">{proposal.persetujuan}</p>
                  <ul className="mt-1 list-disc pl-5 text-ink2">{proposal.prinsip.map((p) => <li key={p}>{p}</li>)}</ul>
                  {proposal.jurnal.map((j) => (
                    <div key={j.bulan} className="mt-2"><p className="font-medium">{j.bulan}</p>
                      {j.lines.map((l, i) => <div key={i} className="flex justify-between gap-3"><span>{l.akun} {l.nama}{l.catatan ? ` — ${l.catatan}` : ""}</span><span className="tabular-nums">D {teksRp(l.debit)} / K {teksRp(l.kredit)}</span></div>)}
                    </div>
                  ))}
                </details>
              )}
            </>
          )}
        </div>
      </Panel>

      <DaftarPemasukan
        periode={periode} tab={{ ...tabDari("historis"), judul: "Baris arsip yang dihitung / perlu ditinjau pada periode terpilih", ringkas: "Hanya baris arsip yang siap, perlu ditinjau, atau duplikat pada periode ini." }}
        opsi={{ ...opsi, status: [{ id: "SIAP", label: "Siap" }, { id: "PERLU_DITINJAU", label: "Perlu ditinjau" }, { id: "DUPLIKAT", label: "Duplikat" }] }} indeksRek={indeksRek} onBuka={onBuka}
        judulKosong="Belum ada data arsip pada periode ini (unggah & impor dulu)."
      />

      {detail && (
        <Modal open onOpenChange={(v) => { if (!v) setDetail(null); }} title={`Batch: ${detail.batch.fileName}`} className="max-w-5xl">
          <div className="space-y-3 text-[13px]">
            <p>Status <strong>{detail.batch.status}</strong> · tanggal acuan {tanggalPendek(detail.batch.cutoff)} · {detail.ringkasan.jumlah} baris · siap {detail.ringkasan.perStatus.SIAP} ({teksRp(detail.ringkasan.nilaiSiap)}) · tinjau {detail.ringkasan.perStatus.PERLU_DITINJAU} · duplikat {detail.ringkasan.perStatus.DUPLIKAT} · di luar periode {detail.ringkasan.perStatus.DI_LUAR_PERIODE} · tidak valid {detail.ringkasan.perStatus.TIDAK_VALID}</p>
            <select value={statusBaris} onChange={(e) => { setStatusBaris(e.target.value); bukaBatch(detail.batch.id, e.target.value); }} className="rounded-lg border px-2 py-1" aria-label="Filter status baris">
              <option value="">Semua status</option><option value="SIAP">Siap</option><option value="PERLU_DITINJAU">Perlu ditinjau</option><option value="DUPLIKAT">Duplikat</option><option value="DI_LUAR_PERIODE">Di luar periode</option><option value="TIDAK_VALID">Tidak valid</option>
            </select>
            <TableWrap><Table>
              <THead><TR><TH>#</TH><TH>Tanggal</TH><TH>Nomor</TH><TH>Pelanggan</TH><TH className="text-right">Nilai</TH><TH>Bayar</TH><TH>Status</TH><TH>Alasan</TH><TH /></TR></THead>
              <TBody>
                {detail.items.map((b) => (
                  <TR key={b.id}>
                    <TD>{b.rowNo}</TD><TD className="whitespace-nowrap">{b.tanggal ? tanggalPendek(b.tanggal) : "—"}</TD><TD>{b.nomorLama ?? <span className="text-ink3">{b.legacyId}</span>}</TD><TD>{b.pelanggan ?? "—"}</TD>
                    <TD className="text-right">{b.nilai === null ? "—" : <Rp v={b.nilai} />}</TD><TD>{b.payLabel}</TD><TD><BadgeStatus label={b.keputusan === "ABAIKAN" ? "Diabaikan" : b.keputusan === "TERIMA" ? "Diterima" : b.statusLabel} nada={b.nada} /></TD>
                    <TD className="max-w-[260px] text-[12px] text-ink2">{b.alasan}</TD>
                    <TD className="whitespace-nowrap">
                      {boleh && detail.batch.status === "IMPORTED" && b.status === "PERLU_DITINJAU" && !b.keputusan && (<><Button size="sm" disabled={sibuk} onClick={() => putuskan(b, "TERIMA")}>Terima</Button>{" "}<Button size="sm" variant="outline" disabled={sibuk} onClick={() => putuskan(b, "ABAIKAN")}>Abaikan</Button></>)}
                    </TD>
                  </TR>
                ))}
              </TBody></Table></TableWrap>
            {detail.adaLagi && <p className="text-ink3">Menampilkan 100 baris pertama dari {detail.total}. Gunakan filter status untuk mempersempit.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── MENUNGGU VERIFIKASI ──────────────────────────────────────────────────────────────────────────────────────
// Satu antrean untuk semua yang secara bisnis perlu dicek Finance. DUA sumber berbeda: (1) Klaim Lunas dari Sales = flag status order di CRM, belum ada
// catatan uang masuk; (2) pembayaran yang sudah tercatat tetapi belum diverifikasi. Jumlah keduanya TIDAK digabung di sini.
function PerluVerifikasi({ periode, opsi, indeksRek, onBuka }) {
  return (
    <div className="fin-pm-verif" data-testid="tab-perlu-verifikasi">
      <p className="fin-catatan-kaki">
        <strong>Menunggu verifikasi</strong> memuat dua hal berbeda: <strong>klaim lunas dari Sales</strong> (status order di CRM, belum ada catatan uang masuk)
        dan <strong>uang masuk yang sudah tercatat tapi belum diverifikasi</strong>. Keduanya dulu terpisah, sehingga klaim Sales tidak terlihat di daftar pembayaran.
      </p>
      <section aria-label="Klaim lunas dari Sales" className="fin-panel">
        <div className="fin-panel-kepala"><h2 className="fin-panel-judul">1. Klaim lunas dari Sales</h2><p className="fin-panel-sub">Status lunas di CRM yang belum punya catatan uang masuk. Semua periode.</p></div>
        <LunasBelumDicatat ringkas />
      </section>
      <DaftarPemasukan
        key="perlu-uang" periode={periode} indeksRek={indeksRek} opsi={opsi} onBuka={onBuka} statusAwal="MENUNGGU"
        tab={{ ...tabDari("pembayaran"), judul: "2. Uang masuk tercatat, menunggu verifikasi", ringkas: "Catatan pembayaran pada periode terpilih yang belum diverifikasi Finance." }}
        judulKosong="Tidak ada pembayaran tercatat yang menunggu verifikasi pada periode ini."
      />
    </div>
  );
}

/** Catatan di modal rincian bagi baris yang tidak masuk total: alasan server (sama dengan Excel), alasan batal, pembayaran pengganti. */
function AlasanTidakDihitung({ b }) {
  const a = susunAlasan(b);
  if (!a) return null;
  return (
    <div className="space-y-1.5 rounded-lg bg-inset p-3" role="note" aria-label="Alasan tidak dihitung" data-testid="detail-alasan-tidak-dihitung">
      <p className="font-medium text-ink2">Tidak dihitung ke total</p>
      <p className="break-words">{a.teks}</p>
      {a.alasanBatal && <p className="break-words">Alasan pembatalan: {a.alasanBatal}</p>}
      {a.pengganti && (
        <div>
          <p className="font-medium text-ink2">Pembayaran pengganti{a.pengganti.kecocokan ? ` · ${a.pengganti.kecocokan}` : ""}</p>
          <ul className="mt-1 space-y-1">
            {a.pengganti.daftar.map((g) => (
              <li key={g.kunci} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
                <span className="text-ink3">{g.id}</span>
                {g.tanggal && <span>{tanggalPendek(g.tanggal)}</span>}
                {g.nominal !== null && <span>{teksRp(g.nominal)}</span>}
                <span className={g.terverifikasi ? "text-green" : "text-orange"}>{g.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-ink2">Nominal tercatat <span className="font-medium text-ink">{teksRp(a.nilaiAsli)}</span> · masuk total <span className="font-medium text-ink">{teksRp(a.nilaiDihitung)}</span></p>
    </div>
  );
}

// ── HALAMAN ──────────────────────────────────────────────────────────────────────────────────────────────────
export default function FinancePemasukan() {
  const nav = useNavigate();
  const [periode, setPeriode] = usePeriodeFinance();
  const [tab, setTab] = useState("ringkasan");
  const [opsi, setOpsi] = useState(null);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailGalat, setDetailGalat] = useState(null);
  const [akun, setAkun] = useState(undefined);
  const [rk, setRk] = useState({ kunci: null, data: null, galat: null });
  const urutRk = useRef(0);
  const kunciP = `${periode.from}|${periode.to}`;

  useEffect(() => { api.getFinancePemasukanOpsi().then(setOpsi).catch((e) => setError(e.message)); }, []);

  // Ringkasan dimuat untuk tab Ringkasan dan Uang masuk (ringkasan nilai terverifikasi). Hanya respons permintaan TERAKHIR yang dipakai (periode lama tidak menimpa yang baru).
  const muatRk = useCallback(async () => {
    const saya = ++urutRk.current;
    try {
      const d = await api.getFinancePemasukanRingkasan({ from: periode.from, to: periode.to });
      if (saya === urutRk.current) setRk({ kunci: kunciP, data: d, galat: null });
    } catch (e) { if (saya === urutRk.current) setRk({ kunci: kunciP, data: null, galat: e.message || "Gagal memuat ringkasan" }); }
  }, [periode.from, periode.to, kunciP]);
  const butuhRk = tab === "ringkasan" || tab === "pembayaran";
  useEffect(() => { if (butuhRk && rk.kunci !== kunciP) muatRk(); }, [butuhRk, kunciP]); // eslint-disable-line react-hooks/exhaustive-deps
  const rkIni = rk.kunci === kunciP ? rk : { data: null, galat: null };

  // Rekening (kas/bank/e-wallet) untuk logo bank di daftar. Sumber lama (daftar rekening); bila gagal dimuat → logo netral, daftar tetap berfungsi.
  const butuhAkun = !["ringkasan", "pendapatan"].includes(tab);
  useEffect(() => {
    if (!butuhAkun || akun !== undefined) return;
    api.getFinanceCashAccounts().then((r) => setAkun(r?.accounts ?? [])).catch(() => setAkun([]));
  }, [butuhAkun, akun]);
  const indeksRek = useMemo(() => indeksRekening(akun), [akun]);

  const aktif = tabDari(tab);
  const ke = useCallback((id) => { setTab(id); window.scrollTo?.({ top: 0 }); }, []);

  async function buka(b) {
    setDetail({ memuat: true, baris: b }); setDetailGalat(null);
    try { setDetail({ baris: b, ...(await api.getFinancePemasukanDetail(b.jenis, b.id)) }); }
    catch (e) { setDetailGalat(e.message); }
  }
  const tautan = detail?.baris?.tautan;

  const ringkasanUang = rkIni.data
    ? { keadaan: "ada", nilai: rkIni.data.pembayaranMasuk.terverifikasi.nilai, jumlah: rkIni.data.pembayaranMasuk.terverifikasi.jumlah }
    : { keadaan: rkIni.galat ? "tidak" : "memuat" };

  const judul = tab === "ringkasan"
    ? "Pemasukan"
    : <><span className="fin-pm-induk">Pemasukan</span><ChevronRight size={22} className="fin-pm-induk-panah" aria-hidden="true" /><span className="fin-sr-saja">: </span>{aktif.judul}</>;
  const subjudul = tab === "ringkasan"
    ? "Pendapatan, pembayaran, dan tagihan dalam satu tampilan."
    : aktif.ringkas;

  return (
    <HalamanFinance
      className="fin-halaman" title={judul} subtitle={subjudul}
      actions={<div className="fin-pm-aksi"><PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />{opsi?.aksiCatat?.boleh && <Button size="sm" onClick={() => nav("/finance/cash?tab=pemasukan")}>Catat pemasukan lain</Button>}</div>}
      loading={false} error={error} onRetry={() => window.location.reload()}
    >
      <div className="fin-ring fin-pm" data-testid="halaman-pemasukan" data-tab={tab}>
        <StripSementara teks={PERINGATAN_PENDAPATAN_2026} />
        <PemilihKategori tab={tab} onTab={ke} />

        {tab === "ringkasan" && (
          rkIni.galat
            ? <section className="fin-panel"><p className="fin-galat" role="alert">Gagal memuat ringkasan: {rkIni.galat} <button type="button" className="fin-pm-reset" onClick={muatRk}>Coba lagi</button></p></section>
            : !rkIni.data
              ? <section className="fin-panel" aria-busy="true"><p className="fin-kosong">Memuat ringkasan…</p></section>
              : <RingkasanPemasukan r={rkIni.data} periode={periode} ke={ke} navigate={nav} />
        )}
        {tab === "verifikasi" && <PerluVerifikasi periode={periode} opsi={opsi} indeksRek={indeksRek} onBuka={buka} />}
        {["pendapatan", "pembayaran", "lain", "dana"].includes(tab) && (
          <DaftarPemasukan key={tab} periode={periode} tab={aktif} opsi={opsi} indeksRek={indeksRek} onBuka={buka} ringkasanUang={tab === "pembayaran" ? ringkasanUang : null} />
        )}
        {tab === "historis" && <DataSebelumSistem periode={periode} opsi={opsi} indeksRek={indeksRek} onBuka={buka} />}
      </div>

      {detail && (
        <Modal open onOpenChange={(v) => { if (!v) setDetail(null); }} title={`${detail.baris.nomor} — ${detail.baris.kategoriLabel}`}>
          <div className="space-y-3 text-[13px]">
            {detailGalat && <p className="text-red">Gagal memuat detail: {detailGalat}</p>}
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-ink3">Tanggal</span><div>{tanggalPendek(detail.baris.tanggal)}</div></div>
              <div><span className="text-ink3">Nilai</span><div><Rp v={detail.baris.nilai} /></div></div>
              <div><span className="text-ink3">Pelanggan / pembayar</span><div>{detail.baris.pihak ?? "—"}</div></div>
              <div><span className="text-ink3">Status</span><div>{detail.baris.statusBayar ? <>{detail.baris.statusBayar.label}{detail.baris.statusBayar.rekeningBelumDiketahui ? " · rekening belum diketahui" : ""}</> : detail.baris.statusLabel}</div></div>
              <div><span className="text-ink3">Sumber</span><div>{detail.baris.sumberLabel}</div></div>
              <div><span className="text-ink3">Rekening</span><div>{detail.baris.rekening ?? "—"}</div></div>
              <div className="col-span-2"><span className="text-ink3">Keterangan</span><div>{detail.baris.keterangan}</div></div>
            </div>
            {tidakDihitung(detail.baris) && <AlasanTidakDihitung b={detail.baris} />}
            <div>
              <p className="font-semibold">Klasifikasi akuntansi (dihitung server)</p>
              {(detail.klasifikasi ?? [{ kategoriLabel: detail.baris.kategoriLabel, subLabel: detail.baris.subLabel, nilai: detail.baris.nilai, catatan: detail.baris.catatan }]).map((k, i) => (
                <div key={i} className="mt-1 rounded-lg border p-2"><div>{k.kategoriLabel}{k.subLabel ? ` — ${k.subLabel}` : ""}: <Rp v={k.nilai} /></div>{k.catatan && <div className="text-orange">{k.catatan}</div>}</div>
              ))}
              {detail.penjelasan && <p className="mt-1 text-ink2">{detail.penjelasan}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {tautan?.jurnal && <Button size="sm" variant="outline" onClick={() => nav("/finance/journal")}>Jurnal {tautan.jurnal.nomor}</Button>}
              {tautan?.invoice && <Button size="sm" variant="outline" onClick={() => nav("/finance/invoices")}>Invoice {tautan.invoice.nomor}</Button>}
              {tautan?.pembayaran && <Button size="sm" variant="outline" onClick={() => nav("/finance/payments")}>Pembayaran</Button>}
              {tautan?.dokumen?.modul === "pemasukan" && <Button size="sm" variant="outline" onClick={() => nav("/finance/cash?tab=pemasukan")}>Pemasukan Lain</Button>}
            </div>
          </div>
        </Modal>
      )}
    </HalamanFinance>
  );
}
