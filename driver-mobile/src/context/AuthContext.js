// Context autentikasi — pola SAMA dengan mobile/src/context/AuthContext.js
// (Sano Messenger), TANPA socket.js (driver app tidak butuh realtime chat).
import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, configureApi, DEFAULT_SERVER } from "../api";
import { registerForPush, unregisterPush } from "../push";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [server, setServer] = useState(DEFAULT_SERVER);

  useEffect(() => {
    (async () => {
      try {
        const [savedToken, savedUser, savedServer] = await Promise.all([
          AsyncStorage.getItem("token"),
          AsyncStorage.getItem("user"),
          AsyncStorage.getItem("server"),
        ]);
        const srv = savedServer || DEFAULT_SERVER;
        setServer(srv);
        configureApi({
          server: srv,
          jwt: savedToken,
          unauthorizedHandler: () => setUser(null),
        });
        if (savedToken && savedUser) {
          const parsedUser = JSON.parse(savedUser);
          setUser(parsedUser);
          registerForPush(parsedUser);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email, password, serverUrl) {
    const srv = (serverUrl || DEFAULT_SERVER).replace(/\/+$/, "");
    configureApi({ server: srv });
    const res = await api.login(email.trim(), password);
    configureApi({ jwt: res.token });
    await Promise.all([
      AsyncStorage.setItem("token", res.token),
      AsyncStorage.setItem("user", JSON.stringify(res.user)),
      AsyncStorage.setItem("server", srv),
    ]);
    setServer(srv);
    setUser(res.user);
    registerForPush(res.user);
  }

  async function logout() {
    await unregisterPush();
    await AsyncStorage.multiRemove(["token", "user"]);
    configureApi({ jwt: null });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, server, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
