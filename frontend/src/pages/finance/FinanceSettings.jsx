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
import { KartuPinFinance } from "@/features/finance/KoreksiAman.jsx";
import { BIAYA_BAWAAN, JENIS_BIAYA_TRANSFER, presetRekening } from "@/features/finance/biayaTransfer.js";
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
  const [rekeningBank, setRekeningBank] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalKategori, setModalKategori] = useState(false);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, g, p, k, a, rk] = await Promise.all([
        api.getFinanceSettings(),
        api.getFinanceGaps(),
        api.getFinancePeriods(),
        api.getFinanceExpenseCategories({ includeInactive: "1" }),
        api.getFinanceAccounts(),
        api.getFinanceCashAccounts(),
      ]);
      setSettings(s);
      setGaps(g.gaps);
      setPeriods(p.periods);
      setKategori(k.categories);
      setRekeningBank((rk.accounts || []).filter((x) => x.active && x.kind !== "KAS"));
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
          <TableWrap className="dh-table">
            <Table fixed>
              <THead>
                <TR>
                  <TH sticky width={140} className="whitespace-nowrap">Waktu</TH>
                  <TH width={160} hideBelow="wide">Sumber</TH>
                  <TH width={200}>Masalah</TH>
                  <TH>Penjelasan</TH>
                  <TH width={140} />
                </TR>
              </THead>
              <TBody>
                {gapTerbuka.map((g) => (
                  <TR key={g.id}>
                    <TD sticky className="whitespace-nowrap">{tanggalJam(g.createdAt)}</TD>
                    <TD hideBelow="wide"><Badge variant="neutral">{g.source}</Badge></TD>
                    <TD truncate className="text-[12px] text-ink2" title={g.reason}>{g.reason}</TD>
                    <TD truncate className="text-[12px] leading-relaxed" title={g.detail}>{g.detail}</TD>
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
            Pembayaran pelanggan dicatat sales/driver dengan metode CASH/TRANSFER/QRIS/KARTU, tapi metode saja tidak
            memberi tahu buku besar uangnya masuk ke rekening mana. Pemetaan ini yang menjawabnya.
            <strong> Selama belum dipetakan, pembayaran tetap tercatat normal di CRM</strong> tapi jurnalnya
            tertahan di daftar Data Belum Lengkap di atas.
          </>}
          info="Atur ini SEBELUM tim mulai mencatat pembayaran rutin — kalau terlambat dipetakan, pembayaran yang sudah masuk akan menumpuk sebagai 'Data Belum Lengkap' sampai dipetakan dan diulang manual."
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { key: K.CASH_ACCOUNT_CASH, label: "Tunai (CASH)" },
            { key: K.CASH_ACCOUNT_TRANSFER, label: "Transfer bank" },
            { key: K.CASH_ACCOUNT_QRIS, label: "QRIS / e-wallet" },
            { key: K.CASH_ACCOUNT_CARD, label: "Kartu kredit/debit (EDC)" },
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

      {/* ── KEBIJAKAN BUKTI / NOTA ── */}
      <Card>
        <JudulKartu
          title="Kebijakan Bukti (Nota)"
          description="Kapan foto nota WAJIB ada sebelum pengeluaran/pembelian bisa disetujui."
          info="Pembelian dan Reimbursement SELALU wajib bernota, berapa pun nominalnya. Pengeluaran lain baru wajib kalau nominalnya di atas ambang ini (kecuali gaji, upah, dan biaya admin bank — buktinya bukan nota toko). Verifikasi bukti harus dilakukan orang lain, bukan pembuat transaksinya."
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PengaturanAngka
            label="Ambang nota wajib (Rp)"
            hint="Pengeluaran non-reimbursement di atau di atas nominal ini wajib bernota"
            nilai={S[K.RECEIPT_REQUIRED_THRESHOLD]}
            onSimpan={(v) => ubahSetting(K.RECEIPT_REQUIRED_THRESHOLD, v)}
          />
          <PengaturanAngka
            label="Antrean tinjau berlaku sejak"
            hint="Format YYYY-MM-DD — transaksi sebelum tanggal ini tidak masuk antrean tinjau"
            nilai={S[K.RECEIPT_POLICY_SINCE]} tipe="text"
            onSimpan={(v) => ubahSetting(K.RECEIPT_POLICY_SINCE, v)}
          />
        </CardContent>
      </Card>

      {/* ── KASBON ── */}
      <Card>
        <JudulKartu
          title="Kasbon Karyawan"
          description="Batas total kasbon aktif per karyawan."
          info="Kalau diisi, kasbon baru yang membuat total kasbon aktif seorang karyawan melewati batas ini akan ditolak — kecuali admin sengaja mengizinkan saat mencatat. Isi 0 untuk tidak membatasi."
        />
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PengaturanAngka
            label="Batas kasbon aktif per karyawan (Rp)"
            hint="0 = tidak dibatasi"
            nilai={S[K.KASBON_BATAS_AKTIF]}
            onSimpan={(v) => ubahSetting(K.KASBON_BATAS_AKTIF, v)}
          />
        </CardContent>
      </Card>

      {/* ── BIAYA ADMIN TRANSFER PER REKENING ── */}
      <Card>
        <JudulKartu
          title="Biaya Admin Transfer per Rekening"
          description="Nominal yang terisi otomatis saat Cara Bayar = Transfer di semua form uang keluar."
          info="Tiap rekening bank punya tarif sendiri. Metode Lainnya / Custom tidak punya preset — nominalnya diketik saat transaksi. Biaya admin dicatat sebagai baris beban terpisah pada transaksi yang sama (Beban Administrasi Bank), bukan pengeluaran kedua. Perubahan preset hanya berlaku untuk transaksi BARU."
        />
        <CardContent className="space-y-3">
          {rekeningBank.length === 0 ? (
            <p className="text-[13px] text-ink3">Belum ada rekening bank/e-wallet aktif. Tambahkan di menu Kas &amp; Bank.</p>
          ) : rekeningBank.map((r) => (
            <BarisPresetBiaya
              key={r.id + JSON.stringify(r.transferFeePresets)}
              rekening={r}
              onSimpan={(presets) => aksi(() => api.updateFinanceCashAccount(r.id, { transferFeePresets: presets }), () => `Preset biaya admin ${r.name} disimpan`)}
            />
          ))}
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
          <TableWrap className="dh-table">
            <Table fixed>
              <THead>
                <TR>
                  <TH sticky width={110}>Periode</TH>
                  <TH width={120}>Status</TH>
                  <TH width={220} hideBelow="wide">Ditutup</TH>
                  <TH>Catatan</TH>
                  <TH width={110} />
                </TR>
              </THead>
              <TBody>
                {periods.map((p) => (
                  <TR key={p.id}>
                    <TD sticky className="font-medium">{String(p.month).padStart(2, "0")}/{p.year}</TD>
                    <TD><StatusBadge status={p.status} /></TD>
                    <TD hideBelow="wide" truncate className="text-[12px] text-ink2">
                      {p.closedAt ? `${tanggalPendek(p.closedAt)} · ${p.closedBy?.name || "—"}` : "—"}
                    </TD>
                    <TD truncate className="text-[12px]" title={p.closeNote || "—"}>{p.closeNote || "—"}</TD>
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
        <TableWrap className="dh-table">
          <Table fixed>
            <THead>
              <TR>
                <TH sticky width={140}>Kode</TH>
                <TH width={200}>Nama</TH>
                <TH width={220} hideBelow="wide">Akun Tujuan</TH>
                <TH width={130}>Divisi</TH>
                <TH hideBelow="wide">Otomatis Dari</TH>
                <TH width={100}>Status</TH>
              </TR>
            </THead>
            <TBody>
              {kategori.map((k) => (
                <TR key={k.id}>
                  <TD sticky truncate className="font-mono text-[12px]">{k.code}</TD>
                  <TD truncate>{k.name}</TD>
                  <TD hideBelow="wide" truncate className="text-[12px]">{k.account?.code} · {k.account?.name}</TD>
                  <TD><Badge variant="neutral">{LABEL_DIVISI[k.division] || k.division}</Badge></TD>
                  <TD hideBelow="wide" truncate className="text-[12px] text-ink3">{k.autoMapKey || "—"}</TD>
                  <TD>{k.active ? <Badge variant="green">Aktif</Badge> : <Badge variant="neutral">Nonaktif</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      {/* ── PIN FINANCE (step-up koreksi) ── */}
      <Card>
        <JudulKartu
          title="PIN Finance"
          description="Kunci tambahan untuk koreksi transaksi yang sudah masuk buku besar (jurnal dibalik + pengganti)."
        />
        <CardContent><KartuPinFinance /></CardContent>
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
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi onClick={() => onSubmit(f)} disabled={!f.code.trim() || !f.name.trim() || !f.accountId}>Simpan</TombolAksi></>}
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

// Field pengaturan bernilai tunggal — disimpan saat fokus keluar (bukan tiap
// ketikan), supaya tiap perubahan jadi SATU catatan audit pengaturan.
function PengaturanAngka({ label, hint, nilai, onSimpan, tipe = "number" }) {
  const [draft, setDraft] = useState(nilai ?? "");
  useEffect(() => { setDraft(nilai ?? ""); }, [nilai]);
  return (
    <Field label={label} hint={hint}>
      <Input
        type={tipe} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (String(draft) !== String(nilai ?? "") && String(draft).trim() !== "") onSimpan(String(draft).trim()); }}
      />
    </Field>
  );
}

function BarisPresetBiaya({ rekening, onSimpan }) {
  const efektif = presetRekening(rekening);
  const [nilai, setNilai] = useState({ SESAMA_BANK: String(efektif.SESAMA_BANK), BI_FAST: String(efektif.BI_FAST), TRANSFER_ONLINE: String(efektif.TRANSFER_ONLINE) });
  const berbeda = Object.keys(BIAYA_BAWAAN).some((k) => Number(nilai[k]) !== efektif[k]);
  const validasi = Object.values(nilai).every((v) => v !== "" && Number(v) >= 0);
  return (
    <div className="rounded-lg bg-inset p-3">
      <p className="mb-2 text-[13px] font-medium text-ink">
        {rekening.name}
        {!rekening.transferFeePresets && <span className="ml-2 text-[11px] font-normal text-ink3">memakai tarif bawaan</span>}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {JENIS_BIAYA_TRANSFER.filter((j) => j.code !== "LAINNYA").map((j) => (
          <Field key={j.code} label={j.label}>
            <InputUang value={nilai[j.code]} onChange={(v) => setNilai((s) => ({ ...s, [j.code]: v }))} />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {rekening.transferFeePresets && (
          <Button size="sm" variant="neutral" onClick={() => onSimpan(null)}>Kembalikan ke bawaan</Button>
        )}
        <TombolAksi onClick={() => onSimpan(Object.fromEntries(Object.entries(nilai).map(([k, v]) => [k, Number(v)])))} disabled={!berbeda || !validasi}>
          Simpan preset
        </TombolAksi>
      </div>
    </div>
  );
}
