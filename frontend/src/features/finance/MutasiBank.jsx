import React, { useCallback, useEffect, useRef, useState } from "react";
import { Landmark, Upload, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Field } from "@/components/ui/field.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { Uang, formatUang, KartuAngka, JudulKartu, tanggalPendek, tanggalJam } from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import ImporRekeningKoran from "@/features/finance/ImporRekeningKoran.jsx";
import { statusTampil, STATUS_BANK } from "@/features/finance/rekonBankLogic.js";

// MUTASI REKENING (menurut BANK) — salinan rekening koran yang diimpor. Tidak bisa diubah; impor tidak pernah membuat jurnal atau mengubah saldo buku.

const BATAS = 100;

export default function MutasiBank({ rek, periode, sakelar, onBerubah }) {
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const [status, setStatus] = useState("");
  const [hal, setHal] = useState(1);
  const [data, setData] = useState(null);
  const [batch, setBatch] = useState([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState(null);
  const [impor, setImpor] = useState(false);
  const [batal, setBatal] = useState(null); // { batch, alasan, lepas }
  const [pesan, setPesan] = useState(null);
  const permintaan = useRef(0);

  useEffect(() => { setHal(1); }, [qTunda, status, periode.from, periode.to, rek.id]);

  const muat = useCallback(async () => {
    const no = ++permintaan.current;
    setMemuat(true); setGalat(null);
    try {
      const [d, b] = await Promise.all([
        api.getRekonMutasiBank(rek.id, { from: periode.from, to: periode.to, q: qTunda.trim(), status, page: hal, limit: BATAS }),
        api.getRekonBatch(rek.id),
      ]);
      if (no === permintaan.current) { setData(d); setBatch(b); }
    } catch (e) {
      if (no === permintaan.current) setGalat(e.message || "Gagal memuat mutasi rekening koran");
    } finally {
      if (no === permintaan.current) setMemuat(false);
    }
  }, [rek.id, periode.from, periode.to, qTunda, status, hal]);
  useEffect(() => { muat(); }, [muat]);

  async function batalkan() {
    try {
      const r = await api.batalkanImporKoran(batal.batch.id, { alasan: batal.alasan, lepasPencocokan: batal.lepas });
      setBatal(null); setPesan(`Impor dibatalkan (${r.jumlahBaris} baris${r.pencocokanDilepas ? `, ${r.pencocokanDilepas} pencocokan dilepas` : ""}).`);
      await muat(); onBerubah?.();
    } catch (e) { setBatal((b) => ({ ...b, galat: e.message })); }
  }

  const baris = data?.baris || [];
  const batchAktif = batch.filter((b) => b.status === "AKTIF");
  const kosong = !memuat && (data?.jumlahBaris ?? 0) === 0 && batchAktif.length === 0;

  return (
    <>
      {galat && <Card className="bg-redbg"><CardContent className="flex items-center justify-between gap-3 py-3"><p className="text-[13px] text-ink">{galat}</p><Button size="sm" variant="neutral" onClick={muat}>Coba lagi</Button></CardContent></Card>}
      {pesan && <Card className="bg-greenbg"><CardContent className="flex items-center justify-between gap-3 py-3"><p className="text-[13px] text-ink">{pesan}</p><Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button></CardContent></Card>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka label="Saldo Bank Awal" value={data?.saldoAwalBank ? formatUang(data.saldoAwalBank) : "—"} sub={data?.saldoAwalBank ? `sebelum ${tanggalPendek(periode.from)}` : "berkas tanpa kolom saldo"} />
        <KartuAngka label="Uang Masuk (bank)" value={formatUang(data?.totalMasuk ?? 0)} tone="green" sub="kredit menurut bank" />
        <KartuAngka label="Uang Keluar (bank)" value={formatUang(data?.totalKeluar ?? 0)} tone="orange" sub="debit menurut bank" />
        <KartuAngka
          label="Saldo Bank Akhir" value={data?.saldoAkhirBank ? formatUang(data.saldoAkhirBank) : "—"} sub={data?.saldoAkhirBank ? `per ${tanggalPendek(periode.to)}` : "berkas tanpa kolom saldo"}
          info="Saldo menurut kolom saldo di rekening koran yang diimpor — bukan hasil hitungan sistem. Dibandingkan dengan saldo buku di tab Rekonsiliasi."
        />
      </div>

      <Card className="overflow-hidden">
        <JudulKartu title="Impor rekening koran" description="Salinan mutasi bank (tidak bisa diubah). Berkas yang sama persis dan baris yang sudah ada tidak akan masuk dua kali." />
        <CardContent className="space-y-3 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setImpor(true)} disabled={!sakelar} title={sakelar ? "" : "Belum diaktifkan"}><Upload size={14} /> Impor berkas (XLSX/CSV)</Button>
            {!sakelar && <span className="text-[12.5px] text-ink3">Impor belum diaktifkan. Admin/Owner menyalakannya di Finance › Pengaturan (Rekonsiliasi Bank V2).</span>}
          </div>
          {batch.length > 0 && (
            <ul className="list-none p-0 space-y-1.5" data-testid="riwayat-impor">
              {batch.slice(0, 8).map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{b.berkas}</span>
                    <span className="block text-ink3">{b.jumlahBaris} baris · {tanggalPendek(b.tanggalAwal)} – {tanggalPendek(b.tanggalAkhir)} · {b.diimporOleh?.name || "—"} · {tanggalJam(b.diimporPada)}</span>
                  </span>
                  {b.status === "AKTIF"
                    ? <Button size="sm" variant="neutral" onClick={() => setBatal({ batch: b, alasan: "", lepas: false })} disabled={!sakelar}><RotateCcw size={13} /> Batalkan impor</Button>
                    : <Badge variant="neutral" className="normal-case">Dibatalkan{b.alasanBatal ? ` — ${b.alasanBatal}` : ""}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!kosong && (
        <FilterBar
          q={q} onQ={setQ} placeholder="Cari keterangan, referensi, nominal…"
          filters={[{ key: "status", label: "Status", value: status, onChange: setStatus, options: Object.entries(STATUS_BANK).filter(([k]) => k !== "BELUM_ADA_DI_BANK").map(([k, v]) => [k, v.label]) }]}
          ringkasan={`${data?.total ?? 0} dari ${data?.jumlahBaris ?? 0} baris${qTunda || status ? " (disaring)" : ""}`}
          onReset={() => { setQ(""); setStatus(""); }}
        />
      )}

      <Card className="overflow-hidden">
        <JudulKartu title={`Rekening koran ${rek.name}`} description="Urut tanggal transaksi menurut bank. Status menunjukkan apakah baris sudah dicocokkan dengan buku." />
        <div className="flex justify-end px-4 pb-3">
          <TombolExportExcel
            modul="mutasi-bank" disabled={kosong}
            ambilBody={() => ({
              periode: { from: periode.from, to: periode.to },
              filter: { cashAccountId: rek.id, q: qTunda.trim(), status },
              filterLabel: labelFilterAktif([["Rekening", rek.name], ["Status", status ? STATUS_BANK[status]?.label : ""], ["Pencarian", qTunda.trim()]]),
            })}
          />
        </div>
        {kosong ? (
          <CardContent>
            <EmptyState
              icon={Landmark} title="Belum ada rekening koran yang diimpor"
              description={sakelar ? "Impor mutasi dari Mandiri (XLSX atau CSV) untuk mulai mencocokkan dengan buku. Tanpa ini, selisih saldo tidak bisa dijelaskan transaksi per transaksi." : "Fitur impor belum diaktifkan. Mutasi Buku dan laporan exception tetap bisa dipakai."}
              action={sakelar ? <Button size="sm" onClick={() => setImpor(true)}><Upload size={14} /> Impor berkas</Button> : null}
            />
          </CardContent>
        ) : baris.length === 0 && !memuat ? (
          <CardContent><EmptyState icon={Landmark} title="Tidak ada baris" description="Tidak ada mutasi bank pada periode, pencarian, dan status ini." /></CardContent>
        ) : (
          <>
            <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
              <Table fixed>
                <THead>
                  <TR>
                    <TH sticky width={96}>Tanggal</TH><TH>Keterangan bank</TH><TH width={110} hideBelow="2xl">Referensi</TH>
                    <TH numeric width={116}>Masuk</TH><TH numeric width={116}>Keluar</TH><TH numeric width={128} hideBelow="wide">Saldo bank</TH><TH width={150}>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {baris.map((b) => (
                    <TR key={b.id}>
                      <TD sticky className="whitespace-nowrap text-[12px]">{tanggalPendek(b.tanggal)}{b.tanggalEfektif && b.tanggalEfektif !== b.tanggal && <span className="block text-[11px] text-ink3">efektif {tanggalPendek(b.tanggalEfektif)}</span>}</TD>
                      <TD>
                        <span className="block truncate">{b.deskripsi}</span>
                        {b.pencocokan && <span className="block truncate text-[11.5px] text-ink3">{b.pencocokan.bentuk}{b.pencocokan.kategoriLabel ? ` · ${b.pencocokan.kategoriLabel}` : ""}{b.pencocokan.alasan ? ` · ${b.pencocokan.alasan}` : ""}</span>}
                      </TD>
                      <TD hideBelow="2xl" truncate className="font-mono text-[11.5px]">{b.referensi || "—"}</TD>
                      <TD numeric>{b.masuk ? <Uang value={b.masuk} className="text-green" /> : <span className="text-ink3">—</span>}</TD>
                      <TD numeric>{b.keluar ? <Uang value={b.keluar} className="text-orange" /> : <span className="text-ink3">—</span>}</TD>
                      <TD hideBelow="wide" numeric>{b.saldo ? <Uang value={b.saldo} sen /> : <span className="text-ink3">—</span>}</TD>
                      <TD><Badge variant={statusTampil(b.status).variant} className="normal-case">{statusTampil(b.status).label}</Badge></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <CardList className={CARD_VIEW_CLASS}>
              {baris.map((b) => (
                <RowCard
                  key={b.id} title={tanggalPendek(b.tanggal)}
                  status={<Badge variant={statusTampil(b.status).variant} className="normal-case">{statusTampil(b.status).label}</Badge>}
                  subtitle={b.deskripsi}
                  fields={[
                    { label: b.masuk ? "Masuk" : "Keluar", value: formatUang(b.masuk || b.keluar) },
                    { label: "Saldo bank", value: b.saldo ? formatUang(b.saldo) : "—" },
                    { label: "Referensi", value: b.referensi, span: true },
                    ...(b.pencocokan ? [{ label: "Pencocokan", value: `${b.pencocokan.bentuk}${b.pencocokan.kategoriLabel ? ` · ${b.pencocokan.kategoriLabel}` : ""}`, span: true }] : []),
                  ]}
                />
              ))}
            </CardList>
            {(hal > 1 || data?.adaLagi) && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[12.5px] text-ink2">
                <span>Halaman {hal} · {BATAS} baris per halaman</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="neutral" disabled={hal <= 1 || memuat} onClick={() => setHal((h) => Math.max(1, h - 1))}>Sebelumnya</Button>
                  <Button size="sm" variant="neutral" disabled={!data?.adaLagi || memuat} onClick={() => setHal((h) => h + 1)}>Berikutnya</Button>
                </span>
              </div>
            )}
          </>
        )}
      </Card>

      <ImporRekeningKoran open={impor} onOpenChange={setImpor} rekening={rek} onSelesai={() => { muat(); onBerubah?.(); }} />

      <Modal
        open={!!batal} onOpenChange={(v) => !v && setBatal(null)} title="Batalkan impor rekening koran"
        description="Baris tidak dihapus — hanya ditandai dibatalkan (riwayat tetap). Tidak mengubah buku."
        footer={<><Button size="sm" variant="neutral" onClick={() => setBatal(null)}>Kembali</Button><Button size="sm" onClick={batalkan} disabled={(batal?.alasan || "").trim().length < 10}>Batalkan impor</Button></>}
      >
        {batal && (
          <div className="space-y-3">
            <p className="text-[13px] text-ink">{batal.batch.berkas} — {batal.batch.jumlahBaris} baris.</p>
            <Field label="Alasan" required hint="Minimal 10 karakter."><Input value={batal.alasan} onChange={(e) => setBatal((b) => ({ ...b, alasan: e.target.value }))} placeholder="mis. salah memilih rekening / berkas keliru" /></Field>
            <label className="flex items-start gap-2 text-[13px] text-ink"><input type="checkbox" className="mt-1" checked={batal.lepas} onChange={(e) => setBatal((b) => ({ ...b, lepas: e.target.checked }))} /> Sekaligus lepaskan pencocokan yang memakai baris impor ini</label>
            {batal.galat && <p role="alert" className="text-[12.5px] text-red">{batal.galat}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}

