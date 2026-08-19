import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, PackageCheck, Truck, Wallet } from "lucide-react";
import { api } from "../api.js";
import { formatRupiah } from "../utils/format.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { WorkspaceHero } from "@/components/ui/workspace-hero.jsx";
import { Card, CardHeader, CardTitle } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";

function currentRoles() {
  try {
    return JSON.parse(localStorage.getItem("user"))?.roles || [];
  } catch {
    return [];
  }
}

const PAYMENT_METHOD_LABEL = { CASH: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS" };

// Pembayaran Driver (D-011) — rekonsiliasi finance. Bagian ini SENGAJA
// punya loading/error state SENDIRI, terpisah dari overview di atas:
// PAYMENT_READ cuma dipegang ADMIN+FINANCE (bukan semua yang boleh buka
// Kendali secara permission granular), jadi kalau endpoint ini 403 untuk
// suatu akun, sisa halaman tetap harus jalan normal.
function PaymentReconciliation() {
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState("");
  const [verifyingId, setVerifyingId] = useState(null);
  const canVerify = currentRoles().includes("FINANCE");

  const load = useCallback(() => {
    api.getPayments().then(setPayments).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleVerify(id) {
    setVerifyingId(id);
    try {
      await api.verifyPayment(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifyingId(null);
    }
  }

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Pembayaran Driver</CardTitle></CardHeader>
        <p className="text-[13px] text-red">{error}</p>
      </Card>
    );
  }
  if (!payments) {
    return (
      <Card>
        <CardHeader><CardTitle>Pembayaran Driver</CardTitle></CardHeader>
        <div className="flex items-center gap-2 py-6 text-ink2">
          <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-[13px]">Memuat…</span>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Pembayaran Driver</CardTitle></CardHeader>
      {payments.length === 0 ? (
        <EmptyState icon={Wallet} title="Belum ada pembayaran tercatat" description="Muncul di sini begitu driver mencatat penerimaan di stop pengiriman." />
      ) : (
        <div className="flex flex-col gap-2">
          {payments.map((p) => {
            const verified = p.verifications?.length > 0;
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-btn bg-inset px-4 py-3">
                <div className="min-w-[160px] flex-1">
                  <div className="text-[13px] font-semibold text-ink">{formatRupiah(p.amount)}</div>
                  <div className="text-[12px] text-ink2">
                    {p.order?.orderNumber || "—"} · {p.order?.customer?.name || "—"} · dicatat {p.recordedBy?.name || "—"}
                    {p.job?.type && <span> · {p.job.type === "PICKUP" ? "saat ambil" : "saat kirim"}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="neutral">{PAYMENT_METHOD_LABEL[p.method] || p.method}</Badge>
                  {verified ? (
                    <Badge variant="green">Terverifikasi</Badge>
                  ) : canVerify ? (
                    <Button className="h-8 px-3 text-xs" disabled={verifyingId === p.id} onClick={() => handleVerify(p.id)}>
                      {verifyingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verifikasi"}
                    </Button>
                  ) : (
                    <Badge variant="orange">Belum Diverifikasi</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// KENDALI — dashboard ringkasan lintas portal (PRD §7.7, FR-C). Sano Hub Phase 1.
//
// Setiap angka di sini SUDAH diverifikasi jujur dari backend (kendali.js):
// cycle time mengecualikan durasi retrospektif (NULL), unit terblokir
// diturunkan dari ledger (bukan kolom status), dan dua metrik yang PRD minta
// tapi tidak bisa dihitung (unit berisiko lewat tanggal janji, on-time
// delivery rate) ditampilkan sebagai catatan eksplisit, BUKAN disembunyikan.

const UNIT_STATUS_LABEL = {
  AWAITING_PICKUP: "Menunggu Pengambilan",
  IN_TRANSIT_IN: "Dalam Perjalanan (Masuk)",
  RECEIVED: "Diterima",
  IN_PRODUCTION: "Dalam Pengerjaan",
  READY_FOR_DELIVERY: "Siap Kirim",
  READY_ON_CUSTOMER_HOLD: "Siap, Ditunda Customer",
  IN_TRANSIT_OUT: "Dalam Perjalanan (Kirim)",
  DELIVERED: "Terkirim",
  CANCELLED: "Dibatalkan",
};

const JOB_TYPE_LABEL = { PICKUP: "Pengambilan", DELIVERY: "Pengiriman" };

function formatDurasi(seconds) {
  if (seconds == null) return "—";
  const menit = Math.round(seconds / 60);
  if (menit < 60) return `${menit} mnt`;
  const jam = Math.floor(menit / 60);
  const sisaMenit = menit % 60;
  return sisaMenit ? `${jam} jam ${sisaMenit} mnt` : `${jam} jam`;
}

function relatifWaktu(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const jam = Math.floor(diffMs / 3_600_000);
  if (jam < 1) return "< 1 jam lalu";
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  return `${hari} hari lalu`;
}

// StatCard DIHAPUS (redesign SANSS, 1 Agustus 2026) — keempat KPI-nya pindah
// ke WorkspaceHero di bawah. Komponen ini juga membangun class Tailwind secara
// dinamis (`bg-${tone}bg`) yang TIDAK PERNAH bisa dilihat compiler Tailwind,
// jadi warnanya sebagian memang tidak pernah benar-benar ter-generate.

// ─── KESIAPAN OPERASIONAL ────────────────────────────────────────────────
// Menjawab "apa yang masih kurang sebelum Bengkel/Armada/Gudang bisa dipakai
// kerja?" — lihat catatan panjang di backend #GET /kendali/kesiapan.
//
// SENGAJA MENGHILANG SENDIRI kalau semua prasyarat sudah terpenuhi DAN
// sistem sudah benar-benar dipakai. Checklist yang isinya centang hijau
// semua tiap hari akan berhenti dibaca orang; begitu berhenti dibaca, dia
// tidak berguna lagi saat suatu saat benar-benar ada yang merah.
// State sendiri (bukan ikut /overview) supaya kalau endpoint ini gagal,
// sisa halaman Kendali tetap tampil normal.
function KesiapanOperasional() {
  const [k, setK] = useState(null);

  useEffect(() => {
    let batal = false;
    api.getKendaliKesiapan()
      .then((d) => !batal && setK(d))
      .catch(() => {}); // diam-diam: ini panel bantu, bukan konten utama Kendali
    return () => { batal = true; };
  }, []);

  if (!k) return null;
  if (k.siap && k.aktivitas.pernahDipakai) return null;

  const belum = k.butir.filter((b) => !b.siap);
  const perModul = belum.reduce((acc, b) => {
    (acc[b.modul] ||= []).push(b);
    return acc;
  }, {});

  return (
    <Card className="border-l-4 border-l-orange">
      <CardHeader>
        <CardTitle>
          {k.siap ? "Siap dipakai — belum ada aktivitas tercatat" : `Kesiapan Operasional — ${k.jumlahBelumSiap} hal belum siap`}
        </CardTitle>
      </CardHeader>

      {k.siap ? (
        <p className="text-[13px] leading-relaxed text-ink2">
          Semua prasyarat sudah terpenuhi, tapi belum ada satu pun unit yang masuk produksi,
          job pengiriman, atau pergerakan stok. Angka nol di dashboard ini <strong>wajar</strong> untuk
          sistem yang baru mau mulai — bukan tanda ada yang rusak.
        </p>
      ) : (
        <>
          <p className="mb-3 text-[13px] leading-relaxed text-ink2">
            Selama hal di bawah ini belum dibereskan, tombol aksi di modul terkait akan{" "}
            <strong>ditolak (403)</strong> — dan di layar gejalanya cuma terlihat seperti
            “tidak terjadi apa-apa”, bukan pesan error yang jelas.
          </p>
          <div className="flex flex-col gap-3">
            {Object.entries(perModul).map(([modul, items]) => (
              <div key={modul}>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">{modul}</div>
                <div className="flex flex-col gap-1.5">
                  {items.map((b) => (
                    <div key={b.nama} className="rounded-btn bg-inset px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTriangle size={13} className="shrink-0 text-orange" />
                        <span className="text-[13px] font-semibold text-ink">{b.nama}</span>
                        <span className="text-[11px] text-ink3">({b.nilai})</span>
                      </div>
                      {b.catatan && <p className="mt-0.5 text-[12px] leading-relaxed text-ink2">{b.catatan}</p>}
                      {b.aksi && <p className="mt-0.5 text-[11.5px] text-accent">→ {b.aksi}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Denyut operasional — BUKAN prasyarat, sekadar menjawab "sudah benar-
          benar dipakai belum". Ditampilkan juga saat semua sudah siap. */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2.5 text-[11.5px] text-ink3">
        <span>{k.aktivitas.unitSedangDikerjakan} unit sedang dikerjakan</span>
        <span>{k.aktivitas.unitBelumMasukProduksi} unit belum masuk produksi</span>
        <span>{k.aktivitas.totalJob} job pengiriman</span>
        <span>{k.aktivitas.totalPergerakanStok} pergerakan stok</span>
      </div>
    </Card>
  );
}

export default function Kendali() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let batal = false;
    api
      .getKendaliOverview()
      .then((d) => !batal && setData(d))
      .catch((err) => !batal && setError(err.message));
    return () => {
      batal = true;
    };
  }, []);

  if (error) {
    return (
      <PageContainer>
        <EmptyState icon={AlertTriangle} title="Gagal memuat Kendali" description={error} />
      </PageContainer>
    );
  }

  if (!data) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center gap-2 py-16 text-ink2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Memuat ringkasan…</span>
        </div>
      </PageContainer>
    );
  }

  const { units, cycleTime, jobFailures, rework, driverActivity, unavailable } = data;

  return (
    <PageContainer>
      <PageHeader
        title="All Teams Dashboard"
        subtitle="Executive overview lintas sales, produksi, warehouse, dan delivery."
      />

      {/* Command center — KPI yang SEBELUMNYA berupa 4 StatCard polos dipindah
          ke sini, BUKAN diduplikasi: menampilkan angka yang sama dua kali di
          satu layar cuma bikin orang ragu mana yang benar. Angka & sumbernya
          persis sama (endpoint /kendali/overview), hanya wadahnya yang baru.
          "Rework rate" tetap bisa "—" kalau backend belum punya cukup data —
          itu perilaku lama yang sengaja dipertahankan, jangan diisi angka. */}
      <div className="mb-5">
        <WorkspaceHero
          tone="violet"
          title="Dashboard command center"
          subtitle="Ringkasan lintas divisi — bengkel, armada, dan kualitas — dalam satu tampilan."
          health={
            units.blocked.length > 0
              ? { label: `${units.blocked.length} unit terblokir`, tone: "warn" }
              : { label: "Operasional sehat", tone: "ok" }
          }
          stats={[
            { label: "Total unit aktif", value: units.totalUnits, hint: "di seluruh tahap" },
            { label: "Unit terblokir", value: units.blocked.length, hint: "butuh tindakan" },
            {
              label: "Rework rate QC",
              value: rework.reworkRate == null ? "—" : `${Math.round(rework.reworkRate * 100)}%`,
              hint: rework.reworkRate == null ? "data belum cukup" : "dari QC tercatat",
            },
            {
              label: "Job driver hari ini",
              value: driverActivity.reduce((n, d) => n + d.completed + d.failed, 0),
              hint: "selesai + gagal",
            },
          ]}
        />
      </div>

      <PageBody>

        {/* Paling atas dengan sengaja: kalau ada prasyarat yang belum siap,
            itu menjelaskan KENAPA angka-angka di bawahnya nol — percuma
            menatap grafik kosong tanpa tahu penyebabnya. */}
        <KesiapanOperasional />

        {/* Unit per status */}
        <Card>
          <CardHeader>
            <CardTitle>Unit per Status</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap gap-3">
            {Object.entries(units.byStatus).length === 0 ? (
              <p className="text-[13px] text-ink2">Belum ada unit.</p>
            ) : (
              Object.entries(units.byStatus).map(([status, count]) => (
                <div key={status} className="rounded-btn bg-inset px-4 py-2">
                  <div className="text-[18px] font-bold text-ink">{count}</div>
                  <div className="text-[12px] text-ink2">{UNIT_STATUS_LABEL[status] || status}</div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Unit terblokir */}
        <Card>
          <CardHeader>
            <CardTitle>Unit Terblokir</CardTitle>
          </CardHeader>
          {units.blocked.length === 0 ? (
            <EmptyState icon={PackageCheck} title="Tidak ada unit terblokir" description="Semua unit berjalan normal di tahapnya masing-masing." />
          ) : (
            <div className="flex flex-col gap-2">
              {units.blocked.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-btn bg-inset px-4 py-3">
                  <div className="min-w-[140px] flex-1">
                    <div className="text-[13px] font-semibold text-ink">{b.unitCode}</div>
                    <div className="text-[12px] text-ink2">Tahap: {b.stageLabel} — {relatifWaktu(b.blockedSince)}</div>
                  </div>
                  <Badge variant="red" className="shrink-0">{b.blockReason || "Tanpa alasan"}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Cycle time per tahap */}
        <Card>
          <CardHeader>
            <CardTitle>Waktu Pengerjaan per Tahap</CardTitle>
          </CardHeader>
          {cycleTime.length === 0 ? (
            <EmptyState title="Belum ada data terukur" description="Cycle time hanya dihitung dari pencatatan real-time, belum ada yang cukup." />
          ) : (
            <div className="flex flex-col gap-2">
              {cycleTime.map((c) => (
                <div key={c.stageCode} className="flex items-center justify-between gap-3 rounded-btn bg-inset px-4 py-3">
                  <div className="text-[13px] font-semibold text-ink">{c.stageLabel}</div>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] text-ink2">{c.sampleCount} sampel</span>
                    <span className="text-[14px] font-bold text-ink">{formatDurasi(c.avgSeconds)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Alasan kegagalan job */}
          <Card>
            <CardHeader>
              <CardTitle>Alasan Kegagalan Kunjungan</CardTitle>
            </CardHeader>
            {jobFailures.length === 0 ? (
              <EmptyState icon={Truck} title="Tidak ada kegagalan" description="Semua kunjungan pickup/delivery berhasil." />
            ) : (
              <div className="flex flex-col gap-2">
                {jobFailures.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-btn bg-inset px-4 py-3">
                    <div>
                      <Badge variant="neutral">{JOB_TYPE_LABEL[f.type] || f.type}</Badge>
                      <span className="ml-2 text-[13px] text-ink">{f.reason || "Tanpa alasan"}</span>
                    </div>
                    <span className="text-[14px] font-bold text-ink">{f.count}×</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Aktivitas driver hari ini */}
          <Card>
            <CardHeader>
              <CardTitle>Aktivitas Driver Hari Ini</CardTitle>
            </CardHeader>
            {driverActivity.length === 0 ? (
              <EmptyState icon={Truck} title="Belum ada aktivitas" description="Belum ada job pickup/delivery yang selesai atau gagal hari ini." />
            ) : (
              <div className="flex flex-col gap-2">
                {driverActivity.map((d) => (
                  <div key={d.driverId} className="flex items-center justify-between gap-3 rounded-btn bg-inset px-4 py-3">
                    <span className="text-[13px] font-semibold text-ink">{d.driverName}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="green">{d.completed} selesai</Badge>
                      {d.failed > 0 && <Badge variant="red">{d.failed} gagal</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <PaymentReconciliation />

        {/* Belum bisa dihitung — jujur, bukan disembunyikan */}
        {unavailable && (
          <Card className="bg-inset">
            <CardHeader>
              <CardTitle>Belum Bisa Dihitung</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-1.5 text-[13px] text-ink2">
              {Object.entries(unavailable).map(([key, note]) => (
                <li key={key}>• {note}</li>
              ))}
            </ul>
          </Card>
        )}
      </PageBody>
    </PageContainer>
  );
}
