import React, { useCallback, useEffect, useState } from "react";
import { Plus, Receipt } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, PeriodePicker, periodeDefault, tanggalPendek,
  LABEL_DIVISI,
} from "@/features/finance/shared.jsx";

// PENGELUARAN & REIMBURSEMENT.
//
// ⚠️ YANG TIDAK DICATAT DI SINI, dan ini disengaja:
//   - Biaya kendaraan (BBM/tol/parkir/servis) → tetap di Delivery > Biaya.
//   - Belanja iklan bulanan → tetap di Pengaturan CRM.
//   - Bahan baku → nilainya mengalir sendiri dari ledger stok Gudang.
// Ketiganya sudah punya tempat input yang benar dan orang yang paling tahu
// angkanya. Modul Finance MEMBACA dan membukukannya, bukan meminta
// diketik ulang — menyalinnya ke sini akan menghasilkan dua angka untuk
// pengeluaran yang sama, dan yang kedua pasti tertinggal.

const STATUS_TAB = [
  { key: "MENUNGGU_APPROVAL", label: "Menunggu Persetujuan" },
  { key: "DISETUJUI", label: "Disetujui (belum dibayar)" },
  { key: "DIBAYAR", label: "Dibayar" },
  { key: "DITOLAK", label: "Ditolak" },
  { key: "", label: "Semua" },
];

export default function FinanceExpenses() {
  const [periode, setPeriode] = useState(periodeDefault);
  const [status, setStatus] = useState("MENUNGGU_APPROVAL");
  const [data, setData] = useState(null);
  const [kategori, setKategori] = useState([]);
  const [rekening, setRekening] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalBaru, setModalBaru] = useState(false);
  const [bayarUntuk, setBayarUntuk] = useState(null);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [e, k, r] = await Promise.all([
        api.getFinanceExpenses({ ...periode, status }),
        api.getFinanceExpenseCategories(),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
      ]);
      setData(e);
      setKategori(k.categories);
      setRekening((r.accounts || []).filter((a) => a.active));
    } catch (er) {
      setError(er.message || "Gagal memuat pengeluaran");
    } finally {
      setLoading(false);
    }
  }, [periode, status]);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      await fn();
      setModalBaru(false);
      setBayarUntuk(null);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const expenses = data?.expenses || [];

  return (
    <HalamanFinance
      title="Pengeluaran & Reimbursement"
      subtitle="Biaya operasional, upah produksi, dan uang yang ditalangi karyawan."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
          <Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Pengeluaran Baru</Button>
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

      {data?.hanyaMilikSendiri && (
        <Penjelasan>
          Anda melihat pengajuan milik sendiri saja. Persetujuan & pembayaran dikerjakan tim Finance.
        </Penjelasan>
      )}

      <Penjelasan>
        Beban diakui di buku besar saat pengeluaran <strong>DISETUJUI</strong>, bukan saat dibuat — pengajuan
        yang belum tentu disetujui bukan beban. Untuk reimbursement & utang, pengakuan beban dan keluarnya
        uang adalah dua kejadian terpisah: beban tetap masuk bulan ini walau uangnya baru diganti bulan depan.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KartuAngka
          label="Total di Filter Ini"
          value={formatUang(data?.total ?? 0)}
          sub={`${expenses.length} pengeluaran`}
        />
        <KartuAngka
          label="Menunggu Persetujuan"
          value={expenses.filter((e) => e.status === "MENUNGGU_APPROVAL").length}
          tone={expenses.some((e) => e.status === "MENUNGGU_APPROVAL") ? "orange" : "default"}
        />
        <KartuAngka
          label="Disetujui, Belum Dibayar"
          value={expenses.filter((e) => e.status === "DISETUJUI").length}
          sub="Reimbursement & utang"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TAB.map((t) => (
          <Button key={t.key || "semua"} size="sm" variant={status === t.key ? "secondary" : "neutral"} onClick={() => setStatus(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Daftar Pengeluaran</CardTitle>
          <CardDescription>Nomor EXP dibuat otomatis per bulan.</CardDescription>
        </CardHeader>
        {expenses.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={Receipt}
              title="Tidak ada pengeluaran"
              description="Belum ada pengeluaran yang cocok dengan filter ini."
              action={<Button size="sm" onClick={() => setModalBaru(true)}>Catat Pengeluaran</Button>}
            />
          </CardContent>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Nomor</TH><TH>Tanggal</TH><TH>Keterangan</TH><TH>Kategori</TH>
                  <TH>Divisi</TH><TH>Mode</TH><TH numeric>Nominal</TH><TH>Status</TH><TH />
                </TR>
              </THead>
              <TBody>
                {expenses.map((e) => (
                  <TR key={e.id}>
                    <TD className="font-mono text-[12px]">{e.expenseNumber}</TD>
                    <TD className="whitespace-nowrap">{tanggalPendek(e.date)}</TD>
                    <TD className="max-w-[260px]">
                      <span className="block truncate">{e.description}</span>
                      {e.reimburseTo && <span className="text-[11px] text-ink3">ditalangi {e.reimburseTo.name}</span>}
                      {e.supplier && <span className="text-[11px] text-ink3">ke {e.supplier.name}</span>}
                      {!e.reimburseTo && !e.supplier && e.payeeName && <span className="text-[11px] text-ink3">ke {e.payeeName}</span>}
                    </TD>
                    <TD className="text-[12px]">{e.category?.name}</TD>
                    <TD><Badge variant="neutral">{LABEL_DIVISI[e.division] || e.division}</Badge></TD>
                    <TD className="text-[12px] text-ink2">
                      {e.mode === "LANGSUNG" ? "Bayar langsung" : e.mode === "REIMBURSEMENT" ? "Reimbursement" : "Utang"}
                    </TD>
                    <TD numeric><Uang value={e.amount} /></TD>
                    <TD><StatusBadge status={e.status} /></TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {["DRAFT", "MENUNGGU_APPROVAL"].includes(e.status) && (
                          <>
                            <TombolAksi
                              size="sm" variant="secondary"
                              confirmText={`Setujui ${e.expenseNumber} sebesar ${formatUang(e.amount)}? Beban akan langsung masuk buku besar.`}
                              onClick={() => aksi(() => api.approveFinanceExpense(e.id))}
                            >
                              Setujui
                            </TombolAksi>
                            <TombolAksi
                              size="sm" variant="neutral"
                              onClick={() => {
                                const alasan = window.prompt("Alasan penolakan:");
                                if (alasan?.trim()) return aksi(() => api.rejectFinanceExpense(e.id, alasan.trim()));
                              }}
                            >
                              Tolak
                            </TombolAksi>
                          </>
                        )}
                        {e.status === "DISETUJUI" && (
                          <Button size="sm" variant="secondary" onClick={() => setBayarUntuk(e)}>Bayar</Button>
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

      <ModalPengeluaran
        open={modalBaru} onClose={() => setModalBaru(false)}
        kategori={kategori} rekening={rekening}
        onSubmit={(d) => aksi(() => api.createFinanceExpense(d))}
      />

      <ModalBayar
        expense={bayarUntuk} onClose={() => setBayarUntuk(null)}
        rekening={rekening}
        onSubmit={(d) => aksi(() => api.payFinanceExpense(bayarUntuk.id, d))}
      />
    </HalamanFinance>
  );
}

function ModalPengeluaran({ open, onClose, kategori, rekening, onSubmit }) {
  const [f, setF] = useState({
    date: "", amount: "", description: "", categoryId: "", division: "",
    mode: "LANGSUNG", cashAccountId: "", payeeName: "", orderId: "", notes: "",
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.description.trim() && f.categoryId && Number(f.amount) > 0 &&
    (f.mode !== "LANGSUNG" || f.cashAccountId);

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Pengeluaran Baru"
      description="Pengajuan lahir berstatus Menunggu Persetujuan dan belum menyentuh buku besar."
      className="w-[520px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose}>Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Ajukan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Keterangan" required>
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Upah harian tukang minggu ke-3" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal"><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
          <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        <Field label="Kategori biaya" required hint="Menentukan akun beban di buku besar">
          <Pilihan value={f.categoryId} onChange={(v) => {
            set("categoryId", v);
            const k = kategori.find((x) => x.id === v);
            if (k && !f.division) set("division", k.division);
          }}>
            <option value="">— pilih —</option>
            {kategori.map((k) => (
              <option key={k.id} value={k.id}>{k.name} → {k.account?.code} {k.account?.name}</option>
            ))}
          </Pilihan>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dibebankan ke divisi">
            <Pilihan value={f.division} onChange={(v) => set("division", v)}>
              <option value="">— ikut kategori —</option>
              {Object.entries(LABEL_DIVISI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Pilihan>
          </Field>
          <Field label="Cara bayar">
            <Pilihan value={f.mode} onChange={(v) => set("mode", v)}>
              <option value="LANGSUNG">Bayar langsung dari kas/bank</option>
              <option value="REIMBURSEMENT">Ditalangi karyawan (reimbursement)</option>
              <option value="UTANG">Belum dibayar (jadi utang)</option>
            </Pilihan>
          </Field>
        </div>
        {f.mode === "LANGSUNG" && (
          <Field label="Uang keluar dari" required>
            <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
              <option value="">— pilih —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Pilihan>
          </Field>
        )}
        <Field label="Dibayarkan kepada" hint="Nama toko/tukang — opsional">
          <Input value={f.payeeName} onChange={(e) => set("payeeName", e.target.value)} />
        </Field>
        <Field label="Order terkait" hint="Opsional — untuk membebankan biaya ke order tertentu">
          <OrderPicker value={f.orderId} onChange={(id) => set("orderId", id)} placeholder="Cari order…" />
        </Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalBayar({ expense, onClose, rekening, onSubmit }) {
  const [f, setF] = useState({ cashAccountId: "", paidAt: "" });
  useEffect(() => { setF({ cashAccountId: expense?.cashAccountId || "", paidAt: "" }); }, [expense]);
  if (!expense) return null;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Bayar ${expense.expenseNumber}`}
      description={`${formatUang(expense.amount)} · ${expense.description}`}
      footer={
        <>
          <Button variant="neutral" onClick={onClose}>Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!f.cashAccountId}>Catat Pembayaran</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-ink2">
          Bebannya sudah diakui saat pengeluaran ini disetujui. Langkah ini mencatat <strong>keluarnya uang</strong>
          {" "}dan melunasi {expense.mode === "REIMBURSEMENT" ? "utang reimbursement ke karyawan" : "utang ke pihak ketiga"}.
        </p>
        <Field label="Uang keluar dari" required>
          <Pilihan value={f.cashAccountId} onChange={(v) => setF((s) => ({ ...s, cashAccountId: v }))}>
            <option value="">— pilih —</option>
            {rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Tanggal bayar">
          <Input type="date" value={f.paidAt} onChange={(e) => setF((s) => ({ ...s, paidAt: e.target.value }))} />
        </Field>
      </div>
    </Modal>
  );
}
