import React from "react";
import useThemeStore from "../lib/zustand/themeStore";
import { themes } from "../lib/constants";
import {
  LuMonitor as Monitor,
  LuCheck as Check,
  LuPlay as Play,
  LuCaptions as Captions,
  LuSlidersHorizontal as Sliders,
  LuInfo as Info,
} from "react-icons/lu";
import { PlayerSettings } from "../components/settings/PlayerSettings";
import { SubtitleSettings } from "../components/settings/SubtitleSettings";
import { PreferencesSettings } from "../components/settings/PreferencesSettings";
import { GitHubStarButton } from "../components/settings/GitHubStarButton";
import { checkAppUpdates } from "../lib/hooks/useAppUpdater";
import { FocusableButton } from "../components/layout/FocusableButton";
import { Switch } from "../components/ui/switch";
import { settingsStorage } from "../lib/storage";

import "./SettingsPage.css";

export const SettingsPage: React.FC = () => {
  const { primary, setPrimary } = useThemeStore();
  const [appVersion, setAppVersion] = React.useState("Loading...");
  const [infoPageDynamicTheme, setInfoPageDynamicTheme] = React.useState(() =>
    settingsStorage.isInfoPageDynamicThemeEnabled(),
  );

  React.useEffect(() => {
    import("@tauri-apps/api/app")
      .then((app) => app.getVersion())
      .then((v) => setAppVersion(`Version ${v}`))
      .catch(() => setAppVersion("Version 1.0.0"));
  }, []);

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1 className="headline-lg">Settings</h1>
      </div>

      <div className="settings-content">
        {/* Appearance Group */}
        <section className="settings-group">
          <h2
            className="title-md flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <Monitor size={20} /> Appearance
          </h2>
          <div className="settings-card">
            {/* Accent Color */}
            <div className="settings-row">
              <div className="settings-info">
                <h3 className="label-lg">Accent Color</h3>
                <p className="body-md text-muted">
                  Choose your preferred primary color
                </p>
              </div>
              <div className="accent-color-grid">
                {themes.map((t) => {
                  const isMatch =
                    primary?.toLowerCase() === t.color?.toLowerCase();
                  return (
                    <FocusableButton
                      key={t.name}
                      className={`accent-color-btn ${isMatch ? "active" : ""}`}
                      style={{ backgroundColor: t.color }}
                      onClick={() => setPrimary(t.color)}
                      title={t.name}
                      aria-label={`Set accent color to ${t.name}`}
                    >
                      {isMatch && (
                        <Check
                          size={16}
                          color={t.color === "#FFFFFF" ? "#000" : "#FFF"}
                        />
                      )}
                    </FocusableButton>
                  );
                })}
              </div>
            </div>

            <div className="settings-divider" />

            <div className="settings-row">
              <div className="settings-info">
                <h3 className="label-lg">Dynamic Info Page Theme</h3>
                <p className="body-md text-muted">
                  Derive the info page colors from the title artwork
                </p>
              </div>
              <Switch
                checked={infoPageDynamicTheme}
                onCheckedChange={(enabled) => {
                  setInfoPageDynamicTheme(enabled);
                  settingsStorage.setInfoPageDynamicThemeEnabled(enabled);
                }}
                aria-label="Use artwork colors on info pages"
              />
            </div>
          </div>
        </section>

        {/* Player Group */}
        <section className="settings-group">
          <h2
            className="title-md flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <Play size={20} /> Player
          </h2>
          <div className="settings-card">
            <PlayerSettings />
          </div>
        </section>

        {/* Subtitles Group */}
        <section className="settings-group">
          <h2
            className="title-md flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <Captions size={20} /> Subtitles
          </h2>
          <div className="settings-card">
            <SubtitleSettings />
          </div>
        </section>

        {/* Preferences Group */}
        <section className="settings-group">
          <h2
            className="title-md flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <Sliders size={20} /> Preferences
          </h2>
          <div className="settings-card">
            <PreferencesSettings />
          </div>
        </section>

        {/* About Group */}
        <section className="settings-group">
          <h2
            className="title-md flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            <Info size={20} /> About
          </h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-info">
                <h3 className="label-lg">Vega Desktop</h3>
                <p className="body-md text-muted">{appVersion}</p>
                <FocusableButton
                  className="theme-toggle-btn active"
                  onClick={() => checkAppUpdates(true)}
                  style={{
                    width: "fit-content",
                    padding: "6px 12px",
                    marginTop: "8px",
                  }}
                >
                  Check for Updates
                </FocusableButton>
              </div>
            </div>
            <div className="settings-divider" />
            <div className="github-star-row">
              <GitHubStarButton />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
