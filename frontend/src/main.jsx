import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient.js";
import App from "./App.jsx";
import "./index.css";
// Tailwind (utilities-only, preflight off — lihat komentar di file ini)
// dipakai HALAMAN BARU yang migrasi bertahap (mulai dari Laporan), tidak
// menyentuh styling halaman lama yang masih 100% index.css.
import "./styles/tailwind.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
