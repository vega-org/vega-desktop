import React, { useState, useEffect } from "react";
import { settingsStorage } from "../../lib/storage";
import { open } from "@tauri-apps/plugin-dialog";
import {
  LuFolderOpen as FolderOpen,
  LuTrash2 as Trash2,
  LuCheck as Check,
} from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { useDownloadStore } from "../../lib/zustand/downloadStore";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { CustomSelect } from "../CustomSelect";
import { syncFromSharedFolder } from "../../lib/sync/syncService";
import { clearAppCache } from "../../lib/clearAppCache";

const QUALITIES = ["360p", "480p", "720p", "1080p", "4k"];

export const PreferencesSettings: React.FC = () => {
  const [downloadLocation, setDownloadLocation] = useState<string>("vega");
  const [excludedQualities, setExcludedQualities] = useState<string[]>([]);
  const [autoInstallUpdates, setAutoInstallUpdates] = useState<boolean>(true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true);
  const [tvModeEnabled, setTvModeEnabled] = useState<boolean>(false);
  const [devtoolsShortcutsEnabled, setDevtoolsShortcutsEnabled] =
    useState<boolean>(false);
  const [dohEnabled, setDohEnabled] = useState<boolean>(true);
  const [dohProvider, setDohProvider] = useState<string>("cloudflare");
  const [dohCustomUrl, setDohCustomUrl] = useState<string>("");
  const [downloadConcurrency, setDownloadConcurrency] = useState<number>(2);
  const [tmdbApiKey, setTmdbApiKey] = useState<string>("");
  const [tmdbKeySaved, setTmdbKeySaved] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  useEffect(() => {
    setDownloadLocation(settingsStorage.getDownloadLocation());
    setExcludedQualities(settingsStorage.getExcludedQualities());
    setAutoInstallUpdates(settingsStorage.isAutoDownloadEnabled());
    setAutoCheckUpdates(settingsStorage.isAutoCheckUpdateEnabled());
    setTvModeEnabled(settingsStorage.isTvModeEnabled());
    setDevtoolsShortcutsEnabled(settingsStorage.areDevtoolsShortcutsEnabled());
    setDohEnabled(settingsStorage.isDohEnabled());
    setDohProvider(settingsStorage.getDohProvider());
    setDohCustomUrl(settingsStorage.getDohCustomUrl());
    setDownloadConcurrency(settingsStorage.getDownloadConcurrency());
    setTmdbApiKey(settingsStorage.getTmdbApiKey());
  }, []);

  const handleChangeDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === "string") {
        setDownloadLocation(selected);
        settingsStorage.setDownloadLocation(selected);
        syncFromSharedFolder().catch((err) =>
          console.warn("[VegaSync] Folder change sync failed:", err),
        );
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const handleResetDir = () => {
    setDownloadLocation("vega");
    settingsStorage.resetDownloadLocation();
    syncFromSharedFolder().catch((err) =>
      console.warn("[VegaSync] Folder reset sync failed:", err),
    );
  };

  const handleToggleQuality = (quality: string) => {
    const updated = excludedQualities.includes(quality)
      ? excludedQualities.filter((q) => q !== quality)
      : [...excludedQualities, quality];

    setExcludedQualities(updated);
    settingsStorage.setExcludedQualities(updated);
  };

  const handleToggleAutoInstall = () => {
    const nextState = !autoInstallUpdates;
    setAutoInstallUpdates(nextState);
    settingsStorage.setAutoDownloadEnabled(nextState);
  };

  const handleToggleAutoCheck = () => {
    const nextState = !autoCheckUpdates;
    setAutoCheckUpdates(nextState);
    settingsStorage.setAutoCheckUpdateEnabled(nextState);
  };

  const handleToggleTvMode = () => {
    const nextState = !tvModeEnabled;
    setTvModeEnabled(nextState);
    settingsStorage.setTvModeEnabled(nextState);
  };

  const handleToggleDevtoolsShortcuts = () => {
    const nextState = !devtoolsShortcutsEnabled;
    setDevtoolsShortcutsEnabled(nextState);
    settingsStorage.setDevtoolsShortcutsEnabled(nextState);
  };

  const handleToggleDoh = () => {
    const nextState = !dohEnabled;
    setDohEnabled(nextState);
    settingsStorage.setDohEnabled(nextState);
  };

  const handleChangeDohProvider = (val: string) => {
    setDohProvider(val);
    settingsStorage.setDohProvider(val);
  };

  const handleChangeDohCustomUrl = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDohCustomUrl(val);
    settingsStorage.setDohCustomUrl(val);
  };

  const isAndroid = navigator.userAgent.toLowerCase().includes("android");

  const updateDownloadConcurrency = (value: number) => {
    const next = Math.min(Math.max(value, 1), 5);
    setDownloadConcurrency(next);
    settingsStorage.setDownloadConcurrency(next);
    useDownloadStore.getState().scheduleDownloads();
  };

  const saveTmdbApiKey = () => {
    settingsStorage.setTmdbApiKey(tmdbApiKey);
    setTmdbApiKey(settingsStorage.getTmdbApiKey());
    setTmdbKeySaved(true);
    window.setTimeout(() => setTmdbKeySaved(false), 1800);
  };

  const clearTmdbApiKey = () => {
    setTmdbApiKey("");
    settingsStorage.setTmdbApiKey("");
    setTmdbKeySaved(false);
  };

  const handleClearCache = async () => {
    await clearAppCache();
    setCacheCleared(true);
    window.setTimeout(() => setCacheCleared(false), 2000);
  };

  return (
    <div className="preferences-settings">
      {/* Download Directory */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Download Directory</h3>
          <p className="body-md text-muted" style={{ wordBreak: "break-all" }}>
            {isAndroid
              ? "Internal App Storage (Recommended for Android)"
              : downloadLocation === "vega"
                ? "Default (Documents/VegaDownloads)"
                : downloadLocation}
          </p>
        </div>
        {!isAndroid && (
          <div style={{ display: "flex", gap: "8px" }}>
            <FocusableButton
              className="theme-toggle-btn active"
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
              onClick={handleChangeDir}
            >
              <FolderOpen size={16} /> Change
            </FocusableButton>
            {downloadLocation !== "vega" && (
              <FocusableButton
                className="theme-toggle-btn"
                onClick={handleResetDir}
              >
                Reset
              </FocusableButton>
            )}
          </div>
        )}
      </div>

      <div className="settings-divider" />

      {/* Concurrent Downloads */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Concurrent Downloads</h3>
          <p className="body-md text-muted">
            Extra downloads wait in a FIFO queue. Default is 2.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <FocusableButton
            className="theme-toggle-btn"
            disabled={downloadConcurrency <= 1}
            onClick={() => updateDownloadConcurrency(downloadConcurrency - 1)}
          >
            -
          </FocusableButton>
          <span style={{ minWidth: "28px", textAlign: "center" }}>
            {downloadConcurrency}
          </span>
          <FocusableButton
            className="theme-toggle-btn"
            disabled={downloadConcurrency >= 5}
            onClick={() => updateDownloadConcurrency(downloadConcurrency + 1)}
          >
            +
          </FocusableButton>
        </div>
      </div>

      <div className="settings-divider" />

      {/* Auto Install Updates */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Auto Install App Updates</h3>
          <p className="body-md text-muted">
            Automatically download and install new versions of Vega
          </p>
        </div>
        <Switch
          checked={autoInstallUpdates}
          onCheckedChange={() => handleToggleAutoInstall()}
          aria-label="Automatically install updates"
        />
      </div>

      <div className="settings-divider" />

      {/* Auto Check Updates */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Auto Check for Updates</h3>
          <p className="body-md text-muted">Check for updates on app startup</p>
        </div>
        <Switch
          checked={autoCheckUpdates}
          onCheckedChange={() => handleToggleAutoCheck()}
          aria-label="Automatically check for updates"
        />
      </div>

      <div className="settings-divider" />

      {/* TV Mode */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">TV / Controller Mode</h3>
          <p className="body-md text-muted">
            Enable arrow-key spatial navigation for remotes and gamepads
            (Requires app restart)
          </p>
        </div>
        <Switch
          checked={tvModeEnabled}
          onCheckedChange={() => handleToggleTvMode()}
          aria-label="Enable TV mode"
        />
      </div>

      <div className="settings-divider" />

      {/* Developer Tools Shortcuts */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Developer Tools Shortcuts</h3>
          <p className="body-md text-muted">
            Allow F12 or Ctrl+Shift+I to toggle developer tools
          </p>
        </div>
        <Switch
          checked={devtoolsShortcutsEnabled}
          onCheckedChange={() => handleToggleDevtoolsShortcuts()}
          aria-label="Enable developer shortcuts"
        />
      </div>

      <div className="settings-divider" />

      {/* TMDB API Key */}
      <div className="settings-row" style={{ alignItems: "flex-start" }}>
        <div className="settings-info">
          <h3 className="label-lg">TMDB API Key</h3>
          <p className="body-md text-muted">
            Optional custom key for Story metadata. It overrides the bundled
            environment key.
          </p>
        </div>
        <div className="tmdb-key-control">
          <Input
            type="password"
            autoComplete="off"
            aria-label="Custom TMDB API key"
            placeholder={
              import.meta.env.VITE_TMDB_API_KEY
                ? "Using bundled key"
                : "Enter TMDB API key"
            }
            value={tmdbApiKey}
            onChange={(event) => {
              setTmdbApiKey(event.target.value);
              setTmdbKeySaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                saveTmdbApiKey();
              }
            }}
            onBlur={() => {
              if (
                tmdbApiKey.trim() &&
                tmdbApiKey.trim() !== settingsStorage.getTmdbApiKey()
              ) {
                saveTmdbApiKey();
              }
            }}
            className="tmdb-key-input"
          />
          <div className="tmdb-key-actions">
            <FocusableButton
              className="theme-toggle-btn active"
              onClick={saveTmdbApiKey}
            >
              {tmdbKeySaved ? "Saved" : "Save"}
            </FocusableButton>
            {settingsStorage.getTmdbApiKey() && (
              <FocusableButton
                className="theme-toggle-btn"
                onClick={clearTmdbApiKey}
              >
                Clear
              </FocusableButton>
            )}
          </div>
        </div>
      </div>

      <div className="settings-divider" />

      {/* DNS over HTTPS */}
      <div className="settings-row" style={{ alignItems: "flex-start" }}>
        <div className="settings-info">
          <h3 className="label-lg">DNS over HTTPS</h3>
          <p className="body-md text-muted">
            Bypass ISP DNS blocking for movie providers
          </p>
        </div>
        <div className="settings-stacked-control">
          <Switch
            checked={dohEnabled}
            onCheckedChange={() => handleToggleDoh()}
            aria-label="Enable secure DNS"
          />

          {dohEnabled && (
            <div className="doh-settings-fields">
              <CustomSelect
                value={dohProvider}
                onChange={handleChangeDohProvider}
                options={[
                  { value: "cloudflare", label: "Cloudflare (1.1.1.1)" },
                  { value: "google", label: "Google (8.8.8.8)" },
                  { value: "adguard", label: "AdGuard" },
                  { value: "custom", label: "Custom URL" },
                ]}
                className="doh-provider-select"
              />

              {dohProvider === "custom" && (
                <Input
                  type="text"
                  placeholder="https://dns.example.com/dns-query"
                  value={dohCustomUrl}
                  onChange={handleChangeDohCustomUrl}
                  aria-label="Custom DNS over HTTPS URL"
                  className="doh-custom-url"
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="settings-divider" />

      {/* Excluded Qualities */}
      <div className="settings-row">
        <div className="settings-info" style={{ width: "100%" }}>
          <h3 className="label-lg">Excluded Qualities</h3>
          <p className="body-md text-muted" style={{ marginBottom: "8px" }}>
            Select qualities you want to hide from playback and downloads.
          </p>

          <div
            className="quality-options"
            role="group"
            aria-label="Excluded playback qualities"
          >
            {QUALITIES.map((q) => {
              const isExcluded = excludedQualities.includes(q);
              return (
                <FocusableButton
                  key={q}
                  className={`quality-option ${isExcluded ? "active" : ""}`}
                  onClick={() => handleToggleQuality(q)}
                  aria-pressed={isExcluded}
                  title={isExcluded ? "Click to Include" : "Click to Exclude"}
                >
                  {q}
                </FocusableButton>
              );
            })}
          </div>
        </div>
      </div>

      <div className="settings-divider" />

      {/* Clear App Cache */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Clear App Cache</h3>
          <p className="body-md text-muted">
            Remove all cached home page catalogs, metadata, and temporary data.
          </p>
        </div>
        <FocusableButton
          className={`theme-toggle-btn ${cacheCleared ? "active" : ""}`}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
          onClick={handleClearCache}
        >
          {cacheCleared ? (
            <>
              <Check size={16} /> Cleared
            </>
          ) : (
            <>
              <Trash2 size={16} /> Clear Cache
            </>
          )}
        </FocusableButton>
      </div>
    </div>
  );
};
