import React, { useMemo, useState } from "react";
import { Camera, ShieldCheck, Download, AlertTriangle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import { JudulKartu, KartuAngka, formatUang, Uang, tanggalPendek, tanggalJam } from "@/features/finance/shared.jsx";

// B3 — REKONSILIASI CUTOFF. Periode = snapshot historis immutable. Angka "Snapshot" di sini DIBACA dari record tersimpan, tidak
// dihitung ulang dari seluruh jurnal. Yang ditampilkan terpisah: jurnal yang dibuat SESUDAH snapshot (Posting Setelah Cutoff,
// Reversal Setelah Snapshot, Penyesuaian Buku), saldo buku sekarang, mutasi bank asli, dan exception Perlu Ditinjau.

const LABEL_SUMBER = {
  PEMBAYARAN_ORDER: "Pembayaran order", PENGELUARAN: "Pengeluaran", PEMBELIAN: "Pembelian", TRANSFER_KAS: "Transfer kas",
  PEMASUKAN_LAIN: "Pemasukan lain", PEMBAYARAN_SUPPLIER: "Pembayaran supplier", REFUND: "Refund", KASBON: "Kasbon",
  SALDO_AWAL: "Penyesuaian saldo", REKONSILIASI_SEMENTARA: "Penyesuaian sementara (2-1700)", REVERSAL: "Reversal", MANUAL: "Jurnal umum",
  UANG_MUKA_OPERASIONAL: "Uang muka operasional", INSENTIF_DRIVER: "Insentif driver",
};

const waktu = (v) => (v ? `${tanggalJam(v)} WIB` : "—");

function Rincian({ label, nilai, info }) {
  return (
    <div className="rounded-lg bg-inset px-3 py-2">
      <dt className="text-[11px] uppercase tracking-[0.05em] text-ink3">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-ink">{nilai}</dd>
      {info && <p className="mt-0.5 text-[11.5px] text-ink3">{info}</p>}
    </div>
  );
}

export function DrillJurnal({ id, onClose }) {
  const [d, setD] = useState(null);
  const [galat, setGalat] = useState("");
  React.useEffect(() => { api.getBukuJurnalDetail(id).then(setD).catch((e) => setGalat(e.message)); }, [id]);
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={d ? `Jurnal ${d.nomor}` : "Jurnal"} description={d?.keterangan} className="w-[620px]"
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Tutup</Button>}>
      {galat && <p className="text-[13px] text-red">{galat}</p>}
      {!d && !galat && <p className="text-[13px] text-ink3">Memuat…</p>}
      {d && (
        <div className="space-y-3">
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Rincian label="Tanggal buku" nilai={tanggalPendek(d.tanggal)} />
            <Rincian label="Dibuat" nilai={waktu(d.riwayat?.[0]?.waktu)} />
            <Rincian label="Sumber" nilai={d.sumberLabel || LABEL_SUMBER[d.sumber] || d.sumber} />
            <Rincian label="Dokumen" nilai={d.dokumen ? `${d.dokumen.jenis || ""} ${d.dokumen.nomor || ""}`.trim() : "—"} />
          </dl>
          <div className="overflow-x-auto rounded-lg bg-inset px-3 py-2">
            <table className="w-full min-w-[320px] text-[12px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-[0.05em] text-ink3"><th className="py-1 pr-2 font-medium">Akun</th><th className="w-28 py-1 text-right font-medium">Debit</th><th className="w-28 py-1 text-right font-medium">Kredit</th></tr></thead>
              <tbody>
                {(d.baris || []).map((b) => (
                  <tr key={b.no}><td className="py-0.5 pr-2">{b.kodeAkun} {b.namaAkun}{b.rekening ? <span className="text-ink3"> · {b.rekening}</span> : null}</td>
                    <td className="py-0.5 text-right tabular-nums">{Number(b.debit) ? formatUang(Number(b.debit)) : ""}</td>
                    <td className="py-0.5 text-right tabular-nums">{Number(b.kredit) ? formatUang(Number(b.kredit)) : ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TabelJurnalSetelah({ judul, deskripsi, item, onBuka, kosong }) {
  return (
    <Card className="overflow-hidden">
      <JudulKartu title={judul} description={deskripsi} />
      {item.length === 0 ? (
        <CardContent><p className="py-3 text-center text-[13px] text-ink3">{kosong}</p></CardContent>
      ) : (
        <TableWrap className="dh-table">
          <Table fixed>
            <THead>
              <TR>
                <TH sticky width={150}>Nomor</TH>
                <TH width={104} className="whitespace-nowrap">Tgl. Buku</TH>
                <TH width={150} hideBelow="wide">Dibuat</TH>
                <TH>Sumber</TH>
                <TH numeric width={130}>Dampak</TH>
              </TR>
            </THead>
            <TBody>
              {item.map((i) => (
                <TR key={i.jurnalId} clickable onClick={() => onBuka(i.jurnalId)}>
                  <TD sticky className="font-mono text-[12px]">{i.nomor}</TD>
                  <TD className="whitespace-nowrap text-[12px]">
                    {tanggalPendek(i.tanggalBuku)}
                    {i.tanggalSebelumPeriode && <span className="block text-[11px] text-orange">sebelum periode</span>}
                  </TD>
                  <TD hideBelow="wide" className="whitespace-nowrap text-[12px]">{waktu(i.dibuatPada)}</TD>
                  <TD truncate className="text-[12px]">{LABEL_SUMBER[i.sumber] || i.sumber}</TD>
                  <TD numeric><Uang value={i.nilai} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

export function PerluDitinjau({ data, bolehTinjau, onTinjau }) {
  const [tinjau, setTinjau] = useState(null);
  const [catatan, setCatatan] = useState("");
  const [galat, setGalat] = useState("");
  if (!data) return null;
  return (
    <Card className="overflow-hidden" data-testid="perlu-ditinjau">
      <JudulKartu
        title={`Perlu Ditinjau (${data.terbuka} terbuka)`}
        description="Ketidaksesuaian dokumen dan jurnal yang terdeteksi otomatis. Sistem TIDAK memperbaikinya — perbaiki lewat dokumennya, atau tandai sudah ditinjau dengan catatan."
      />
      {data.items.length === 0 ? (
        <CardContent><p className="py-3 text-center text-[13px] text-ink3">Tidak ada exception untuk rekening ini.</p></CardContent>
      ) : (
        <CardContent className="space-y-2">
          {data.items.map((x) => (
            <div key={`${x.kode}:${x.refId}`} className="rounded-lg bg-inset px-3 py-2 text-[12.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{x.label}</span>
                {x.ditinjau ? <Badge variant="green">Ditinjau</Badge> : <Badge variant="orange">Terbuka</Badge>}
              </div>
              <p className="text-ink2">{x.jenisDokumen} {x.nomor || ""} · {tanggalPendek(x.tanggal)}{x.jurnal ? ` · jurnal ${x.jurnal}` : ""}{x.rincian ? ` · ${x.rincian}` : ""}</p>
              {x.ditinjau && <p className="text-ink3">Ditinjau {x.ditinjau.oleh || "—"} ({waktu(x.ditinjau.pada)}): {x.ditinjau.catatan}</p>}
              {!x.ditinjau && bolehTinjau && (
                <Button size="sm" variant="outline" className="mt-1 max-sm:min-h-11" onClick={() => { setTinjau(x); setCatatan(""); setGalat(""); }}>Tandai Sudah Ditinjau</Button>
              )}
            </div>
          ))}
        </CardContent>
      )}
      {tinjau && (
        <Modal open onOpenChange={(v) => !v && setTinjau(null)} title="Tandai Sudah Ditinjau" description={`${tinjau.label} — ${tinjau.nomor || ""}`}
          footer={<>
            <Button variant="neutral" onClick={() => setTinjau(null)} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <Button disabled={!catatan.trim()} className="max-sm:min-h-11 max-sm:px-4" onClick={async () => {
              try { await onTinjau({ kode: tinjau.kode, refId: tinjau.refId, catatan: catatan.trim() }); setTinjau(null); } catch (e) { setGalat(e.message); }
            }}>Simpan</Button>
          </>}>
          <div className="space-y-3">
            <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] text-ink2">Data dokumen dan jurnal tidak diubah. Catatan ini hanya mencatat bahwa exception sudah diperiksa dan alasannya.</p>
            <Field label="Catatan tinjauan" required><Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. biaya sudah termasuk tagihan supplier; status dokumen akan dirapikan" /></Field>
            {galat && <p className="text-[13px] text-red">{galat}</p>}
          </div>
        </Modal>
      )}
    </Card>
  );
}

/** Panel utama di detail periode. `detail` = respons GET /finance/bank-statements/:id. */
export default function PanelCutoff({ detail, bolehAdmin, onUbah, filter }) {
  const c = detail.cutoff;
  const [buka, setBuka] = useState(null);
  const [verif, setVerif] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");
  const jumlahMutasi = detail.statement.lines.length;
  const tampilLate = !filter || filter === "late";

  const semuaSetelah = useMemo(() => (c ? [...c.postingSetelahCutoff, ...c.reversalSetelahSnapshot, ...c.penyesuaianSetelahSnapshot] : []), [c]);

  async function buatSnapshot() {
    const sumber = window.prompt("Sumber konfirmasi saldo (mis. 'Konfirmasi owner via WhatsApp'):");
    if (!sumber?.trim()) return;
    setSibuk(true); setGalat("");
    try { await api.buatSnapshotRekon(detail.statement.id, { confirmedSource: sumber.trim() }); await onUbah(); } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }
  async function verifikasi() {
    setSibuk(true); setGalat("");
    try { setVerif(await api.verifikasiSnapshotRekon(detail.statement.id)); } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }
  async function ekspor() {
    setGalat("");
    try {
      const { blob, namaFile } = await api.eksporAuditRekon(detail.statement.id);
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = namaFile; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setGalat(e.message); }
  }

  return (
    <div className="space-y-4" data-testid="panel-cutoff">
      <Card>
        <JudulKartu
          title="Snapshot Cutoff"
          description="Angka buku yang dipotret saat saldo bank dikonfirmasi. Tidak ikut berubah bila ada jurnal baru sesudahnya."
          info="Jurnal termasuk snapshot bila tanggal bukunya ≤ akhir periode DAN dibuat ≤ high-water mark. Jurnal bertanggal di periode yang dibuat sesudahnya tampil sebagai Posting Setelah Cutoff."
        />
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            {!c && bolehAdmin && <Button size="sm" disabled={sibuk} onClick={buatSnapshot}><Camera size={14} /> Buat Snapshot</Button>}
            {c && <Button size="sm" variant="outline" disabled={sibuk} onClick={verifikasi}><ShieldCheck size={14} /> Verifikasi Integritas</Button>}
            <Button size="sm" variant="outline" onClick={ekspor}><Download size={14} /> Ekspor Ringkasan Audit</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {galat && <p className="text-[13px] text-red">{galat}</p>}
          {verif && (
            <p className={`rounded-lg px-3 py-2 text-[12.5px] ${verif.cocok ? "bg-greenbg text-green" : "bg-redbg text-red"}`}>
              {verif.cocok ? `Integritas cocok: ${verif.tersimpan.jumlah} jurnal, hash sama dengan saat snapshot.` : `Integritas TIDAK cocok — tersimpan ${verif.tersimpan.jumlah} jurnal / ${formatUang(verif.tersimpan.saldo)}, sekarang ${verif.dihitungUlang.jumlah} jurnal / ${formatUang(verif.dihitungUlang.saldo)}.`}
            </p>
          )}
          {!c ? (
            <p className="text-[13px] text-ink3">Periode ini belum punya snapshot. Snapshot dibuat saat saldo bank dikonfirmasi, atau otomatis saat periode diselesaikan.</p>
          ) : (
            <>
              {!c.valid && (
                <p className="flex gap-2 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red"><AlertTriangle size={15} className="mt-0.5 shrink-0" />Snapshot tidak berlaku: {c.alasanTidakBerlaku}</p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <KartuAngka label="Snapshot saat dikonfirmasi" value={formatUang(c.snapshot.saldoBuku)} sub={`Selisih vs bank: ${formatUang(c.snapshot.selisih)}`} tone={Math.abs(c.snapshot.selisih) < 0.005 ? "green" : "orange"} />
                <KartuAngka label="Posting Setelah Cutoff" value={formatUang(c.ringkasanSetelahSnapshot.POSTING_SETELAH_CUTOFF.total)} sub={`${c.ringkasanSetelahSnapshot.POSTING_SETELAH_CUTOFF.jumlah} jurnal`} tone={c.ringkasanSetelahSnapshot.POSTING_SETELAH_CUTOFF.jumlah ? "orange" : "default"} />
                <KartuAngka label="Reversal Setelah Snapshot" value={formatUang(c.ringkasanSetelahSnapshot.REVERSAL_SETELAH_SNAPSHOT.total)} sub={`${c.ringkasanSetelahSnapshot.REVERSAL_SETELAH_SNAPSHOT.jumlah} jurnal`} />
                <KartuAngka label="Penyesuaian Buku setelah snapshot" value={formatUang(c.ringkasanSetelahSnapshot.PENYESUAIAN_BUKU.total)} sub={`${c.ringkasanSetelahSnapshot.PENYESUAIAN_BUKU.jumlah} jurnal · bukan mutasi bank`} />
                <KartuAngka label="Saldo Buku Sekarang" value={formatUang(c.saldoBukuSekarang)} sub={c.identitas.konsisten ? "= snapshot + jurnal sesudahnya" : "Tidak cocok dengan snapshot + jurnal sesudahnya"} tone={c.identitas.konsisten ? "default" : "red"} />
                <KartuAngka label="Mutasi Bank Asli" value={jumlahMutasi === 0 ? "Belum ada" : `${jumlahMutasi} baris`} sub={`Selisih rekonsiliasi sekarang: ${formatUang(c.selisihSekarang)}`} tone={jumlahMutasi === 0 ? "orange" : "default"} />
              </div>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <Rincian label="Cutoff mutasi bank" nilai={`${waktu(c.snapshot.cutoffStartAt)} – ${waktu(c.snapshot.cutoffEndAt)}`} />
                <Rincian label="Saldo riil dikonfirmasi" nilai={waktu(c.snapshot.confirmedAt)} info={c.snapshot.confirmedSource} />
                <Rincian label="High-water mark jurnal" nilai={waktu(c.snapshot.hwmAt)} info={c.snapshot.hwmEntryNumber ? `Jurnal terakhir yang termasuk: ${c.snapshot.hwmEntryNumber}` : null} />
                <Rincian label="Snapshot dibuat" nilai={waktu(c.snapshot.snapshotAt)} />
                <Rincian label="Jurnal termasuk" nilai={`${c.snapshot.entryCount} jurnal`} info={<span className="font-mono">{String(c.snapshot.entryHash).slice(0, 16)}…</span>} />
                <Rincian label="Saldo bank" nilai={`${formatUang(c.snapshot.saldoAwalBank)} → ${formatUang(c.snapshot.saldoAkhirBank)}`} />
              </dl>
              {c.snapshot.explanation && <p className="flex gap-2 text-[12.5px] text-ink2"><Clock size={14} className="mt-0.5 shrink-0 text-ink3" />{c.snapshot.explanation}</p>}
            </>
          )}
        </CardContent>
      </Card>

      {c && tampilLate && (
        <>
          <TabelJurnalSetelah judul="Posting Setelah Cutoff" deskripsi="Tanggal buku masuk (atau sebelum) periode, tetapi jurnalnya dibuat sesudah snapshot." item={c.postingSetelahCutoff} onBuka={setBuka} kosong="Tidak ada posting setelah cutoff." />
          {!filter && <TabelJurnalSetelah judul="Reversal Setelah Snapshot" deskripsi="Jurnal balik yang dibuat sesudah snapshot dan memengaruhi saldo periode." item={c.reversalSetelahSnapshot} onBuka={setBuka} kosong="Tidak ada reversal setelah snapshot." />}
          {!filter && <TabelJurnalSetelah judul="Penyesuaian Buku setelah snapshot" deskripsi="Kalibrasi/koreksi saldo dan penyesuaian sementara — bukan mutasi bank." item={c.penyesuaianSetelahSnapshot} onBuka={setBuka} kosong="Tidak ada penyesuaian buku setelah snapshot." />}
          {!filter && c.diLuarPeriode.jumlah > 0 && <p className="text-[12px] text-ink3">{c.diLuarPeriode.jumlah} jurnal dibuat sesudah snapshot dengan tanggal buku sesudah periode — tidak memengaruhi periode ini.</p>}
          {semuaSetelah.length === 0 && null}
        </>
      )}
      {buka && <DrillJurnal id={buka} onClose={() => setBuka(null)} />}
    </div>
  );
}
