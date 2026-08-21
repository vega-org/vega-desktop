import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import { tauriAxiosAdapter } from "./lib/providers/tauriAxiosAdapter";
import "./styles/index.css";
import App from "./App";

// Force all axios requests across the application to route through the Tauri Rust backend
// bypassing browser CORS and enabling DoH / TLS emulation.
axios.defaults.adapter = tauriAxiosAdapter;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
