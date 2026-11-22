import { lazy, Suspense, useEffect } from "react";
import {isTauriRuntime} from "./platform/host";
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
const AppRouter = import.meta.env.VITE_TV_HOST ? HashRouter : BrowserRouter;
import { client } from "./lib/client";
import { Layout } from "./components/layout/Layout";
import { WindowControls, isWindowsPlatform } from "./components/layout/WindowControls";
import { ExtensionsPage } from "./pages/ExtensionsPage";
import { HomePage } from "./pages/HomePage";
import { MetaPage } from "./pages/MetaPage";
import { SearchPage } from "./pages/SearchPage";
import { AnimatedHourglass } from "./components/AnimatedHourglass";
import { WafDialog } from "./components/WafDialog";
import { VerificationConsentDialog } from "./components/VerificationConsentDialog";
import { AppUpdateDialog } from "./components/updater/AppUpdateDialog";
import { BrowserExtensionPermissionPrompt } from "./components/extensions/BrowserExtensionPrompt";
import useThemeStore from "./lib/zustand/themeStore";
import { settingsStorage } from "./lib/storage";
import { useAppUpdater } from "./lib/hooks/useAppUpdater";
import { initDownloadListeners } from "./lib/zustand/downloadStore";
import { DownloadsPage } from "./pages/DownloadsPage";
import { DownloadsSeriesPage } from "./pages/DownloadsSeriesPage";
import { LibraryPage } from "./pages/LibraryPage";
import { CatalogPage } from "./pages/CatalogPage";
import { SettingsPage } from "./pages/SettingsPage";
import { updateProvidersService } from "./lib/services/UpdateProviders";
import {
  init as initNavigation,
  setFocus,
  doesFocusableExist,
} from "@noriginmedia/norigin-spatial-navigation-core";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  initializeSyncService,
  publishSyncManifest,
  syncFromSharedFolder,
} from "./lib/sync/syncService";

import { applyThemeTokens } from "./lib/theme";
import { ToastContainer } from "./components/ui/ToastContainer";
import { useGamepadNavigation } from "./lib/hooks/useGamepadNavigation";
import { ModalFocusProvider } from "./lib/context/ModalFocusContext";
import { cleanupAllStreamTorrents } from "./lib/services/torrentStreamService";
import { syncProxySettings } from "./lib/services/proxyService";
import {
  setPendingSourceToken,
  subscribeSourceIntent,
} from "./lib/services/sourceIntent";

let isNavInitialized = false;

// The player and its media engines are only needed after playback starts.
const PlayerPage = lazy(() => import("./pages/PlayerPage").then(module => ({
  default: module.PlayerPage,
})));

// Opens Extensions with the add source dialog prefilled from the Android add
// source intent. The user still confirms there, so another app or web page
// cannot add a source silently.
function SourceIntentHandler() {
  const navigate = useNavigate();

  useEffect(
    () =>
      subscribeSourceIntent((payload) => {
        const requestId = Date.now();
        setPendingSourceToken(requestId, payload.token);
        navigate("/extensions", {
          state: { addSource: payload.url, requestId },
        });
      }),
    [navigate],
  );

  return null;
}

export default function App() {
  initDownloadListeners();
  useAppUpdater();
  useGamepadNavigation();

  const { primary } = useThemeStore();

  useEffect(() => {
    // Keep an escape route even when fullscreen was entered outside the player.
    // Player/menu handlers run first and mark the keys they handled.
    const handleWindowShortcut = (event: KeyboardEvent) => {
      if (!isTauriRuntime()) return;
      if (event.defaultPrevented || event.repeat) return;
      if (event.key !== "F11" && event.key !== "Escape") return;
      const toggle = event.key === "F11";
      event.preventDefault();
      void (async () => {
        const win = getCurrentWindow();
        const fullscreen = await win.isFullscreen();
        if (!toggle && !fullscreen) return;
        const next = toggle && !fullscreen;
        await win.setFullscreen(next);
        if (!next && !isWindowsPlatform()) await win.setDecorations(true);
      })().catch((error) => console.warn("Window shortcut failed:", error));
    };
    window.addEventListener("keydown", handleWindowShortcut);
    return () => window.removeEventListener("keydown", handleWindowShortcut);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    settingsStorage.syncStreamDoh();
    syncProxySettings();
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
    const handleBeforeUnload = () => {
      cleanupAllStreamTorrents().catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!isNavInitialized) {
      initNavigation({
        debug: false,
        visualDebug: false,
        distanceCalculationMethod: "corners",
      });
      isNavInitialized = true;
      (window as any).__setFocus = setFocus;
      (window as any).__doesFocusableExist = doesFocusableExist;
    }
  }, []);

  useEffect(() => {
    const handleDevtoolsShortcut = (event: KeyboardEvent) => {
      if (!isTauriRuntime()) return;
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
    // This is an app, not a web page: hide the browser's own menu (Back,
    // Refresh, Print, Inspect) and its shortcuts. Text fields keep their
    // cut/copy/paste menu. With developer shortcuts on, everything stays.
    if (!isTauriRuntime()) return;
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest("input, textarea, [contenteditable='true']") !== null);
    const browserShortcuts = new Set(["r", "p", "s", "u", "f", "g", "h", "j"]);

    const handleContextMenu = (event: MouseEvent) => {
      if (settingsStorage.areDevtoolsShortcutsEnabled()) return;
      if (isEditable(event.target)) return;
      event.preventDefault();
    };
    const handleBrowserShortcut = (event: KeyboardEvent) => {
      if (settingsStorage.areDevtoolsShortcutsEnabled()) return;
      const key = event.key.toLowerCase();
      const ctrl = event.ctrlKey || event.metaKey;
      if (key === "f5" || (ctrl && browserShortcuts.has(key))) {
        // Only stop the browser action; app handlers (e.g. Ctrl+S in the
        // player) still receive the event.
        event.preventDefault();
      }
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleBrowserShortcut);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleBrowserShortcut);
    };
  }, []);

  useEffect(() => {
    // Start auto provider updates on boot
    updateProvidersService.startAutomaticUpdateCheck();

    applyThemeTokens(primary);
  }, [primary]);

  const isWindows = isWindowsPlatform();

  useEffect(() => {
    document.body.classList.toggle("platform-windows", isWindows);
  }, [isWindows]);

  return (
    <ModalFocusProvider>
      <QueryClientProvider client={client}>
        <WafDialog />
        <VerificationConsentDialog />
        <AppUpdateDialog />
        <BrowserExtensionPermissionPrompt />
        <ToastContainer />
        <AppRouter>
          <SourceIntentHandler />
          {isWindows && <WindowControls />}
          <Routes>
            {/* Player is outside Layout since it needs fullscreen without sidebar */}
            <Route path="player" element={
              <Suspense fallback={
                <div role="status" aria-label="Loading player" style={{position:'fixed',inset:0,display:'grid',placeItems:'center',background:'#000',zIndex:100}}>
                  <AnimatedHourglass />
                </div>
              }>
                <PlayerPage />
              </Suspense>
            } />
            <Route path="/" element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="content/:url" element={<MetaPage />} />
              <Route path="/catalog" element={<CatalogPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/watchlist" element={<LibraryPage />} />
              <Route path="/watchlist/content/:url" element={<MetaPage />} />
              <Route path="/downloads" element={isTauriRuntime() ? <DownloadsPage /> : <Navigate to="/watchlist" replace />} />
              <Route
                path="/downloads/series/:showName"
                element={isTauriRuntime() ? <DownloadsSeriesPage /> : <Navigate to="/watchlist" replace />}
              />
              <Route path="extensions" element={<ExtensionsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AppRouter>
      </QueryClientProvider>
    </ModalFocusProvider>
  );
}
