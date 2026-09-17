import React, { useCallback, useEffect, useState } from "react";
import { Plus, ArrowLeftRight, TrendingUp, Wallet, Pencil, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, Penjelasan, Pilihan, InputUang,
  TombolAksi, PeriodePicker, periodeDefault, tanggalPendek,
} from "@/features/finance/shared.jsx";

// KAS & BANK — rekening yang benar-benar dipegang perusahaan, mutasi antar
// rekening, dan pemasukan di luar order.
//
// Saldo di sini SELALU "menurut buku besar" — hasil penjumlahan seluruh
// jurnal yang menyentuh rekening itu. Saldo "menurut bank" ada di halaman
// Rekonsiliasi; memisahkan keduanya adalah inti rekonsiliasi itu sendiri,
// jadi keduanya tidak boleh ditampilkan seolah satu angka.

const TAB = [
  { key: "rekening", label: "Rekening", Icon: Wallet },
  { key: "transfer", label: "Mutasi Antar Rekening", Icon: ArrowLeftRight },
  { key: "pemasukan", label: "Pemasukan Lain", Icon: TrendingUp },
];

export default function FinanceCash() {
  const [tab, setTab] = useState("rekening");
  const [periode, setPeriode] = useState(periodeDefault);
  const [rekening, setRekening] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [akunPendapatan, setAkunPendapatan] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modal, setModal] = useState(null); // "rekening" | "transfer" | "pemasukan"
  const [editRekening, setEditRekening] = useState(null); // akun yang sedang diedit, null = mode "tambah baru"

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, t, i, a] = await Promise.all([
        api.getFinanceCashAccounts(),
        api.getFinanceTransfers(periode),
        api.getFinanceOtherIncome(periode),
        api.getFinanceAccounts(),
      ]);
      setRekening(r);
      setTransfers(t.transfers);
      setIncomes(i.incomes);
      setAkunPendapatan(a.accounts.filter((x) => x.type === "PENDAPATAN" && x.isPostable && x.active));
    } catch (e) {
      setError(e.message || "Gagal memuat data kas & bank");
    } finally {
      setLoading(false);
    }
  }, [periode]);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModal(null);
      setEditRekening(null);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  async function hapusRekening(a) {
    if (!confirm(`Hapus rekening "${a.name}" secara permanen? Aksi ini tidak bisa dibatalkan.`)) return;
    try {
      await api.deleteFinanceCashAccount(a.id);
      await muat();
    } catch (e) {
      // 409 = sudah punya transaksi — pesan dari backend sudah mengarahkan
      // ke "nonaktifkan lewat Edit", tampilkan apa adanya.
      setPesan(e.message);
    }
  }

  return (
    <HalamanFinance
      title="Kas & Bank"
      subtitle="Saldo tiap rekening menurut buku besar, mutasi antar rekening sendiri, dan pemasukan di luar order."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          {tab !== "rekening" && <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />}
          <Button size="sm" onClick={() => setModal(tab)}>
            <Plus size={14} />
            {tab === "rekening" ? "Rekening Baru" : tab === "transfer" ? "Catat Transfer" : "Catat Pemasukan"}
          </Button>
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

      <div className="flex flex-wrap gap-2">
        {TAB.map((t) => (
          <Button
            key={t.key} size="sm"
            variant={tab === t.key ? "secondary" : "neutral"}
            onClick={() => setTab(t.key)}
          >
            <t.Icon size={14} /> {t.label}
          </Button>
        ))}
      </div>

      {tab === "rekening" && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KartuAngka label="Total Kas & Bank" value={formatUang(rekening?.totalSaldo ?? 0)} sub="Menurut buku besar" />
            {(rekening?.accounts || []).filter((a) => a.active).slice(0, 3).map((a) => (
              <KartuAngka key={a.id} label={a.name} value={formatUang(a.saldo)} sub={a.kind === "KAS" ? "Kas tunai" : a.bankName || a.kind} />
            ))}
          </div>

          <Penjelasan>
            Angka di sini adalah saldo <strong>menurut buku besar</strong> — hasil seluruh jurnal yang menyentuh
            rekening itu. Saldo menurut koran bank bisa berbeda (transfer yang belum masuk, biaya admin yang
            belum dicatat); mencocokkan keduanya adalah pekerjaan halaman Rekonsiliasi Bank.
          </Penjelasan>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Daftar Rekening</CardTitle>
              <CardDescription>Kas tunai, rekening bank, dan e-wallet yang dipegang perusahaan.</CardDescription>
            </CardHeader>
            {(rekening?.accounts || []).length === 0 ? (
              <CardContent>
                <EmptyState
                  icon={Wallet}
                  title="Belum ada rekening"
                  description="Tanpa rekening, pembayaran yang masuk tidak punya tempat dan akan menumpuk di Data Belum Lengkap."
                  action={<Button size="sm" onClick={() => setModal("rekening")}>Tambah Rekening</Button>}
                />
              </CardContent>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <TR><TH>Nama</TH><TH>Jenis</TH><TH>Nomor</TH><TH>Akun COA</TH><TH numeric>Saldo Buku</TH><TH>Status</TH><TH>Aksi</TH></TR>
                  </THead>
                  <TBody>
                    {rekening.accounts.map((a) => (
                      <TR key={a.id}>
                        <TD className="font-medium">{a.name}</TD>
                        <TD><Badge variant="neutral">{a.kind}</Badge></TD>
                        <TD className="text-[12px] text-ink2">
                          {a.accountNumber ? `${a.bankName || ""} ${a.accountNumber}`.trim() : "—"}
                          {a.accountHolder && <span className="block text-ink3">a.n. {a.accountHolder}</span>}
                        </TD>
                        <TD className="font-mono text-[12px]">{a.account?.code} · {a.account?.name}</TD>
                        <TD numeric><Uang value={a.saldo} className="font-bold" /></TD>
                        <TD>{a.active ? <Badge variant="green">Aktif</Badge> : <Badge variant="neutral">Nonaktif</Badge>}</TD>
                        <TD>
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="neutral" title="Edit" onClick={() => setEditRekening(a)}>
                              <Pencil size={14} />
                            </Button>
                            <Button size="icon" variant="neutral" title="Hapus" onClick={() => hapusRekening(a)}>
                              <Trash2 size={14} />
                            </Button>
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

      {tab === "transfer" && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Mutasi Antar Rekening</CardTitle>
            <CardDescription>
              Setor tunai ke bank, tarik tunai, pindah antar bank. Bukan pendapatan & bukan beban —
              laporan arus kas sengaja tidak menghitungnya sebagai uang masuk/keluar.
            </CardDescription>
          </CardHeader>
          {transfers.length === 0 ? (
            <CardContent><p className="py-6 text-center text-[13px] text-ink3">Belum ada mutasi di periode ini.</p></CardContent>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR><TH>Nomor</TH><TH>Tanggal</TH><TH>Dari</TH><TH>Ke</TH><TH numeric>Nominal</TH><TH numeric>Biaya Admin</TH><TH>Status</TH></TR>
                </THead>
                <TBody>
                  {transfers.map((t) => (
                    <TR key={t.id}>
                      <TD className="font-mono text-[12px]">{t.transferNumber}</TD>
                      <TD>{tanggalPendek(t.date)}</TD>
                      <TD>{t.fromAccount?.name}</TD>
                      <TD>{t.toAccount?.name}</TD>
                      <TD numeric><Uang value={t.amount} /></TD>
                      <TD numeric><Uang value={t.feeAmount} nolSebagaiStrip /></TD>
                      <TD>
                        {t.cancelledAt
                          ? <Badge variant="red">Dibatalkan</Badge>
                          : <Badge variant="green">Terposting</Badge>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === "pemasukan" && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Pemasukan di Luar Order</CardTitle>
            <CardDescription>
              Penjualan aset bekas, bunga bank, klaim asuransi. Pembayaran dari pelanggan TIDAK dicatat di
              sini — itu mengalir sendiri dari Order & Pengiriman.
            </CardDescription>
          </CardHeader>
          {incomes.length === 0 ? (
            <CardContent><p className="py-6 text-center text-[13px] text-ink3">Belum ada pemasukan lain di periode ini.</p></CardContent>
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <TR><TH>Nomor</TH><TH>Tanggal</TH><TH>Keterangan</TH><TH>Akun</TH><TH>Masuk ke</TH><TH numeric>Nominal</TH></TR>
                </THead>
                <TBody>
                  {incomes.map((i) => (
                    <TR key={i.id}>
                      <TD className="font-mono text-[12px]">{i.incomeNumber}</TD>
                      <TD>{tanggalPendek(i.date)}</TD>
                      <TD className="max-w-[280px] truncate">{i.description}</TD>
                      <TD className="text-[12px]">{i.account ? `${i.account.code} · ${i.account.name}` : "—"}</TD>
                      <TD>{i.cashAccount?.name}</TD>
                      <TD numeric><Uang value={i.amount} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      <ModalRekening
        open={modal === "rekening" || Boolean(editRekening)}
        onClose={() => { setModal(null); setEditRekening(null); }}
        initial={editRekening}
        onSubmit={(d) => aksi(() => (
          editRekening ? api.updateFinanceCashAccount(editRekening.id, d) : api.createFinanceCashAccount(d)
        ))}
      />
      <ModalTransfer
        open={modal === "transfer"} onClose={() => setModal(null)}
        rekening={(rekening?.accounts || []).filter((a) => a.active)}
        onSubmit={(d) => aksi(() => api.createFinanceTransfer(d))}
      />
      <ModalPemasukan
        open={modal === "pemasukan"} onClose={() => setModal(null)}
        rekening={(rekening?.accounts || []).filter((a) => a.active)}
        akunPendapatan={akunPendapatan}
        onSubmit={(d) => aksi(() => api.createFinanceOtherIncome(d))}
      />
    </HalamanFinance>
  );
}

const REKENING_KOSONG = { name: "", kind: "BANK", bankName: "", accountNumber: "", accountHolder: "", notes: "", active: true };

function ModalRekening({ open, onClose, initial, onSubmit }) {
  const editMode = Boolean(initial);
  const [f, setF] = useState(REKENING_KOSONG);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  // Isi ulang form setiap kali modal dibuka dengan target BEDA (edit rekening
  // lain) atau dibuka dalam mode tambah baru — bukan cuma sekali saat mount,
  // supaya klik "Edit" di baris kedua tidak menampilkan data baris pertama
  // yang sempat tersimpan di state sebelumnya.
  useEffect(() => {
    if (!open) return;
    setF(initial ? {
      name: initial.name || "", kind: initial.kind || "BANK",
      bankName: initial.bankName || "", accountNumber: initial.accountNumber || "",
      accountHolder: initial.accountHolder || "", notes: initial.notes || "",
      active: initial.active ?? true,
    } : REKENING_KOSONG);
  }, [open, initial]);

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title={editMode ? `Edit — ${initial?.name}` : "Rekening Baru"}
      description={editMode ? "Jenis rekening tidak bisa diubah setelah dibuat." : "Kas tunai, rekening bank, atau e-wallet."}
      footer={
        <>
          <Button variant="neutral" onClick={onClose}>Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!f.name.trim()}>Simpan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nama rekening" required hint="Yang mudah dikenali tim, mis. “BCA Operasional”">
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        {editMode ? (
          <Field label="Jenis">
            <Input value={f.kind === "KAS" ? "Kas tunai" : f.kind === "EWALLET" ? "E-wallet / QRIS" : "Rekening bank"} disabled />
          </Field>
        ) : (
          <Field label="Jenis">
            <Pilihan value={f.kind} onChange={(v) => set("kind", v)}>
              <option value="KAS">Kas tunai</option>
              <option value="BANK">Rekening bank</option>
              <option value="EWALLET">E-wallet / QRIS</option>
            </Pilihan>
          </Field>
        )}
        {f.kind !== "KAS" && (
          <>
            <Field label="Nama bank / penyedia">
              <Input value={f.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="BCA" />
            </Field>
            <Field label="Nomor rekening">
              <Input value={f.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} />
            </Field>
            <Field label="Atas nama">
              <Input value={f.accountHolder} onChange={(e) => set("accountHolder", e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Catatan">
          <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Opsional" />
        </Field>
        {editMode && (
          <Field label="Status" hint="Nonaktifkan kalau rekening ini tidak dipakai lagi tapi riwayat transaksinya harus tetap ada (tidak bisa dihapus permanen).">
            <Pilihan value={f.active ? "1" : "0"} onChange={(v) => set("active", v === "1")}>
              <option value="1">Aktif</option>
              <option value="0">Nonaktif</option>
            </Pilihan>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function ModalTransfer({ open, onClose, rekening, onSubmit }) {
  const [f, setF] = useState({ date: "", fromAccountId: "", toAccountId: "", amount: "", feeAmount: "", reference: "", notes: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.fromAccountId && f.toAccountId && f.fromAccountId !== f.toAccountId && Number(f.amount) > 0;
  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Catat Mutasi Antar Rekening"
      footer={
        <>
          <Button variant="neutral" onClick={onClose}>Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Simpan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Tanggal">
          <Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dari rekening" required>
            <Pilihan value={f.fromAccountId} onChange={(v) => set("fromAccountId", v)}>
              <option value="">— pilih —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </Field>
          <Field label="Ke rekening" required error={f.fromAccountId && f.fromAccountId === f.toAccountId ? "Tidak boleh sama" : undefined}>
            <Pilihan value={f.toAccountId} onChange={(v) => set("toAccountId", v)}>
              <option value="">— pilih —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </Field>
        </div>
        <Field label="Nominal" required>
          <InputUang value={f.amount} onChange={(v) => set("amount", v)} />
        </Field>
        <Field
          label="Biaya admin transfer"
          hint="Dicatat TERPISAH, tidak dikurangkan dari nominal — supaya saldo rekening tujuan cocok dengan mutasi bank"
        >
          <InputUang value={f.feeAmount} onChange={(v) => set("feeAmount", v)} />
        </Field>
        <Field label="Referensi">
          <Input value={f.reference} onChange={(e) => set("reference", e.target.value)} placeholder="Nomor transaksi bank" />
        </Field>
        <Field label="Catatan">
          <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ModalPemasukan({ open, onClose, rekening, akunPendapatan, onSubmit }) {
  const [f, setF] = useState({ date: "", amount: "", description: "", accountId: "", cashAccountId: "", notes: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.description.trim() && f.accountId && f.cashAccountId && Number(f.amount) > 0;
  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Catat Pemasukan Lain"
      description="Pemasukan yang BUKAN dari order pelanggan."
      footer={
        <>
          <Button variant="neutral" onClick={onClose}>Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Simpan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Tanggal"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Keterangan" required>
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Penjualan mesin jahit bekas" />
        </Field>
        <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        <Field label="Akun pendapatan" required>
          <Pilihan value={f.accountId} onChange={(v) => set("accountId", v)}>
            <option value="">— pilih —</option>
            {akunPendapatan.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Uang masuk ke" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
