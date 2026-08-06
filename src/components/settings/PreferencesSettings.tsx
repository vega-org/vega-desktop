import React, { useState, useEffect } from "react";
import { settingsStorage } from "../../lib/storage";
import { open } from "@tauri-apps/plugin-dialog";
import { LuFolderOpen as FolderOpen } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { useDownloadStore } from "../../lib/zustand/downloadStore";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { CustomSelect } from "../CustomSelect";

const QUALITIES = ["360p", "480p", "720p", "1080p", "4k"];

export const PreferencesSettings: React.FC = () => {
  const [downloadLocation, setDownloadLocation] = useState<string>("vega");
  const [excludedQualities, setExcludedQualities] = useState<string[]>([]);
  const [autoInstallUpdates, setAutoInstallUpdates] = useState<boolean>(true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true);
  const [tvModeEnabled, setTvModeEnabled] = useState<boolean>(false);
  const [showSeekButtons, setShowSeekButtons] = useState<boolean>(true);
  const [hwAccelEnabled, setHwAccelEnabled] = useState<boolean>(false);
  const [devtoolsShortcutsEnabled, setDevtoolsShortcutsEnabled] =
    useState<boolean>(false);
  const [dohEnabled, setDohEnabled] = useState<boolean>(true);
  const [dohProvider, setDohProvider] = useState<string>("cloudflare");
  const [dohCustomUrl, setDohCustomUrl] = useState<string>("");
  const [downloadConcurrency, setDownloadConcurrency] = useState<number>(2);
  const [tmdbApiKey, setTmdbApiKey] = useState<string>("");
  const [tmdbKeySaved, setTmdbKeySaved] = useState(false);
  const [externalPlayerEnabled, setExternalPlayerEnabled] = useState(false);
  const [vlcEnabled, setVlcEnabled] = useState(false);
  const [vlcPath, setVlcPath] = useState("");

  useEffect(() => {
    setDownloadLocation(settingsStorage.getDownloadLocation());
    setExcludedQualities(settingsStorage.getExcludedQualities());
    setAutoInstallUpdates(settingsStorage.isAutoDownloadEnabled());
    setAutoCheckUpdates(settingsStorage.isAutoCheckUpdateEnabled());
    setTvModeEnabled(settingsStorage.isTvModeEnabled());
    setShowSeekButtons(!settingsStorage.hideSeekButtons());
    setHwAccelEnabled(settingsStorage.isHardwareAccelerationEnabled());
    setDevtoolsShortcutsEnabled(settingsStorage.areDevtoolsShortcutsEnabled());
    setDohEnabled(settingsStorage.isDohEnabled());
    setDohProvider(settingsStorage.getDohProvider());
    setDohCustomUrl(settingsStorage.getDohCustomUrl());
    setDownloadConcurrency(settingsStorage.getDownloadConcurrency());
    setTmdbApiKey(settingsStorage.getTmdbApiKey());
    setExternalPlayerEnabled(settingsStorage.isExternalPlayerEnabled());
    setVlcEnabled(settingsStorage.isVlcEnabled());
    setVlcPath(settingsStorage.getVlcPath());
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
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const handleResetDir = () => {
    setDownloadLocation("vega");
    settingsStorage.resetDownloadLocation();
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

  const handleToggleSeekButtons = (enabled: boolean) => {
    setShowSeekButtons(enabled);
    settingsStorage.setHideSeekButtons(!enabled);
  };

  const handleToggleHwAccel = () => {
    const nextState = !hwAccelEnabled;
    setHwAccelEnabled(nextState);
    settingsStorage.setHardwareAccelerationEnabled(nextState);
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

  const handleChangeVlcPath = async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        filters: navigator.userAgent.toLowerCase().includes("windows")
          ? [{ name: "VLC executable", extensions: ["exe"] }]
          : undefined,
      });
      if (selected && typeof selected === "string") {
        setVlcPath(selected);
        settingsStorage.setVlcPath(selected);
      }
    } catch (err) {
      console.error("Failed to select VLC executable:", err);
    }
  };

  const handleResetVlcPath = () => {
    settingsStorage.resetVlcPath();
    setVlcPath(settingsStorage.getVlcPath());
  };

  const handleToggleVlc = (enabled: boolean) => {
    setVlcEnabled(enabled);
    settingsStorage.setVlcEnabled(enabled);
  };

  const handleToggleExternalPlayer = (enabled: boolean) => {
    setExternalPlayerEnabled(enabled);
    settingsStorage.setExternalPlayerEnabled(enabled);
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

      {isAndroid && (
        <>
          <div className="settings-row">
            <div className="settings-info">
              <h3 className="label-lg">External Player</h3>
              <p className="body-md text-muted">
                Show Android&apos;s app chooser for network streams instead of
                playing them inside Vega.
              </p>
            </div>
            <Switch
              checked={externalPlayerEnabled}
              onCheckedChange={handleToggleExternalPlayer}
              aria-label="Use an external player"
            />
          </div>
          <div className="settings-divider" />
        </>
      )}

      {!isAndroid && (
        <>
          <div className="settings-row">
            <div className="settings-info">
              <h3 className="label-lg">VLC Player</h3>
              <p className="body-md text-muted">
                Open the selected server directly in VLC instead of Vega's
                player.
              </p>
            </div>
            <Switch
              checked={vlcEnabled}
              onCheckedChange={handleToggleVlc}
              aria-label="Use VLC as the external player"
            />
          </div>
          {vlcEnabled && (
            <div className="settings-row">
              <div className="settings-info">
                <h3 className="label-lg">VLC Path</h3>
                <p
                  className="body-md text-muted"
                  style={{ wordBreak: "break-all" }}
                >
                  {vlcPath}
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <FocusableButton
                  className="theme-toggle-btn active"
                  onClick={handleChangeVlcPath}
                >
                  <FolderOpen size={16} /> Change
                </FocusableButton>
                {vlcPath !== settingsStorage.getDefaultVlcPath() && (
                  <FocusableButton
                    className="theme-toggle-btn"
                    onClick={handleResetVlcPath}
                  >
                    Reset
                  </FocusableButton>
                )}
              </div>
            </div>
          )}
          <div className="settings-divider" />
        </>
      )}

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

      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Player Seek Buttons</h3>
          <p className="body-md text-muted">
            Show 10-second rewind and forward buttons in the player
          </p>
        </div>
        <Switch
          checked={showSeekButtons}
          onCheckedChange={handleToggleSeekButtons}
          aria-label="Show player seek buttons"
        />
      </div>

      <div className="settings-divider" />

      {/* Hardware Acceleration */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Hardware Acceleration</h3>
          <p className="body-md text-muted">
            Use GPU to decode video. Turn off if you experience playback issues.
          </p>
        </div>
        <Switch
          checked={hwAccelEnabled}
          onCheckedChange={() => handleToggleHwAccel()}
          aria-label="Enable hardware acceleration"
        />
      </div>

      <div className="settings-divider" />

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
                Use bundled
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
    </div>
  );
};
