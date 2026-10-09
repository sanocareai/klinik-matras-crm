import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { KartuAngka, formatUang, Pilihan, tanggalPendek, TombolAksi } from "@/features/finance/shared.jsx";
import { KenapaBeda } from "@/features/finance/kontrak.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import {
  TAB_AGING, NADA_INDIKATOR, VARIAN_STATUS_PEMBAYARAN, VARIAN_STATUS_BARANG, VARIAN_STATUS_FAKTUR, teksJatuhTempo, teksTermin,
} from "@/features/finance/terminLogic.js";

// JADWAL & AGING UTANG SUPPLIER. Semua angka (kartu, tabel, detail) datang dari SATU read-model server (GET /finance/utang/aging) — sama dengan export Excel.
// Aging menurut TANGGAL JATUH TEMPO, bukan tanggal barang datang. Tiga status DIPISAH: barang, faktur, pembayaran. Layar ini tidak membayar apa pun:
// "Atur jadwal bayar" hanya menyimpan rencana; pembayaran tetap lewat tab Pembayaran.
const LABEL_BARANG = { BELUM_DATANG: "Belum Datang", DITERIMA_SEBAGIAN: "Diterima Sebagian", SIAP_DISIMPAN: "Siap Disimpan", SUDAH_MASUK_STOK: "Sudah Masuk Stok", SELESAI: "Selesai" };
const LABEL_FAKTUR = { BELUM_ADA_FAKTUR: "Belum Ada Faktur", FAKTUR_DITERIMA: "Faktur Diterima", PERLU_DITINJAU: "Perlu Ditinjau", DISETUJUI: "Disetujui", DIBATALKAN: "Dibatalkan" };
const LABEL_BAYAR = { BELUM_JATUH_TEMPO: "Belum Jatuh Tempo", JATUH_TEMPO_7_HARI: "Jatuh Tempo ≤7 Hari", JATUH_TEMPO_HARI_INI: "Jatuh Tempo Hari Ini", TERLAMBAT: "Terlambat", DIBAYAR_SEBAGIAN: "Dibayar Sebagian", LUNAS: "Lunas", TANPA_JATUH_TEMPO: "Jatuh Tempo Belum Diisi" };
const GARIS = { merah: "border-l-red", jingga: "border-l-orange", biru: "border-l-accent", hijau: "border-l-green", netral: "border-l-line" };

function TigaStatus({ r }) {
  return (
    <div className="flex flex-wrap gap-1" data-testid="tiga-status">
      {r.statusBarang ? <Badge variant={VARIAN_STATUS_BARANG[r.statusBarang]}>Barang: {LABEL_BARANG[r.statusBarang]}</Badge> : <Badge variant="neutral">Barang: tidak berlaku</Badge>}
      {r.adaBarangDitolak && <Badge variant="orange">Ada Barang Ditolak</Badge>}
      <Badge variant={VARIAN_STATUS_FAKTUR[r.statusFaktur]}>Faktur: {LABEL_FAKTUR[r.statusFaktur]}</Badge>
      <Badge variant={VARIAN_STATUS_PEMBAYARAN[r.statusPembayaran]}>Bayar: {LABEL_BAYAR[r.statusPembayaran]}</Badge>
    </div>
  );
}

export default function JadwalAgingUtang({ suppliers = [], rekening = [], bolehJadwal = false, onBukaPembayaran }) {
  const [kelompok, setKelompok] = useState("AKTIF");
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const [supplierId, setSupplierId] = useState("");
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  const [detailId, setDetailId] = useState(null);
  const pernah = useRef(false);

  const muat = useCallback(async () => {
    try {
      const params = { kelompok, q: qTunda.trim() || undefined, supplierId: supplierId || undefined };
      setData(await api.getAgingUtang(params)); setGalat("");
    } catch (e) { setGalat(e.message || "Gagal memuat jadwal utang"); }
  }, [kelompok, qTunda, supplierId]);
  useEffect(() => { muat(); pernah.current = true; }, [muat]);

  if (galat && !data) return <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{galat}</p>;
  if (!data) return <p className="text-[13px] text-ink3">Memuat jadwal utang…</p>;
  const k = data.ringkasan.kartu;
  const baris = data.baris;
  const terlambat = k.jumlahTerlambat;

  return (
    <div className="space-y-4" data-testid="jadwal-aging">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" data-testid="kartu-aging">
        <KartuAngka label="Total Utang Aktif" metrik="utang_jatuh_tempo_aging" value={formatUang(k.totalUtangAktif)} sub={`${k.jumlahFakturAktif} faktur`} />
        <KartuAngka label="Terlambat" value={formatUang(k.totalTerlambat)} tone={terlambat > 0 ? "red" : "default"} sub={`${terlambat} faktur`} />
        <KartuAngka label="Jatuh Tempo 7 Hari" value={formatUang(k.jatuhTempo7Hari)} tone={k.jumlahJatuhTempo7Hari > 0 ? "orange" : "default"} sub={`${k.jumlahJatuhTempo7Hari} faktur (termasuk hari ini)`} />
        <KartuAngka label="Jatuh Tempo 30 Hari" value={formatUang(k.jatuhTempo30Hari)} sub={`${k.jumlahJatuhTempo30Hari} faktur`} />
        <KartuAngka label="Sudah Dijadwalkan" value={formatUang(k.sudahDijadwalkan)} sub={`${k.jumlahDijadwalkan} faktur — rencana, belum dibayar`} />
        <KartuAngka label="Tanpa Jatuh Tempo" value={formatUang(k.tanpaJatuhTempo)} tone={k.jumlahTanpaJatuhTempo > 0 ? "orange" : "default"} sub={`${k.jumlahTanpaJatuhTempo} faktur — tanggal belum diisi`} />
      </div>
      <KenapaBeda metrik={["utang_jatuh_tempo_aging", "utang_supplier"]} />

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Kelompok aging">
        {TAB_AGING.map((t) => {
          const g = data.ringkasan.perKelompok.find((x) => x.kunci === t.kunci);
          const jumlah = t.kunci === "AKTIF" ? k.jumlahFakturAktif : t.kunci === "DIBAYAR_SEBAGIAN" ? k.jumlahDibayarSebagian : g?.jumlah;
          return (
            <Button key={t.kunci} size="sm" variant={kelompok === t.kunci ? "secondary" : "neutral"} role="tab" aria-selected={kelompok === t.kunci} onClick={() => setKelompok(t.kunci)}>
              {t.label}{jumlah != null && <span className="ml-1 tabular-nums text-ink3">{jumlah}</span>}
            </Button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <FilterBar q={q} onQ={setQ} placeholder="Cari supplier, no. faktur, no. PO…" filters={[]} ringkasan={`${baris.length} faktur`} onReset={() => { setQ(""); setSupplierId(""); }} />
        </div>
        <Field label="Supplier" className="w-56 max-sm:w-full">
          <Pilihan value={supplierId} onChange={setSupplierId} aria-label="Filter supplier">
            <option value="">Semua supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Pilihan>
        </Field>
        <TombolExportExcel
          modul="aging-utang"
          ambilBody={() => ({ filter: { q: qTunda.trim() || undefined, supplierId: supplierId || undefined }, filterLabel: labelFilterAktif([["Pencarian", qTunda.trim()], ["Supplier", suppliers.find((s) => s.id === supplierId)?.name]]) })}
        />
      </div>

      {baris.length === 0 ? (
        <Card><CardContent><EmptyState icon={CalendarClock} title="Tidak ada faktur di kelompok ini" description="Faktur muncul di sini setelah disetujui. Aging dihitung dari tanggal jatuh tempo." /></CardContent></Card>
      ) : (
        <>
          <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
            <Table>
              <THead>
                <TR><TH>Supplier / Faktur</TH><TH>PO</TH><TH>Barang diterima</TH><TH>Tgl faktur</TH><TH>Termin</TH><TH>Jatuh tempo</TH><TH numeric>Nilai</TH><TH numeric>Dibayar</TH><TH numeric>Sisa</TH><TH>Status</TH></TR>
              </THead>
              <TBody>
                {baris.map((r) => (
                  <TR key={r.rowKey ?? r.billId} clickable onClick={() => setDetailId(r.billId)} className={cn("border-l-4", GARIS[r.indikator])} data-testid="baris-aging">
                    <TD><div className="font-medium text-ink">{r.supplier}</div><div className="font-mono text-[11.5px] text-ink2">{r.nomorFaktur || r.nomorTagihan}</div></TD>
                    <TD className="font-mono text-[12px]">{r.po?.nomor ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-[12px]">{r.tanggalBarangDiterima ? tanggalPendek(r.tanggalBarangDiterima) : "—"}</TD>
                    <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(r.tanggalFaktur)}</TD>
                    <TD className="text-[12px]">{teksTermin(r.termin)}</TD>
                    <TD className="whitespace-nowrap text-[12px]"><div>{r.tanggalJatuhTempo ? tanggalPendek(r.tanggalJatuhTempo) : <span className="text-orange">Belum diisi</span>}</div><div className={cn("text-[11.5px]", r.indikator === "merah" ? "font-semibold text-red" : r.indikator === "jingga" ? "text-orange" : "text-ink3")}>{teksJatuhTempo(r)}</div></TD>
                    <TD numeric>{formatUang(r.nilaiFaktur)}</TD>
                    <TD numeric>{formatUang(r.dibayar)}</TD>
                    <TD numeric className="font-semibold">{formatUang(r.sisaUtang)}</TD>
                    <TD><TigaStatus r={r} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <CardList className={CARD_VIEW_CLASS}>
            {baris.map((r) => (
              <RowCard
                key={r.rowKey ?? r.billId} className={cn("border-l-4", GARIS[r.indikator])} onClick={() => setDetailId(r.billId)}
                title={r.nomorFaktur || r.nomorTagihan} subtitle={r.supplier}
                status={<Badge variant={NADA_INDIKATOR[r.indikator].variant}>{teksJatuhTempo(r)}</Badge>}
                fields={[
                  { label: "Sisa utang", value: formatUang(r.sisaUtang) }, { label: "Nilai faktur", value: formatUang(r.nilaiFaktur) },
                  { label: "Jatuh tempo", value: r.tanggalJatuhTempo ? tanggalPendek(r.tanggalJatuhTempo) : "Belum diisi" }, { label: "Termin", value: teksTermin(r.termin) },
                  { label: "PO", value: r.po?.nomor ?? "—" }, { label: "Barang diterima", value: r.tanggalBarangDiterima ? tanggalPendek(r.tanggalBarangDiterima) : "—" },
                  { label: "Status", value: <TigaStatus r={r} /> },
                ]}
              />
            ))}
          </CardList>
        </>
      )}
      {detailId && <DetailUtang billId={detailId} rekening={rekening} bolehJadwal={bolehJadwal} onClose={() => setDetailId(null)} onChanged={muat} onBukaPembayaran={onBukaPembayaran} />}
    </div>
  );
}

function DetailUtang({ billId, rekening, bolehJadwal, onClose, onChanged, onBukaPembayaran }) {
  const [d, setD] = useState(null);
  const [galat, setGalat] = useState("");
  const [f, setF] = useState({ date: "", cashAccountId: "", note: "" });
  const [sibuk, setSibuk] = useState(false);
  const muat = useCallback(async () => {
    try {
      const r = await api.getAgingUtangDetail(billId); setD(r); setGalat("");
      setF({ date: r.jadwalBayar?.tanggal ?? "", cashAccountId: r.jadwalBayar?.rekeningId ?? "", note: r.jadwalBayar?.catatan ?? "" });
    } catch (e) { setGalat(e.message || "Gagal memuat detail"); }
  }, [billId]);
  useEffect(() => { muat(); }, [muat]);

  async function simpan(hapus = false) {
    setSibuk(true); setGalat("");
    try { setD(await api.aturJadwalBayar(billId, hapus ? { date: null } : { date: f.date, cashAccountId: f.cashAccountId, note: f.note })); await onChanged(); if (hapus) setF({ date: "", cashAccountId: "", note: "" }); }
    catch (e) { setGalat(e.message || "Gagal menyimpan jadwal"); } finally { setSibuk(false); }
  }

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={d ? `${d.supplier} — ${d.nomorFaktur || d.nomorTagihan}` : "Memuat…"} description={d ? `Tagihan ${d.nomorTagihan}${d.po ? ` · ${d.po.nomor}` : ""}` : undefined} className="w-[720px]">
      {!d ? <p className="py-4 text-[13px] text-ink3">{galat || "Memuat…"}</p> : (
        <div className="space-y-4" data-testid="detail-utang">
          <TigaStatus r={d} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-3">
            <div><dt className="text-ink3">Tanggal barang diterima</dt><dd className="m-0 font-medium">{d.tanggalBarangDiterima ? tanggalPendek(d.tanggalBarangDiterima) : "—"}</dd></div>
            <div><dt className="text-ink3">Tanggal faktur</dt><dd className="m-0 font-medium">{tanggalPendek(d.tanggalFaktur)}</dd></div>
            <div><dt className="text-ink3">Jatuh tempo</dt><dd className="m-0 font-medium">{d.tanggalJatuhTempo ? tanggalPendek(d.tanggalJatuhTempo) : "Belum diisi"} · {teksJatuhTempo(d)}</dd></div>
            <div><dt className="text-ink3">Termin</dt><dd className="m-0 font-medium">{teksTermin(d.termin)}</dd></div>
            <div><dt className="text-ink3">Umur utang</dt><dd className="m-0 font-medium">{d.umurUtangHari} hari sejak faktur</dd></div>
            <div><dt className="text-ink3">Rekening</dt><dd className="m-0 font-medium">{d.rekeningPembayaran ?? "—"}</dd></div>
            <div><dt className="text-ink3">Nilai faktur</dt><dd className="m-0 font-medium tabular-nums">{formatUang(d.nilaiFaktur)}</dd></div>
            <div><dt className="text-ink3">Sudah dibayar</dt><dd className="m-0 font-medium tabular-nums">{formatUang(d.dibayar)}</dd></div>
            <div><dt className="text-ink3">Sisa utang</dt><dd className="m-0 font-semibold tabular-nums">{formatUang(d.sisaUtang)}</dd></div>
          </dl>
          {d.termin.alasanOverride && (
            <p className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="alasan-override">Termin/tanggal diganti{d.termin.oleh ? ` oleh ${d.termin.oleh}` : ""}: {d.termin.alasanOverride}</p>
          )}
          {!d.tanggalJatuhTempo && <p className="m-0 flex items-center gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange"><AlertTriangle size={13} aria-hidden /> Tanggal jatuh tempo belum diisi (data lama). Sistem tidak menebaknya — isi lewat Edit Info Tagihan.</p>}

          <section>
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Riwayat pembayaran</h4>
            {d.pembayaran.length === 0 ? <p className="m-0 text-[12.5px] text-ink3">Belum ada pembayaran aktif. Pembayaran dibatalkan lewat reversal dan tidak dihitung di sini.</p> : (
              <ul className="m-0 list-none space-y-1 p-0">
                {d.pembayaran.map((p) => (
                  <li key={p.paymentId} className="flex flex-wrap items-center gap-x-3 rounded-btn border border-line px-3 py-1.5 text-[12.5px]">
                    <span className="font-mono text-[12px] font-semibold">{p.nomor}</span><span className="text-ink3">{tanggalPendek(p.tanggal)}</span><span className="text-ink2">{p.rekening ?? "—"}</span>
                    <span className="ml-auto tabular-nums font-medium">{formatUang(p.jumlah)}</span>
                    {p.biayaTransfer > 0 && <span className="text-[11.5px] text-ink3">+ biaya transfer {formatUang(p.biayaTransfer)} (terpisah)</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Jadwal bayar (rencana)</h4>
            {d.jadwalBayar && <p className="mb-2 text-[12.5px] text-ink2" data-testid="jadwal-tersimpan">Direncanakan {tanggalPendek(d.jadwalBayar.tanggal)} lewat {d.jadwalBayar.rekening ?? "—"}{d.jadwalBayar.oleh ? ` · oleh ${d.jadwalBayar.oleh}` : ""}{d.jadwalBayar.catatan ? ` · ${d.jadwalBayar.catatan}` : ""}</p>}
            {bolehJadwal && d.statusPembayaran !== "LUNAS" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Tanggal rencana"><Input type="date" value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} aria-label="Tanggal rencana bayar" /></Field>
                <Field label="Rekening"><Pilihan value={f.cashAccountId} onChange={(v) => setF((s) => ({ ...s, cashAccountId: v }))} aria-label="Rekening rencana bayar"><option value="">— pilih —</option>{rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Pilihan></Field>
                <Field label="Catatan"><Input value={f.note} onChange={(e) => setF((s) => ({ ...s, note: e.target.value }))} /></Field>
              </div>
            ) : <p className="m-0 text-[12px] text-ink3">{d.statusPembayaran === "LUNAS" ? "Faktur sudah lunas." : "Hanya pengguna dengan izin mencatat (finance:post) yang dapat mengatur jadwal bayar."}</p>}
            {galat && <p role="alert" className="mt-2 text-[12.5px] text-red">{galat}</p>}
            <p className="mt-2 text-[11.5px] text-ink3">Jadwal hanya rencana: tidak membayar, tidak membuat jurnal. Pembayaran sebenarnya dicatat di tab Pembayaran dan tidak menutup faktur bila hanya sebagian.</p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {d.jadwalBayar && bolehJadwal && <Button variant="neutral" size="sm" disabled={sibuk} onClick={() => simpan(true)}>Hapus jadwal</Button>}
              {bolehJadwal && d.statusPembayaran !== "LUNAS" && <TombolAksi disabled={sibuk || !f.date || !f.cashAccountId} onClick={() => simpan(false)}>Simpan jadwal</TombolAksi>}
              {onBukaPembayaran && d.statusPembayaran !== "LUNAS" && <Button size="sm" variant="secondary" onClick={() => { onClose(); onBukaPembayaran(d); }}>Catat pembayaran…</Button>}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
