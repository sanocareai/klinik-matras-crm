import React, { useCallback, useEffect, useState } from "react";
import { Plus, Undo2, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, Uang, formatUang, JudulKartu, Penjelasan, TombolAksi, StatusBadge,
  Pilihan, InputUang, PeriodePicker, periodeDefault, tanggalPendek,
  LABEL_SUMBER_JURNAL, DateChip,
} from "@/features/finance/shared.jsx";

// JURNAL UMUM — seluruh pencatatan buku besar, dari mana pun asalnya.
//
// Mayoritas baris di sini LAHIR SENDIRI dari transaksi operasional
// (pembayaran order, pengakuan pendapatan, HPP bahan, biaya kendaraan).
// Jurnal manual dipakai untuk hal yang memang tidak punya transaksi sumber:
// saldo awal, penyesuaian akhir periode, koreksi khusus.
//
// TIDAK ADA tombol "edit". Jurnal yang sudah masuk buku besar hanya bisa
// dibatalkan lewat JURNAL BALIK (reversal) yang punya tanggalnya sendiri —
// supaya laporan bulan lalu yang sudah dibaca owner tidak bisa berubah
// angkanya secara diam-diam.

export default function FinanceJournal() {
  const [periode, setPeriode] = useState(periodeDefault);
  const [filter, setFilter] = useState({ source: "", status: "", search: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [detail, setDetail] = useState(null);
  const [modalBaru, setModalBaru] = useState(false);
  const [akun, setAkun] = useState([]);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [j, a] = await Promise.all([
        api.getFinanceJournal({ ...periode, ...filter }),
        api.getFinanceAccounts(),
      ]);
      setData(j);
      setAkun(a.accounts.filter((x) => x.isPostable && x.active));
    } catch (e) {
      setError(e.message || "Gagal memuat jurnal");
    } finally {
      setLoading(false);
    }
  }, [periode, filter]);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModalBaru(false);
      setDetail(null);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const entries = data?.entries || [];

  return (
    <HalamanFinance
      title="Jurnal Umum"
      subtitle="Seluruh pencatatan buku besar — yang lahir otomatis dari operasional maupun yang diketik manual."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
          <Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Jurnal Manual</Button>
        </>
      }
    >
      {pesan && (
        <Card className="bg-redbg">
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p className="text-[13px] text-ink">{pesan}</p>
            <Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
          </CardContent>
        </Card>
      )}

      <Penjelasan>
        Jurnal yang sudah terposting <strong>tidak bisa diedit atau dihapus</strong>. Koreksi dilakukan dengan
        jurnal balik yang punya tanggalnya sendiri, sehingga laporan periode yang sudah dilaporkan tidak
        berubah angkanya secara retroaktif — dan baris aslinya tetap utuh untuk diaudit.
      </Penjelasan>

      <Card className="overflow-hidden">
        <JudulKartu
          title={`${data?.total ?? 0} jurnal di periode ini`}
          description="Menampilkan maksimal 100 terbaru."
          info="Setiap baris di sini adalah SATU peristiwa keuangan yang sudah tercatat lengkap dengan pasangan debit-kreditnya (double-entry) — klik baris mana pun untuk melihat rinciannya."
        />
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
              placeholder="Cari nomor atau keterangan…" className="max-w-[240px]"
            />
            <Pilihan value={filter.source} onChange={(v) => setFilter((f) => ({ ...f, source: v }))} className="max-w-[200px]">
              <option value="">Semua sumber</option>
              {Object.entries(LABEL_SUMBER_JURNAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Pilihan>
            <Pilihan value={filter.status} onChange={(v) => setFilter((f) => ({ ...f, status: v }))} className="max-w-[160px]">
              <option value="">Semua status</option>
              <option value="POSTED">Terposting</option>
              <option value="DRAFT">Draft</option>
              <option value="REVERSED">Dibalik</option>
            </Pilihan>
          </div>
        </CardHeader>
        {entries.length === 0 ? (
          <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada jurnal di filter ini.</p></CardContent>
        ) : (
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR><TH sticky>Nomor</TH><TH>Tanggal</TH><TH>Keterangan</TH><TH>Sumber</TH><TH numeric>Nilai</TH><TH>Status</TH><TH /></TR>
              </THead>
              <TBody>
                {entries.map((e) => (
                  <TR key={e.id} clickable onClick={() => setDetail(e.id)}>
                    <TD sticky className="font-mono text-[12px]">{e.entryNumber}</TD>
                    <TD className="whitespace-nowrap">{tanggalPendek(e.date)}</TD>
                    <TD className="max-w-[320px] truncate">{e.description}</TD>
                    <TD><Badge variant={e.source === "MANUAL" || e.source === "SALDO_AWAL" ? "accent" : "neutral"}>
                      {LABEL_SUMBER_JURNAL[e.source] || e.source}
                    </Badge></TD>
                    <TD numeric><Uang value={e.totalDebit} /></TD>
                    <TD><StatusBadge status={e.status} /></TD>
                    <TD><ChevronRight size={14} className="text-ink3" /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <DetailJurnal
        entryId={detail}
        onClose={() => setDetail(null)}
        onReversed={() => aksi(async () => {})}
        onError={setPesan}
      />

      <ModalJurnalManual
        open={modalBaru} onClose={() => setModalBaru(false)}
        akun={akun}
        onSubmit={(d) => aksi(() => api.createFinanceJournal(d))}
      />
    </HalamanFinance>
  );
}

function DetailJurnal({ entryId, onClose, onReversed, onError }) {
  const [entry, setEntry] = useState(null);

  useEffect(() => {
    if (!entryId) { setEntry(null); return; }
    api.getFinanceJournalEntry(entryId).then(setEntry).catch((e) => onError(e.message));
  }, [entryId, onError]);

  if (!entryId) return null;

  async function balikkan() {
    const alasan = window.prompt("Alasan pembatalan jurnal ini (wajib):");
    if (!alasan?.trim()) return;
    try {
      await api.reverseFinanceJournal(entryId, { reason: alasan.trim() });
      await onReversed();
      onClose();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={entry?.entryNumber || "Memuat…"}
      description={entry ? `${tanggalPendek(entry.date)} · ${LABEL_SUMBER_JURNAL[entry.source] || entry.source}` : undefined}
      className="w-[640px]"
      footer={
        entry && entry.status === "POSTED" ? (
          <>
            <Button variant="neutral" onClick={onClose}>Tutup</Button>
            <TombolAksi variant="destructive" onClick={balikkan}>
              <Undo2 size={14} /> Batalkan (Jurnal Balik)
            </TombolAksi>
          </>
        ) : <Button variant="neutral" onClick={onClose}>Tutup</Button>
      }
    >
      {!entry ? (
        <p className="text-[13px] text-ink3">Memuat rincian jurnal…</p>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-ink">{entry.description}</p>

          {entry.status === "REVERSED" && entry.reversedBy && (
            <div className="rounded-lg bg-redbg px-3 py-2 text-[12px] text-red">
              Jurnal ini sudah dibatalkan oleh {entry.reversedBy.entryNumber} ({tanggalPendek(entry.reversedBy.date)}).
              {entry.reversalReason && ` Alasan: ${entry.reversalReason}`}
            </div>
          )}
          {entry.reversalOf && (
            <div className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink2">
              Ini jurnal balik atas {entry.reversalOf.entryNumber} ({tanggalPendek(entry.reversalOf.date)}).
            </div>
          )}

          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR><TH>Akun</TH><TH>Keterangan</TH><TH numeric>Debit</TH><TH numeric>Kredit</TH></TR>
              </THead>
              <TBody>
                {entry.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <span className="block font-mono text-[12px]">{l.account?.code}</span>
                      <span className="text-[12px] text-ink2">{l.account?.name}</span>
                    </TD>
                    <TD className="max-w-[220px] text-[12px]">
                      <span className="block truncate">{l.description || "—"}</span>
                      {(l.order || l.customer || l.supplier || l.cashAccount) && (
                        <span className="text-[11px] text-ink3">
                          {[l.order?.orderNumber, l.customer?.name, l.supplier?.name, l.cashAccount?.name]
                            .filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </TD>
                    <TD numeric><Uang value={l.debit} nolSebagaiStrip sen /></TD>
                    <TD numeric><Uang value={l.credit} nolSebagaiStrip sen /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>

          <p className="text-[12px] text-ink3">
            Dibuat {entry.createdBy?.name || "sistem"}
            {entry.postedBy ? ` · diposting ${entry.postedBy.name}` : ""}
          </p>
        </div>
      )}
    </Modal>
  );
}

function ModalJurnalManual({ open, onClose, akun, onSubmit }) {
  const [f, setF] = useState({ date: "", description: "", saldoAwal: false });
  const [baris, setBaris] = useState([
    { accountId: "", debit: "", credit: "", description: "" },
    { accountId: "", debit: "", credit: "", description: "" },
  ]);

  const totalDebit = baris.reduce((s, b) => s + (Number(b.debit) || 0), 0);
  const totalKredit = baris.reduce((s, b) => s + (Number(b.credit) || 0), 0);
  const seimbang = Math.abs(totalDebit - totalKredit) < 0.005 && totalDebit > 0;
  const valid = f.description.trim() && seimbang && baris.every((b) => !b.accountId || Number(b.debit) > 0 || Number(b.credit) > 0);

  function ubah(i, k, v) {
    setBaris((s) => s.map((b, idx) => {
      if (idx !== i) return b;
      const next = { ...b, [k]: v };
      // Satu baris hanya boleh debit ATAU kredit — mengisi salah satunya
      // mengosongkan yang lain, supaya tidak perlu menghapus manual dan
      // tidak pernah terkirim baris yang ditolak backend.
      if (k === "debit" && v) next.credit = "";
      if (k === "credit" && v) next.debit = "";
      return next;
    }));
  }

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Jurnal Manual"
      description="Untuk saldo awal, penyesuaian, atau koreksi yang tidak punya transaksi sumber."
      className="w-[680px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi
            disabled={!valid}
            onClick={() => onSubmit({
              ...f,
              lines: baris.filter((b) => b.accountId).map((b) => ({
                accountId: b.accountId,
                debit: Number(b.debit) || 0,
                credit: Number(b.credit) || 0,
                description: b.description || null,
              })),
            })}
          >
            Posting
          </TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Keterangan" required>
          <Input value={f.description} onChange={(e) => setF((s) => ({ ...s, description: e.target.value }))} placeholder="Saldo awal kas per 1 September 2026" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal buku">
            <DateChip className="w-full" value={f.date} onChange={(v) => setF((s) => ({ ...s, date: v }))} ariaLabel="Tanggal buku" />
          </Field>
          <Field label="Jenis" hint="Saldo awal ditandai terpisah supaya laporan tahu neraca sudah lengkap">
            <label className="flex h-9 items-center gap-2 text-[13px] text-ink2">
              <input
                type="checkbox" checked={f.saldoAwal}
                onChange={(e) => setF((s) => ({ ...s, saldoAwal: e.target.checked }))}
              />
              Ini jurnal saldo awal
            </label>
          </Field>
        </div>

        <div className="space-y-2">
          {baris.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_120px_28px] items-center gap-2">
              <Pilihan value={b.accountId} onChange={(v) => ubah(i, "accountId", v)}>
                <option value="">— pilih akun —</option>
                {akun.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </Pilihan>
              <InputUang value={b.debit} onChange={(v) => ubah(i, "debit", v)} placeholder="Debit" />
              <InputUang value={b.credit} onChange={(v) => ubah(i, "credit", v)} placeholder="Kredit" />
              <Button
                variant="neutral" size="icon" disabled={baris.length <= 2}
                onClick={() => setBaris((s) => s.filter((_, idx) => idx !== i))}
                aria-label="Hapus baris"
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            size="sm" variant="tertiary" className="px-0"
            onClick={() => setBaris((s) => [...s, { accountId: "", debit: "", credit: "", description: "" }])}
          >
            + Tambah baris
          </Button>
        </div>

        <div className={`rounded-lg px-3 py-2 text-[13px] ${seimbang ? "bg-greenbg text-green" : "bg-orangebg text-orange"}`}>
          Debit {formatUang(totalDebit)} · Kredit {formatUang(totalKredit)}
          {!seimbang && (
            totalDebit === 0
              ? " — jurnal masih kosong"
              : ` — belum seimbang, selisih ${formatUang(Math.abs(totalDebit - totalKredit))}`
          )}
        </div>
      </div>
    </Modal>
  );
}
