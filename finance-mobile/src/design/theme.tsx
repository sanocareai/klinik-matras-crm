import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Platform, useColorScheme } from "react-native";
import * as Device from "expo-device";
import { colors, type Colors, type Scheme } from "./tokens";
import { pickGlassTier, type GlassTier } from "./glass";
import { usePrefs } from "./prefs";

export type Theme = {
  scheme: Scheme;
  isDark: boolean;
  colors: Colors;
  glassTier: GlassTier;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const sistem = useColorScheme();
  const { theme: pref, efekRingan } = usePrefs();
  const [kurangiGerak, setKurangiGerak] = useState(false);

  useEffect(() => {
    let batal = false;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (!batal) setKurangiGerak(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setKurangiGerak);
    return () => { batal = true; sub.remove(); };
  }, []);

  const scheme: Scheme = pref === "system" ? (sistem === "light" ? "light" : "dark") : pref;

  const glassTier = useMemo(
    () => pickGlassTier({
      androidApi: Platform.OS === "android" ? Number(Platform.Version) || 0 : 0,
      totalMemoryBytes: Device.totalMemory ?? null,
      efekRingan,
      kurangiGerak,
    }),
    [efekRingan, kurangiGerak],
  );

  const value = useMemo<Theme>(
    () => ({ scheme, isDark: scheme === "dark", colors: colors[scheme], glassTier }),
    [scheme, glassTier],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("useTheme harus dipakai di dalam <ThemeProvider>");
  return t;
}
