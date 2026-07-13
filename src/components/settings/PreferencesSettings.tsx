import React, { useState, useEffect } from "react";
import { settingsStorage } from "../../lib/storage";
import { open } from "@tauri-apps/plugin-dialog";
import { LuFolderOpen as FolderOpen } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";

const QUALITIES = ["360p", "480p", "720p", "1080p", "4k"];

export const PreferencesSettings: React.FC = () => {
  const [downloadLocation, setDownloadLocation] = useState<string>("vega");
  const [excludedQualities, setExcludedQualities] = useState<string[]>([]);
  const [autoInstallUpdates, setAutoInstallUpdates] = useState<boolean>(true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true);
  const [tvModeEnabled, setTvModeEnabled] = useState<boolean>(false);
  const [hwAccelEnabled, setHwAccelEnabled] = useState<boolean>(false);
  const [dohEnabled, setDohEnabled] = useState<boolean>(true);
  const [dohProvider, setDohProvider] = useState<string>("cloudflare");
  const [dohCustomUrl, setDohCustomUrl] = useState<string>("");

  useEffect(() => {
    setDownloadLocation(settingsStorage.getDownloadLocation());
    setExcludedQualities(settingsStorage.getExcludedQualities());
    setAutoInstallUpdates(settingsStorage.isAutoDownloadEnabled());
    setAutoCheckUpdates(settingsStorage.isAutoCheckUpdateEnabled());
    setTvModeEnabled(settingsStorage.isTvModeEnabled());
    setHwAccelEnabled(settingsStorage.isHardwareAccelerationEnabled());
    setDohEnabled(settingsStorage.isDohEnabled());
    setDohProvider(settingsStorage.getDohProvider());
    setDohCustomUrl(settingsStorage.getDohCustomUrl());
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

      {/* Auto Install Updates */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Auto Install App Updates</h3>
          <p className="body-md text-muted">
            Automatically download and install new versions of Vega
          </p>
        </div>
        <FocusableButton
          className={`theme-toggle-btn ${autoInstallUpdates ? "active" : ""}`}
          onClick={handleToggleAutoInstall}
        >
          {autoInstallUpdates ? "ON" : "OFF"}
        </FocusableButton>
      </div>

      <div className="settings-divider" />

      {/* Auto Check Updates */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Auto Check for Updates</h3>
          <p className="body-md text-muted">Check for updates on app startup</p>
        </div>
        <FocusableButton
          className={`theme-toggle-btn ${autoCheckUpdates ? "active" : ""}`}
          onClick={handleToggleAutoCheck}
        >
          {autoCheckUpdates ? "ON" : "OFF"}
        </FocusableButton>
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
        <FocusableButton
          className={`theme-toggle-btn ${tvModeEnabled ? "active" : ""}`}
          onClick={handleToggleTvMode}
        >
          {tvModeEnabled ? "ON" : "OFF"}
        </FocusableButton>
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
        <FocusableButton
          className={`theme-toggle-btn ${hwAccelEnabled ? "active" : ""}`}
          onClick={handleToggleHwAccel}
        >
          {hwAccelEnabled ? "ON" : "OFF"}
        </FocusableButton>
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            alignItems: "flex-end",
          }}
        >
          <FocusableButton
            className={`theme-toggle-btn ${dohEnabled ? "active" : ""}`}
            onClick={handleToggleDoh}
          >
            {dohEnabled ? "ON" : "OFF"}
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
                style={{
                  backgroundColor: "rgba(255, 255, 255, 0.05)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "6px",
                  padding: "8px",
                  outline: "none",
                }}
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
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "6px",
                    padding: "8px",
                    outline: "none",
                    fontSize: "12px",
                  }}
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
  );
};
