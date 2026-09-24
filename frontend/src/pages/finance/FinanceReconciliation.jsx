import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Link2, Unlink, EyeOff, CheckCircle2, Scale, AlertTriangle, Check, X } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card.jsx";
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
  StatusBadge, Pilihan, InputUang, tanggalPendek, tanggalJam, LABEL_STATUS,
} from "@/features/finance/shared.jsx";
import FilterBar, { cocok } from "@/features/finance/FilterBar.jsx";
import PanelCutoff, { PerluDitinjau } from "@/features/finance/RekonCutoff.jsx";
import { rolesOf } from "@/lib/roles.js";

// FINANCE_ADMIN (snapshot, tandai tinjau) dipegang ADMIN/OWNER — server tetap sumber kebenaran (403 bila tidak berhak).
function bolehFinanceAdmin() {
  try { return rolesOf(JSON.parse(localStorage.getItem("user") || "null")).some((r) => r === "ADMIN" || r === "OWNER"); } catch { return false; }
}

// Nominal bisa dicari sebagai "150000" maupun "150.000" (tanda minus diabaikan).
function teksNominal(x) {
  const n = Math.abs(Math.round(Number(x)));
  if (!Number.isFinite(n)) return "";
  return `${n} ${n.toLocaleString("id-ID")}`;
}

const LABEL_STATUS_PERIODE = { DRAF_MENUNGGU_MUTASI: "Menunggu mutasi bank", DRAFT: "Sedang dicocokkan", SELESAI: "Selesai" };
const VARIAN_STATUS_PERIODE = { DRAF_MENUNGGU_MUTASI: "orange", DRAFT: "neutral", SELESAI: "green" };
function BadgeStatusPeriode({ status }) {
  return <Badge className="whitespace-normal text-left leading-snug" variant={VARIAN_STATUS_PERIODE[status] || "neutral"}>{LABEL_STATUS_PERIODE[status] || status}</Badge>;
}
function teksCutoff(c) {
  if (!c?.mulai || !c?.selesai) return null;
  const f = (d) => new Date(d).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${f(c.mulai)} WIB sampai ${f(c.selesai)} WIB`;
}

// REKONSILIASI BANK — mencocokkan mutasi menurut KORAN BANK dengan mutasi
// menurut BUKU BESAR, lalu menjelaskan selisihnya.
//
// TIDAK ADA INTEGRASI API BANK di sistem ini, dan halaman ini tidak
// berpura-pura ada: baris koran bank diinput manual atau ditempel dari
// mutasi rekening. Berpura-pura otomatis akan lebih berbahaya daripada
// jujur manual — orang akan berhenti memeriksa.

export default function FinanceReconciliation() {
  const [searchParams] = useSearchParams();
  // Halaman dibuka di dalam sistem tab — sebagian tab tidak meneruskan search string ke router, jadi window.location jadi cadangan.
  const periodeDariUrl = searchParams.get("periode") || new URLSearchParams(window.location.search).get("periode");
  const [statements, setStatements] = useState([]);
  const [rekening, setRekening] = useState([]);
  const [aktif, setAktif] = useState(periodeDariUrl);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalBaru, setModalBaru] = useState(false);
  const [modalBaris, setModalBaris] = useState(false);
  const [cocokkan, setCocokkan] = useState(null);

  const [qPeriode, setQPeriode] = useState("");
  const [fStatusP, setFStatusP] = useState("");
  const [fRekening, setFRekening] = useState("");
  const [fBelum, setFBelum] = useState("");
  const [fLate, setFLate] = useState("");
  const [fTinjau, setFTinjau] = useState("");
  const [fokusDetail, setFokusDetail] = useState(""); // "" | "late" | "tinjau"
  const bolehAdmin = useMemo(bolehFinanceAdmin, []);
  const [qBaris, setQBaris] = useState("");
  const [fStatusB, setFStatusB] = useState("");
  const [fArah, setFArah] = useState("");

  const namaRekening = useMemo(
    () => [...new Set(statements.map((s) => s.cashAccount?.name).filter(Boolean))],
    [statements],
  );
  const periodeTampil = useMemo(() => statements.filter((s) =>
    (!fStatusP || s.status === fStatusP)
    && (!fRekening || s.cashAccount?.name === fRekening)
    && (!fBelum || (fBelum === "ada" ? s.belumCocok > 0 : !(s.belumCocok > 0)))
    && (!fLate || (s.cutoffInfo?.postingSetelahCutoff?.jumlah > 0) === (fLate === "ada"))
    && (!fTinjau || (s.perluDitinjau > 0) === (fTinjau === "ada"))
    && cocok(qPeriode, s.cashAccount?.name, tanggalPendek(s.periodStart), tanggalPendek(s.periodEnd), s.periodStart, s.periodEnd, s.note),
  ), [statements, qPeriode, fStatusP, fRekening, fBelum, fLate, fTinjau]);

  const semuaBaris = detail?.statement?.lines;
  const statusBaris = useMemo(
    () => [...new Set((semuaBaris || []).map((l) => l.status).filter(Boolean))],
    [semuaBaris],
  );
  const barisTampil = useMemo(() => (semuaBaris || []).filter((l) =>
    (!fStatusB || l.status === fStatusB)
    && (!fArah || (fArah === "masuk" ? Number(l.amount) > 0 : Number(l.amount) < 0))
    && cocok(qBaris, l.description, l.reference, teksNominal(l.amount), l.matchedLine?.entry?.entryNumber, l.matchedLine?.description, l.matchedLine?.entry?.description),
  ), [semuaBaris, qBaris, fStatusB, fArah]);

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

      <FilterBar
        q={qPeriode} onQ={setQPeriode}
        placeholder="Cari rekening, periode, catatan…"
        filters={[
          { key: "status", label: "Status", value: fStatusP, onChange: setFStatusP, options: [["DRAF_MENUNGGU_MUTASI", LABEL_STATUS_PERIODE.DRAF_MENUNGGU_MUTASI], ["DRAFT", LABEL_STATUS_PERIODE.DRAFT], ["SELESAI", LABEL_STATUS_PERIODE.SELESAI]] },
          { key: "rek", label: "Rekening", value: fRekening, onChange: setFRekening, options: namaRekening.map((n) => [n, n]) },
          { key: "belum", label: "Belum cocok", value: fBelum, onChange: setFBelum, options: [["ada", "Ada"], ["nol", "Semua cocok"]] },
          { key: "late", label: "Posting Setelah Cutoff", value: fLate, onChange: setFLate, options: [["ada", "Ada"], ["tidak", "Tidak ada"]] },
          { key: "tinjau", label: "Perlu Ditinjau", value: fTinjau, onChange: setFTinjau, options: [["ada", "Ada"], ["tidak", "Tidak ada"]] },
        ]}
        ringkasan={`${periodeTampil.length} periode${periodeTampil.length !== statements.length ? ` dari ${statements.length}` : ""}`}
        onReset={() => { setQPeriode(""); setFStatusP(""); setFRekening(""); setFBelum(""); setFLate(""); setFTinjau(""); }}
      />

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
        ) : periodeTampil.length === 0 ? (
          <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada periode yang cocok dengan pencarian/filter.</p></CardContent>
        ) : (
          <TableWrap className="dh-table">
            <Table fixed>
              <THead>
                <TR>
                  <TH sticky width={144}>Rekening</TH>
                  <TH width={172}>Periode</TH>
                  <TH numeric width={124} hideBelow="2xl">Saldo Awal (Bank)</TH>
                  <TH numeric width={124} hideBelow="2xl">Saldo Akhir (Bank)</TH>
                  <TH numeric width={124} hideBelow="wide">Saldo Buku Akhir</TH>
                  <TH numeric width={160}>Selisih Terbuka</TH>
                  <TH width={176} hideBelow="2xl">Cutoff & Snapshot</TH>
                  <TH numeric width={144}>Selisih Snapshot</TH>
                  <TH numeric width={120}>Setelah Cutoff</TH>
                  <TH numeric width={88} hideBelow="2xl">Mutasi</TH>
                  <TH numeric width={104} hideBelow="2xl">Belum Cocok</TH>
                  <TH width={168}>Status</TH>
                  <TH width={84} hideBelow="2xl" />
                </TR>
              </THead>
              <TBody>
                {periodeTampil.map((s) => (
                  <TR key={s.id} clickable selected={aktif === s.id} onClick={() => setAktif(s.id)}>
                    <TD sticky truncate className="font-medium">{s.cashAccount?.name}</TD>
                    <TD className="whitespace-nowrap text-[12px]">{tanggalPendek(s.periodStart)} – {tanggalPendek(s.periodEnd)}</TD>
                    <TD hideBelow="2xl" numeric><Uang value={s.openingBalance} /></TD>
                    <TD hideBelow="2xl" numeric><Uang value={s.closingBalance} /></TD>
                    <TD hideBelow="wide" numeric><Uang value={s.saldoBuku} /></TD>
                    <TD numeric>
                      {Math.abs(s.selisih) < 0.005
                        ? <Badge variant="green">Rp0 · cocok</Badge>
                        : <span className="text-orange"><Uang value={Math.abs(s.selisih)} className="font-bold" /><span className="block text-[11px] text-ink3">{s.selisih < 0 ? "buku lebih tinggi" : "bank lebih tinggi"}</span></span>}
                    </TD>
                    <TD hideBelow="2xl" className="text-[12px]">
                      {s.cutoffInfo?.adaSnapshot ? (
                        <span className="block leading-snug">
                          <span className="block">Cutoff {s.cutoffInfo.cutoffAkhir ? tanggalJam(s.cutoffInfo.cutoffAkhir) : "—"}</span>
                          <span className="block text-ink3">Snapshot {tanggalJam(s.cutoffInfo.snapshotAt)}</span>
                        </span>
                      ) : <span className="text-ink3">Belum ada snapshot</span>}
                    </TD>
                    <TD numeric>
                      {!s.cutoffInfo?.adaSnapshot ? <span className="text-ink3">—</span>
                        : !s.cutoffInfo.valid ? <Badge variant="red">Tidak berlaku</Badge>
                        : Math.abs(s.cutoffInfo.selisihSnapshot) < 0.005 ? <Badge variant="green">Rp0</Badge>
                        : <Uang value={s.cutoffInfo.selisihSnapshot} className="text-orange" />}
                    </TD>
                    <TD numeric>
                      <span className="inline-flex flex-wrap justify-end gap-1">
                        {s.cutoffInfo?.postingSetelahCutoff?.jumlah > 0 && <Badge variant="orange" title="Posting Setelah Cutoff">{s.cutoffInfo.postingSetelahCutoff.jumlah} late</Badge>}
                        {s.perluDitinjau > 0 && <Badge variant="red" title="Perlu Ditinjau">{s.perluDitinjau} tinjau</Badge>}
                        {!(s.cutoffInfo?.postingSetelahCutoff?.jumlah > 0) && !(s.perluDitinjau > 0) && <span className="text-ink3">—</span>}
                      </span>
                    </TD>
                    <TD hideBelow="2xl" numeric>{s.jumlahBaris > 0 ? s.jumlahBaris : <span className="text-[12px] text-ink3">belum ada</span>}</TD>
                    <TD hideBelow="2xl" numeric>
                      {s.jumlahBaris === 0 ? <span className="text-ink3">—</span> : s.belumCocok > 0 ? <Badge variant="orange">{s.belumCocok}</Badge> : <Badge variant="green">0</Badge>}
                    </TD>
                    <TD><BadgeStatusPeriode status={s.status} /></TD>
                    <TD hideBelow="2xl"><Button size="sm" variant="tertiary">Buka</Button></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {detail && (
        <>
          {detail.rekonsiliasi.sementara && (
            <Card className="bg-orangebg" role="status" data-testid="banner-rekon-sementara">
              <CardContent className="flex gap-3 py-4">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-orange" />
                <div className="min-w-0 space-y-1">
                  <p className="text-[13px] font-bold text-ink">{detail.rekonsiliasi.labelSementara}</p>
                  {teksCutoff(detail.rekonsiliasi.cutoff) && <p className="text-[12px] text-ink2">Cutoff: {teksCutoff(detail.rekonsiliasi.cutoff)}.</p>}
                  {detail.statement.note && <p className="text-[12px] text-ink2">{detail.statement.note}</p>}
                  <p className="text-[12px] text-ink2">Tidak ada mutasi bank di periode ini — sengaja tidak dibuatkan mutasi perkiraan. Periode tidak dapat diselesaikan sebelum mutasi bank asli dimasukkan.</p>
                </div>
              </CardContent>
            </Card>
          )}
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
              label="Selisih Terbuka" value={formatUang(Math.abs(detail.rekonsiliasi.selisih))}
              tone={detail.rekonsiliasi.cocok ? "green" : "orange"}
              sub={detail.rekonsiliasi.cocok ? "Saldo akhir cocok" : detail.rekonsiliasi.selisih < 0 ? "Saldo buku lebih tinggi dari saldo bank" : "Saldo bank lebih tinggi dari saldo buku"}
              info="Selisih antara saldo buku dan saldo bank. Kalau tidak nol, biasanya ada mutasi yang belum tercatat di salah satu sisi — telusuri lewat baris yang masih 'Belum Cocok'."
            />
            <KartuAngka
              label="Baris Belum Cocok" value={detail.statement.lines.length === 0 ? "Belum ada mutasi" : detail.rekonsiliasi.belumCocok}
              tone={detail.statement.lines.length === 0 ? "default" : detail.rekonsiliasi.belumCocok > 0 ? "orange" : "green"}
              info="Baris mutasi dari koran bank yang belum ditemukan pasangannya di buku besar. Cocokkan satu per satu, atau tandai 'Abaikan' dengan alasan kalau memang tidak ada pasangannya (mis. biaya admin kecil yang belum dicatat)."
            />
          </div>

          {!!detail.danaBelumTeridentifikasi?.total && (
            <Card className="bg-orangebg" role="status" data-testid="banner-dana-belum-teridentifikasi">
              <CardContent className="flex gap-3 py-4">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-orange" />
                <div className="min-w-0 space-y-1">
                  <p className="text-[13px] font-bold text-ink">⚠ {detail.danaBelumTeridentifikasi.peringatan}</p>
                  <p className="text-[12px] text-ink2">
                    Tercatat di akun sementara "Dana Masuk Belum Teridentifikasi" (2-1700) — BUKAN pendapatan, dan periode ini
                    TIDAK BISA ditandai Selesai sampai sumber dananya terbukti (rekening koran) dan direklasifikasi ke akun yang benar.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap gap-2" role="group" aria-label="Fokus tampilan">
            {[["", "Semua"], ["late", "Posting Setelah Cutoff"], ["tinjau", "Perlu Ditinjau"]].map(([k, l]) => (
              <Button key={k || "semua"} size="sm" variant={fokusDetail === k ? "secondary" : "neutral"} className="max-sm:min-h-11" onClick={() => setFokusDetail(k)}>{l}</Button>
            ))}
          </div>

          {fokusDetail !== "tinjau" && (
            <PanelCutoff detail={detail} bolehAdmin={bolehAdmin} filter={fokusDetail || null} onUbah={muat} />
          )}
          {fokusDetail !== "late" && (
            <PerluDitinjau data={detail.perluDitinjau} bolehTinjau={bolehAdmin} onTinjau={async (d) => { await api.tinjauExceptionRekon(d); await muat(); }} />
          )}

          <PenyesuaianBuku data={detail.penyesuaianBuku} />

          <SyaratSelesai p={detail.rekonsiliasi.penyelesaian} status={detail.statement.status} />

          <FilterBar
            q={qBaris} onQ={setQBaris}
            placeholder="Cari keterangan, referensi, nominal…"
            filters={[
              { key: "status", label: "Status", value: fStatusB, onChange: setFStatusB, options: statusBaris.map((s) => [s, LABEL_STATUS[s] || s]) },
              { key: "arah", label: "Arah", value: fArah, onChange: setFArah, options: [["masuk", "Masuk"], ["keluar", "Keluar"]] },
            ]}
            ringkasan={`${barisTampil.length} baris${barisTampil.length !== detail.statement.lines.length ? ` dari ${detail.statement.lines.length}` : ""}`}
            onReset={() => { setQBaris(""); setFStatusB(""); setFArah(""); }}
          />

          <Card className="overflow-hidden">
            <JudulKartu
              title={`${detail.statement.cashAccount?.name} · ${tanggalPendek(detail.statement.periodStart)} – ${tanggalPendek(detail.statement.periodEnd)}`}
              description="Mutasi menurut koran bank, dan pasangannya di buku besar."
              info="Pencocokan menuntut nominal SAMA PERSIS, termasuk arahnya (masuk/keluar) — kalau dipaksakan cocok padahal beda nominal, selisihnya justru tersembunyi, bukan terselesaikan."
            />
            <CardHeader>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setModalBaris(true)}>
                  <Plus size={14} /> {detail.rekonsiliasi.sementara ? "Masukkan Mutasi Bank Asli" : "Tambah Baris Koran Bank"}
                </Button>
                {detail.statement.status !== "SELESAI" && (
                  detail.rekonsiliasi.penyelesaian.bisa ? (
                    <TombolAksi
                      size="sm"
                      onClick={() => {
                        const catatan = window.prompt("Catatan penutup (opsional):") || "";
                        return aksi(() => api.completeFinanceBankStatement(detail.statement.id, catatan.trim() || null));
                      }}
                    >
                      <CheckCircle2 size={14} /> Tandai Selesai
                    </TombolAksi>
                  ) : (
                    <Button size="sm" variant="neutral" disabled title={detail.rekonsiliasi.penyelesaian.alasan.join("; ")}>
                      <CheckCircle2 size={14} /> Tandai Selesai (belum memenuhi syarat)
                    </Button>
                  )
                )}
              </div>
            </CardHeader>
            {detail.statement.lines.length === 0 ? (
              <CardContent><p className="py-6 text-center text-[13px] text-ink3">{detail.rekonsiliasi.sementara ? "Belum ada mutasi bank asli. Rekening koran belum dimasukkan — tidak ada mutasi perkiraan yang dibuat." : "Belum ada baris koran bank."}</p></CardContent>
            ) : barisTampil.length === 0 ? (
              <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada baris yang cocok dengan pencarian/filter.</p></CardContent>
            ) : (
              <TableWrap className="dh-table">
                <Table fixed>
                  <THead>
                    <TR>
                      <TH sticky width={92} className="whitespace-nowrap">Tanggal</TH>
                      <TH>Keterangan Bank</TH>
                      <TH width={130} hideBelow="wide">Referensi</TH>
                      <TH numeric width={128}>Nominal</TH>
                      <TH width={200} hideBelow="wide">Pasangan di Buku</TH>
                      <TH width={128}>Status</TH>
                      <TH width={92} />
                    </TR>
                  </THead>
                  <TBody>
                    {barisTampil.map((l) => (
                      <TR key={l.id}>
                        <TD sticky className="whitespace-nowrap">{tanggalPendek(l.date)}</TD>
                        <TD truncate title={l.description}>{l.description}</TD>
                        <TD hideBelow="wide" truncate className="text-[12px] text-ink2">{l.reference || "—"}</TD>
                        <TD numeric><Uang value={l.amount} /></TD>
                        <TD hideBelow="wide" className="min-w-0 text-[12px]">
                          {l.matchedLine
                            ? <>
                                <span className="block truncate font-mono" title={l.matchedLine.entry?.entryNumber}>{l.matchedLine.entry?.entryNumber}</span>
                                <span className="block truncate text-ink3" title={l.matchedLine.description || l.matchedLine.entry?.description}>{l.matchedLine.description || l.matchedLine.entry?.description}</span>
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
          <Field label="Dari tanggal" required><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.periodStart} onChange={(v) => set("periodStart", v)} /></Field>
          <Field label="Sampai tanggal" required><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.periodEnd} onChange={(v) => set("periodEnd", v)} /></Field>
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
        <Field label="Tanggal"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
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

function PenyesuaianBuku({ data }) {
  if (!data || data.items.length === 0) return null;
  const k = data.ringkasan.koreksiKasGanda;
  return (
    <Card className="overflow-hidden" data-testid="penyesuaian-buku">
      <JudulKartu
        title="Penyesuaian Buku"
        description="Bukan transaksi bank — kalibrasi saldo riil dan koreksi kas ganda."
        info="Jurnal ini menyesuaikan saldo buku agar sesuai saldo riil (lawan Koreksi Saldo Awal). Tidak dicocokkan dengan mutasi koran dan tidak masuk daftar kandidat pencocokan."
      />
      <CardContent className="space-y-2">
        <p className="text-[13px] text-ink2">
          {data.ringkasan.jumlah} jurnal · bersih <Uang value={data.ringkasan.bersih} />
          {k.jumlah > 0 && <> · termasuk {k.jumlah} koreksi kas ganda ({k.dari} s.d. {k.sampai}) senilai <Uang value={k.bersih} /></>}
        </p>
        <p className="text-[12px] text-ink3">{data.catatan}</p>
      </CardContent>
      <TableWrap className="dh-table max-h-[420px] overflow-y-auto">
        <Table fixed>
          <THead>
            <TR>
              <TH sticky width={128}>Jurnal</TH>
              <TH width={92} className="whitespace-nowrap">Tanggal</TH>
              <TH width={160}>Jenis</TH>
              <TH>Keterangan</TH>
              <TH numeric width={160}>Pengaruh ke saldo buku</TH>
            </TR>
          </THead>
          <TBody>
            {data.items.map((x) => (
              <TR key={x.jurnalId}>
                <TD sticky truncate className="font-mono text-[12px]">{x.nomor}</TD>
                <TD className="whitespace-nowrap">{tanggalPendek(x.tanggal)}</TD>
                <TD><Badge variant="neutral">{x.jenisLabel}</Badge></TD>
                <TD truncate className="text-[12px]" title={x.keterangan}>{x.keterangan}</TD>
                <TD numeric><Uang value={x.nilai} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  );
}

function SyaratSelesai({ p, status }) {
  if (!p || status === "SELESAI") return null;
  return (
    <Card data-testid="syarat-selesai">
      <JudulKartu title="Syarat Menyelesaikan Periode" description="Periode hanya bisa diselesaikan bila semua syarat terpenuhi." />
      <CardContent>
        <ul className="space-y-1.5">
          {p.syarat.map((x) => (
            <li key={x.kode} className="flex items-start gap-2 text-[13px]">
              {x.ok ? <Check size={15} className="mt-0.5 shrink-0 text-green" /> : <X size={15} className="mt-0.5 shrink-0 text-orange" />}
              <span className={x.ok ? "text-ink2" : "text-ink"}>{x.kode === "STATUS" && !x.ok ? x.teks : x.teks}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
