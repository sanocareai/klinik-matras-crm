import React, { useEffect, useRef } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useTheme } from "@/design/theme";
import { useLock } from "@/auth/lock";
import { useSession } from "@/auth/session";
import { KunciPanel } from "./KunciPanel";
import { PinSetup } from "./PinSetup";

// GERBANG KUNCI — membungkus seluruh aplikasi.
//   • PIN belum dibuat (atau alur pengaturan awal berjalan) → PinSetup (tidak bisa dilewati).
//   • Terkunci (cold start / background melewati batas) → KunciPanel (mode kunci).
//   • Saat app ke background isi layar langsung ditutup (`cover`), sebelum sistem mengambil cuplikan.
//   • Aksi sensitif yang meminta step-up → KunciPanel (mode stepup) di atas layar.
// Lapisan-lapisan ini opaque dan menutup penuh, sehingga isi keuangan tidak terlihat maupun terjangkau.

const JEDA_REFRESH_ME_MS = 60_000;

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const status = useSession((s) => s.status);
  const ready = useLock((s) => s.ready);
  const pinSet = useLock((s) => s.pinSet);
  const locked = useLock((s) => s.locked);
  const cover = useLock((s) => s.cover);
  const setupBaru = useLock((s) => s.setupBaru);
  const stepUpOpen = useLock((s) => s.stepUpOpen);
  const terakhirRefresh = useRef(0);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      const lock = useLock.getState();
      if (s === "background") {
        lock.appToBackground();
      } else if (s === "active") {
        lock.appToForeground();
        void lock.refreshBiometric();
        const t = Date.now();
        if (t - terakhirRefresh.current > JEDA_REFRESH_ME_MS) {
          terakhirRefresh.current = t;
          void useSession.getState().refreshMe(); // izin bisa berubah selama app tidak dipakai
        }
      }
    });
    return () => sub.remove();
  }, []);

  const masuk = status === "signedIn" && ready;
  const perluSetup = masuk && (!pinSet || setupBaru);
  const kunci = masuk && !perluSetup && locked;
  const tutup = masuk && !perluSetup && !locked && cover;

  return (
    <View style={{ flex: 1 }}>
      {children}
      {perluSetup ? <Lapisan><PinSetup /></Lapisan> : null}
      {kunci ? <Lapisan><KunciPanel mode="kunci" /></Lapisan> : null}
      {tutup ? <Lapisan><View style={{ flex: 1, backgroundColor: colors.bgBottom }} /></Lapisan> : null}
      {masuk && stepUpOpen && !kunci && !perluSetup ? (
        <Lapisan>
          <KunciPanel
            mode="stepup"
            onBerhasil={() => useLock.getState().resolveStepUp(true)}
            onBatal={() => useLock.getState().resolveStepUp(false)}
          />
        </Lapisan>
      ) : null}
    </View>
  );
}

function Lapisan({ children }: { children: React.ReactNode }) {
  return <View style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }]}>{children}</View>;
}
