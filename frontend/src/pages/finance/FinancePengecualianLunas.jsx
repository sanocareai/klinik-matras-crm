import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Penjelasan, TombolAksi, tanggalPendek } from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import { PanelDetail, klikBuka } from "@/features/finance/PanelDetail.jsx";
import { specPengecualianLunas } from "@/features/finance/detailSpecs.js";
import { adminSaatIni } from "@/features/finance/aksiMenu.jsx";
import { alasanCukup } from "@/features/finance/pengecualianLunasLogic.js";

// PENGECUALIAN TANGGAL LUNAS — keputusan Owner, ber-riwayat. Order.paidAt normalnya mengikuti tanggal pembayaran yang diverifikasi Finance; order yang DIKUNCI di sini tetap
// dihitung lunas pada tanggal yang diputuskan Owner (mis. target Sales September), walau Finance memverifikasinya bulan berikutnya. Tidak mengubah Payment, jurnal, saldo, atau status bayar.
// Semua data dari server; layar ini menampilkan dan mengirim keputusan. Aturan & alasan: backend services/pengecualianPaidAt.js.

const TAB = [{ key: "1", label: "Aktif" }, { key: "0", label: "Dicabut" }, { key: "", label: "Semua riwayat" }];
const hariIniISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const StatusBadge = ({ p }) => <Badge variant={p.aktif ? "green" : "neutral"}>{p.aktif ? "Aktif" : "Dicabut"}</Badge>;
const tglWib = (iso) => (iso ? tanggalPendek(new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)) : "—");

export default function FinancePengecualianLunas() {
  const [tab, setTab] = useState("1");
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const pernahMuat = useRef(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modalBaru, setModalBaru] = useState(false);
  const [cabutUntuk, setCabutUntuk] = useState(null);
  const [panelRincian, setPanelRincian] = useState(null);
  const admin = adminSaatIni();

  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    if (!diam) setLoading(true);
    setError(null);
    try { setData(await api.getPengecualianLunas({ aktif: tab, q: qTunda.trim() })); }
    catch (e) { if (diam) setPesan(e.message || "Gagal menyegarkan daftar"); else setError(e.message || "Gagal memuat pengecualian"); }
    finally { if (!diam) setLoading(false); }
  }, [tab, qTunda]);
  useEffect(() => { muat({ diam: pernahMuat.current }); pernahMuat.current = true; }, [muat]);

  async function aksi(fn) {
    try { await fn(); setModalBaru(false); setCabutUntuk(null); await muat({ diam: true }); } catch (e) { setPesan(e.message); }
  }

  const daftar = data?.pengecualian || [];
  const spec = (p) => specPengecualianLunas(p, { badge: <StatusBadge p={p} /> });
  const tombolCabut = (p) => (admin && p.aktif ? <Button size="sm" variant="neutral" onClick={() => setCabutUntuk(p)}>Cabut</Button> : null);

  return (
    <HalamanFinance
      title="Pengecualian Tanggal Lunas"
      subtitle="Order yang tanggal hitung lunasnya dikunci oleh keputusan Owner, lengkap dengan riwayat."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={admin ? <Button size="sm" onClick={() => setModalBaru(true)}><Plus size={14} /> Tambah Pengecualian</Button> : null}
    >
      {pesan && (
        <Card className="bg-redbg"><CardContent className="flex items-center justify-between gap-3 py-3">
          <p className="text-[13px] text-ink">{pesan}</p><Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button>
        </CardContent></Card>
      )}

      <Penjelasan>
        Normalnya tanggal lunas order mengikuti tanggal pembayaran yang <strong>diverifikasi Finance</strong>, sehingga order yang ditandai lunas di akhir bulan tetapi diverifikasi bulan
        berikutnya ikut pindah bulan. Order di daftar <strong>Aktif</strong> sengaja dikunci: tanggal lunasnya tetap seperti keputusan Owner (mis. untuk target dan insentif Sales), apa pun
        yang terjadi pada pembayarannya. <strong>Finance tetap memverifikasi pembayaran seperti biasa</strong> — uang tetap tercatat pada tanggal sebenarnya; yang terkunci hanya tanggal hitung lunas.
        Hanya Owner/Admin yang bisa menambah atau mencabut, dan setiap perubahan tercatat permanen.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KartuAngka label="Pengecualian Aktif" value={String(data?.jumlahAktif ?? 0)} sub="order dengan tanggal lunas terkunci" />
        <KartuAngka label="Nilai Order Terkunci" value={formatUang(data?.nilaiAktif ?? 0)} sub="dihitung server dari pengecualian aktif" />
        <KartuAngka label="Perlu Dicek" value={String(data?.tidakKonsisten ?? 0)} tone={(data?.tidakKonsisten ?? 0) > 0 ? "orange" : "default"} sub="aktif tetapi tanggal lunasnya berbeda dari yang dikunci" />
      </div>

      <div className="flex flex-wrap gap-2">
        {TAB.map((t) => <Button key={t.key || "semua"} size="sm" variant={tab === t.key ? "secondary" : "neutral"} onClick={() => setTab(t.key)}>{t.label}</Button>)}
      </div>
      <FilterBar q={q} onQ={setQ} placeholder="Cari nomor order, pelanggan, alasan…" filters={[]} ringkasan={`${daftar.length} pengecualian`} onReset={() => setQ("")} />

      <Card className="overflow-hidden">
        <JudulKartu title="Riwayat Pengecualian" description="Baris tidak pernah dihapus. Mencabut hanya menandai pengecualian selesai, lengkap dengan siapa dan alasannya." />
        {daftar.length === 0 ? (
          <CardContent><EmptyState icon={ShieldCheck} title="Belum ada pengecualian" description="Tidak ada yang cocok dengan filter ini." action={admin ? <Button size="sm" onClick={() => setModalBaru(true)}>Tambah Pengecualian</Button> : null} /></CardContent>
        ) : (
          <>
            <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
              <Table fixed>
                <THead><TR><TH sticky width={150}>Order</TH><TH>Pelanggan</TH><TH numeric width={112}>Nilai</TH><TH width={110}>Lunas dikunci</TH><TH>Alasan</TH><TH width={96}>Status</TH><TH width={110}>Aksi</TH></TR></THead>
                <TBody>
                  {daftar.map((p) => (
                    <TR key={p.id} {...klikBuka(() => setPanelRincian(spec(p)))}>
                      <TD sticky className="font-mono text-[12px]">{p.order.nomor}</TD>
                      <TD truncate>{p.order.pelanggan}</TD>
                      <TD numeric><Uang value={p.order.nilai} /></TD>
                      <TD className="whitespace-nowrap text-[12px]">{tglWib(p.paidAtDikunci)}</TD>
                      <TD truncate className="text-[12px] text-ink2">{p.alasan}</TD>
                      <TD><StatusBadge p={p} /></TD>
                      <TD>{tombolCabut(p)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <CardList className={CARD_VIEW_CLASS}>
              {daftar.map((p) => (
                <RowCard
                  key={p.id}
                  onClick={() => setPanelRincian(spec(p))}
                  title={p.order.nomor}
                  status={<StatusBadge p={p} />}
                  subtitle={p.order.pelanggan}
                  fields={[{ label: "Nilai", value: formatUang(p.order.nilai) }, { label: "Lunas dikunci", value: tglWib(p.paidAtDikunci) }, { label: "Alasan", value: p.alasan, span: true }]}
                  actions={tombolCabut(p)}
                />
              ))}
            </CardList>
          </>
        )}
      </Card>

      <ModalBaru open={modalBaru} onClose={() => setModalBaru(false)} onSubmit={(d) => aksi(() => api.buatPengecualianLunas(d))} />
      <ModalCabut target={cabutUntuk} onClose={() => setCabutUntuk(null)} onSubmit={(alasan) => aksi(() => api.cabutPengecualianLunas(cabutUntuk.id, alasan))} />
      <PanelDetail spec={panelRincian} onClose={() => setPanelRincian(null)} />
    </HalamanFinance>
  );
}

function ModalBaru({ open, onClose, onSubmit }) {
  const [f, setF] = useState({ orderNumber: "", alasan: "", paidAtDikunci: "" });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  useEffect(() => { if (open) setF({ orderNumber: "", alasan: "", paidAtDikunci: "" }); }, [open]);
  const valid = f.orderNumber.trim() && alasanCukup(f.alasan);
  return (
    <Modal
      open={open} onOpenChange={(v) => !v && onClose()}
      title="Tambah Pengecualian Tanggal Lunas"
      description="Tanggal hitung lunas order ini dikunci. Pembayaran, jurnal, dan status bayar tidak berubah."
      className="w-[520px]"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi disabled={!valid} onClick={() => onSubmit({ orderNumber: f.orderNumber.trim(), alasan: f.alasan.trim(), ...(f.paidAtDikunci && { paidAtDikunci: new Date(`${f.paidAtDikunci}T12:00:00+07:00`).toISOString() }) })}>Kunci Tanggal Lunas</TombolAksi></>}
    >
      <div className="space-y-3">
        <Field label="Nomor order" required hint="Contoh: RES-27092026-161. Order harus sudah punya tanggal lunas, atau isi tanggalnya di bawah."><Input value={f.orderNumber} onChange={(e) => set("orderNumber", e.target.value)} placeholder="RES-DDMMYYYY-NNN" /></Field>
        <Field label="Tanggal lunas yang dikunci" hint="Kosongkan untuk memakai tanggal lunas order saat ini.">
          <Input type="date" max={hariIniISO()} value={f.paidAtDikunci} onChange={(e) => set("paidAtDikunci", e.target.value)} />
        </Field>
        <Field label="Alasan keputusan Owner" required hint={`Minimal 10 karakter, tercatat permanen (${f.alasan.trim().length}/10)`}>
          <Input value={f.alasan} onChange={(e) => set("alasan", e.target.value)} placeholder="mis. target Sales September 120 jt" />
        </Field>
      </div>
    </Modal>
  );
}

function ModalCabut({ target, onClose, onSubmit }) {
  const [alasan, setAlasan] = useState("");
  useEffect(() => { if (target) setAlasan(""); }, [target]);
  if (!target) return null;
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Cabut pengecualian ${target.order.nomor}`}
      description="Setelah dicabut, tanggal lunas order kembali mengikuti pembayaran yang diverifikasi pada kejadian pembayaran berikutnya. Tanggal saat ini tidak berubah otomatis."
      className="w-[480px]"
      footer={<><Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button><TombolAksi disabled={!alasanCukup(alasan)} onClick={() => onSubmit(alasan.trim())}>Cabut Pengecualian</TombolAksi></>}
    >
      <Field label="Alasan mencabut" required hint={`Minimal 10 karakter (${alasan.trim().length}/10)`}><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} /></Field>
    </Modal>
  );
}
