import React, { useState, useEffect } from "react";
import { settingsStorage } from "../../lib/storage";
import { open } from "@tauri-apps/plugin-dialog";
import { 
  LuFolderOpen as FolderOpen,
  LuFolder,
  LuLayers,
  LuCloudDownload,
  LuRefreshCw,
  LuGamepad2,
  LuCpu,
  LuTerminal,
  LuShield,
  LuVideo
} from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { useDownloadStore } from "../../lib/zustand/downloadStore";

const QUALITIES = ["360p", "480p", "720p", "1080p", "4k"];

export const PreferencesSettings: React.FC = () => {
  const [downloadLocation, setDownloadLocation] = useState<string>("vega");
  const [excludedQualities, setExcludedQualities] = useState<string[]>([]);
  const [autoInstallUpdates, setAutoInstallUpdates] = useState<boolean>(true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true);
  const [tvModeEnabled, setTvModeEnabled] = useState<boolean>(false);
  const [hwAccelEnabled, setHwAccelEnabled] = useState<boolean>(false);
  const [devtoolsShortcutsEnabled, setDevtoolsShortcutsEnabled] =
    useState<boolean>(false);
  const [dohEnabled, setDohEnabled] = useState<boolean>(true);
  const [dohProvider, setDohProvider] = useState<string>("cloudflare");
  const [dohCustomUrl, setDohCustomUrl] = useState<string>("");
  const [downloadConcurrency, setDownloadConcurrency] = useState<number>(2);

  useEffect(() => {
    setDownloadLocation(settingsStorage.getDownloadLocation());
    setExcludedQualities(settingsStorage.getExcludedQualities());
    setAutoInstallUpdates(settingsStorage.isAutoDownloadEnabled());
    setAutoCheckUpdates(settingsStorage.isAutoCheckUpdateEnabled());
    setTvModeEnabled(settingsStorage.isTvModeEnabled());
    setHwAccelEnabled(settingsStorage.isHardwareAccelerationEnabled());
    setDevtoolsShortcutsEnabled(settingsStorage.areDevtoolsShortcutsEnabled());
    setDohEnabled(settingsStorage.isDohEnabled());
    setDohProvider(settingsStorage.getDohProvider());
    setDohCustomUrl(settingsStorage.getDohCustomUrl());
    setDownloadConcurrency(settingsStorage.getDownloadConcurrency());
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

  const handleChangeDohProvider = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
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

  return (
    <div className="preferences-settings">
      {/* Left Column of Preferences */}
      <div className="preferences-column">
        {/* Download Directory */}
        <div className="settings-row preference-row">
          <div className="preference-icon-wrapper folder">
            <LuFolder size={20} />
          </div>
          <div className="settings-info flex-1">
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
            <div className="preference-action">
              <FocusableButton
                className="change-dir-btn"
                onClick={handleChangeDir}
              >
                <FolderOpen size={16} style={{ marginRight: "4px" }} /> Change
              </FocusableButton>
              {downloadLocation !== "vega" && (
                <FocusableButton
                  className="reset-dir-btn"
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
        <div className="settings-row preference-row">
          <div className="preference-icon-wrapper layers">
            <LuLayers size={20} />
          </div>
          <div className="settings-info flex-1">
            <h3 className="label-lg">Concurrent Downloads</h3>
            <p className="body-md text-muted">
              Extra downloads wait in a FIFO queue. Default is 2.
            </p>
          </div>
          <div className="preference-action-concurrency">
            <FocusableButton
              className="concurrency-btn"
              disabled={downloadConcurrency <= 1}
              onClick={() => updateDownloadConcurrency(downloadConcurrency - 1)}
            >
              -
            </FocusableButton>
            <span className="concurrency-val">
              {downloadConcurrency}
            </span>
            <FocusableButton
              className="concurrency-btn"
              disabled={downloadConcurrency >= 5}
              onClick={() => updateDownloadConcurrency(downloadConcurrency + 1)}
            >
              +
            </FocusableButton>
          </div>
        </div>

        <div className="settings-divider" />

        {/* Auto Install Updates */}
        <div className="settings-row preference-row">
          <div className="preference-icon-wrapper download-cloud">
            <LuCloudDownload size={20} />
          </div>
          <div className="settings-info flex-1">
            <h3 className="label-lg">Auto Install App Updates</h3>
            <p className="body-md text-muted">
              Automatically download and install new versions of Vega
            </p>
          </div>
          <FocusableButton
            className={`switch-toggle ${autoInstallUpdates ? "active" : ""}`}
            onClick={handleToggleAutoInstall}
            aria-label={`Toggle auto install app updates, currently ${autoInstallUpdates ? "on" : "off"}`}
          >
            <div className="switch-knob" />
          </FocusableButton>
        </div>

        <div className="settings-divider" />

        {/* Auto Check Updates */}
        <div className="settings-row preference-row">
          <div className="preference-icon-wrapper refresh-cw">
            <LuRefreshCw size={20} />
          </div>
          <div className="settings-info flex-1">
            <h3 className="label-lg">Auto Check for Updates</h3>
            <p className="body-md text-muted">Check for updates on app startup</p>
          </div>
          <FocusableButton
            className={`switch-toggle ${autoCheckUpdates ? "active" : ""}`}
            onClick={handleToggleAutoCheck}
            aria-label={`Toggle auto check for updates, currently ${autoCheckUpdates ? "on" : "off"}`}
          >
            <div className="switch-knob" />
          </FocusableButton>
        </div>

        <div className="settings-divider" />

        {/* TV Mode */}
        <div className="settings-row preference-row">
          <div className="preference-icon-wrapper gamepad">
            <LuGamepad2 size={20} />
          </div>
          <div className="settings-info flex-1">
            <h3 className="label-lg">TV / Controller Mode</h3>
            <p className="body-md text-muted">
              Enable arrow-key spatial navigation for remotes and gamepads
              (Requires app restart)
            </p>
          </div>
          <FocusableButton
            className={`switch-toggle ${tvModeEnabled ? "active" : ""}`}
            onClick={handleToggleTvMode}
            aria-label={`Toggle TV mode, currently ${tvModeEnabled ? "on" : "off"}`}
          >
            <div className="switch-knob" />
          </FocusableButton>
        </div>
      </div>

      {/* Right Column of Preferences */}
      <div className="preferences-column">
        {/* Hardware Acceleration */}
        <div className="settings-row preference-row">
          <div className="preference-icon-wrapper cpu">
            <LuCpu size={20} />
          </div>
          <div className="settings-info flex-1">
            <h3 className="label-lg">Hardware Acceleration</h3>
            <p className="body-md text-muted">
              Use GPU to decode video. Turn off if you experience playback issues.
            </p>
          </div>
          <FocusableButton
            className={`switch-toggle ${hwAccelEnabled ? "active" : ""}`}
            onClick={handleToggleHwAccel}
            aria-label={`Toggle hardware acceleration, currently ${hwAccelEnabled ? "on" : "off"}`}
          >
            <div className="switch-knob" />
          </FocusableButton>
        </div>

        <div className="settings-divider" />

        {/* Developer Tools Shortcuts */}
        <div className="settings-row preference-row">
          <div className="preference-icon-wrapper terminal">
            <LuTerminal size={20} />
          </div>
          <div className="settings-info flex-1">
            <h3 className="label-lg">Developer Tools Shortcuts</h3>
            <p className="body-md text-muted">
              Allow F12 or Ctrl+Shift+I to toggle developer tools
            </p>
          </div>
          <FocusableButton
            className={`switch-toggle ${devtoolsShortcutsEnabled ? "active" : ""}`}
            onClick={handleToggleDevtoolsShortcuts}
            aria-label={`Toggle developer tools shortcuts, currently ${devtoolsShortcutsEnabled ? "on" : "off"}`}
          >
            <div className="switch-knob" />
          </FocusableButton>
        </div>

        <div className="settings-divider" />

        {/* DNS over HTTPS */}
        <div className="settings-row preference-row" style={{ alignItems: "flex-start" }}>
          <div className="preference-icon-wrapper shield">
            <LuShield size={20} />
          </div>
          <div className="settings-info flex-1">
            <h3 className="label-lg">DNS over HTTPS</h3>
            <p className="body-md text-muted">
              Bypass ISP DNS blocking for movie providers
            </p>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              alignItems: "flex-end",
            }}
          >
            <FocusableButton
              className={`switch-toggle ${dohEnabled ? "active" : ""}`}
              onClick={handleToggleDoh}
              aria-label={`Toggle DNS over HTTPS, currently ${dohEnabled ? "on" : "off"}`}
            >
              <div className="switch-knob" />
            </FocusableButton>

            {dohEnabled && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  width: "200px",
                }}
              >
                <select
                  value={dohProvider}
                  onChange={handleChangeDohProvider}
                  className="doh-select"
                >
                  <option
                    value="cloudflare"
                    style={{ backgroundColor: "#1a1a1a", color: "white" }}
                  >
                    Cloudflare (1.1.1.1)
                  </option>
                  <option
                    value="google"
                    style={{ backgroundColor: "#1a1a1a", color: "white" }}
                  >
                    Google (8.8.8.8)
                  </option>
                  <option
                    value="adguard"
                    style={{ backgroundColor: "#1a1a1a", color: "white" }}
                  >
                    AdGuard
                  </option>
                  <option
                    value="custom"
                    style={{ backgroundColor: "#1a1a1a", color: "white" }}
                  >
                    Custom URL
                  </option>
                </select>

                {dohProvider === "custom" && (
                  <input
                    type="text"
                    placeholder="https://dns.example.com/dns-query"
                    value={dohCustomUrl}
                    onChange={handleChangeDohCustomUrl}
                    className="doh-custom-input"
                  />
                )}
              </div>
            )}
          </div>
        </div>

        <div className="settings-divider" />

        {/* Excluded Qualities */}
        <div className="settings-row preference-row">
          <div className="preference-icon-wrapper video">
            <LuVideo size={20} />
          </div>
          <div className="settings-info flex-1">
            <h3 className="label-lg">Excluded Qualities</h3>
            <p className="body-md text-muted" style={{ marginBottom: "8px" }}>
              Select qualities you want to hide from playback and downloads.
            </p>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                marginTop: "8px",
              }}
            >
              {QUALITIES.map((q) => {
                const isExcluded = excludedQualities.includes(q);
                return (
                  <FocusableButton
                    key={q}
                    className={`quality-toggle-btn ${isExcluded ? "excluded" : ""}`}
                    onClick={() => handleToggleQuality(q)}
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
    </div>
  );
};
