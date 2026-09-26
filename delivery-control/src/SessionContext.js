import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { controlModules, deliveryExpenseAbilities } from "@sano/delivery-shared";
import { sessionManager, setUnauthorizedHandler } from "./client";

const Ctx = createContext(null);

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null));
    sessionManager.restore().then(setSession).catch(() => setSession(null)).finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email, password) => {
    const s = await sessionManager.signIn(email.trim(), password);
    setSession(s);
  }, []);
  const signOut = useCallback(async () => {
    await sessionManager.signOut();
    setSession(null);
  }, []);

  const value = useMemo(() => ({
    loading, session, signIn, signOut,
    user: session?.user || null,
    capabilities: session?.capabilities || null,
    abilities: deliveryExpenseAbilities(session?.capabilities),
    modules: controlModules(session?.capabilities),
    offline: !!session?.offline,
  }), [loading, session, signIn, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}
