import React, { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { kirimJadwal, usePapan, useRefsJadwal, useSasaranJadwal } from "@/api/jadwal";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import {
  ALASAN_JADWAL_ULANG, KODE_BASI, PRIORITAS, formAwal, kapasitas, labelMeja, opsiLini, perintahJadwal, perluAlasanUlang, validasiJadwal, type FormJadwal,
} from "@/features/jadwal";
import { bolehCobaLagi } from "@/features/langkah";
import { kodePendek } from "@/features/model";
import { CentangBaris, Isian, PilihanChip } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Chip, Screen, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";
import { deretHari } from "@/lib/waktu";

// JADWAL — rencanakan unit ke meja, atau ubah jadwal kartu yang sudah di papan. Kontrak & aturan = ScheduleModal web
// (lihat src/features/jadwal.ts). Kapasitas, lini PIC, revisi, dan aktivasi tetap diputuskan server.
// Tidak diubah dari HP: target khusus per kartu (tetap seperti yang tersimpan), pendaftaran operator baru.
export default function Jadwal() {
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const { sasaran: s, tanggal } = useSasaranJadwal();
  const refs = useRefsJadwal(!!s);
  // Hanya isian yang DIUBAH pengguna disimpan; sisanya bawaan (formAwal, sama dengan web) — dihitung saat render, bukan di effect.
  const [ubah, setUbah] = useState<Partial<FormJadwal>>({});
  const tanggalAktif = ubah.productionDate ?? s?.plan?.productionDate ?? tanggal ?? "";
  const papan = usePapan(tanggalAktif, !!tanggalAktif);
  const stations = useMemo(() => papan.data?.stations ?? [], [papan.data]);
  const [busy, setBusy] = useState<"simpan" | "keluar" | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(`pm-jadwal-${randomUUID()}`);
  const set = (patch: Partial<FormJadwal>) => { setUbah((x) => ({ ...x, ...patch })); kunci.current = `pm-jadwal-${randomUUID()}`; };

  const f = useMemo<FormJadwal | null>(() => {
    if (!s || !tanggal || !papan.data || !refs.data) return null;
    const isi = { ...formAwal(s, { tanggal, stations, refs: refs.data }), ...ubah };
    // Pindah tanggal → meja terpilih bisa penuh di tanggal itu: pakai meja yang masih lega (kecuali meja rencana ini sendiri).
    const cur = stations.find((m) => m.code === isi.stationCode);
    const milikSendiri = isi.stationCode === s.plan?.stationCode && isi.productionDate === s.plan?.productionDate;
    if (cur && kapasitas(cur).penuh && !milikSendiri) {
      const alt = stations.find((m) => !kapasitas(m).penuh);
      if (alt) isi.stationCode = alt.code;
    }
    return isi;
  }, [s, tanggal, papan.data, refs.data, stations, ubah]);

  const hari = useMemo(() => deretHari(8, 0), []);
  const mejaDipilih = stations.find((m) => m.code === f?.stationCode) ?? null;
  const picBawaan = mejaDipilih?.defaultPic ?? null;
  const opsiMeja = f && refs.data ? opsiLini(refs.data.operators, "TABLE", s?.plan?.operator ?? null) : [];
  const opsiCorner = f && refs.data ? opsiLini(refs.data.operators, "CORNER", s?.plan?.cornerOperator ?? null) : [];

  if (!s) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Screen lembar header={<NavBar judul="Jadwal" />}><StateView kind="empty" title="Pilih unit dari tab Target" /></Screen>
      </View>
    );
  }

  const kirim = async (keluarkan: boolean) => {
    if (!f) return;
    const salah = keluarkan ? null : validasiJadwal(s, f, picBawaan);
    if (salah) { setGalat(salah); return; }
    setBusy(keluarkan ? "keluar" : "simpan"); setGalat(null);
    try {
      await kirimJadwal(perintahJadwal(s, f, keluarkan), `${kunci.current}${keluarkan ? "-keluar" : ""}`);
      await qc.invalidateQueries();
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-jadwal-${randomUUID()}`;
      setGalat(pesanUntukPengguna(e));
      if (e instanceof ApiError && KODE_BASI.includes(e.code ?? "")) void papan.refetch();
    } finally { setBusy(null); }
  };

  const siap = !!f && !!refs.data && !!papan.data;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen lembar header={<NavBar judul={s.plan?.stationCode ? "Ubah Jadwal" : "Rencanakan"} kembali="Batal" />} bottomPad={40}>
        <Card style={{ gap: 4 }}>
          <T.Title>{kodePendek(s.unitCode)}</T.Title>
          <T.Sub>{s.customer || "—"}{s.plan?.stationCode ? ` · sekarang ${labelMeja(s.plan.stationCode)}, ${s.plan.productionDate}` : " · belum dijadwalkan"}</T.Sub>
          {s.komplain ? <Chip label="Komplain — prioritaskan" tone="red" style={{ marginTop: 4 }} /> : null}
        </Card>

        {refs.isLoading || papan.isLoading ? <StateView kind="loading" title="Memuat meja & PIC…" /> : null}
        {refs.error ? <StateView kind="error" title="Daftar PIC tidak bisa dimuat" text={pesanUntukPengguna(refs.error)} onRetry={() => void refs.refetch()} /> : null}
        {(refs.data?.problems ?? []).filter((p) => p.severity !== "info").map((p) => (
          <Card key={p.code} style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>{p.message}</T.Sub></Card>
        ))}

        {siap && f ? (
          <>
            <PilihanChip label="Tanggal produksi" options={hari.map((h) => ({ value: h.kunci, label: `${h.hari3} ${h.tgl}` }))} value={[f.productionDate]} onChange={(v) => v[0] && set({ productionDate: v[0] })} />

            <PilihanChip
              label="Meja bongkar"
              options={stations.map((m) => { const k = kapasitas(m); return { value: m.code, label: `${m.label} · ${k.label}${k.penuh ? " penuh" : ""}` }; })}
              value={[f.stationCode]}
              onChange={(v) => {
                const m = stations.find((x) => x.code === v[0]);
                const milikSendiri = v[0] === s.plan?.stationCode && f.productionDate === s.plan?.productionDate;
                if (m && kapasitas(m).penuh && !milikSendiri) { setGalat(`${m.label} sudah penuh pada tanggal ini.`); return; }
                if (v[0]) { setGalat(null); set({ stationCode: v[0] }); }
              }}
            />

            <PilihanChip label="Prioritas" options={PRIORITAS} value={[String(f.priority) as "0" | "1"]} onChange={(v) => v[0] && set({ priority: Number(v[0]) as 0 | 1 })} />

            {refs.data!.workCenters.length > 1 ? (
              <PilihanChip label="Workshop" options={refs.data!.workCenters.map((w) => ({ value: w.id, label: w.name }))} value={[f.workCenterId]} onChange={(v) => v[0] && set({ workCenterId: v[0] })} />
            ) : null}

            <PilihanChip
              label="PIC meja (bongkar & restorasi)"
              options={[
                { value: "", label: picBawaan?.active ? `Ikuti ${picBawaan.name} (bawaan)` : s.plan?.operator?.name ? `Tetap ${s.plan.operator.name}` : "Belum ada bawaan" },
                ...opsiMeja.map((o) => ({ value: o.id, label: o.lama ? `${o.name} (belum berlini)` : o.name })),
              ]}
              value={[f.operatorId]}
              onChange={(v) => set({ operatorId: v[0] ?? "" })}
            />
            {f.operatorId && picBawaan?.active && f.operatorId !== picBawaan.operatorId ? <T.Caption style={{ marginHorizontal: 4, color: TONE.orange.text }}>Berbeda dari PIC bawaan meja — hanya untuk order ini.</T.Caption> : null}

            <PilihanChip
              label="PIC Corner & Finishing (opsional)"
              options={[{ value: "", label: "Belum ditetapkan" }, ...opsiCorner.map((o) => ({ value: o.id, label: o.lama ? `${o.name} (belum berlini)` : o.name }))]}
              value={[f.cornerOperatorId]}
              onChange={(v) => set({ cornerOperatorId: v[0] ?? "" })}
            />

            {s.plan?.targetMissed ? (
              <Card style={{ backgroundColor: TONE.red.tint, gap: 10 }}>
                <T.Headline style={{ color: TONE.red.text }}>Lewat Target — {s.plan.targetEffective ?? s.plan.productionDate}</T.Headline>
                {perluAlasanUlang(s, f) ? (
                  <>
                    <PilihanChip label="Alasan jadwal ulang (wajib)" options={ALASAN_JADWAL_ULANG} value={f.alasanUlang ? [f.alasanUlang as (typeof ALASAN_JADWAL_ULANG)[number]["value"]] : []} onChange={(v) => set({ alasanUlang: v[0] ?? "" })} />
                    <Isian label="Catatan (wajib, minimal 5 huruf)" value={f.catatanUlang} onChange={(t) => set({ catatanUlang: t })} multiline />
                  </>
                ) : <T.Sub>Pilih tanggal produksi baru untuk menjadwalkan ulang; alasan akan diminta.</T.Sub>}
              </Card>
            ) : null}

            {s.tanyaAktivasi && !s.plan ? (
              <Card style={{ backgroundColor: TONE.orange.tint, gap: 8 }}>
                <T.Sub style={{ color: TONE.orange.text }}>Unit ini belum diaktifkan untuk Rencana Produksi. Menyimpan akan mengaktifkannya lalu menjadwalkannya.</T.Sub>
                <CentangBaris label="Ya, aktifkan unit ini dan jadwalkan" value={f.aktivasiOk} onChange={(v) => set({ aktivasiOk: v })} />
              </Card>
            ) : null}

            {s.tanyaCorner && !s.plan ? (
              <View style={{ gap: 8 }}>
                <PilihanChip label="Corner diperlukan? (kain/jahit)" options={[{ value: "YES", label: "Ya, diperlukan" }, { value: "NO", label: "Tidak diperlukan" }] as const} value={f.corner ? [f.corner] : []} onChange={(v) => set({ corner: (v[0] ?? "") as FormJadwal["corner"] })} />
                {f.corner === "NO" ? <Isian label="Alasan Corner tidak diperlukan" value={f.alasanCorner} onChange={(t) => set({ alasanCorner: t })} placeholder="mis. tidak ada pekerjaan kain/jahit" /> : null}
                {s.masalahProduk ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>Jenis produk perlu dikonfirmasi: {s.masalahProduk}. Jadwal tetap bisa disimpan.</T.Sub></Card> : null}
              </View>
            ) : null}

            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
            <Button label={s.plan?.stationCode ? "Simpan jadwal" : "Jadwalkan"} onPress={() => void kirim(false)} busy={busy === "simpan"} disabled={!online || !!busy} />
            {s.plan?.stationCode ? <Button label="Keluarkan dari papan" kind="danger" onPress={() => void kirim(true)} busy={busy === "keluar"} disabled={!online || !!busy} /> : null}
            {!online ? <T.Caption style={{ textAlign: "center" }}>Offline — simpan saat sinyal kembali.</T.Caption> : null}
            <T.Caption style={{ textAlign: "center", marginHorizontal: 12 }}>Kapasitas meja & PIC diperiksa server. Hasilnya langsung tampil di HP tim, SANSS Web, dan Andon TV.</T.Caption>
          </>
        ) : null}
      </Screen>
    </View>
  );
}
