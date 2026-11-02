import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Loader2 } from "lucide-react";
import { useV1Units } from "@/features/production/v1Source.jsx";
import { DELAY_TITLE } from "@/features/production/productionLabels.js";
import { unitDetailPath } from "@/lib/legacyProductionRoutes.js";
import { api } from "@/api.js";
import { PageContainer } from "@/components/ui/page.jsx";
import { formatTanggal } from "@/utils/formatDate.js";
import { bagiTile, jadwalHariIni, summaryFromV1, summaryFromV2, tindakLanjutDari } from "@/features/production/ringkasanModel.js";
import ReworkPelanggan from "@/features/production/ringkasan/ReworkPelanggan.jsx";
import { IkAwas, IkBaki, IkDokumen, IkJadwal, IkJam, IkKotak, IkMuatUlang, IkOrang, IkPanahKanan, IkPeriksa, IkProses, IkSelesai, IkTarget, IkTruk } from "@/components/produksiIcons.jsx";

// Ringkasan (redesain Produksi, 2 Nov 2026) — komposisi: empat KPI utama → metrik pendukung padat → "Perlu ditindaklanjuti" + PIC → posisi unit → jadwal hari ini.
// SUMBER DATA TIDAK BERUBAH: Command Center V2 (atau V1 lewat adaptor bila reader V2 OFF) — angka server apa adanya, tanpa total baru dan tanpa menggabungkan populasi berbeda
// ("Belum masuk papan" = Order Diproses di luar papan V2, dihitung hook v1Source, ditampilkan sebagai segmen TERPISAH — tidak dijumlahkan ke pipeline).
function todayWibISO() { return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); }
function currentRoles() { try { return JSON.parse(localStorage.getItem("user"))?.roles || []; } catch { return []; } }

const IKON_KPI = { target: IkTarget, done: IkSelesai, active: IkProses, queue: IkJam, late: IkAwas, material: IkKotak, qc: IkDokumen };
const WARNA_KPI = { target: "biru", done: "muda", active: "lavender", queue: "netral" }; // Menunggu mulai: netral + aksen amber (bukan hijau yang menyiratkan berhasil)
const LABEL_KPI = { queue: "Menunggu mulai" }; // sumber: kolom "Tiba / belum mulai" (V2) atau antrean (V1) — kata-kata saja berbeda
const IKON_TAHAP = { AKAN_MASUK: IkTruk, DALAM_PERJALANAN: IkTruk, TIBA_BELUM_MULAI: IkBaki, UJI_FONDASI: IkPeriksa, UJI_TEKSTUR: IkPeriksa, SIAP_KIRIM: IkKotak };
const TAHAP_AWAL = 5;

function Kpi({ tile }) {
  const Ikon = IKON_KPI[tile.key] || IkJam;
  const isi = (
    <>
      <span className="prod-kpi-ikon"><Ikon size={26} /></span>
      <div className="prod-kpi-isi">
        <p className="prod-kpi-label">{LABEL_KPI[tile.key] || tile.label}</p>
        <p className="prod-kpi-angka">{tile.value}{tile.of != null && <span> / {tile.of}</span>}<span className="prod-kpi-satuan">unit</span></p>
      </div>
    </>
  );
  const props = { "data-testid": "kpi-tile", "data-kpi": tile.key, className: `prod-kpi ${WARNA_KPI[tile.key] || "lavender"}` };
  return tile.to ? <Link to={tile.to} {...props}>{isi}</Link> : <div {...props}>{isi}</div>;
}

function Metrik({ tile }) {
  const Ikon = IKON_KPI[tile.key] || IkJam;
  const rawan = tile.tone === "red" || tile.tone === "orange";
  const isi = (
    <>
      <span className={`prod-ikon-ubin ${tile.tone === "red" ? "merah" : tile.tone === "orange" ? "oranye" : ""}`}><Ikon size={22} /></span>
      <div className="min-w-0">
        <p className="prod-metrik-label">{LABEL_KPI[tile.key] || tile.label}</p>
        <p className="prod-metrik-angka" data-rawan={rawan || undefined}>{tile.value}{typeof tile.value === "number" && <small>unit</small>}</p>
      </div>
    </>
  );
  return tile.to ? <Link to={tile.to} className="prod-metrik" data-testid="kpi-tile" data-kpi={tile.key}>{isi}</Link> : <div className="prod-metrik" data-testid="kpi-tile" data-kpi={tile.key}>{isi}</div>;
}

function BarisTindakLanjut({ t, "data-testid": testid }) {
  return (
    <li data-testid={testid} className={`prod-tl ${t.tingkat}`}>
      <span className="prod-tl-ikon"><IkAwas size={22} /></span>
      <div className="prod-tl-isi">
        <p className="prod-tl-judul"><span className="prod-sr">{t.tingkat === "kritis" ? "Kritis: " : "Perlu perhatian: "}</span>{t.judul}</p>
        <p className="prod-tl-meta">
          {t.pelanggan && <span className="nama">{t.pelanggan}</span>}
          {t.unitCode && <span>Unit: {t.unitCode}</span>}
          {t.orderNumber && <span>{t.orderNumber}</span>}
          {t.pemilik && <span>Tindakan: {t.pemilik}</span>}
          {t.rincian && <span>{t.rincian}</span>}
        </p>
      </div>
      {t.to && <Link to={t.to} className="prod-tombol prod-tl-buka" aria-label={`Buka ${t.unitCode || t.judul}`}>Buka <IkPanahKanan size={14} /></Link>}
    </li>
  );
}

export default function ProductionRingkasan() {
  const date = todayWibISO();
  const [v2, setV2] = useState(null);
  const [v1, setV1] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [semuaTahap, setSemuaTahap] = useState(false);

  const { v1: orders, total: offBoardTotal, hasMore: offBoardMore } = useV1Units();
  const v1Blocked = useMemo(() => orders.filter((u) => u.productionStatus === "BLOCKED"), [orders]);
  const roles = currentRoles();
  const allowed = roles.some((r) => ["ADMIN", "OWNER", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE"].includes(r));

  const load = useCallback(() => {
    setLoading(true); setError("");
    return api.getProductionV2CommandCenter()
      .then(async (c) => { setV2(c); setV1(c.readerMode === "OFF" ? await api.getCommandCenter(date).catch(() => null) : null); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const summary = useMemo(() => {
    if (!v2) return null;
    if (v2.readerMode !== "OFF") return summaryFromV2(v2);
    return v1 ? summaryFromV1(v1) : null;
  }, [v2, v1]);
  const { utama, pendukung } = useMemo(() => bagiTile(summary?.tiles), [summary]);
  const jadwal = useMemo(() => (v2 && v2.readerMode !== "OFF" ? jadwalHariIni(v2) : []), [v2]);
  const tindak = useMemo(() => (summary ? summary.attention.map(tindakLanjutDari) : []), [summary]);

  if (!allowed) {
    return (
      <PageContainer className="prod-halaman">
        <div className="prod-kosong"><div><b>Tidak punya akses</b>Halaman ini khusus tim produksi.</div></div>
      </PageContainer>
    );
  }

  const jumlahTindak = tindak.length + v1Blocked.length;
  const tahap = summary ? summary.pipeline : [];
  const segmenTahap = [
    ...(offBoardTotal > 0 ? [{ off: true, key: "OFF", label: "Belum masuk papan", title: "Order Diproses yang belum masuk papan", count: offBoardTotal, to: "/bengkel/order-produksi?tab=aktif" }] : []),
    ...tahap.map((s) => ({ key: s.key, label: s.label, title: s.label, count: s.count, to: "/bengkel/production-v2" })),
  ];
  const tahapTampil = semuaTahap ? segmenTahap : segmenTahap.slice(0, TAHAP_AWAL);

  return (
    <PageContainer fluid className="prod-halaman">
      <div className="prod-stack">
        <div className="prod-baris-judul">
          <div>
            <h1 className="page-title m-0">Ringkasan produksi</h1>
            <p className="page-subtitle m-0">{formatTanggal(date)}</p>
          </div>
          <div className="prod-aksi-judul">
            <button type="button" className="prod-tombol netral" onClick={load} disabled={loading} data-testid="ringkasan-muat-ulang"><IkMuatUlang size={18} className={loading ? "animate-spin" : undefined} /> Muat ulang</button>
          </div>
        </div>

        {error && !summary ? (
          <div className="prod-galat" role="alert" data-testid="ringkasan-galat"><span>{error}</span><button type="button" className="prod-tombol" onClick={load}>Coba lagi</button></div>
        ) : loading && !summary ? (
          <div className="prod-panel prod-memuat"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Memuat ringkasan produksi…</div>
        ) : summary ? (
          <>
            <div className="prod-kpi-grid" data-testid="kpi-row">
              {utama.map((t) => <Kpi key={t.key} tile={t} />)}
            </div>
            {pendukung.length > 0 && <div className="prod-pendukung">{pendukung.map((t) => <Metrik key={t.key} tile={t} />)}</div>}

            <div className="prod-grid-dua">
              <section className="prod-panel" data-testid="attention-card" aria-labelledby="prod-tl-judul">
                <div className="prod-panel-kepala">
                  <span className="prod-ikon-ubin"><IkAwas size={22} /></span>
                  <h2 id="prod-tl-judul" className="prod-panel-judul">Perlu ditindaklanjuti</h2>
                  {jumlahTindak > 0 && <span className="prod-hitung merah">{jumlahTindak}</span>}
                </div>
                <div className="prod-panel-isi">
                  {jumlahTindak === 0 ? (
                    <div className="prod-kosong"><div><b>Tidak ada yang perlu ditindaklanjuti</b>Operasional produksi berjalan normal.</div></div>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {v1Blocked.slice(0, 4).map((u) => (
                        <BarisTindakLanjut key={`v1-${u.id}`} data-testid="v1-attention" t={{ tingkat: "kritis", judul: DELAY_TITLE, unitCode: u.unitCode, orderNumber: u.order?.orderNumber || null, pelanggan: null, pemilik: "Tim produksi", rincian: "Pekerjaan tertunda — perlu dilanjutkan", to: unitDetailPath(u.id) }} />
                      ))}
                      {tindak.slice(0, 8).map((t, i) => <BarisTindakLanjut key={`${t.judul}-${t.unitCode}-${i}`} t={t} />)}
                    </ul>
                  )}
                  {offBoardMore && <p className="prod-catatan" data-testid="offboard-partial">Pekerjaan tertunda dibaca dari {orders.length} unit terbaru dari {offBoardTotal}; lihat Order produksi untuk semuanya.</p>}
                  {tindak.length > 8 && <p className="prod-catatan">+{tindak.length - 8} hal lainnya — lihat <Link to="/bengkel/production-v2">Status produksi</Link>.</p>}
                  <ReworkPelanggan />
                </div>
              </section>

              <div className="prod-kolom">
                <section className="prod-panel" data-testid="pic-card" aria-labelledby="prod-pic-judul">
                  <div className="prod-panel-kepala">
                    <span className="prod-ikon-ubin"><IkOrang size={22} /></span>
                    <h2 id="prod-pic-judul" className="prod-panel-judul">Pekerjaan hari ini</h2>
                    {summary.pic.length > 0 && <span className="prod-hitung">{summary.pic.length}</span>}
                  </div>
                  <div className="prod-panel-isi">
                    {summary.pic.length === 0 ? (
                      <div className="prod-kosong"><div><b>Belum ada PIC dengan unit aktif</b>Pekerjaan PIC muncul di sini setelah unit dijadwalkan.</div></div>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {summary.pic.map((p) => (
                          <li key={p.name} className="prod-pic">
                            <span className="prod-avatar" aria-hidden>{p.name.replace(/^QA-PV2\s+/, "").slice(0, 1).toUpperCase()}</span>
                            <div className="min-w-0"><p className="prod-pic-nama">{p.name}</p><p className="prod-pic-sub">{p.stationLabel || "—"}</p></div>
                            <p className="prod-pic-hitung"><span><b>{p.active}</b>aktif</span><span><b>{p.completedToday}</b>selesai</span></p>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link to="/bengkel/rencana-produksi" className="prod-tombol mt-3 w-full justify-between">Buka rencana produksi <IkPanahKanan size={14} /></Link>
                  </div>
                </section>
              {segmenTahap.length > 0 && (
                <section className="prod-panel" data-testid="pipeline-strip" aria-labelledby="prod-posisi-judul">
                  <div className="prod-panel-kepala">
                    <span className="prod-ikon-ubin"><IkTruk size={22} /></span>
                    <h2 id="prod-posisi-judul" className="prod-panel-judul">Posisi unit</h2>
                    <span className="ml-auto text-[14px] text-[var(--text-secondary)]">Posisi saat ini · unit</span>
                  </div>
                  <div className="prod-panel-isi">
                    <div className="prod-alur">
                      {tahapTampil.map((s) => {
                        const Ikon = s.off ? IkBaki : (IKON_TAHAP[s.key] || IkProses);
                        return (
                          <Link key={s.key} to={s.to} title={s.title} data-testid={s.off ? "offboard-segment" : undefined} className={`prod-tahap${s.count ? "" : " kosong"}${s.off ? " garis" : ""}`}>
                            <span className="prod-ikon-ubin"><Ikon size={22} /></span>
                            <div className="min-w-0"><p className="prod-tahap-nama">{s.label}</p><p className="prod-tahap-angka">{s.count}<small>unit</small></p></div>
                          </Link>
                        );
                      })}
                    </div>
                    {segmenTahap.length > TAHAP_AWAL && (
                      <button type="button" className="prod-tombol mt-3 w-full" aria-expanded={semuaTahap} onClick={() => setSemuaTahap((v) => !v)} data-testid="posisi-semua-tahap">
                        {semuaTahap ? "Ringkas tahap" : "Lihat semua tahap"} <ChevronDown size={16} className={semuaTahap ? "rotate-180" : undefined} aria-hidden />
                      </button>
                    )}
                  </div>
                </section>
              )}

              </div>
            </div>

            <section className="prod-panel" data-testid="jadwal-hari-ini" aria-labelledby="prod-jadwal-judul">
              <div className="prod-panel-kepala">
                <span className="prod-ikon-ubin"><IkJadwal size={22} /></span>
                <h2 id="prod-jadwal-judul" className="prod-panel-judul">Jadwal hari ini</h2>
                {jadwal.length > 0 && <span className="prod-hitung">{jadwal.length}</span>}
                <Link to="/bengkel/rencana-produksi" className="prod-tombol primer ml-auto">Buka rencana produksi</Link>
              </div>
              <div className="prod-panel-isi">
                {jadwal.length === 0 ? (
                  <div className="prod-kosong"><IkJadwal size={30} /><div><b>Belum ada unit dijadwalkan</b>Buka rencana produksi untuk menjadwalkan unit.</div></div>
                ) : (
                  <ul className="prod-jadwal">
                    {jadwal.map((j) => (
                      <li key={j.runId}>
                        <Link to={unitDetailPath(j.unitId)} className="prod-jadwal-baris">
                          <span className="prod-jadwal-meja">{j.meja || "Belum ada meja"}</span>
                          <span className="prod-jadwal-unit"><b>{j.pelanggan || j.unitCode}</b><span>{j.unitCode}</span></span>
                          <span className="prod-jadwal-pic">{j.pic || "PIC belum ditetapkan"}</span>
                          <span className="prod-jadwal-tahap">{j.tahap}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </PageContainer>
  );
}
