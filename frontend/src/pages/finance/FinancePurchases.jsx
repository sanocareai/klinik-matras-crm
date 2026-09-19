import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, ShoppingCart, Pencil } from "lucide-react";
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
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, PeriodePicker, periodeDefault, tanggalPendek,
  LABEL_DIVISI, PemilihBukti, SelBukti,
} from "@/features/finance/shared.jsx";
import EditDokumen, { STATUS_BISA_DIEDIT } from "@/features/finance/EditDokumen.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";

// PEMBELIAN — barang/aset yang DIBELI dari luar, tanpa tagihan resmi supplier:
// bahan baku (manual, sebelum Gudang dipakai penuh), aset tetap (kendaraan,
// peralatan & mesin), aset tak berwujud (paten/HAKI/domain), dan uang muka/DP.
//
// ⚠️ BEDA DENGAN DUA TAB TETANGGA, dan ini disengaja:
//   - Pengeluaran & Reimbursement → BIAYA operasional yang habis terpakai
//     (bensin, tol, gaji, listrik, sewa). Bukan barang/aset.
//   - Supplier & Utang > Tagihan → pembelian BERTAGIHAN resmi (ada invoice
//     supplier, termin pembayaran, opsional menaut penerimaan barang Gudang).
// Tab ini untuk pembelian yang TIDAK lewat proses tagihan formal itu —
// dibayar tunai/transfer langsung, atau ditalangi dulu oleh karyawan.
//
// ⚠️ UANG MUKA (DP) tidak selesai sendiri: jenis "Uang Muka Pembelian"
// mencatat DP sebagai ASET (akun 1-1500), bukan beban. Saat barang/jasanya
// akhirnya diterima, saldo itu dipindahkan ke akun tujuan sebenarnya lewat
// Jurnal Umum manual — sengaja tidak diotomasi, lihat catatan di
// services/finance/posting/purchase.js.

const STATUS_TAB = [
  { key: "MENUNGGU_APPROVAL", label: "Menunggu Persetujuan" },
  { key: "DISETUJUI", label: "Disetujui (belum dibayar)" },
  { key: "DIBAYAR", label: "Dibayar" },
  { key: "DITOLAK", label: "Ditolak" },
  { key: "", label: "Semua" },
];

export default function FinancePurchases() {
  const [periode, setPeriode] = useState(periodeDefault);
  // Default "Semua" — lihat catatan yang sama di FinanceExpenses.jsx
  // (histori impor Notion masuk sebagai DIBAYAR langsung, jadi default
  // "Menunggu Persetujuan" membuat halaman ini tampak kosong).
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
  const [suppliers, setSuppliers] = useState([]);
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
      const [p, k, r, s] = await Promise.all([
        api.getFinancePurchases({
          ...periode, status, q: qTunda.trim(),
          categoryId: fKategori, division: fDivisi, mode: fMode, bukti: fBukti,
        }),
        api.getFinancePurchaseCategories(),
        api.getFinanceCashAccounts().catch(() => ({ accounts: [] })),
        api.getFinanceSuppliers().catch(() => ({ suppliers: [] })),
      ]);
      setData(p);
      setKategori(k.categories);
      setRekening((r.accounts || []).filter((a) => a.active));
      setSuppliers((s.suppliers || []).filter((x) => x.active));
    } catch (er) {
      if (diam) setPesan(er.message || "Gagal menyegarkan daftar");
      else setError(er.message || "Gagal memuat pembelian");
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

  const purchases = data?.purchases || [];

  return (
    <HalamanFinance
      title="Pembelian"
      subtitle="Bahan baku, aset tetap, aset tak berwujud, dan uang muka (DP) ke supplier."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
          <Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Pembelian Baru</Button>
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
          Anda melihat pengajuan milik sendiri saja. Persetujuan &amp; pembayaran dikerjakan tim Finance.
        </Penjelasan>
      )}

      <Penjelasan>
        Tab ini untuk <strong>barang/aset yang dibeli tanpa tagihan resmi supplier</strong> — dibayar tunai/transfer
        langsung atau ditalangi karyawan. Pembelian yang ada invoice &amp; terminnya dicatat di{" "}
        <strong>Supplier &amp; Utang → Tagihan</strong>, sementara biaya operasional yang habis terpakai (bensin, tol,
        gaji, listrik) tetap di <strong>Pengeluaran &amp; Reimbursement</strong>. Untuk jenis <strong>Uang Muka
        Pembelian</strong>, nominalnya dicatat sebagai aset dulu (bukan beban) sampai barangnya diterima.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KartuAngka
          label="Total di Filter Ini"
          value={formatUang(data?.total ?? 0)}
          sub={`${purchases.length} pembelian`}
          info="Jumlah nominal seluruh baris yang tampil di tabel bawah, sesuai filter periode & status yang sedang aktif — bukan total pembelian sepanjang masa."
        />
        <KartuAngka
          label="Menunggu Persetujuan"
          value={purchases.filter((p) => p.status === "MENUNGGU_APPROVAL").length}
          tone={purchases.some((p) => p.status === "MENUNGGU_APPROVAL") ? "orange" : "default"}
          info="Pengajuan yang belum ada keputusan — belum masuk buku besar sama sekali. Perlu Setujui atau Tolak."
        />
        <KartuAngka
          label="Disetujui, Belum Dibayar"
          value={purchases.filter((p) => p.status === "DISETUJUI").length}
          sub="Reimbursement & utang"
          info="Barang/asetnya SUDAH tercatat di buku besar, tapi uangnya belum benar-benar keluar — menunggu diganti ke karyawan atau dibayar ke pihak ketiga."
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
          { key: "kat", label: "Jenis", value: fKategori, onChange: setFKategori, options: kategori.map((k) => [k.id, k.name]) },
          { key: "div", label: "Divisi", value: fDivisi, onChange: setFDivisi, options: Object.entries(LABEL_DIVISI) },
          { key: "mode", label: "Cara bayar", value: fMode, onChange: setFMode, options: [["LANGSUNG", "Bayar langsung"], ["REIMBURSEMENT", "Reimbursement"], ["UTANG", "Utang"]] },
          { key: "bukti", label: "Bukti", value: fBukti, onChange: setFBukti, options: [["ada", "Ada nota"], ["tanpa", "Tanpa nota"], ["terverifikasi", "Terverifikasi"], ["belum", "Belum diverifikasi"]] },
        ]}
        ringkasan={`${purchases.length} pembelian${data?.terpotong ? " · baru 300 teratas tampil — persempit pencarian atau periode" : ""}`}
        onReset={aturUlangFilter}
      />

      <Card className="overflow-hidden">
        <JudulKartu
          title="Daftar Pembelian"
          description="Nomor PUR dibuat otomatis per bulan."
          info="Nomor dokumen (PUR-tanggal-urutan) dibuat sistem sendiri, tidak bisa diketik manual — supaya tidak ada dua pembelian berbeda yang kebetulan pakai nomor yang sama."
        />
        {purchases.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={ShoppingCart}
              title="Tidak ada pembelian"
              description="Belum ada pembelian yang cocok dengan filter ini."
              action={<Button size="sm" onClick={() => setModalBaru(true)}>Catat Pembelian</Button>}
            />
          </CardContent>
        ) : (
          <TableWrap className="dh-table">
            <Table>
              <THead>
                <TR>
                  <TH sticky>Nomor</TH><TH>Tanggal</TH><TH>Keterangan</TH><TH>Jenis</TH>
                  <TH>Divisi</TH><TH>Mode</TH><TH numeric>Nominal</TH><TH>Status</TH><TH>Bukti</TH><TH />
                </TR>
              </THead>
              <TBody>
                {purchases.map((p) => (
                  <TR key={p.id}>
                    <TD sticky className="font-mono text-[12px]">{p.purchaseNumber}</TD>
                    <TD className="whitespace-nowrap">{tanggalPendek(p.date)}</TD>
                    <TD className="max-w-[260px]">
                      <span className="block truncate">{p.description}</span>
                      {p.reimburseTo && <span className="text-[11px] text-ink3">ditalangi {p.reimburseTo.name}</span>}
                      {p.supplier && <span className="text-[11px] text-ink3">dari {p.supplier.name}</span>}
                      {!p.reimburseTo && !p.supplier && p.payeeName && <span className="text-[11px] text-ink3">dari {p.payeeName}</span>}
                    </TD>
                    <TD className="text-[12px]">{p.category?.name}</TD>
                    <TD><Badge variant="neutral">{LABEL_DIVISI[p.division] || p.division}</Badge></TD>
                    <TD className="text-[12px] text-ink2">
                      {p.mode === "LANGSUNG" ? "Bayar langsung" : p.mode === "REIMBURSEMENT" ? "Reimbursement" : "Utang"}
                    </TD>
                    <TD numeric><Uang value={p.amount} /></TD>
                    <TD><StatusBadge status={p.status} /></TD>
                    <TD><SelBukti doc={p} jenis="purchases" aksi={aksi} /></TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        {STATUS_BISA_DIEDIT.includes(p.status) && (
                          <Button size="sm" variant="neutral" onClick={() => setEditUntuk(p)} title="Edit / koreksi">
                            <Pencil size={13} /> Edit
                          </Button>
                        )}
                        {["DISETUJUI", "DIBAYAR"].includes(p.status) && (
                          <TombolAksi
                            size="sm" variant="neutral"
                            onClick={() => {
                              const alasan = window.prompt("Alasan membatalkan pembelian ini (salah input total)? Jurnalnya akan dibalik, riwayat tetap tersimpan:");
                              if (alasan?.trim()) return aksi(() => api.cancelFinancePurchase(p.id, alasan.trim()));
                            }}
                          >
                            Batalkan
                          </TombolAksi>
                        )}
                        {["DRAFT", "MENUNGGU_APPROVAL"].includes(p.status) && (
                          <>
                            <TombolAksi
                              size="sm" variant="secondary"
                              confirmText={`Setujui ${p.purchaseNumber} sebesar ${formatUang(p.amount)}? Nilainya akan langsung masuk buku besar.`}
                              onClick={() => aksi(() => api.approveFinancePurchase(p.id))}
                            >
                              Setujui
                            </TombolAksi>
                            <TombolAksi
                              size="sm" variant="neutral"
                              onClick={() => {
                                const alasan = window.prompt("Alasan penolakan:");
                                if (alasan?.trim()) return aksi(() => api.rejectFinancePurchase(p.id, alasan.trim()));
                              }}
                            >
                              Tolak
                            </TombolAksi>
                          </>
                        )}
                        {p.status === "DISETUJUI" && (
                          <Button size="sm" variant="secondary" onClick={() => setBayarUntuk(p)}>Bayar</Button>
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

      <ModalPembelian
        open={modalBaru} onClose={() => setModalBaru(false)}
        kategori={kategori} rekening={rekening} suppliers={suppliers}
        onSubmit={(d) => aksi(() => api.createFinancePurchase(d))}
      />

      <ModalBayar
        purchase={bayarUntuk} onClose={() => setBayarUntuk(null)}
        rekening={rekening}
        onSubmit={(d) => aksi(() => api.payFinancePurchase(bayarUntuk.id, d))}
      />
      <EditDokumen
        doc={editUntuk} jenis="purchases" kategori={kategori} rekening={rekening}
        onClose={() => setEditUntuk(null)}
        onSaved={() => { setEditUntuk(null); muat({ diam: true }); }}
      />
    </HalamanFinance>
  );
}

function ModalPembelian({ open, onClose, kategori, rekening, suppliers, onSubmit }) {
  const [f, setF] = useState({
    date: "", amount: "", description: "", categoryId: "", division: "",
    mode: "LANGSUNG", cashAccountId: "", supplierId: "", payeeName: "", notes: "", receiptUrl: "",
  });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.description.trim() && f.categoryId && Number(f.amount) > 0 &&
    (f.mode !== "LANGSUNG" || f.cashAccountId);

  const kategoriDipilih = kategori.find((k) => k.id === f.categoryId);
  const isUangMuka = kategoriDipilih?.code === "UANG_MUKA_PEMBELIAN";

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Pembelian Baru"
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
          <Input value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Busa rebonded 160x200x4, 10 lembar" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
          <Field label="Nominal" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
        </div>
        <Field label="Jenis pembelian" required hint="Menentukan akun tujuan di buku besar">
          <Pilihan value={f.categoryId} onChange={(v) => set("categoryId", v)}>
            <option value="">— pilih —</option>
            {kategori.map((k) => (
              <option key={k.id} value={k.id}>{k.name} → {k.account?.code} {k.account?.name}</option>
            ))}
          </Pilihan>
        </Field>
        {isUangMuka && (
          <Penjelasan>
            Uang muka dicatat sebagai <strong>aset</strong> (Uang Muka Pembelian), bukan beban. Saat barang/jasanya
            diterima, pindahkan saldonya ke akun tujuan sebenarnya lewat <strong>Jurnal Umum</strong> — langkah itu
            tidak otomatis.
          </Penjelasan>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Dibebankan ke divisi">
            <Pilihan value={f.division} onChange={(v) => set("division", v)}>
              <option value="">— Umum —</option>
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
        <Field label="Supplier" hint="Opsional — pilih kalau pemasoknya sudah terdaftar">
          <Pilihan value={f.supplierId} onChange={(v) => set("supplierId", v)}>
            <option value="">— tidak dipilih —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Dibeli dari" hint="Nama toko/orang kalau belum jadi supplier terdaftar — opsional">
          <Input value={f.payeeName} onChange={(e) => set("payeeName", e.target.value)} />
        </Field>
        <Field label="Foto nota / bukti" hint="Wajib sebelum disetujui untuk reimbursement, pembelian, dan nominal besar — foto nota dari bawahan di sini">
          <PemilihBukti url={f.receiptUrl} onChange={(v) => set("receiptUrl", v)} />
        </Field>
        <Field label="Catatan"><Input value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ModalBayar({ purchase, onClose, rekening, onSubmit }) {
  const [f, setF] = useState({ cashAccountId: "", paidAt: "" });
  useEffect(() => { setF({ cashAccountId: purchase?.cashAccountId || "", paidAt: "" }); }, [purchase]);
  if (!purchase) return null;

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Bayar ${purchase.purchaseNumber}`}
      description={`${formatUang(purchase.amount)} · ${purchase.description}`}
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={() => onSubmit(f)} disabled={!f.cashAccountId}>Catat Pembayaran</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-ink2">
          Barang/asetnya sudah tercatat di buku besar saat pembelian ini disetujui. Langkah ini mencatat{" "}
          <strong>keluarnya uang</strong> dan melunasi{" "}
          {purchase.mode === "REIMBURSEMENT" ? "utang reimbursement ke karyawan" : "utang ke pihak ketiga"}.
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
