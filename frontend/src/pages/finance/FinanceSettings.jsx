import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Lock, Unlock, AlertTriangle, Plus } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi,
  StatusBadge, Pilihan, InputUang, tanggalPendek, tanggalJam, LABEL_DIVISI,
} from "@/features/finance/shared.jsx";

// PENGATURAN FINANCE — empat hal yang semuanya "sekali atur, jarang
// disentuh", plus satu daftar kerja yang justru sering dibuka:
//
//   1. DATA BELUM LENGKAP (posting gap) — transaksi yang sudah terjadi tapi
//      belum bisa dibukukan. Ditaruh PALING ATAS, bukan di bawah, karena
//      inilah satu-satunya bagian halaman ini yang perlu ditindak rutin.
//   2. Pemetaan metode pembayaran → rekening kas/bank.
//   3. Gerbang verifikasi pembayaran.
//   4. Periode akuntansi & kategori biaya.

const SUMBER_SYNC = [
  { key: "biaya-kendaraan", label: "Biaya & Servis Kendaraan", asal: "Delivery > Biaya" },
  { key: "iklan", label: "Belanja Iklan Bulanan", asal: "Pengaturan CRM > Belanja Iklan" },
  { key: "penerimaan-barang", label: "Nilai Penerimaan Barang", asal: "Gudang > Penerimaan Barang" },
  { key: "pemakaian-bahan", label: "HPP Pemakaian Bahan", asal: "Gudang > Pengeluaran Material" },
];

export default function FinanceSettings() {
  const [settings, setSettings] = useState(null);
  const [gaps, setGaps] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [kategori, setKategori] = useState([]);
  const [akun, setAkun] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalKategori, setModalKategori] = useState(false);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, g, p, k, a] = await Promise.all([
        api.getFinanceSettings(),
        api.getFinanceGaps(),
        api.getFinancePeriods(),
        api.getFinanceExpenseCategories({ includeInactive: "1" }),
        api.getFinanceAccounts(),
      ]);
      setSettings(s);
      setGaps(g.gaps);
      setPeriods(p.periods);
      setKategori(k.categories);
      setAkun(a.accounts.filter((x) => x.isPostable && x.active && ["BEBAN", "BEBAN_POKOK"].includes(x.type)));
    } catch (e) {
      setError(e.message || "Gagal memuat pengaturan finance");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn, sukses) {
    try {
      const r = await fn();
      if (sukses) setPesan(sukses(r));
      setModalKategori(false);
      await muat();
    } catch (e) {
      setPesan(e.message);
    }
  }

  const K = settings?.keys || {};
  const S = settings?.settings || {};
  const gapTerbuka = gaps.filter((g) => !g.resolvedAt);

  function ubahSetting(key, value) {
    return aksi(() => api.updateFinanceSettings({ [key]: value }));
  }

  return (
    <HalamanFinance
      title="Pengaturan Finance"
      subtitle="Pemetaan rekening, gerbang verifikasi, periode akuntansi, dan transaksi yang belum bisa dibukukan."
      loading={loading}
      error={error}
      onRetry={muat}
    >
      {pesan && (
        <Card className="bg-accentbg">
          <CardContent className="flex items-center justify-between gap-3 py-3">
            <p className="text-[13px] text-ink">{pesan}</p>
            <Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
          </CardContent>
        </Card>
      )}

      {/* ── 1. DATA BELUM LENGKAP ── */}
      <Card className="overflow-hidden">
        <JudulKartu
          title={<>
            Data Belum Lengkap
            {gapTerbuka.length > 0 && <Badge variant="red" className="ml-2">{gapTerbuka.length}</Badge>}
          </>}
          description="Transaksi yang SUDAH terjadi tapi belum bisa masuk buku besar — biasanya karena rekening belum
            dipetakan atau material belum punya harga perolehan. Selama daftar ini berisi, laporan keuangan
            JUJUR menyebut dirinya belum lengkap alih-alih menyajikan angka yang diam-diam kurang."
          info="Ini bagian yang paling butuh dicek rutin — bukan sekali atur lalu lupa. Setelah membereskan penyebabnya (mis. memetakan rekening di bawah), klik 'Coba Lagi' pada barisnya untuk memposting ulang."
        />
        {gapTerbuka.length === 0 ? (
          <CardContent>
            <p className="py-4 text-[13px] text-green">
              Tidak ada transaksi yang tertahan. Semua yang tercatat sudah masuk buku besar.
            </p>
          </CardContent>
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR><TH>Waktu</TH><TH>Sumber</TH><TH>Masalah</TH><TH>Penjelasan</TH><TH /></TR>
              </THead>
              <TBody>
                {gapTerbuka.map((g) => (
                  <TR key={g.id}>
                    <TD className="whitespace-nowrap">{tanggalJam(g.createdAt)}</TD>
                    <TD><Badge variant="neutral">{g.source}</Badge></TD>
                    <TD className="text-[12px] text-ink2">{g.reason}</TD>
                    <TD className="max-w-[420px] text-[12px] leading-relaxed">{g.detail}</TD>
                    <TD>
                      <TombolAksi size="sm" variant="secondary" onClick={() => aksi(() => api.retryFinanceGap(g.id))}>
                        <RefreshCw size={13} /> Coba Lagi
                      </TombolAksi>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {/* ── 2. PEMETAAN REKENING ── */}
      <Card>
        <JudulKartu
          title="Rekening Tujuan per Metode Pembayaran"
          description={<>
            Pembayaran pelanggan dicatat sales/driver dengan metode CASH/TRANSFER/QRIS, tapi metode saja tidak
            memberi tahu buku besar uangnya masuk ke rekening mana. Pemetaan ini yang menjawabnya.
            <strong> Selama belum dipetakan, pembayaran tetap tercatat normal di CRM</strong> tapi jurnalnya
            tertahan di daftar Data Belum Lengkap di atas.
          </>}
          info="Atur ini SEBELUM tim mulai mencatat pembayaran rutin — kalau terlambat dipetakan, pembayaran yang sudah masuk akan menumpuk sebagai 'Data Belum Lengkap' sampai dipetakan dan diulang manual."
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { key: K.CASH_ACCOUNT_CASH, label: "Tunai (CASH)" },
            { key: K.CASH_ACCOUNT_TRANSFER, label: "Transfer bank" },
            { key: K.CASH_ACCOUNT_QRIS, label: "QRIS / e-wallet" },
          ].map((m) => (
            <Field key={m.key} label={m.label}>
              <Pilihan value={S[m.key] || ""} onChange={(v) => ubahSetting(m.key, v)}>
                <option value="">— belum dipetakan —</option>
                {(settings?.cashAccounts || []).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Pilihan>
            </Field>
          ))}
        </CardContent>
      </Card>

      {/* ── 3. GERBANG VERIFIKASI ── */}
      <Card>
        <JudulKartu
          title="Gerbang Verifikasi Pembayaran"
          description="Menentukan apakah status bayar order di CRM ikut menunggu verifikasi finance."
          info="Aman dinyalakan kapan saja — TIDAK berlaku surut ke pembayaran lama, jadi order yang sudah dianggap DP/Lunas tidak akan mendadak berubah status di hari yang sama saat gerbang dinyalakan."
        />
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={settings?.gate?.enabled ? "green" : "neutral"}>
              {settings?.gate?.enabled ? "AKTIF" : "TIDAK AKTIF"}
            </Badge>
            {settings?.gate?.since && (
              <span className="text-[12px] text-ink3">berlaku untuk pembayaran sejak {tanggalJam(settings.gate.since)}</span>
            )}
            <TombolAksi
              size="sm"
              variant={settings?.gate?.enabled ? "neutral" : "secondary"}
              confirmText={
                settings?.gate?.enabled
                  ? "Matikan gerbang verifikasi? Status bayar order akan kembali mengikuti seluruh pembayaran yang tercatat."
                  : "Nyalakan gerbang verifikasi? Mulai sekarang, pembayaran BARU baru menggerakkan status bayar order setelah diverifikasi finance. Pembayaran lama tidak terpengaruh sama sekali."
              }
              onClick={() => ubahSetting(K.PAYMENT_VERIFICATION_GATE, settings?.gate?.enabled ? "false" : "true")}
            >
              {settings?.gate?.enabled ? "Matikan" : "Nyalakan"}
            </TombolAksi>
          </div>

          <div className="rounded-lg bg-inset px-3 py-2.5 text-[13px] leading-relaxed text-ink2">
            <p className="font-medium text-ink">Kalau MATI (bawaan):</p>
            <p>
              Status bayar order mengikuti SELURUH pembayaran yang tercatat, terverifikasi atau belum — persis
              perilaku sistem sebelum modul Finance ada. Verifikasi tetap dikerjakan sebagai audit “uangnya
              benar sampai ke kas”, tapi tidak menahan apa pun.
            </p>
            <p className="mt-2 font-medium text-ink">Kalau NYALA:</p>
            <p>
              Order baru berubah jadi DP/Lunas setelah finance memverifikasi pembayarannya. Berlaku HANYA untuk
              pembayaran yang dicatat sejak gerbang dinyalakan — ratusan order lama tidak akan mendadak balik
              jadi “Belum Bayar”, karena riwayat tidak pernah dinilai ulang secara surut.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── 4. SINKRONISASI SUMBER LAMA ── */}
      <Card>
        <JudulKartu
          title="Bukukan Transaksi dari Workspace Lain"
          description="Transaksi ini diinput di workspace-nya masing-masing dan TIDAK diketik ulang di Finance. Tombol di
            bawah membaca baris yang sudah ada lalu membukukannya — idempoten, jadi aman ditekan berkali-kali
            (yang sudah punya jurnal dilewati)."
          info="Kenapa tidak otomatis: supaya Finance bisa mengontrol KAPAN transaksi dari divisi lain masuk buku besar — misalnya menunggu bagan akun siap dulu, baru membukukan yang tertunda sekaligus."
        />
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SUMBER_SYNC.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 rounded-lg bg-inset px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">{s.label}</p>
                <p className="text-[12px] text-ink3">diinput di {s.asal}</p>
              </div>
              <TombolAksi
                size="sm" variant="secondary"
                onClick={() => aksi(
                  () => api.syncFinanceSource(s.key),
                  (r) => `${s.label}: ${r.diproses} diperiksa, ${r.dibukukan} dibukukan, ${r.gap} tertahan.`
                )}
              >
                Bukukan
              </TombolAksi>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── 5. PERIODE AKUNTANSI ── */}
      <Card className="overflow-hidden">
        <JudulKartu
          title="Periode Akuntansi"
          description="Menutup periode mengunci angkanya: jurnal baru untuk bulan itu ditolak. Inilah yang membuat laporan
            yang sudah dibaca owner tidak berubah diam-diam."
          info="Kalau masih ada 'Data Belum Lengkap' terbuka, sistem akan bertanya dulu sebelum menutup periode — supaya tidak mengunci laporan yang diam-diam kurang tanpa disadari. Sebaiknya selesaikan dulu daftarnya di kartu paling atas."
        />
        {periods.length === 0 ? (
          <CardContent><p className="py-4 text-[13px] text-ink3">Belum ada periode — periode dibuat otomatis saat jurnal pertama bulan itu diposting.</p></CardContent>
        ) : (
          <TableWrap>
            <Table>
              <THead><TR><TH>Periode</TH><TH>Status</TH><TH>Ditutup</TH><TH>Catatan</TH><TH /></TR></THead>
              <TBody>
                {periods.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium">{String(p.month).padStart(2, "0")}/{p.year}</TD>
                    <TD><StatusBadge status={p.status} /></TD>
                    <TD className="text-[12px] text-ink2">
                      {p.closedAt ? `${tanggalPendek(p.closedAt)} · ${p.closedBy?.name || "—"}` : "—"}
                    </TD>
                    <TD className="max-w-[260px] truncate text-[12px]">{p.closeNote || "—"}</TD>
                    <TD>
                      {p.status === "OPEN" ? (
                        <TombolAksi
                          size="sm" variant="neutral"
                          onClick={() => {
                            const catatan = window.prompt(`Catatan penutupan periode ${p.month}/${p.year} (opsional):`) ?? null;
                            return aksi(async () => {
                              try {
                                return await api.closeFinancePeriod({ year: p.year, month: p.month, note: catatan });
                              } catch (e) {
                                if (e.status === 409 && window.confirm(`${e.message}\n\nTutup juga?`)) {
                                  return api.closeFinancePeriod({ year: p.year, month: p.month, note: catatan, abaikanGap: true });
                                }
                                throw e;
                              }
                            });
                          }}
                        >
                          <Lock size={13} /> Tutup
                        </TombolAksi>
                      ) : (
                        <TombolAksi
                          size="sm" variant="neutral"
                          onClick={() => {
                            const alasan = window.prompt("Alasan membuka kembali periode ini (wajib):");
                            if (alasan?.trim()) return aksi(() => api.reopenFinancePeriod({ year: p.year, month: p.month, note: alasan.trim() }));
                          }}
                        >
                          <Unlock size={13} /> Buka
                        </TombolAksi>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {/* ── 6. KATEGORI BIAYA ── */}
      <Card className="overflow-hidden">
        <JudulKartu
          title="Kategori Biaya"
          description="Jembatan antara bahasa operasional (“Bensin”, “Upah Tukang”) dan akun pembukuan yang benar —
            supaya orang yang mencatat pengeluaran tidak perlu memilih akun dari bagan akun."
          info="Kolom 'Otomatis Dari' menandai kategori yang dipetakan ke sumber lain (biaya kendaraan, iklan) — kategori itu dipakai sinkronisasi otomatis di kartu 'Bukukan Transaksi dari Workspace Lain', jangan diubah akun tujuannya sembarangan."
        />
        <CardHeader>
          <Button size="sm" variant="secondary" onClick={() => setModalKategori(true)}>
            <Plus size={14} /> Kategori Baru
          </Button>
        </CardHeader>
        <TableWrap>
          <Table>
            <THead><TR><TH>Kode</TH><TH>Nama</TH><TH>Akun Tujuan</TH><TH>Divisi</TH><TH>Otomatis Dari</TH><TH>Status</TH></TR></THead>
            <TBody>
              {kategori.map((k) => (
                <TR key={k.id}>
                  <TD className="font-mono text-[12px]">{k.code}</TD>
                  <TD>{k.name}</TD>
                  <TD className="text-[12px]">{k.account?.code} · {k.account?.name}</TD>
                  <TD><Badge variant="neutral">{LABEL_DIVISI[k.division] || k.division}</Badge></TD>
                  <TD className="text-[12px] text-ink3">{k.autoMapKey || "—"}</TD>
                  <TD>{k.active ? <Badge variant="green">Aktif</Badge> : <Badge variant="neutral">Nonaktif</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <ModalKategori
        open={modalKategori} onClose={() => setModalKategori(false)} akun={akun}
        onSubmit={(d) => aksi(() => api.createFinanceExpenseCategory(d))}
      />
    </HalamanFinance>
  );
}

function ModalKategori({ open, onClose, akun, onSubmit }) {
  const [f, setF] = useState({ code: "", name: "", accountId: "", division: "UMUM" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Kategori Biaya Baru"
      footer={<><Button variant="neutral" onClick={onClose}>Batal</Button><TombolAksi onClick={() => onSubmit(f)} disabled={!f.code.trim() || !f.name.trim() || !f.accountId}>Simpan</TombolAksi></>}
    >
      <div className="space-y-3">
        <Field label="Kode" required><Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="PELATIHAN" /></Field>
        <Field label="Nama" required><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Pelatihan Karyawan" /></Field>
        <Field label="Akun beban tujuan" required hint="Wajib akun bertipe Beban atau Beban Pokok">
          <Pilihan value={f.accountId} onChange={(v) => set("accountId", v)}>
            <option value="">— pilih —</option>
            {akun.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </Pilihan>
        </Field>
        <Field label="Divisi bawaan">
          <Pilihan value={f.division} onChange={(v) => set("division", v)}>
            {Object.entries(LABEL_DIVISI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Pilihan>
        </Field>
      </div>
    </Modal>
  );
}
