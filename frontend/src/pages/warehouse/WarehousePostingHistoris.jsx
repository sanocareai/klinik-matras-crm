import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, RefreshCw, Square } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { rolesOf } from "@/lib/roles.js";
import { BarisManifest, DaftarOrderBatch, KartuHpp, KartuProgres, Stat } from "@/features/warehouse/postingHistoris/PostingHistorisParts.jsx";
import { useBatchPostingHistoris } from "@/features/warehouse/postingHistoris/useBatchPostingHistoris.js";
import { KUNCI_DRAFT, STATUS_AKTIF, angka, aksiBatch, bolehLihatPosting, bolehMulaiPosting, bolehTekanMulai, labelStatusBatch, pesanGalat, rupiah, unitTerpilih, validasiRujukan } from "@/features/warehouse/postingHistoris/postingHistorisModel.js";

// POSTING PEMAKAIAN HISTORIS (Admin/Owner/Finance). Catatan Excel Admin Sales → pengeluaran stok resmi, hanya KUANTITAS (tanpa jurnal HPP).
// Halaman ini: (1) pratinjau manifest + dampak stok/HPP + yang tertahan, (2) mulai batch dengan konfirmasi (hash manifest = pin persetujuan, rujukan Owner), (3) progres per order, alasan gagal, lanjut/hentikan.
// Batch berjalan di SERVER; halaman ini hanya menampilkan statusnya. Draf isian (rujukan, pilihan order) disimpan per tab agar tidak hilang saat refresh.
function pengguna() { try { return JSON.parse(localStorage.getItem("user")) || {}; } catch { return {}; } }
function bacaDraft() { try { return JSON.parse(sessionStorage.getItem(KUNCI_DRAFT)) || {}; } catch { return {}; } }
function simpanDraft(d) { try { sessionStorage.setItem(KUNCI_DRAFT, JSON.stringify(d)); } catch { /* diblokir */ } }

export default function WarehousePostingHistoris() {
  const roles = rolesOf(pengguna());
  const boleh = bolehLihatPosting(roles);
  const batch = useBatchPostingHistoris({ aktif: boleh });
  const [pra, setPra] = useState({ memuat: true, data: null, galat: null }); // manifest PENUH (daftar order)
  const [praSub, setPraSub] = useState({ memuat: false, data: null, galat: null }); // manifest untuk order TERPILIH (hash + dampak bila hanya sebagian)
  const [pilih, setPilih] = useState(() => bacaDraft().pilih ?? null); // null = semua order
  const [cari, setCari] = useState("");
  const [dlg, setDlg] = useState(false);
  const [rujukan, setRujukan] = useState(() => bacaDraft().rujukan ?? "");
  const [cek, setCek] = useState(false);
  const [galatAksi, setGalatAksi] = useState(null);
  const mulaiRef = useRef(false);

  const aktifSt = batch.status; const sedangAktif = !!aktifSt && STATUS_AKTIF.includes(aktifSt.status);
  useEffect(() => { simpanDraft({ pilih, rujukan }); }, [pilih, rujukan]);

  const muatPratinjau = useCallback(async () => {
    setPra((p) => ({ ...p, memuat: true, galat: null }));
    try { const d = await api.pratinjauPostingHistoris(); setPra({ memuat: false, data: d, galat: null }); }
    catch (e) { setPra((p) => ({ ...p, memuat: false, galat: e })); }
  }, []);
  // pratinjau dimuat saat halaman dibuka, saat pilihan order berubah, dan saat batch selesai (rencana sisa berubah). Tidak dimuat ulang tiap polling.
  const statusBatch = aktifSt?.status;
  // pratinjau hanya dimuat SETELAH status batch diketahui dan tidak ada batch aktif (saat batch berjalan manifest tidak relevan dan mahal dihitung: beberapa tab tidak boleh memicunya)
  useEffect(() => { if (boleh && !batch.memuat && !sedangAktif) muatPratinjau(); }, [boleh, batch.memuat, sedangAktif, statusBatch, muatPratinjau]);
  // bila hanya sebagian order dipilih: hash/dampak/HPP dihitung server untuk pilihan itu (bukan dikira-kira di browser)
  useEffect(() => {
    if (!boleh || batch.memuat || sedangAktif || !pilih) { setPraSub({ memuat: false, data: null, galat: null }); return undefined; }
    let batal = false; setPraSub((x) => ({ ...x, memuat: true, galat: null }));
    api.pratinjauPostingHistoris(pilih.length ? pilih : undefined).then((d) => { if (!batal) setPraSub({ memuat: false, data: d, galat: null }); }).catch((e) => { if (!batal) setPraSub({ memuat: false, data: null, galat: e }); });
    return () => { batal = true; };
  }, [boleh, batch.memuat, sedangAktif, pilih, statusBatch]);

  const semuaUnit = useMemo(() => pra.data?.order?.map((o) => o.unitId) ?? [], [pra.data]);
  const orders = useMemo(() => (pra.data?.order ?? []).filter((o) => !cari.trim() || o.orderNumber.toLowerCase().includes(cari.trim().toLowerCase())), [pra.data, cari]);
  const terpilihSet = useMemo(() => new Set(pilih ?? semuaUnit), [pilih, semuaUnit]);
  function ubahPilihan(id, nilai) { const set = new Set(pilih ?? semuaUnit); if (nilai) set.add(id); else set.delete(id); setPilih(set.size >= semuaUnit.length ? null : [...set]); }

  const p = pilih ? praSub.data : pra.data; // yang akan diposting
  const v = p ?? pra.data; // tampilan: bila pilihan sedang dihitung ulang, tetap tampilkan yang terakhir (tombol Mulai dikunci lewat memuatP)
  const memuatP = pilih ? praSub.memuat || (!praSub.data && !praSub.galat) : pra.memuat;
  const syarat = bolehTekanMulai({ pratinjau: p, batchAktif: aktifSt, roles, memuat: memuatP });
  const aksi = aksiBatch({ status: aktifSt?.status, roles, sibuk: batch.sibuk });
  const rj = validasiRujukan(rujukan);

  async function mulai() {
    if (mulaiRef.current || !rj.ok || !cek || !p) return;
    mulaiRef.current = true; setGalatAksi(null);
    try {
      const ids = unitTerpilih(semuaUnit, pilih ?? semuaUnit);
      await batch.mulai({ hashDisetujui: p.hash, rujukan: rj.nilai, ...(ids ? { unitIds: ids } : {}) });
      setDlg(false); setCek(false); setRujukan(""); setPilih(null);
    } catch (e) { setGalatAksi(e); } finally { mulaiRef.current = false; }
  }
  async function aksiLain(fn) { setGalatAksi(null); try { await fn(); } catch (e) { setGalatAksi(e); } }

  if (!boleh) return (<PageContainer><PageHeader title="Posting Pemakaian Historis" /><PageBody><EmptyState title="Halaman ini untuk Admin, Owner, dan Finance" description="Akun Anda tidak memiliki akses ke posting pemakaian historis." /></PageBody></PageContainer>);

  const idsPilihan = unitTerpilih(semuaUnit, pilih ?? semuaUnit);
  const jumlahTerpilih = pilih ? pilih.length : semuaUnit.length;
  const galatBanner = batch.galat ? pesanGalat(batch.galat) : "";
  return (
    <PageContainer>
      <PageHeader title="Posting Pemakaian Historis" subtitle="Catatan pemakaian Excel Admin Sales → pengeluaran stok resmi. Hanya mengurangi kuantitas; jurnal HPP tidak dibuat."
        actions={<Button variant="neutral" className="min-h-[44px]" onClick={() => { batch.ambil(); if (!sedangAktif) muatPratinjau(); }} data-testid="muat-ulang"><RefreshCw size={15} aria-hidden /> Muat ulang</Button>} />
      <PageBody className="space-y-4">
        {!bolehMulaiPosting(roles) && <p className="m-0 rounded-btn bg-accentbg px-3 py-2 text-[13px] text-ink" data-testid="info-baca-saja">Anda dapat melihat manifest dan memantau progres. Memulai, menghentikan, atau melanjutkan batch hanya untuk akun dengan izin persetujuan penyesuaian stok (Owner/Finance).</p>}

        {aktifSt && (
          <section aria-label="Batch" className="space-y-3" data-testid="bagian-batch">
            <KartuProgres s={aktifSt} galat={galatBanner} diperbaruiPada={batch.diperbaruiPada} aksi={
              <div className="space-y-2">
                {(aksi.lanjut || aksi.hentikan) && (
                  <div className="flex flex-wrap gap-2">
                    {aksi.hentikan && <Button variant="destructive" className="min-h-[44px]" disabled={batch.sibuk} data-testid="btn-hentikan" onClick={() => aksiLain(() => batch.hentikan(aktifSt.batchId))}><Square size={14} aria-hidden /> Hentikan setelah order ini</Button>}
                    {aksi.lanjut && <Button className="min-h-[44px]" disabled={batch.sibuk} data-testid="btn-lanjut" onClick={() => aksiLain(() => batch.lanjut(aktifSt.batchId))}><Play size={14} aria-hidden /> Lanjutkan</Button>}
                  </div>
                )}
                {aksi.alasan && <p className="m-0 text-[12px] text-ink3" data-testid="alasan-tanpa-aksi">{aksi.alasan}</p>}
                {galatAksi && <p role="alert" className="m-0 text-[12.5px] text-red" data-testid="galat-aksi">{pesanGalat(galatAksi)}</p>}
              </div>
            } />
            <KartuHpp hpp={aktifSt.hpp} judul="HPP hasil batch ini" />
            <DaftarOrderBatch unit={aktifSt.unit ?? []} />
          </section>
        )}

        {!sedangAktif && (
          <section aria-label="Manifest" className="space-y-3" data-testid="bagian-manifest">
            <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-[15px] font-semibold text-ink">{aktifSt ? "Manifest berikutnya" : "Manifest siap posting"}</h2>{v && <Badge variant="neutral" data-testid="hash-manifest">hash {v.hash.slice(0, 10)}…</Badge>}</div>
            {pra.galat && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red" data-testid="galat-pratinjau">{pesanGalat(pra.galat)}</p>}
            {pra.memuat && !pra.data && <p className="m-0 text-[13px] text-ink3">Memuat manifest…</p>}
            {praSub.galat && <p role="alert" className="m-0 rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{pesanGalat(praSub.galat)}</p>}
            {pra.data && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Order" nilai={v.jumlahOrder} testid="stat-order" /><Stat label="Transaksi" nilai={v.jumlahTrx} testid="stat-trx" />
                  <Stat label="HPP berbukti" nilai={rupiah(v.hpp.hppBerbukti)} testid="stat-hpp" /><Stat label="Bahan terdampak" nilai={v.dampakStok.bahan} sub={v.dampakStok.bahanNegatifSesudah ? `${v.dampakStok.bahanNegatifSesudah} jadi negatif!` : "tanpa saldo negatif baru"} nada={v.dampakStok.bahanNegatifSesudah ? "red" : undefined} testid="stat-bahan" />
                </div>
                <KartuHpp hpp={v.hpp} judul="Dampak HPP bila diposting" />
                <details className="rounded-card border border-line bg-surface" data-testid="dampak-bahan"><summary className="cursor-pointer px-3 py-2.5 text-[13px] font-semibold text-ink">Dampak stok per bahan ({v.bahan.length})</summary>
                  <ul className="m-0 list-none divide-y divide-line p-0">{v.bahan.map((b) => <li key={b.materialId} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 text-[12.5px]"><span className="font-semibold text-ink">{b.kode}</span><span className="text-ink2">{angka(b.saldoSekarang)} → <b className={b.saldoSesudah < 0 ? "text-red" : "text-ink"}>{angka(b.saldoSesudah)}</b> {b.satuan} <span className="text-ink3">(−{angka(b.qty)}, {b.trx} trx{b.trxTanpaHarga ? `, ${b.trxTanpaHarga} tanpa harga` : ""})</span></span></li>)}</ul></details>
                <Card className="px-0 py-0">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                    <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nomor order…" aria-label="Cari order" data-testid="cari-order" className="h-10 min-w-0 flex-1 rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
                    {bolehMulaiPosting(roles) && <span className="text-[12px] text-ink3" data-testid="jumlah-terpilih">{jumlahTerpilih} dari {semuaUnit.length} order dipilih</span>}
                    {bolehMulaiPosting(roles) && pilih && <Button variant="tertiary" onClick={() => setPilih(null)} data-testid="pilih-semua">Pilih semua</Button>}
                  </div>
                  {orders.length === 0 ? <p className="m-0 px-3 py-4 text-[13px] text-ink3">{pra.data.jumlahTrx ? "Tidak ada order yang cocok." : "Tidak ada transaksi siap posting."}</p>
                    : <ul className="m-0 max-h-[480px] list-none overflow-y-auto p-0" data-testid="daftar-manifest">{orders.map((o) => <BarisManifest key={o.unitId} o={o} dipilih={terpilihSet.has(o.unitId)} onPilih={ubahPilihan} bolehPilih={bolehMulaiPosting(roles)} />)}</ul>}
                </Card>
                <div className="flex flex-wrap items-center gap-2">
                  <Button className="min-h-[48px]" disabled={!syarat.ok || jumlahTerpilih === 0} data-testid="btn-mulai" onClick={() => { setGalatAksi(null); setDlg(true); }}><Play size={15} aria-hidden /> Mulai batch ({jumlahTerpilih} order)…</Button>
                  {!syarat.ok && <span className="text-[12.5px] text-ink3" data-testid="alasan-mulai">{syarat.alasan}</span>}
                </div>
              </>
            )}
          </section>
        )}

        {batch.daftar.length > 1 && (
          <details className="rounded-card border border-line bg-surface" data-testid="riwayat-batch"><summary className="cursor-pointer px-3 py-2.5 text-[13px] font-semibold text-ink">Riwayat batch ({batch.daftar.length})</summary>
            <ul className="m-0 list-none divide-y divide-line p-0">{batch.daftar.map((b) => <li key={b.batchId} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[12.5px]"><Badge variant={labelStatusBatch(b.status).nada}>{labelStatusBatch(b.status).label}</Badge><span className="text-ink2">{b.unitSelesai}/{b.totalUnit} order · {b.transaksiDiposting}/{b.transaksiTotal} trx</span><span className="ml-auto text-ink3">{new Date(b.diajukanPada).toLocaleString("id-ID", { hour12: false })}</span></li>)}</ul></details>
        )}
      </PageBody>

      <Modal open={dlg} onOpenChange={(o) => { if (!mulaiRef.current) setDlg(o); }} title="Mulai posting batch?" description="Tindakan ini mengubah stok. Tidak bisa dibatalkan — hanya dikoreksi lewat Koreksi Pemakaian."
        footer={<><Button variant="neutral" className="min-h-[44px]" onClick={() => setDlg(false)} disabled={batch.sibuk} data-testid="batal-mulai">Batal</Button><Button className="min-h-[44px]" disabled={!rj.ok || !cek || batch.sibuk} onClick={mulai} data-testid="konfirmasi-mulai">{batch.sibuk ? "Memulai…" : "Ya, mulai batch"}</Button></>}>
        {p && (
          <div className="space-y-3 text-[13px] text-ink" data-testid="dialog-mulai">
            <ul className="m-0 list-disc space-y-1 pl-4">
              <li><b>{v.jumlahOrder} order</b>, <b>{v.jumlahTrx} transaksi</b> akan diposting sebagai pengeluaran stok, bertanggal pemakaian aslinya.</li>
              <li>HPP berbukti <b>{rupiah(v.hpp.hppBerbukti)}</b> ({v.hpp.status === "PARSIAL" ? <b className="text-orange">PARSIAL</b> : "lengkap"}). <b>Belum dijurnal {rupiah(v.hpp.selisihBelumDijurnal)}</b> — jurnal HPP tidak dibuat.</li>
              <li>Berjalan di server. Anda boleh menutup halaman; progres tersimpan dan dapat dilihat lagi.</li>
              <li>Pin persetujuan: hash <code className="break-all text-[12px]">{p.hash.slice(0, 16)}…</code> — jika stok/catatan berubah sebelum dimulai, server menolak.</li>
            </ul>
            <label className="block"><span className="mb-1 block text-[12px] text-ink3">Rujukan persetujuan Owner (min. 8 karakter)</span>
              <input value={rujukan} onChange={(e) => setRujukan(e.target.value)} maxLength={200} data-testid="input-rujukan" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" placeholder="mis. OWNER-2026-10-26-posting-historis" /></label>
            {!rj.ok && rujukan.length > 0 && <p className="m-0 text-[12px] text-red">{rj.pesan}</p>}
            <label className="flex min-h-[44px] items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={cek} onChange={(e) => setCek(e.target.checked)} data-testid="cek-periksa" /><span>Saya sudah memeriksa manifest dan dampaknya, dan menyetujui memposting transaksi ini.</span></label>
            {galatAksi && <p role="alert" className="m-0 text-[12.5px] text-red" data-testid="galat-mulai">{pesanGalat(galatAksi)}</p>}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
