import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { client } from "./lib/client";
import { Layout } from "./components/layout/Layout";
import { WindowControls } from "./components/layout/WindowControls";
import { ExtensionsPage } from "./pages/ExtensionsPage";
import { HomePage } from "./pages/HomePage";
import { MetaPage } from "./pages/MetaPage";
import { SearchPage } from "./pages/SearchPage";
import { PlayerPage } from "./pages/PlayerPage";
import { WafDialog } from "./components/WafDialog";
import useThemeStore from "./lib/zustand/themeStore";
import { settingsStorage } from "./lib/storage";
import { useAppUpdater } from "./lib/hooks/useAppUpdater";
import { initDownloadListeners } from "./lib/zustand/downloadStore";
import { DownloadsPage } from "./pages/DownloadsPage";
import { DownloadsSeriesPage } from "./pages/DownloadsSeriesPage";
import { WatchlistPage } from "./pages/WatchlistPage";
import { CatalogPage } from "./pages/CatalogPage";
import { SettingsPage } from "./pages/SettingsPage";
import { updateProvidersService } from "./lib/services/UpdateProviders";
import { init as initNavigation } from "@noriginmedia/norigin-spatial-navigation-core";
import { invoke } from "@tauri-apps/api/core";
import {
  initializeSyncService,
  publishSyncManifest,
  syncFromSharedFolder,
} from "./lib/sync/syncService";

import { applyThemeTokens } from "./lib/theme";
import { ToastContainer } from "./components/ui/ToastContainer";

let isNavInitialized = false;

export default function App() {
  initDownloadListeners();
  useAppUpdater();

  const { primary } = useThemeStore();
  const tvMode = settingsStorage.isTvModeEnabled();

  useEffect(() => {
    initializeSyncService().catch((error) =>
      console.warn("[VegaSync] Startup sync failed:", error),
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncFromSharedFolder().catch((error) =>
          console.warn("[VegaSync] Foreground sync failed:", error),
        );
      } else {
        publishSyncManifest().catch((error) =>
          console.warn("[VegaSync] Background publish failed:", error),
        );
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        syncFromSharedFolder().catch((error) =>
          console.warn("[VegaSync] Periodic sync failed:", error),
        );
      }
    }, 30000);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (tvMode && !isNavInitialized) {
      initNavigation({
        debug: false,
        visualDebug: false,
        distanceCalculationMethod: "corners",
      });
      isNavInitialized = true;
    }
  }, [tvMode]);

  useEffect(() => {
    const handleDevtoolsShortcut = (event: KeyboardEvent) => {
      const isDevtoolsShortcut =
        event.key === "F12" ||
        (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "i");

      if (!isDevtoolsShortcut) return;

      event.preventDefault();
      event.stopPropagation();

      if (!settingsStorage.areDevtoolsShortcutsEnabled()) return;

      invoke("toggle_devtools").catch((error) =>
        console.error("Failed to toggle developer tools:", error),
      );
    };

    window.addEventListener("keydown", handleDevtoolsShortcut, true);
    return () =>
      window.removeEventListener("keydown", handleDevtoolsShortcut, true);
  }, []);

  useEffect(() => {
    // Start auto provider updates on boot
    updateProvidersService.startAutomaticUpdateCheck();

    applyThemeTokens(primary);
  }, [primary]);

  return (
    <QueryClientProvider client={client}>
      <WafDialog />
      <ToastContainer />
      <BrowserRouter>
        <WindowControls />
        <Routes>
          {/* Player is outside Layout since it needs fullscreen without sidebar */}
          <Route path="player" element={<PlayerPage />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="content/:url" element={<MetaPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/watchlist/content/:url" element={<MetaPage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route
              path="/downloads/series/:showName"
              element={<DownloadsSeriesPage />}
            />
            <Route path="extensions" element={<ExtensionsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
