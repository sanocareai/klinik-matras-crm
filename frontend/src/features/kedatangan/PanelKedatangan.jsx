import React, { useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, ChevronUp, History, PackageCheck, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { TombolAksi } from "@/features/finance/shared.jsx";
import { api } from "@/api.js";
import { compressImage } from "@/utils/compressImage.js";
import {
  LABEL_PENERIMAAN, VARIAN_PENERIMAAN, LABEL_WORKSPACE, jumlahTeks, tanggalTeks, waktuTeks, teksPendampingAktual,
  formKedatanganAwal, galatKedatangan, kekuranganIsian, bodyKedatangan, formKoreksiAwal, bodyKoreksi, galatKoreksi, kalimatRiwayat,
} from "@/features/kedatangan/kedatanganLogic.js";

// Panel KEDATANGAN barang pada satu PO — dipakai Gudang (Barang Akan Datang) dan Finance (detail PO). Data dan aturan SATU sumber (server): layar hanya menampilkan.
// Mencatat kedatangan TIDAK mengubah stok dan TIDAK membuat jurnal; stok baru bertambah saat Gudang menekan "Simpan ke Stok" di Penerimaan Barang.

// ── Tabel kuantitas per item ─────────────────────────────────────────────
export function TabelKuantitas({ lines, finance = false }) {
  return (
    <>
      <TableWrap className="hidden md:block">
        <Table>
          <THead>
            <TR><TH>Item</TH><TH numeric>Dipesan</TH><TH numeric>Datang</TH><TH numeric>Baik</TH><TH numeric>Ditolak</TH><TH numeric>Masuk stok</TH><TH numeric>Sisa</TH><TH>Jumlah fisik pendamping</TH>{finance && <TH numeric>Harga satuan</TH>}</TR>
          </THead>
          <TBody>
            {lines.map((l) => (
              <TR key={l.id} data-testid="baris-kuantitas">
                <TD><div className="font-medium text-ink">{l.kode}</div><div className="text-[11.5px] text-ink2">{l.nama}</div></TD>
                <TD numeric>{jumlahTeks(l.dipesan)} {l.satuan}</TD>
                <TD numeric>{jumlahTeks(l.datang)}</TD>
                <TD numeric>{jumlahTeks(l.baik)}</TD>
                <TD numeric>{jumlahTeks(l.ditolak)}</TD>
                <TD numeric>{jumlahTeks(l.masukStok)}</TD>
                <TD numeric className={l.sisa > 0 ? "font-semibold text-ink" : ""}>{jumlahTeks(l.sisa)}</TD>
                <TD><PendampingSel l={l} /></TD>
                {finance && <TD numeric>{l.hargaSatuan?.toLocaleString("id-ID")}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <ul className="list-none space-y-2 p-0 md:hidden">
        {lines.map((l) => (
          <li key={l.id} className="rounded-lg border border-line p-2.5 text-[12.5px]" data-testid="baris-kuantitas">
            <div className="font-medium text-ink">{l.kode} — {l.nama}</div>
            <dl className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1">
              <div><dt className="text-ink3">Dipesan</dt><dd className="ml-0 tabular-nums">{jumlahTeks(l.dipesan)} {l.satuan}</dd></div>
              <div><dt className="text-ink3">Datang</dt><dd className="ml-0 tabular-nums">{jumlahTeks(l.datang)}</dd></div>
              <div><dt className="text-ink3">Baik</dt><dd className="ml-0 tabular-nums">{jumlahTeks(l.baik)}</dd></div>
              <div><dt className="text-ink3">Ditolak</dt><dd className="ml-0 tabular-nums">{jumlahTeks(l.ditolak)}</dd></div>
              <div><dt className="text-ink3">Masuk stok</dt><dd className="ml-0 tabular-nums">{jumlahTeks(l.masukStok)}</dd></div>
              <div><dt className="text-ink3">Sisa</dt><dd className="ml-0 font-semibold tabular-nums">{jumlahTeks(l.sisa)}</dd></div>
            </dl>
            {l.pendamping && <div className="mt-1"><PendampingSel l={l} /></div>}
          </li>
        ))}
      </ul>
    </>
  );
}

function PendampingSel({ l }) {
  const p = l.pendamping;
  if (!p) return <span className="text-ink3">—</span>;
  const aktual = teksPendampingAktual(l);
  return (
    <div className="text-[12px] leading-snug" data-testid="pendamping">
      <div className="text-ink2">Rencana: {p.teks}</div>
      <div className={aktual && !/belum diisi/.test(aktual) ? "text-ink" : "text-orange"}>Aktual: {aktual ?? "—"}</div>
      <div className="text-[11px] text-ink3">Hanya informasi kontrol — tidak memengaruhi stok, nilai, atau jurnal.</div>
    </div>
  );
}

// ── Unggah bukti (opsional) ──────────────────────────────────────────────
function UnggahBukti({ workspace, value, onChange }) {
  const ref = useRef(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");
  async function pilih(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSibuk(true); setGalat("");
    try {
      const fd = new FormData();
      fd.append("foto", await compressImage(file), "bukti.jpg");
      const { url } = workspace === "FINANCE" ? await api.unggahBuktiKedatanganFinance(fd) : await api.unggahBuktiKedatanganGudang(fd);
      onChange([...value, url]);
    } catch (err) { setGalat(err.message || "Gagal mengunggah foto"); } finally { setSibuk(false); }
  }
  return (
    <div className="space-y-1.5" data-testid="unggah-bukti">
      <div className="flex flex-wrap items-center gap-2">
        {value.map((u) => (
          <span key={u} className="relative">
            <a href={u} target="_blank" rel="noreferrer"><img src={u} alt="Bukti kedatangan" className="h-14 w-14 rounded-lg object-cover" /></a>
            <button type="button" aria-label="Hapus bukti" onClick={() => onChange(value.filter((x) => x !== u))} className="absolute -right-1.5 -top-1.5 rounded-full bg-surface p-1 text-red shadow"><Trash2 size={11} /></button>
          </span>
        ))}
        {value.length < 5 && (
          <Button type="button" variant="neutral" size="sm" disabled={sibuk} onClick={() => ref.current?.click()} className="max-sm:min-h-11"><Camera size={14} /> {sibuk ? "Mengunggah…" : "Tambah foto"}</Button>
        )}
        <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={pilih} aria-label="Pilih foto bukti" />
      </div>
      {galat && <p role="alert" className="text-[12px] text-red">{galat}</p>}
    </div>
  );
}

// ── Modal: Catat Barang Tiba ─────────────────────────────────────────────
export function ModalCatatKedatangan({ po, receipt = null, workspace, onClose, onDone }) {
  const [f, setF] = useState(() => formKedatanganAwal(po, receipt));
  const [galat, setGalat] = useState("");
  const kunci = useRef(`tiba-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setBaris = (i, patch) => setF((s) => ({ ...s, lines: s.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  const galatDini = galatKedatangan(f, { tanggalPO: po.orderDate });
  const kurang = kekuranganIsian(f);
  async function simpan() {
    setGalat("");
    try {
      const body = bodyKedatangan(f, receipt?.id ?? null);
      const hasil = workspace === "FINANCE" ? await api.catatKedatanganFinance(po.id, body, kunci.current) : await api.catatKedatanganGudang(po.id, body, kunci.current);
      await onDone(hasil);
    } catch (e) { setGalat(e.message || "Gagal mencatat kedatangan"); kunci.current = `tiba-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
  }
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Catat Barang Tiba — ${po.poNumber}`} className="w-[720px]"
      description="Satu pengiriman = satu penerimaan. Mencatat kedatangan tidak mengubah stok; stok bertambah saat Gudang menekan Simpan ke Stok setelah pemeriksaan."
      footer={
        <div className="flex w-full flex-col gap-2">
          {(galat || galatDini) && <p role="alert" data-testid="galat-kedatangan" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">{galat || galatDini}</p>}
          {!galatDini && kurang.length > 0 && <p data-testid="kekurangan-isian" className="text-[12px] text-ink2">Boleh disimpan dulu — akan ditandai: {kurang.join("; ")}.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <TombolAksi disabled={!!galatDini} onClick={simpan} data-testid="simpan-kedatangan"><PackageCheck size={14} /> Catat Barang Tiba</TombolAksi>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="m-0 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink2" data-testid="info-aktor">Dicatat otomatis atas nama akun Anda — peran dan workspace ({LABEL_WORKSPACE[workspace]}) diambil dari sesi, bukan dipilih di sini.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal barang tiba" required hint="Menjadi dasar jatuh tempo faktur (termin)."><Input type="date" max={new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)} value={f.tanggalTiba} onChange={(e) => set("tanggalTiba", e.target.value)} /></Field>
          <Field label="PIC / penerima barang" required><Input value={f.penerima} onChange={(e) => set("penerima", e.target.value)} placeholder="mis. Budi (Gudang)" /></Field>
          <Field label="Nomor surat jalan" hint="Opsional — bila kosong tetap tercatat sebagai kekurangan."><Input value={f.suratJalan} onChange={(e) => set("suratJalan", e.target.value)} /></Field>
          <Field label="Catatan kedatangan" required><Input value={f.catatan} onChange={(e) => set("catatan", e.target.value)} placeholder="mis. dus utuh, dikirim ekspedisi" /></Field>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-ink2">Foto surat jalan / bukti (opsional)</div>
          <UnggahBukti workspace={workspace} value={f.bukti} onChange={(v) => set("bukti", v)} />
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-ink2">Barang yang datang</div>
          <div className="space-y-2">
            {f.lines.map((l, i) => (
              <div key={l.purchaseOrderLineId} className="rounded-lg border border-line p-2.5" data-testid="baris-datang">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[13px] font-medium text-ink">{l.kode} — {l.nama}</span>
                  <span className="text-[11.5px] text-ink3">Dipesan {jumlahTeks(l.dipesan)} {l.satuan} · sisa yang boleh datang {jumlahTeks(l.sisaDatang)} {l.satuan}</span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label={`Jumlah datang (${l.satuan})`}>
                    <input type="number" inputMode="decimal" min="0" step="any" value={l.jumlahDatang} aria-label={`Jumlah datang ${l.kode}`} onChange={(e) => setBaris(i, { jumlahDatang: e.target.value })}
                      className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11" />
                  </Field>
                  {l.pendamping?.mode === "AKTUAL" && (
                    <Field label={`Jumlah ${String(l.pendamping.satuan).toLowerCase()} aktual`} hint="Hitung fisiknya; bukan konversi dari berat.">
                      <input type="number" inputMode="decimal" min="0" step="any" value={l.jumlahPendamping} aria-label={`Jumlah pendamping ${l.kode}`} onChange={(e) => setBaris(i, { jumlahPendamping: e.target.value })}
                        className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11" />
                    </Field>
                  )}
                  {l.pendamping?.mode === "TETAP" && (
                    <div className="text-[12px] text-ink2 sm:pt-6">
                      {l.jumlahDatang !== "" && Number(l.jumlahDatang) > 0 ? `Otomatis ≈ ${jumlahTeks(Number(l.jumlahDatang) * l.pendamping.rasio)} ${String(l.pendamping.satuan).toLowerCase()} (1 ${l.satuan} = ${jumlahTeks(l.pendamping.rasio)})` : `Konversi tetap: 1 ${l.satuan} = ${jumlahTeks(l.pendamping.rasio)} ${String(l.pendamping.satuan).toLowerCase()}`}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {f.lines.length === 0 && <p className="text-[12.5px] text-ink3">Tidak ada item yang masih boleh datang pada PO ini.</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal: Koreksi Kedatangan ────────────────────────────────────────────
export function ModalKoreksiKedatangan({ po, receipt, workspace, onClose, onDone }) {
  const [f, setF] = useState(() => formKoreksiAwal(receipt));
  const [galat, setGalat] = useState("");
  const kunci = useRef(`koreksi-tiba-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setBaris = (i, patch) => setF((s) => ({ ...s, lines: s.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  const galatDini = galatKoreksi(f, receipt, { tanggalPO: po.orderDate });
  async function simpan() {
    setGalat("");
    try {
      const body = bodyKoreksi(f, receipt);
      const hasil = workspace === "FINANCE" ? await api.koreksiKedatanganFinance(receipt.id, body, kunci.current) : await api.koreksiKedatanganGudang(receipt.id, body, kunci.current);
      await onDone(hasil);
    } catch (e) { setGalat(e.message || "Gagal mengoreksi kedatangan"); kunci.current = `koreksi-tiba-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
  }
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={`Koreksi Kedatangan — ${receipt.nomor}`} className="w-[680px]"
      description="Setiap koreksi wajib beralasan dan tercatat sebelum–sesudah (siapa, kapan, dari workspace mana). Jumlah datang hanya bisa dikoreksi sebelum pemeriksaan dimulai."
      footer={
        <div className="flex w-full flex-col gap-2">
          {(galat || (galatDini && f.alasan)) && <p role="alert" data-testid="galat-koreksi" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] leading-snug text-orange">{galat || galatDini}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <TombolAksi disabled={!!galatDini} onClick={simpan} data-testid="simpan-koreksi"><Pencil size={14} /> Simpan Koreksi</TombolAksi>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal barang tiba" required hint="Mengubah tanggal menggeser jatuh tempo faktur."><Input type="date" value={f.tanggalTiba} onChange={(e) => set("tanggalTiba", e.target.value)} /></Field>
          <Field label="PIC / penerima barang" required><Input value={f.penerima} onChange={(e) => set("penerima", e.target.value)} /></Field>
          <Field label="Nomor surat jalan"><Input value={f.suratJalan} onChange={(e) => set("suratJalan", e.target.value)} /></Field>
          <Field label="Catatan kedatangan" required><Input value={f.catatan} onChange={(e) => set("catatan", e.target.value)} /></Field>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-semibold text-ink2">Foto surat jalan / bukti</div>
          <UnggahBukti workspace={workspace} value={f.bukti} onChange={(v) => set("bukti", v)} />
        </div>
        {f.lines.length > 0 && (
          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-ink2">Jumlah</div>
            {f.lines.map((l, i) => (
              <div key={l.purchaseOrderLineId} className="grid grid-cols-1 gap-2 rounded-lg border border-line p-2.5 sm:grid-cols-2">
                <Field label={`${l.kode} — jumlah datang (${l.satuan})`} hint={f.bolehUbahJumlah ? undefined : "Terkunci: penerimaan sudah masuk pemeriksaan."}>
                  <input type="number" inputMode="decimal" min="0" step="any" disabled={!f.bolehUbahJumlah} value={l.jumlahDatang} aria-label={`Koreksi jumlah datang ${l.kode}`} onChange={(e) => setBaris(i, { jumlahDatang: e.target.value })}
                    className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 max-sm:h-11" />
                </Field>
                {l.pendamping?.mode === "AKTUAL" && (
                  <Field label={`Jumlah ${String(l.pendamping.satuan).toLowerCase()} aktual`}>
                    <input type="number" inputMode="decimal" min="0" step="any" value={l.jumlahPendamping} aria-label={`Koreksi jumlah pendamping ${l.kode}`} onChange={(e) => setBaris(i, { jumlahPendamping: e.target.value })}
                      className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:h-11" />
                  </Field>
                )}
              </div>
            ))}
          </div>
        )}
        <Field label="Alasan koreksi" required hint="Contoh: tanggal di surat jalan berbeda dengan yang diketik saat barang tiba."><Input value={f.alasan} onChange={(e) => set("alasan", e.target.value)} data-testid="alasan-koreksi" /></Field>
      </div>
    </Modal>
  );
}

// ── Kartu satu pengiriman ────────────────────────────────────────────────
export function KartuPenerimaan({ r, finance, bolehTulis, onCatat, onKoreksi, ekstra = null }) {
  const [riwayat, setRiwayat] = useState(false);
  const belumTiba = !r.kedatanganDicatat && ["DRAFT", "SCHEDULED"].includes(r.status);
  return (
    <li className="rounded-lg border border-line px-3 py-2.5 text-[12.5px]" data-testid="kartu-penerimaan" data-nomor={r.nomor}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] font-semibold text-ink">{r.nomor}</span>
        <Badge variant={VARIAN_PENERIMAAN[r.status] || "neutral"}>{LABEL_PENERIMAAN[r.status] || r.status}</Badge>
        {r.kedatanganDicatat ? <span className="text-ink2" data-testid="tanggal-tiba">Tiba {tanggalTeks(r.tanggalTiba)}</span> : <span className="text-ink3" data-testid="belum-dicatat">{belumTiba ? "Belum tiba" : "Kedatangan belum dicatat (dokumen lama)"}</span>}
        <span className="ml-auto flex flex-wrap gap-2">
          {bolehTulis && belumTiba && <Button size="sm" onClick={() => onCatat(r)} className="max-sm:min-h-11" data-testid="catat-tiba-penerimaan"><PackageCheck size={13} /> Catat Barang Tiba</Button>}
          {bolehTulis && r.kedatanganDicatat && r.status !== "REJECTED" && <Button size="sm" variant="neutral" onClick={() => onKoreksi(r)} className="max-sm:min-h-11" data-testid="koreksi-kedatangan"><Pencil size={13} /> Koreksi</Button>}
        </span>
      </div>
      {r.kedatanganDicatat && (
        <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-ink2 sm:grid-cols-2">
          <div><dt className="inline text-ink3">PIC/penerima: </dt><dd className="inline">{r.penerima}</dd></div>
          <div><dt className="inline text-ink3">Dicatat oleh: </dt><dd className="inline" data-testid="dicatat-oleh">{r.dicatat?.oleh ?? "—"} · {LABEL_WORKSPACE[r.dicatat?.workspace] ?? r.dicatat?.workspace} ({String(r.dicatat?.peran ?? "").replace(/,/g, ", ")}) · {waktuTeks(r.dicatat?.pada)}</dd></div>
          <div><dt className="inline text-ink3">Surat jalan: </dt><dd className="inline">{r.suratJalan ?? "—"}</dd></div>
          <div className="sm:col-span-2"><dt className="inline text-ink3">Catatan: </dt><dd className="inline">{r.catatan}</dd></div>
        </dl>
      )}
      {r.bukti?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{r.bukti.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Bukti kedatangan" className="h-12 w-12 rounded-lg object-cover" /></a>)}</div>}
      {r.kekurangan?.length > 0 && (
        <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0" data-testid="kekurangan">
          {r.kekurangan.map((k) => <li key={k}><Badge variant="orange"><TriangleAlert size={11} /> {k}</Badge></li>)}
        </ul>
      )}
      <div className="mt-1.5 text-ink2">
        {r.lines.filter((x) => x.datang != null).map((x) => (
          <div key={x.id} className="tabular-nums">{x.kode}: datang {jumlahTeks(x.datang)} · baik {jumlahTeks(x.baik ?? 0)} · ditolak {jumlahTeks(x.ditolak ?? 0)} · masuk stok {jumlahTeks(x.masukStok)}{x.pendamping ? ` · ${String(x.pendamping.satuan).toLowerCase()} ${x.pendamping.aktual == null ? "belum diisi" : jumlahTeks(x.pendamping.aktual)}` : ""}</div>
        ))}
      </div>
      {finance && r.jatuhTempo && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="jatuh-tempo-penerimaan">
          <Badge variant={r.jatuhTempo.status === "TERJADWAL" ? "accent" : "neutral"}>{r.jatuhTempo.label}</Badge>
          {r.jatuhTempo.mulai && <span className="text-[12px] text-ink2">Termin {r.jatuhTempo.termin ?? "—"} mulai {tanggalTeks(r.jatuhTempo.mulai)}{r.jatuhTempo.jatuhTempo ? ` → jatuh tempo ${tanggalTeks(r.jatuhTempo.jatuhTempo)}` : ""}</span>}
        </div>
      )}
      {ekstra}
      {r.riwayat?.length > 0 && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setRiwayat((v) => !v)} className="flex items-center gap-1 text-[12px] font-semibold text-accent max-sm:min-h-11" aria-expanded={riwayat}><History size={12} /> Riwayat kedatangan ({r.riwayat.length}) {riwayat ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
          {riwayat && <ol className="m-0 mt-1 list-none space-y-1 p-0" data-testid="riwayat-kedatangan">{r.riwayat.map((e) => <li key={e.id} className="text-[12px] text-ink2"><span className="tabular-nums text-ink3">{waktuTeks(e.pada)}</span> · {kalimatRiwayat(e)}</li>)}</ol>}
        </div>
      )}
    </li>
  );
}

// ── Panel utama ──────────────────────────────────────────────────────────
/**
 * @param po        bentuk server (bentukBarangAkanDatang): lines[], penerimaan[], ...
 * @param workspace "GUDANG" | "FINANCE"  (menentukan pintu API; aktor tetap dari sesi server)
 * @param bolehTulis  tampilkan tombol catat/koreksi (izin sebenarnya ditegakkan server)
 * @param onChanged   dipanggil setelah catat/koreksi berhasil (muat ulang)
 */
export default function PanelKedatangan({ po, workspace, bolehTulis = true, onChanged, ekstraPenerimaan = null }) {
  const finance = workspace === "FINANCE";
  const [dialog, setDialog] = useState(null); // { jenis: "catat"|"koreksi", receipt? }
  const bisaMenerima = ["DISETUJUI", "DITERIMA_SEBAGIAN"].includes(po.status) && po.lines.some((l) => Number(l.sisaDatang) > 0);
  const urut = useMemo(() => po.penerimaan, [po.penerimaan]);
  return (
    <div className="space-y-3" data-testid="panel-kedatangan">
      <TabelKuantitas lines={po.lines} finance={finance} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Pengiriman &amp; surat jalan ({urut.length})</h4>
        {bolehTulis && bisaMenerima && <Button size="sm" onClick={() => setDialog({ jenis: "catat" })} className="max-sm:min-h-11" data-testid="catat-tiba"><PackageCheck size={14} /> Catat Barang Tiba</Button>}
      </div>
      {urut.length === 0 ? <p className="text-[12.5px] text-ink3">Belum ada pengiriman. Catat saat barang pertama tiba — tiap pengiriman menjadi penerimaan sendiri.</p> : (
        <ul className="list-none space-y-2 p-0">
          {urut.map((r) => <KartuPenerimaan key={r.id} r={r} finance={finance} bolehTulis={bolehTulis} ekstra={ekstraPenerimaan ? ekstraPenerimaan(r) : null} onCatat={(x) => setDialog({ jenis: "catat", receipt: x })} onKoreksi={(x) => setDialog({ jenis: "koreksi", receipt: x })} />)}
        </ul>
      )}
      {dialog?.jenis === "catat" && (
        <ModalCatatKedatangan po={po} receipt={dialog.receipt ?? null} workspace={workspace} onClose={() => setDialog(null)} onDone={async (h) => { setDialog(null); await onChanged?.(h); }} />
      )}
      {dialog?.jenis === "koreksi" && (
        <ModalKoreksiKedatangan po={po} receipt={dialog.receipt} workspace={workspace} onClose={() => setDialog(null)} onDone={async (h) => { setDialog(null); await onChanged?.(h); }} />
      )}
    </div>
  );
}
