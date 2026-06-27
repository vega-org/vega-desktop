import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { client } from './lib/client';
import { Layout } from './components/layout/Layout';
import { ExtensionsPage } from './pages/ExtensionsPage';
import { HomePage } from './pages/HomePage';
import { MetaPage } from './pages/MetaPage';
import { SearchPage } from './pages/SearchPage';
import { PlayerPage } from './pages/PlayerPage';
import { WafDialog } from './components/WafDialog';
import useThemeStore from './lib/zustand/themeStore';
import { settingsStorage } from './lib/storage';
import { useAppUpdater } from './lib/hooks/useAppUpdater';
import { initDownloadListeners } from './lib/zustand/downloadStore';
import { DownloadsPage } from './pages/DownloadsPage';
import { DownloadsSeriesPage } from './pages/DownloadsSeriesPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { CatalogPage } from './pages/CatalogPage';
import { SettingsPage } from './pages/SettingsPage';
import { updateProvidersService } from './lib/services/UpdateProviders';
import { init as initNavigation } from '@noriginmedia/norigin-spatial-navigation-core';

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 178, 190';
}

let isNavInitialized = false;

export default function App() {
  initDownloadListeners();
  useAppUpdater();

  const { primary, themeBackground } = useThemeStore();
  const tvMode = settingsStorage.isTvModeEnabled();

  useEffect(() => {
    if (tvMode && !isNavInitialized) {
      initNavigation({
        debug: false,
        visualDebug: false,
        distanceCalculationMethod: 'corners',
      });
      isNavInitialized = true;
    }
  }, [tvMode]);

  useEffect(() => {
    // Start auto provider updates on boot
    updateProvidersService.startAutomaticUpdateCheck();

    // Apply background theme
    document.documentElement.setAttribute('data-theme', themeBackground);

    // Apply primary accent color
    const root = document.documentElement;
    root.style.setProperty('--primary', primary);
    root.style.setProperty('--primary-rgb', hexToRgb(primary));

    // For simplicity, we make the primary container a slightly transparent version of primary
    // Or we could calculate a darkened/lightened version. Using rgba is easiest:
    root.style.setProperty('--primary-container', `rgba(${hexToRgb(primary)}, 0.2)`);
    root.style.setProperty('--on-primary-container', primary);
  }, [primary, themeBackground]);

  return (
    <QueryClientProvider client={client}>
      <WafDialog />
      <BrowserRouter>
        <Routes>
          {/* Player is outside Layout since it needs fullscreen without sidebar */}
          <Route path="player" element={<PlayerPage />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="content/:url" element={<MetaPage />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route path="/downloads/series/:showName" element={<DownloadsSeriesPage />} />
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
