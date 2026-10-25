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
import { BATAS_KONTROL, KUNCI_DRAFT, STATUS_AKTIF, ambilNomorOrder, angka, aksiBatch, bacaSyaratSaldo, bangunKonfirmasiManifest, bolehLihatPosting, bolehMulaiPosting, bolehTekanMulai, labelStatusBatch, periksaKonfirmasiLayar, pilihHanyaTampil, pesanGalat, rupiah, unitTerpilih, validasiRujukan } from "@/features/warehouse/postingHistoris/postingHistorisModel.js";

// POSTING PEMAKAIAN HISTORIS (Admin/Owner/Finance). Catatan Excel Admin Sales → pengeluaran stok resmi, hanya KUANTITAS (tanpa jurnal HPP).
// Halaman ini: (1) pratinjau manifest + dampak stok/HPP + yang tertahan, (2) mulai batch dengan konfirmasi (konfirmasi manifest oleh Owner, rujukan keputusan), (3) progres per order, alasan gagal, lanjut/hentikan.
// Batch berjalan di SERVER; halaman ini hanya menampilkan statusnya. Draf per tab HANYA menyimpan pilihan order; rujukan dan konfirmasi manifest diketik ulang tiap kali (tidak pernah terisi dari draf/tab lama).
// KONFIRMASI MANIFEST (bukan persetujuan Owner terpisah): dialog meminta hash, daftar order, jumlah order & transaksi; server menolak bila tidak sama dengan pilihan (insiden 25 Okt 2026).
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
  const [pilihanPulih] = useState(() => Array.isArray(bacaDraft().pilih)); // pilihan order berasal dari draf tab ini (sesi sebelumnya)
  const [rujukan, setRujukan] = useState("");
  const [hashKonfirmasi, setHashKonfirmasi] = useState(""); const [orderKonfirmasi, setOrderKonfirmasi] = useState(""); const [jmlOrder, setJmlOrder] = useState(""); const [jmlTrx, setJmlTrx] = useState(""); const [saldoTeks, setSaldoTeks] = useState("");
  const [cek, setCek] = useState(false);
  const [galatAksi, setGalatAksi] = useState(null);
  const mulaiRef = useRef(false);

  const aktifSt = batch.status; const sedangAktif = !!aktifSt && STATUS_AKTIF.includes(aktifSt.status);
  useEffect(() => { simpanDraft({ pilih }); }, [pilih]);

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
    if (!boleh || batch.memuat || sedangAktif || !pilih || pilih.length === 0) { setPraSub({ memuat: false, data: null, galat: null }); return undefined; }
    // DEBOUNCE 450 ms: mencentang/menghapus centang beruntun tidak boleh memicu puluhan perhitungan manifest di server; hanya pilihan TERAKHIR yang dihitung
    let batal = false; setPraSub((x) => ({ ...x, memuat: true, galat: null }));
    const t = setTimeout(() => { api.pratinjauPostingHistoris(pilih).then((d) => { if (!batal) setPraSub({ memuat: false, data: d, galat: null }); }).catch((e) => { if (!batal) setPraSub({ memuat: false, data: null, galat: e }); }); }, 450);
    return () => { batal = true; clearTimeout(t); };
  }, [boleh, batch.memuat, sedangAktif, pilih, statusBatch]);

  const semuaUnit = useMemo(() => pra.data?.order?.map((o) => o.unitId) ?? [], [pra.data]);
  const orders = useMemo(() => (pra.data?.order ?? []).filter((o) => !cari.trim() || o.orderNumber.toLowerCase().includes(cari.trim().toLowerCase())), [pra.data, cari]);
  const terpilihSet = useMemo(() => new Set(pilih ?? semuaUnit), [pilih, semuaUnit]);
  function ubahPilihan(id, nilai) { const set = new Set(pilih ?? semuaUnit); if (nilai) set.add(id); else set.delete(id); setPilih(set.size >= semuaUnit.length ? null : [...set]); }

  const kosong = !!pilih && pilih.length === 0; // tidak ada order dipilih
  const p = kosong ? null : pilih ? praSub.data : pra.data; // yang akan diposting
  const v = p ?? pra.data; // tampilan: bila pilihan sedang dihitung ulang, tetap tampilkan yang terakhir (tombol Mulai dikunci lewat memuatP)
  const memuatP = kosong ? false : pilih ? praSub.memuat || (!praSub.data && !praSub.galat) : pra.memuat;
  const syaratDasar = bolehTekanMulai({ pratinjau: p, batchAktif: aktifSt, roles, memuat: memuatP });
  const syarat = kosong && syaratDasar.alasan === "Tidak ada transaksi siap posting." ? { ok: false, alasan: "Pilih minimal satu order." } : syaratDasar;
  const aksi = aksiBatch({ status: aktifSt?.status, roles, sibuk: batch.sibuk });
  const rj = validasiRujukan(rujukan);
  const daftarKonfirmasi = useMemo(() => ambilNomorOrder(orderKonfirmasi), [orderKonfirmasi]);
  const syaratSaldo = useMemo(() => bacaSyaratSaldo(saldoTeks), [saldoTeks]);
  const bedaKonfirmasi = useMemo(() => (p ? periksaKonfirmasiLayar({ manifest: p, hash: hashKonfirmasi, daftarOrder: daftarKonfirmasi, jumlahOrder: jmlOrder, jumlahTrx: jmlTrx }) : []), [p, hashKonfirmasi, daftarKonfirmasi, jmlOrder, jmlTrx]);
  const konfirmasiCocok = bedaKonfirmasi.length === 0 && syaratSaldo.ok;
  function bukaDialog() { setGalatAksi(null); setCek(false); setRujukan(""); setHashKonfirmasi(""); setOrderKonfirmasi(""); setJmlOrder(""); setJmlTrx(""); setSaldoTeks(""); setDlg(true); }

  async function mulai() {
    if (mulaiRef.current || !rj.ok || !cek || !p || !konfirmasiCocok) return;
    mulaiRef.current = true; setGalatAksi(null);
    try {
      await batch.mulai({ hashDisetujui: p.hash, rujukan: rj.nilai, unitIds: p.unitIds, konfirmasiManifest: bangunKonfirmasiManifest({ manifest: p, hash: hashKonfirmasi, daftarOrder: daftarKonfirmasi, jumlahOrder: jmlOrder, jumlahTrx: jmlTrx, rujukan: rj.nilai, saldoSyarat: syaratSaldo.daftar }) });
      setDlg(false); setCek(false); setRujukan(""); setHashKonfirmasi(""); setOrderKonfirmasi(""); setJmlOrder(""); setJmlTrx(""); setSaldoTeks(""); setPilih(null);
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
        {!bolehMulaiPosting(roles) && <p className="m-0 rounded-btn bg-accentbg px-3 py-2 text-[13px] text-ink" data-testid="info-baca-saja">Anda dapat melihat manifest dan memantau progres. Sementara hanya akun Owner yang dapat memulai posting (Owner meninjau dan mengonfirmasi manifest sendiri); Owner dan Finance dapat menghentikan atau melanjutkan batch yang sudah ada.</p>}

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
                    {bolehMulaiPosting(roles) && (
                      <div className="flex flex-wrap gap-1">
                        <Button variant="tertiary" className="min-h-[40px]" disabled={orders.length === 0} onClick={() => setPilih(pilihHanyaTampil(semuaUnit, orders.map((o) => o.unitId)))} data-testid="pilih-tampil" title="Pilih hanya order yang sedang tampil (hasil pencarian)">Pilih hanya yang tampil</Button>
                        <Button variant="tertiary" className="min-h-[40px]" onClick={() => setPilih([])} data-testid="kosongkan">Kosongkan</Button>
                        {pilih && <Button variant="tertiary" className="min-h-[40px]" onClick={() => setPilih(null)} data-testid="pilih-semua">Pilih semua</Button>}
                      </div>
                    )}
                  </div>
                  {orders.length === 0 ? <p className="m-0 px-3 py-4 text-[13px] text-ink3">{pra.data.jumlahTrx ? "Tidak ada order yang cocok." : "Tidak ada transaksi siap posting."}</p>
                    : <ul className="m-0 max-h-[480px] list-none overflow-y-auto p-0" data-testid="daftar-manifest">{orders.map((o) => <BarisManifest key={o.unitId} o={o} dipilih={terpilihSet.has(o.unitId)} onPilih={ubahPilihan} bolehPilih={bolehMulaiPosting(roles)} />)}</ul>}
                </Card>
                {pilihanPulih && pilih && <p className="m-0 rounded-btn bg-accentbg px-3 py-2 text-[12.5px] text-ink" data-testid="info-pilihan-pulih">Pilihan order dipulihkan dari draf tab ini. Periksa daftarnya; dialog konfirmasi tetap meminta konfirmasi manifest yang diketik ulang.</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <Button className="min-h-[48px]" disabled={!syarat.ok || jumlahTerpilih === 0} data-testid="btn-mulai" onClick={bukaDialog}><Play size={15} aria-hidden /> Mulai batch ({jumlahTerpilih} order)…</Button>
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

      <Modal open={dlg} onOpenChange={(o) => { if (!mulaiRef.current) setDlg(o); }} title="Mulai posting batch?" description="Tindakan ini mengubah stok. Tidak bisa dibatalkan — hanya dikoreksi lewat Koreksi Pemakaian. Hanya akun Owner yang dapat memulai."
        footer={<><Button variant="neutral" className="min-h-[44px]" onClick={() => setDlg(false)} disabled={batch.sibuk} data-testid="batal-mulai">Batal</Button><Button className="min-h-[44px]" disabled={!rj.ok || !cek || !konfirmasiCocok || batch.sibuk} onClick={mulai} data-testid="konfirmasi-mulai">{batch.sibuk ? "Memulai…" : "Ya, mulai batch"}</Button></>}>
        {p && (
          <div className="space-y-3 text-[13px] text-ink" data-testid="dialog-mulai">
            <ul className="m-0 list-disc space-y-1 pl-4">
              <li><b data-testid="dialog-jumlah-order">{p.jumlahOrder} order</b>, <b data-testid="dialog-jumlah-trx">{p.jumlahTrx} transaksi</b> akan diposting sebagai pengeluaran stok, bertanggal pemakaian aslinya.</li>
              <li>HPP berbukti <b>{rupiah(p.hpp.hppBerbukti)}</b> ({p.hpp.status === "PARSIAL" ? <b className="text-orange">PARSIAL</b> : "lengkap"}){p.hpp.trxTanpaHarga ? <> — <b data-testid="dialog-tanpa-harga">{p.hpp.trxTanpaHarga} transaksi tanpa harga: biaya BELUM DIKETAHUI (bukan Rp0)</b></> : null}{p.hpp.catatanTertahan ? <>; {p.hpp.catatanTertahan} catatan lain tetap tertahan</> : null}. <b>Belum dijurnal {rupiah(p.hpp.selisihBelumDijurnal)}</b> — jurnal HPP tidak dibuat.</li>
              <li>Berjalan di server. Anda boleh menutup halaman; progres tersimpan dan dapat dilihat lagi.</li>
              <li>Hash manifest di layar: <code className="break-all text-[12px]" data-testid="dialog-hash-layar">{p.hash}</code></li>
            </ul>
            <div className="rounded-card border border-line">
              <p className="m-0 border-b border-line px-3 py-2 text-[12px] font-semibold text-ink">Order yang akan diposting ({p.order.length})</p>
              <ul className="m-0 max-h-[200px] list-none divide-y divide-line overflow-y-auto p-0" data-testid="dialog-daftar-order">
                {p.order.map((o) => <li key={o.unitId} data-order={o.orderNumber} className="px-3 py-1.5 text-[12.5px]"><b>{o.orderNumber}</b> <span className="text-ink3">— {o.trx.length} transaksi: {o.trx.map((t) => `${t.kodeBahan} ${angka(t.qty)} ${t.satuan} (${t.tanggal})`).join(", ")}{o.jumlahTertahan ? ` · ${o.jumlahTertahan} catatan tertahan` : ""}</span></li>)}
              </ul>
            </div>
            <div className="rounded-card border border-line">
              <p className="m-0 border-b border-line px-3 py-2 text-[12px] font-semibold text-ink">Saldo bahan yang Anda tinjau ({p.bahan.length}) — server menolak bila saldo bergeser sebelum mulai</p>
              <ul className="m-0 max-h-[140px] list-none divide-y divide-line overflow-y-auto p-0" data-testid="dialog-saldo-bahan">
                {p.bahan.map((b) => <li key={b.materialId} data-kode={b.kode} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1 text-[12.5px]"><b>{b.kode}</b><span className="text-ink2">{angka(b.saldoSekarang)} → <b className={b.saldoSesudah < 0 ? "text-red" : "text-ink"}>{angka(b.saldoSesudah)}</b> {b.satuan}</span></li>)}
              </ul>
            </div>
            <div className="space-y-2 rounded-card border border-line bg-surface px-3 py-3" data-testid="blok-konfirmasi">
              <p className="m-0 text-[12.5px] font-semibold text-ink">Konfirmasi manifest oleh Owner — ketik/tempel dari keputusan Anda, bukan dari layar ini</p>
              <p className="m-0 rounded-btn bg-accentbg px-3 py-2 text-[12px] text-ink" data-testid="batas-kontrol">{BATAS_KONTROL}</p>
              <label className="block"><span className="mb-1 block text-[12px] text-ink3">Hash manifest yang dimaksud (64 karakter)</span>
                <input value={hashKonfirmasi} onChange={(e) => setHashKonfirmasi(e.target.value)} autoComplete="off" spellCheck={false} data-testid="input-hash-konfirmasi" className="h-11 w-full rounded-btn border border-line bg-surface px-3 font-mono text-[12px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" placeholder="tempel hash dari keputusan Owner" /></label>
              <label className="block"><span className="mb-1 block text-[12px] text-ink3">Daftar order yang dimaksud (tempel; format RES-…/NEW-… dikenali otomatis)</span>
                <textarea value={orderKonfirmasi} onChange={(e) => setOrderKonfirmasi(e.target.value)} rows={3} autoComplete="off" spellCheck={false} data-testid="input-order-konfirmasi" className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" placeholder="RES-…, RES-…" /></label>
              {daftarKonfirmasi.length > 0 && <p className="m-0 text-[12px] text-ink3" data-testid="terbaca-order-konfirmasi">Terbaca {daftarKonfirmasi.length} order.</p>}
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="mb-1 block text-[12px] text-ink3">Jumlah order</span><input value={jmlOrder} onChange={(e) => setJmlOrder(e.target.value)} inputMode="numeric" autoComplete="off" data-testid="input-jml-order" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
                <label className="block"><span className="mb-1 block text-[12px] text-ink3">Jumlah transaksi</span><input value={jmlTrx} onChange={(e) => setJmlTrx(e.target.value)} inputMode="numeric" autoComplete="off" data-testid="input-jml-trx" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
              </div>
              <label className="block"><span className="mb-1 block text-[12px] text-ink3">Syarat saldo sebelum mulai (opsional; satu per baris, mis. SPANBON-75GRAM=300) — server menolak bila saldo tidak sama</span>
                <textarea value={saldoTeks} onChange={(e) => setSaldoTeks(e.target.value)} rows={2} autoComplete="off" spellCheck={false} data-testid="input-saldo-syarat" className="w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" /></label>
              {!syaratSaldo.ok && <p className="m-0 text-[12px] text-red" data-testid="galat-saldo-syarat">Baris syarat saldo tidak terbaca: {syaratSaldo.galat.join("; ")}</p>}
              {bedaKonfirmasi.length > 0
                ? <ul role="alert" className="m-0 list-disc space-y-0.5 rounded-btn bg-redbg py-2 pl-6 pr-3 text-[12.5px] text-red" data-testid="selisih-konfirmasi">{bedaKonfirmasi.map((x) => <li key={x}>{x}</li>)}</ul>
                : <p className="m-0 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green" data-testid="konfirmasi-cocok">Konfirmasi cocok dengan manifest di layar: hash, {p.jumlahOrder} order, {p.jumlahTrx} transaksi.</p>}
            </div>
            <label className="block"><span className="mb-1 block text-[12px] text-ink3">Rujukan keputusan Owner (min. 8 karakter) — teks ini yang akan tersimpan</span>
              <input value={rujukan} onChange={(e) => setRujukan(e.target.value)} maxLength={200} autoComplete="off" data-testid="input-rujukan" className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" placeholder="ketik rujukan persis seperti keputusan Owner" /></label>
            {!rj.ok && rujukan.length > 0 && <p className="m-0 text-[12px] text-red">{rj.pesan}</p>}
            {rj.ok && <p className="m-0 rounded-btn bg-accentbg px-3 py-2 text-[13px] text-ink" data-testid="rujukan-dicatat">Rujukan yang akan dicatat: <b className="break-all">{rj.nilai}</b></p>}
            <label className="flex min-h-[44px] items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={cek} onChange={(e) => setCek(e.target.checked)} data-testid="cek-periksa" /><span>Saya Owner yang menjalankan ini, sudah memeriksa daftar order, isi transaksi, saldo, dan dampaknya, dan mengonfirmasi manifest ini sendiri.</span></label>
            {galatAksi && <p role="alert" className="m-0 text-[12.5px] text-red" data-testid="galat-mulai">{pesanGalat(galatAksi)}</p>}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
