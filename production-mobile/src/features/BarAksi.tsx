import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { PackageX, Pause, Play } from "lucide-react-native";
import { catatLangkah, kunciNiat, lanjutkanPekerjaan } from "@/api/aksi";
import { pesanUntukPengguna } from "@/api/errors";
import { useLayout } from "@/api/production";
import type { RunCard } from "@/api/types";
import { useSession } from "@/auth/session";
import { aksiCepat, bolehCobaLagi, bolehLaporKurang, formulirDidukung, giliranSaya, labelAksi } from "./langkah";
import { Button, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// BATANG AKSI Detail Unit — SATU tombol utama sesuai `next` dari server (tidak ada tombol yang melewati aturan server):
//   RESUME              → Lanjutkan Pekerjaan (POST units/:unitId/resume-work)
//   START / continueOnly→ satu ketuk (POST steps/:stepNo, payload kosong)
//   tahap berisi bukti  → buka formulir tahap (foto/video + isian)
//   operasi berjalan    → tombol kedua "Tunda" (di dalamnya: Menunggu bahan → Lapor kurang bahan)
//   belum berjalan, tahap 3–8 → tombol kedua "Bahan kurang" (POST runs/:runId/material-shortage)
// Bukan giliran saya / menunggu QC dll → keterangan, tanpa tombol.

const TUNGGU: Record<string, string> = {
  AWAITING_QC: "Menunggu QC — petugas QC akan menguji unit ini.",
  PENDING_ARRIVAL: "Menunggu konfirmasi unit tiba di workshop.",
  MATERIAL_SHORTAGE: "Tertunda — menunggu bahan dari Gudang.",
  MATERIAL_NOT_READY: "Menunggu bahan disiapkan Gudang.",
  COMPLETED: "Produksi unit ini sudah selesai.",
};

export function BarAksi({ card, onBerubah }: { card: RunCard; onBerubah: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const userId = useSession((s) => s.user?.id);
  const l = useLayout();
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const next = card.next;
  const giliran = giliranSaya(card, userId, { lane: l.lane, executeAny: l.executeAny });
  const label = labelAksi(next, card.activeOp?.stageLabel);

  const setelah = async () => { await qc.invalidateQueries(); onBerubah(); };

  const satuKetuk = async () => {
    if (!next) return;
    setBusy(true); setGalat(null);
    const tahap = next.action === "RESUME" ? "resume" : next.stepNo ?? 0;
    const kunci = kunciNiat.untuk(card.runId, tahap, card.revision);
    try {
      if (next.action === "RESUME") await lanjutkanPekerjaan(card.unit.id, card.revision, kunci);
      else await catatLangkah({ runId: card.runId, revision: card.revision, workCenterId: card.workCenterId }, next.stepNo ?? 0, {}, [], kunci);
      kunciNiat.lepas(card.runId, tahap, card.revision);
      await setelah();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunciNiat.lepas(card.runId, tahap, card.revision);
      setGalat(pesanUntukPengguna(e));
      onBerubah();
    } finally { setBusy(false); }
  };

  if (!next) return null;

  if (!giliran) {
    const teks = next.action === "WAIT" ? TUNGGU[next.wait ?? ""] ?? "Menunggu tahap sebelumnya." : "Tahap berikutnya milik tim/PIC lain.";
    // Menunggu bahan disiapkan Gudang: PIC Meja rencana ini tetap boleh melaporkan bahan yang kurang (cermin canShortage web).
    const picMeja = l.lane && (l.executeAny || (!!userId && card.plan?.operator?.userId === userId));
    const kurang = next.wait === "MATERIAL_NOT_READY" && picMeja && bolehLaporKurang(card, "TABLE");
    return (
      <Wadah>
        <T.Sub style={{ textAlign: "center", color: C.ink2 }}>{teks}</T.Sub>
        {kurang ? (
          <Button kind="tinted" tone="red" icon={<PackageX color={TONE.red.text} size={18} />} label="Bahan kurang" onPress={() => router.push({ pathname: "/kurang-bahan/[runId]", params: { runId: card.runId } })} />
        ) : null}
      </Wadah>
    );
  }

  const cepat = next.action === "RESUME" || aksiCepat(next);
  const dukung = cepat ? { ok: true as const } : formulirDidukung(card, next);
  const bisaTunda = card.activeOp?.status === "ACTIVE";
  const dijeda = card.activeOp?.status === "PAUSED" || card.activeOp?.status === "BLOCKED";
  const bisaKurang = !bisaTunda && bolehLaporKurang(card, giliran);

  return (
    <Wadah>
      {next.rework ? <T.Sub style={{ color: TONE.orange.text }}>Uji tekstur belum PAS — sesuaikan lapisan lalu kirim ulang bukti.</T.Sub> : null}
      {dijeda && card.activeOp?.delayKind ? <T.Sub style={{ color: TONE.red.text }}>Tertunda{card.activeOp.delayNote ? ` — ${card.activeOp.delayNote}` : ""}. Tekan Lanjutkan setelah kendalanya selesai.</T.Sub> : null}
      {galat ? <T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub> : null}
      {!online && cepat ? <T.Caption style={{ textAlign: "center" }}>Offline — aksi dikirim saat sinyal kembali.</T.Caption> : null}
      {!dukung.ok ? <T.Sub style={{ color: TONE.blue.text, textAlign: "center" }}>{dukung.alasan}</T.Sub> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {bisaTunda ? (
          <Button kind="tinted" tone="orange" icon={<Pause color={TONE.orange.text} size={18} fill={TONE.orange.text} />} label="Tunda" onPress={() => router.push({ pathname: "/tunda/[runId]", params: { runId: card.runId } })} style={{ flex: 1 }} />
        ) : bisaKurang ? (
          <Button kind="tinted" tone="red" icon={<PackageX color={TONE.red.text} size={18} />} label="Bahan kurang" onPress={() => router.push({ pathname: "/kurang-bahan/[runId]", params: { runId: card.runId } })} style={{ flex: 1 }} />
        ) : null}
        {dukung.ok && label ? (
          <Button
            kind={cepat && next.action !== "RESUME" ? "primary" : "success"}
            icon={cepat ? <Play color="#fff" size={18} fill="#fff" /> : undefined}
            label={label}
            busy={busy}
            disabled={cepat && !online}
            onPress={cepat ? () => void satuKetuk() : next.stepNo === 5
              ? () => router.push({ pathname: "/diagnosa/[runId]", params: { runId: card.runId } })
              : () => router.push({ pathname: "/langkah/[runId]", params: { runId: card.runId } })}
            style={{ flex: bisaTunda || bisaKurang ? 2 : 1 }}
          />
        ) : null}
      </View>
    </Wadah>
  );
}

function Wadah({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, gap: 8, backgroundColor: C.barBg, borderTopWidth: 1, borderTopColor: C.barLine }}>
      {children}
    </View>
  );
}
