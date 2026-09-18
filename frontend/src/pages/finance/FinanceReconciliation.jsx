import React, { useCallback, useEffect, useState } from "react";
import { Plus, Link2, Unlink, EyeOff, CheckCircle2, Scale } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, tanggalPendek, DateChip,
} from "@/features/finance/shared.jsx";

// REKONSILIASI BANK — mencocokkan mutasi menurut KORAN BANK dengan mutasi
// menurut BUKU BESAR, lalu menjelaskan selisihnya.
//
// TIDAK ADA INTEGRASI API BANK di sistem ini, dan halaman ini tidak
// berpura-pura ada: baris koran bank diinput manual atau ditempel dari
// mutasi rekening. Berpura-pura otomatis akan lebih berbahaya daripada
// jujur manual — orang akan berhenti memeriksa.

export default function FinanceReconciliation() {
  const [statements, setStatements] = useState([]);
  const [rekening, setRekening] = useState([]);
  const [aktif, setAktif] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalBaru, setModalBaru] = useState(false);
  const [modalBaris, setModalBaris] = useState(false);
  const [cocokkan, setCocokkan] = useState(null);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        api.getFinanceBankStatements(),
        api.getFinanceCashAccounts(),
      ]);
      setStatements(s.statements);
      setRekening(r.accounts.filter((a) => a.active && a.kind !== "KAS"));
      if (aktif) setDetail(await api.getFinanceBankStatement(aktif));
    } catch (e) {
      setError(e.message || "Gagal memuat rekonsiliasi");
    } finally {
      setLoading(false);
    }
  }, [aktif]);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModalBaru(false);
      setModalBaris(false);
      setCocokkan(null);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  return (
    <HalamanFinance
      title="Rekonsiliasi Bank"
      subtitle="Cocokkan mutasi koran bank dengan buku besar, dan jelaskan selisihnya."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={<Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Periode Baru</Button>}
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
        Tidak ada koneksi otomatis ke bank di sistem ini — baris mutasi diinput manual dari koran bank /
        mutasi internet banking. Pencocokan menuntut nominal <strong>sama persis</strong>, termasuk arahnya:
        pencocokan yang nominalnya beda bukan pencocokan, itu menyembunyikan selisih yang justru jadi alasan
        rekonsiliasi dikerjakan.
      </Penjelasan>

      <Card className="overflow-hidden">
        <JudulKartu
          title="Periode Rekonsiliasi"
          description="Satu baris = satu rekening, satu rentang tanggal koran bank."
          info="Klik salah satu baris untuk membuka detailnya dan mulai mencocokkan mutasi satu per satu. Kolom 'Belum Cocok' menunjukkan berapa baris koran bank yang masih perlu dijelaskan."
        />
        {statements.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={Scale}
              title="Belum ada periode rekonsiliasi"
              description="Buat periode baru lalu masukkan mutasi dari koran bank."
              action={<Button size="sm" onClick={() => setModalBaru(true)}>Buat Periode</Button>}
            />
          </CardContent>
        ) : (
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR>
                  <TH sticky>Rekening</TH><TH>Periode</TH>
                  <TH numeric>Saldo Awal</TH><TH numeric>Saldo Akhir (Bank)</TH>
                  <TH numeric>Baris</TH><TH numeric>Belum Cocok</TH><TH>Status</TH><TH />
                </TR>
              </THead>
              <TBody>
                {statements.map((s) => (
                  <TR key={s.id} clickable selected={aktif === s.id} onClick={() => setAktif(s.id)}>
                    <TD sticky className="font-medium">{s.cashAccount?.name}</TD>
                    <TD className="whitespace-nowrap">{tanggalPendek(s.periodStart)} – {tanggalPendek(s.periodEnd)}</TD>
                    <TD numeric><Uang value={s.openingBalance} /></TD>
                    <TD numeric><Uang value={s.closingBalance} /></TD>
                    <TD numeric>{s.jumlahBaris}</TD>
                    <TD numeric>
                      {s.belumCocok > 0 ? <Badge variant="orange">{s.belumCocok}</Badge> : <Badge variant="green">0</Badge>}
                    </TD>
                    <TD><StatusBadge status={s.status === "SELESAI" ? "SELESAI" : "DRAFT"} /></TD>
                    <TD><Button size="sm" variant="tertiary">Buka</Button></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {detail && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <KartuAngka
              label="Saldo Menurut Buku" value={formatUang(detail.rekonsiliasi.saldoBuku)}
              info="Saldo rekening ini menurut jurnal yang tercatat di sistem — hasil hitungan sendiri, bukan disalin dari bank."
            />
            <KartuAngka
              label="Saldo Menurut Bank" value={formatUang(detail.rekonsiliasi.saldoKoran)}
              info="Saldo akhir yang tertulis di koran bank asli untuk periode ini — diisi manual saat membuat periode rekonsiliasi."
            />
            <KartuAngka
              label="Selisih" value={formatUang(detail.rekonsiliasi.selisih)}
              tone={detail.rekonsiliasi.cocok ? "green" : "red"}
              sub={detail.rekonsiliasi.cocok ? "Cocok" : "Perlu dijelaskan"}
              info="Selisih antara saldo buku dan saldo bank. Kalau tidak nol, biasanya ada mutasi yang belum tercatat di salah satu sisi — telusuri lewat baris yang masih 'Belum Cocok'."
            />
            <KartuAngka
              label="Baris Belum Cocok" value={detail.rekonsiliasi.belumCocok}
              tone={detail.rekonsiliasi.belumCocok > 0 ? "orange" : "green"}
              info="Baris mutasi dari koran bank yang belum ditemukan pasangannya di buku besar. Cocokkan satu per satu, atau tandai 'Abaikan' dengan alasan kalau memang tidak ada pasangannya (mis. biaya admin kecil yang belum dicatat)."
            />
          </div>

          <Card className="overflow-hidden">
            <JudulKartu
              title={`${detail.statement.cashAccount?.name} · ${tanggalPendek(detail.statement.periodStart)} – ${tanggalPendek(detail.statement.periodEnd)}`}
              description="Mutasi menurut koran bank, dan pasangannya di buku besar."
              info="Pencocokan menuntut nominal SAMA PERSIS, termasuk arahnya (masuk/keluar) — kalau dipaksakan cocok padahal beda nominal, selisihnya justru tersembunyi, bukan terselesaikan."
            />
            <CardHeader>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setModalBaris(true)}>
                  <Plus size={14} /> Tambah Baris Koran Bank
                </Button>
                {detail.statement.status !== "SELESAI" && (
                  <TombolAksi
                    size="sm"
                    onClick={() => {
                      const catatan = detail.rekonsiliasi.belumCocok > 0
                        ? window.prompt("Masih ada baris belum cocok. Isi catatan penjelasan untuk menutup rekonsiliasi:")
                        : window.prompt("Catatan penutup (opsional):") || "";
                      if (detail.rekonsiliasi.belumCocok > 0 && !catatan?.trim()) return;
                      return aksi(() => api.completeFinanceBankStatement(detail.statement.id, catatan?.trim() || null));
                    }}
                  >
                    <CheckCircle2 size={14} /> Tandai Selesai
                  </TombolAksi>
                )}
              </div>
            </CardHeader>
            {detail.statement.lines.length === 0 ? (
              <CardContent><p className="py-6 text-center text-[13px] text-ink3">Belum ada baris koran bank.</p></CardContent>
            ) : (
              <TableWrap className="dh-table">
                <Table>
                  <THead>
                    <TR>
                      <TH sticky>Tanggal</TH><TH>Keterangan Bank</TH><TH>Referensi</TH>
                      <TH numeric>Nominal</TH><TH>Pasangan di Buku</TH><TH>Status</TH><TH />
                    </TR>
                  </THead>
                  <TBody>
                    {detail.statement.lines.map((l) => (
                      <TR key={l.id}>
                        <TD sticky className="whitespace-nowrap">{tanggalPendek(l.date)}</TD>
                        <TD className="max-w-[260px] truncate">{l.description}</TD>
                        <TD className="text-[12px] text-ink2">{l.reference || "—"}</TD>
                        <TD numeric><Uang value={l.amount} /></TD>
                        <TD className="text-[12px]">
                          {l.matchedLine
                            ? <>
                                <span className="block font-mono">{l.matchedLine.entry?.entryNumber}</span>
                                <span className="text-ink3">{l.matchedLine.description || l.matchedLine.entry?.description}</span>
                              </>
                            : <span className="text-ink3">—</span>}
                        </TD>
                        <TD><StatusBadge status={l.status} /></TD>
                        <TD>
                          <div className="flex justify-end gap-1">
                            {l.status === "BELUM_COCOK" && (
                              <>
                                <Button size="sm" variant="tertiary" onClick={() => setCocokkan(l)} title="Cocokkan">
                                  <Link2 size={14} />
                                </Button>
                                <Button
                                  size="sm" variant="tertiary" title="Abaikan"
                                  onClick={() => {
                                    const catatan = window.prompt("Kenapa baris ini tidak dicocokkan? (wajib)");
                                    if (catatan?.trim()) return aksi(() => api.ignoreFinanceBankLine(l.id, catatan.trim()));
                                  }}
                                >
                                  <EyeOff size={14} />
                                </Button>
                              </>
                            )}
                            {l.status !== "BELUM_COCOK" && (
                              <Button
                                size="sm" variant="tertiary" title="Lepas pencocokan"
                                onClick={() => aksi(() => api.unmatchFinanceBankLine(l.id))}
                              >
                                <Unlink size={14} />
                              </Button>
                            )}
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </>
      )}

      <ModalPeriodeBaru
        open={modalBaru} onClose={() => setModalBaru(false)} rekening={rekening}
        onSubmit={(d) => aksi(() => api.createFinanceBankStatement(d))}
      />

      <ModalBarisBaru
        open={modalBaris} onClose={() => setModalBaris(false)}
        onSubmit={(d) => aksi(() => api.addFinanceBankLine(detail.statement.id, d))}
      />

      <ModalCocokkan
        baris={cocokkan} kandidat={detail?.kandidat || []}
        onClose={() => setCocokkan(null)}
        onSubmit={(journalLineId) => aksi(() => api.matchFinanceBankLine(cocokkan.id, journalLineId))}
      />
    </HalamanFinance>
  );
}

function ModalPeriodeBaru({ open, onClose, rekening, onSubmit }) {
  const [f, setF] = useState({ cashAccountId: "", periodStart: "", periodEnd: "", openingBalance: "", closingBalance: "", note: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.cashAccountId && f.periodStart && f.periodEnd;
  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Periode Rekonsiliasi Baru"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Buat</TombolAksi></>}
    >
      <div className="space-y-3">
        <Field label="Rekening" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Dari tanggal" required><DateChip className="w-full" value={f.periodStart} onChange={(v) => set("periodStart", v)} ariaLabel="Dari tanggal" /></Field>
          <Field label="Sampai tanggal" required><DateChip className="w-full" value={f.periodEnd} onChange={(v) => set("periodEnd", v)} ariaLabel="Sampai tanggal" /></Field>
        </div>
        <Field label="Saldo awal menurut koran bank"><InputUang value={f.openingBalance} onChange={(v) => set("openingBalance", v)} /></Field>
        <Field label="Saldo akhir menurut koran bank"><InputUang value={f.closingBalance} onChange={(v) => set("closingBalance", v)} /></Field>
        <Field label="Catatan"><Input value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalBarisBaru({ open, onClose, onSubmit }) {
  const [f, setF] = useState({ date: "", description: "", reference: "", amount: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Baris Koran Bank"
      description="Salin apa adanya dari mutasi rekening."
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={() => onSubmit(f)} disabled={!f.description.trim() || !f.amount}>Simpan</TombolAksi></>}
    >
      <div className="space-y-3">
        <Field label="Tanggal"><DateChip className="w-full" value={f.date} onChange={(v) => set("date", v)} ariaLabel="Tanggal" /></Field>
        <Field label="Keterangan di koran bank" required>
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="TRSF E-BANKING CR 1709/FTSCY/WS95051" />
        </Field>
        <Field label="Referensi"><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} /></Field>
        <Field
          label="Nominal" required
          hint="POSITIF untuk uang masuk, NEGATIF untuk uang keluar — ini transkrip koran bank apa adanya"
        >
          <input
            type="number" step="0.01" value={f.amount}
            onChange={(e) => set("amount", e.target.value)}
            className="h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </Field>
      </div>
    </Modal>
  );
}

function ModalCocokkan({ baris, kandidat, onClose, onSubmit }) {
  const [pilih, setPilih] = useState("");
  useEffect(() => { setPilih(""); }, [baris]);
  if (!baris) return null;

  // Kandidat yang nominalnya PERSIS sama ditaruh paling atas — itu yang
  // 95% kasusnya, dan backend memang cuma menerima yang sama persis.
  const cocokPersis = kandidat.filter((k) => Math.abs(k.nilai - baris.amount) < 0.005);
  const lainnya = kandidat.filter((k) => Math.abs(k.nilai - baris.amount) >= 0.005);

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title="Cocokkan dengan Buku Besar"
      description={`${tanggalPendek(baris.date)} · ${formatUang(baris.amount)} · ${baris.description}`}
      className="w-[560px]"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={() => onSubmit(pilih)} disabled={!pilih}>Cocokkan</TombolAksi></>}
    >
      <div className="space-y-3">
        {cocokPersis.length === 0 ? (
          <p className="rounded-lg bg-orangebg px-3 py-2 text-[13px] text-orange">
            Tidak ada mutasi buku besar yang nominalnya persis {formatUang(baris.amount)} di periode ini.
            Kemungkinan transaksinya memang belum dicatat — catat dulu (pengeluaran/pemasukan/transfer),
            atau tandai baris ini “Abaikan” dengan penjelasan.
          </p>
        ) : (
          <Field label="Mutasi buku besar dengan nominal sama">
            <Pilihan value={pilih} onChange={setPilih}>
              <option value="">— pilih —</option>
              {cocokPersis.map((k) => (
                <option key={k.id} value={k.id}>
                  {tanggalPendek(k.tanggal)} · {k.entryNumber} · {formatUang(k.nilai)} · {k.description}
                </option>
              ))}
            </Pilihan>
          </Field>
        )}

        {lainnya.length > 0 && (
          <p className="text-[12px] text-ink3">
            {lainnya.length} mutasi lain di periode ini nominalnya berbeda — tidak ditawarkan di sini karena
            pencocokan menuntut nominal sama persis.
          </p>
        )}
      </div>
    </Modal>
  );
}
