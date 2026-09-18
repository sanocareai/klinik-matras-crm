import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Lock, Download } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, Uang, JudulKartu, Penjelasan, Pilihan, TombolAksi,
  LABEL_TIPE_AKUN,
} from "@/features/finance/shared.jsx";

// BAGAN AKUN (Chart of Accounts) — daftar "rekening pembukuan" perusahaan.
//
// Halaman ini juga jadi LANGKAH PERTAMA seluruh modul finance: tanpa bagan
// akun, mesin posting tidak punya tempat menaruh apa pun dan setiap
// pembayaran yang masuk akan berakhir di daftar "Data Belum Lengkap".
//
// Akun ber-KUNCI SISTEM ditandai gembok & tidak bisa dinonaktifkan —
// backend menolaknya juga (bukan cuma disembunyikan di UI), lihat
// PATCH /api/finance/accounts/:id.

const TIPE = ["ASET", "KEWAJIBAN", "EKUITAS", "PENDAPATAN", "BEBAN_POKOK", "BEBAN"];

export default function FinanceAccounts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterTipe, setFilterTipe] = useState("");
  const [cari, setCari] = useState("");
  const [tampilNonaktif, setTampilNonaktif] = useState(false);
  const [formBuka, setFormBuka] = useState(false);
  const [pesan, setPesan] = useState(null);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getFinanceAccounts(tampilNonaktif ? { includeInactive: "1" } : {}));
    } catch (e) {
      setError(e.message || "Gagal memuat bagan akun");
    } finally {
      setLoading(false);
    }
  }, [tampilNonaktif]);

  useEffect(() => { muat(); }, [muat]);

  const terlihat = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return (data?.accounts || []).filter((a) => {
      if (filterTipe && a.type !== filterTipe) return false;
      if (!q) return true;
      return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    });
  }, [data, filterTipe, cari]);

  async function pasangBawaan() {
    try {
      const r = await api.installFinanceDefaultAccounts();
      setPesan(`Bagan akun bawaan terpasang — ${r.accounts} akun tersedia.`);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  async function ubahAktif(akun, active) {
    try {
      await api.updateFinanceAccount(akun.id, { active });
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const belumTerpasang = data && data.accounts.length === 0;

  return (
    <HalamanFinance
      title="Bagan Akun"
      subtitle="Daftar akun pembukuan. Semua jurnal menempel ke salah satu akun detail di sini."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          <TombolAksi size="sm" variant="neutral" onClick={pasangBawaan}>
            <Download size={14} /> Pasang Akun Bawaan
          </TombolAksi>
          <Button size="sm" onClick={() => setFormBuka(true)}>
            <Plus size={14} /> Akun Baru
          </Button>
        </>
      }
    >
      {pesan && (
        <Card className="bg-accentbg">
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p className="text-[13px] text-ink">{pesan}</p>
            <Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
          </CardContent>
        </Card>
      )}

      {belumTerpasang ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-[15px] font-bold text-ink">Bagan akun belum dipasang</p>
            <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-relaxed text-ink2">
              Tekan “Pasang Akun Bawaan” untuk memasang {data?.jumlahBawaan ?? 0} akun standar yang sudah
              disesuaikan dengan transaksi yang memang ada di sistem ini — pendapatan dipisah per kategori
              order (Layanan/Produk/Sewa), beban dipisah sesuai kategori biaya kendaraan yang dipakai Armada,
              dan akun untuk DP pelanggan yang <strong>bukan</strong> pendapatan.
            </p>
            <TombolAksi className="mt-4" onClick={pasangBawaan}>
              <Download size={14} /> Pasang Akun Bawaan
            </TombolAksi>
          </CardContent>
        </Card>
      ) : (
        <>
          <Penjelasan>
            Akun bertanda <Lock size={12} className="inline align-[-1px]" /> dipakai mesin pembukuan otomatis
            (penerimaan pembayaran, pengakuan pendapatan, HPP bahan). Namanya boleh diganti mengikuti kebiasaan
            tim, tapi tidak bisa dinonaktifkan — mematikannya akan menghentikan pembukuan otomatis, dan
            akibatnya baru terasa berhari-hari kemudian sebagai tumpukan “Data Belum Lengkap”.
          </Penjelasan>

          <Card className="overflow-hidden">
            <JudulKartu
              title={`${terlihat.length} akun`}
              description="Akun kelompok (header) tidak bisa dijurnal — ia cuma pengelompokan tampilan di laporan."
              info="Ini fondasi seluruh modul Finance — setiap transaksi akhirnya menempel ke salah satu akun di sini. Akun bergembok dipakai mesin pembukuan otomatis dan tidak bisa dinonaktifkan; sisanya bebas diatur sesuai kebutuhan."
            />
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={cari} onChange={(e) => setCari(e.target.value)}
                  placeholder="Cari kode atau nama akun…" className="max-w-[240px]"
                />
                <Pilihan value={filterTipe} onChange={setFilterTipe} className="max-w-[180px]">
                  <option value="">Semua tipe</option>
                  {TIPE.map((t) => <option key={t} value={t}>{LABEL_TIPE_AKUN[t]}</option>)}
                </Pilihan>
                <label className="flex items-center gap-1.5 text-[13px] text-ink2">
                  <input type="checkbox" checked={tampilNonaktif} onChange={(e) => setTampilNonaktif(e.target.checked)} />
                  Tampilkan yang nonaktif
                </label>
              </div>
            </CardHeader>
            <TableWrap className="dh-table">
              <Table>
                <THead>
                  <TR>
                    <TH sticky>Kode</TH><TH>Nama Akun</TH><TH>Tipe</TH>
                    <TH>Saldo Normal</TH><TH>Arus Kas</TH><TH>Status</TH><TH />
                  </TR>
                </THead>
                <TBody>
                  {terlihat.map((a) => (
                    <TR key={a.id} className={!a.isPostable ? "bg-inset/50" : undefined}>
                      <TD sticky className="font-mono text-[12px] tabular-nums">{a.code}</TD>
                      <TD>
                        <span className={a.isPostable ? "" : "font-bold uppercase tracking-wide text-ink2"}>
                          {a.name}
                        </span>
                        {a.systemKey && <Lock size={11} className="ml-1.5 inline align-[-1px] text-ink3" />}
                        {a.description && (
                          <p className="mt-0.5 max-w-[420px] text-[12px] leading-snug text-ink3">{a.description}</p>
                        )}
                      </TD>
                      <TD><Badge variant="neutral">{LABEL_TIPE_AKUN[a.type] || a.type}</Badge></TD>
                      <TD className="text-[12px] text-ink2">{a.normalBalance === "DEBIT" ? "Debit" : "Kredit"}</TD>
                      <TD className="text-[12px] text-ink2">{a.cashFlowCategory ? a.cashFlowCategory.toLowerCase() : "—"}</TD>
                      <TD>
                        {!a.isPostable
                          ? <Badge variant="neutral">Kelompok</Badge>
                          : a.active
                            ? <Badge variant="green">Aktif</Badge>
                            : <Badge variant="red">Nonaktif</Badge>}
                      </TD>
                      <TD>
                        {a.isPostable && !a.systemKey && (
                          <Button
                            size="sm" variant="tertiary"
                            onClick={() => ubahAktif(a, !a.active)}
                          >
                            {a.active ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        </>
      )}

      <FormAkunBaru
        open={formBuka}
        onClose={() => setFormBuka(false)}
        accounts={data?.accounts || []}
        onSaved={async () => { setFormBuka(false); await muat(); }}
        onError={setPesan}
      />
    </HalamanFinance>
  );
}

function FormAkunBaru({ open, onClose, accounts, onSaved, onError }) {
  const [form, setForm] = useState({
    code: "", name: "", type: "BEBAN", normalBalance: "DEBIT",
    parentId: "", cashFlowCategory: "OPERASI", description: "",
  });

  const induk = accounts.filter((a) => !a.isPostable);

  function set(k, v) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Saldo normal mengikuti tipe secara default — tapi TETAP bisa diubah
      // manual, karena akun KONTRA (retur penjualan, akumulasi penyusutan)
      // memang punya saldo normal berlawanan dengan tipenya.
      if (k === "type") {
        next.normalBalance = ["ASET", "BEBAN", "BEBAN_POKOK"].includes(v) ? "DEBIT" : "KREDIT";
      }
      return next;
    });
  }

  async function simpan() {
    try {
      await api.createFinanceAccount({
        ...form,
        parentId: form.parentId || null,
        cashFlowCategory: form.cashFlowCategory || null,
      });
      setForm({ code: "", name: "", type: "BEBAN", normalBalance: "DEBIT", parentId: "", cashFlowCategory: "OPERASI", description: "" });
      await onSaved();
    } catch (e) {
      onError(e.message);
    }
  }

  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Akun Baru"
      description="Akun tambahan di luar bagan akun bawaan."
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi onClick={simpan} disabled={!form.code.trim() || !form.name.trim()}>Simpan</TombolAksi>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Kode akun" required hint="Ikuti penomoran yang sudah ada, mis. 6-1950">
          <Input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="6-1950" />
        </Field>
        <Field label="Nama akun" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Beban Pelatihan Karyawan" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipe">
            <Pilihan value={form.type} onChange={(v) => set("type", v)}>
              {TIPE.map((t) => <option key={t} value={t}>{LABEL_TIPE_AKUN[t]}</option>)}
            </Pilihan>
          </Field>
          <Field label="Saldo normal" hint="Ubah manual hanya untuk akun kontra">
            <Pilihan value={form.normalBalance} onChange={(v) => set("normalBalance", v)}>
              <option value="DEBIT">Debit</option>
              <option value="KREDIT">Kredit</option>
            </Pilihan>
          </Field>
        </div>
        <Field label="Masuk kelompok" hint="Menentukan letaknya di laporan">
          <Pilihan value={form.parentId} onChange={(v) => set("parentId", v)}>
            <option value="">— tanpa kelompok —</option>
            {induk.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Kategori arus kas" hint="Dipakai laporan arus kas metode langsung">
          <Pilihan value={form.cashFlowCategory} onChange={(v) => set("cashFlowCategory", v)}>
            <option value="OPERASI">Operasi</option>
            <option value="INVESTASI">Investasi</option>
            <option value="PENDANAAN">Pendanaan</option>
            <option value="">Tidak dikategorikan</option>
          </Pilihan>
        </Field>
        <Field label="Keterangan">
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Opsional" />
        </Field>
      </div>
    </Modal>
  );
}
