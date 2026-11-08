import React from "react";
import { angka, formatPersen } from "../../akuisisiLogic.js";
import { KEADAAN_SINKRON, hookRateTampil, waktuWibTeks } from "../../sinkronMetaLogic.js";

// Status sinkronisasi spend Meta (baca-saja). Tanpa data = "—", bukan nol. Nama konfigurasi yang kurang boleh tampil; nilainya tidak pernah dikirim server.
const Baris = ({ a, b }) => <div className="flex items-baseline justify-between gap-3 border-b border-line/50 py-1.5 last:border-0"><dt className="t-secondary text-[12.5px]">{a}</dt><dd className="m-0 text-right text-[13px] font-medium tabular-nums text-ink">{b}</dd></div>;
const WARNA = { ok: "text-green", info: "text-ink2", perhatian: "text-orange", galat: "text-red" };

export default function StatusSinkronMeta({ s }) {
  if (!s) return null;
  if (s.galatStatus !== undefined) {
    return <p className="text-[13px] text-ink2" role="status" data-testid="status-sinkron-meta" data-keadaan="TIDAK_TERBACA">{s.galatStatus === 403 || s.galatStatus === 401 ? "Status sinkronisasi hanya untuk ADMIN." : "Status sinkronisasi gagal dimuat."}</p>;
  }
  const k = KEADAAN_SINKRON[s.keadaan] || { label: s.keadaan ?? "Tidak diketahui", nada: "info" };
  const t = s.terakhirDicoba; const h = hookRateTampil(s.hookRate);
  return (
    <dl className="m-0" data-testid="status-sinkron-meta" data-keadaan={s.keadaan}>
      <h4 className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[13px] font-semibold text-ink">Sinkronisasi spend Meta <span className={`text-[12.5px] ${WARNA[k.nada]}`} data-testid="keadaan-sinkron">{k.label}</span></h4>
      {(s.konfigurasiKurang?.length ?? 0) > 0 && <p className="mb-1 text-[12px] text-orange">Konfigurasi belum ada: {s.konfigurasiKurang.join(", ")}</p>}
      <Baris a="Terakhir dicoba" b={t ? `${waktuWibTeks(t.waktu)} · ${t.status}` : "Belum pernah berjalan"} />
      <Baris a="Terakhir sukses" b={waktuWibTeks(s.terakhirSukses?.waktu)} />
      <Baris a="Data lengkap sampai" b={s.dataLengkapSampai ?? "—"} />
      <Baris a="Selisih kontrol" b={t?.selisihSpend ?? "—"} />
      <Baris a="Ad belum terpetakan" b={t?.unmapped ?? "—"} />
      <Baris a="Hari belum direkonsiliasi" b={angka(s.hariBelumRekonsiliasi?.length ?? 0)} />
      {t?.alasanGagal && <Baris a="Alasan gagal" b={t.alasanGagal} />}
      <Baris a="Hook rate (3 detik ÷ impressions video)" b={h.teks} />
      {h.coverage !== null && <Baris a="Coverage metrik video" b={formatPersen(h.coverage)} />}
      {h.versi && <p className="t-secondary mt-1 text-[11.5px]" data-testid="hook-definisi">Definisi {h.versi}. Jangan dibandingkan dengan angka berpenyebut lain.</p>}
    </dl>
  );
}
