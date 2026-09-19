import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Receipt, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import DatePicker from "@/components/ui/date-picker.jsx";
import OrderPicker from "@/features/finance/OrderPicker.jsx";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, PeriodePicker, periodeDefault, tanggalPendek,
  LABEL_DIVISI, PemilihBukti, SelBukti,
} from "@/features/finance/shared.jsx";
import EditDokumen, { STATUS_BISA_DIEDIT } from "@/features/finance/EditDokumen.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";

// PENGELUARAN & REIMBURSEMENT.
//
// ⚠️ YANG TIDAK DICATAT DI SINI, dan ini disengaja:
//   - Biaya kendaraan (BBM/tol/parkir/servis) → tetap di Delivery > Biaya.
//   - Belanja iklan bulanan → tetap di Pengaturan CRM.
//   - Bahan baku → nilainya mengalir sendiri dari ledger stok Gudang; yang
//     dibeli manual/tunai (plus aset & uang muka) → tab Pembelian.
// Semuanya sudah punya tempat input yang benar dan orang yang paling tahu
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
  // Default "Semua" (bukan "Menunggu Persetujuan") — histori impor Notion
  // (D-181, 18 Sep 2026) masuk sebagai DIBAYAR langsung (transaksi lama,
  // sudah lunas), jadi default lama membuat halaman ini tampak kosong
  // padahal datanya ada ribuan baris.
  const [status, setStatus] = useState("");
  // Pencarian & filter — dikirim ke SERVER (bukan disaring di browser) supaya
  // hasilnya mencakup seluruh periode, bukan cuma 300 baris yang termuat.
  const [q, setQ] = useState("");
  const [fKategori, setFKategori] = useState("");
  const [fDivisi, setFDivisi] = useState("");
  const [fMode, setFMode] = useState("");
  const [fBukti, setFBukti] = useState("");
  const qTunda = useTertunda(q);
  const pernahMuat = useRef(false);
  const [data, setData] = useState(null);
  const [kategori, setKategori] = useState([]);
  const [rekening, setRekening] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalBaru, setModalBaru] = useState(false);
  const [bayarUntuk, setBayarUntuk] = useState(null);
  const [editUntuk, setEditUntuk] = useState(null);

  // { diam: true } = muat ulang di latar belakang: layar TIDAK berubah jadi
  // "memuat" dan posisi scroll tetap (dipakai setelah upload foto/aksi baris).
  // Argumen selain { diam: true } (mis. event klik dari onRetry) diabaikan.
  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    if (!diam) setLoading(true);
    setError(null);
    try {
      const [e, k, r] = await Promise.all([
        api.getFinanceExpenses({
          ...periode, status, q: qTunda.trim(),
          categoryId: fKategori, division: fDivisi, mode: fMode, bukti: fBukti,
        }),
        api.getFinanceExpenseCategories(),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
      ]);
      setData(e);
      setKategori(k.categories);
      setRekening((r.accounts || []).filter((a) => a.active));
    } catch (er) {
      if (diam) setPesan(er.message || "Gagal menyegarkan daftar");
      else setError(er.message || "Gagal memuat pengeluaran");
    } finally {
      if (!diam) setLoading(false);
    }
  }, [periode, status, qTunda, fKategori, fDivisi, fMode, fBukti]);

  // Pemuatan pertama menampilkan layar "memuat"; setelah itu (ganti filter,
  // ketik pencarian) daftar disegarkan diam-diam supaya kolom cari tidak
  // ikut hilang dan kursor tidak lepas.
  useEffect(() => {
    muat({ diam: pernahMuat.current });
    pernahMuat.current = true;
  }, [muat]);

  function aturUlangFilter() {
    setQ(""); setFKategori(""); setFDivisi(""); setFMode(""); setFBukti("");
  }

  async function aksi(fn) {
    try {
      await fn();
      setModalBaru(false);
      setBayarUntuk(null);
      await muat({ diam: true });
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
          info="Jumlah nominal seluruh baris yang tampil di tabel bawah, sesuai filter periode & status yang sedang aktif — bukan total pengeluaran sepanjang masa."
        />
        <KartuAngka
          label="Menunggu Persetujuan"
          value={expenses.filter((e) => e.status === "MENUNGGU_APPROVAL").length}
          tone={expenses.some((e) => e.status === "MENUNGGU_APPROVAL") ? "orange" : "default"}
          info="Pengajuan yang belum ada keputusan — belum masuk buku besar sama sekali. Perlu Setujui atau Tolak."
        />
        <KartuAngka
          label="Disetujui, Belum Dibayar"
          value={expenses.filter((e) => e.status === "DISETUJUI").length}
          sub="Reimbursement & utang"
          info="Bebannya SUDAH tercatat di laba rugi, tapi uangnya belum benar-benar keluar — menunggu diganti ke karyawan atau dibayar ke pihak ketiga."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TAB.map((t) => (
          <Button key={t.key || "semua"} size="sm" variant={status === t.key ? "secondary" : "neutral"} onClick={() => setStatus(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>
      <p className="text-[13px] leading-relaxed text-ink3">
        Saring daftar di bawah berdasarkan tahap prosesnya — dari pengajuan sampai uangnya benar-benar keluar.
      </p>

      <FilterBar
        q={q} onQ={setQ}
        placeholder="Cari nomor, keterangan, penerima, nominal…"
        filters={[
          { key: "kat", label: "Kategori", value: fKategori, onChange: setFKategori, options: kategori.map((k) => [k.id, k.name]) },
          { key: "div", label: "Divisi", value: fDivisi, onChange: setFDivisi, options: Object.entries(LABEL_DIVISI) },
          { key: "mode", label: "Cara bayar", value: fMode, onChange: setFMode, options: [["LANGSUNG", "Bayar langsung"], ["REIMBURSEMENT", "Reimbursement"], ["UTANG", "Utang"]] },
          { key: "bukti", label: "Bukti", value: fBukti, onChange: setFBukti, options: [["ada", "Ada nota"], ["tanpa", "Tanpa nota"], ["terverifikasi", "Terverifikasi"], ["belum", "Belum diverifikasi"]] },
        ]}
        ringkasan={`${expenses.length} pengeluaran${data?.terpotong ? " · baru 300 teratas tampil — persempit pencarian atau periode" : ""}`}
        onReset={aturUlangFilter}
      />

      <Card className="overflow-hidden">
        <JudulKartu
          title="Daftar Pengeluaran"
          description="Nomor EXP dibuat otomatis per bulan."
          info="Nomor dokumen (EXP-tanggal-urutan) dibuat sistem sendiri, tidak bisa diketik manual — supaya tidak ada dua pengeluaran berbeda yang kebetulan pakai nomor yang sama."
        />
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
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR>
                  <TH sticky>Nomor</TH><TH>Tanggal</TH><TH>Keterangan</TH><TH>Kategori</TH>
                  <TH>Divisi</TH><TH>Mode</TH><TH numeric>Nominal</TH><TH>Status</TH><TH>Bukti</TH><TH />
                </TR>
              </THead>
              <TBody>
                {expenses.map((e) => (
                  <TR key={e.id}>
                    <TD sticky className="font-mono text-[12px]">{e.expenseNumber}</TD>
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
                    <TD><SelBukti doc={e} jenis="expenses" aksi={aksi} /></TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {STATUS_BISA_DIEDIT.includes(e.status) && (
                          <Button size="sm" variant="neutral" onClick={() => setEditUntuk(e)} title="Edit / koreksi">
                            <Pencil size={13} /> Edit
                          </Button>
                        )}
                        {["DISETUJUI", "DIBAYAR"].includes(e.status) && (
                          <TombolAksi
                            size="sm" variant="neutral"
                            onClick={() => {
                              const alasan = window.prompt("Alasan membatalkan pengeluaran ini (salah input total)? Jurnalnya akan dibalik, riwayat tetap tersimpan:");
                              if (alasan?.trim()) return aksi(() => api.cancelFinanceExpense(e.id, alasan.trim()));
                            }}
                          >
                            Batalkan
                          </TombolAksi>
                        )}
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
      <EditDokumen
        doc={editUntuk} jenis="expenses" kategori={kategori} rekening={rekening}
        onClose={() => setEditUntuk(null)}
        onSaved={() => { setEditUntuk(null); muat({ diam: true }); }}
      />
    </HalamanFinance>
  );
}

function ModalPengeluaran({ open, onClose, kategori, rekening, onSubmit }) {
  const [f, setF] = useState({
    date: "", amount: "", description: "", categoryId: "", division: "",
    mode: "LANGSUNG", cashAccountId: "", payeeName: "", orderId: "", notes: "", receiptUrl: "",
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
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!valid}>Ajukan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Keterangan" required>
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Upah harian tukang minggu ke-3" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <Field label="Foto nota / bukti" hint="Wajib sebelum disetujui untuk reimbursement, pembelian, dan nominal besar — foto nota dari bawahan di sini">
          <PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} />
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
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
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
          <DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.paidAt} onChange={(v) => setF((s) => ({ ...s, paidAt: v }))} />
        </Field>
      </div>
    </Modal>
  );
}
