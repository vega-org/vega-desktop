import React from "react";
import useThemeStore from "../lib/zustand/themeStore";
import { themes, socialLinks } from "../lib/constants";
import {
  LuMonitor as Monitor,
  LuCheck as Check,
  LuCode as Code,
} from "react-icons/lu";
import { SubtitleSettings } from "../components/settings/SubtitleSettings";
import { PreferencesSettings } from "../components/settings/PreferencesSettings";
import { checkAppUpdates } from "../lib/hooks/useAppUpdater";
import { FocusableButton } from "../components/layout/FocusableButton";

import "./SettingsPage.css";

export const SettingsPage: React.FC = () => {
  const { primary, themeBackground, setPrimary, setThemeBackground } =
    useThemeStore();
  const [appVersion, setAppVersion] = React.useState("Loading...");

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
            {/* Background Theme */}
            <div className="settings-row">
              <div className="settings-info">
                <h3 className="label-lg">Background Theme</h3>
                <p className="body-md text-muted">
                  Choose the overall background color of the app
                </p>
              </div>
              <div className="theme-toggle-group">
                <FocusableButton
                  className={`theme-toggle-btn ${themeBackground === "oled" ? "active" : ""}`}
                  onClick={() => setThemeBackground("oled")}
                >
                  Black
                </FocusableButton>
                <FocusableButton
                  className={`theme-toggle-btn ${themeBackground === "gray" ? "active" : ""}`}
                  onClick={() => setThemeBackground("gray")}
                >
                  Gray
                </FocusableButton>
              </div>
            </div>

            <div className="settings-divider" />

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
          </div>
        </section>

        {/* Preferences Group */}
        <section className="settings-group">
          <h2
            className="title-md flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            Preferences
          </h2>
          <div className="settings-card">
            <PreferencesSettings />
          </div>
        </section>

        {/* Subtitles Group */}
        <section className="settings-group">
          <h2
            className="title-md flex items-center gap-2"
            style={{ marginBottom: "8px" }}
          >
            Subtitles
          </h2>
          <div className="settings-card">
            <SubtitleSettings />
          </div>
        </section>

        {/* About Group */}
        <section className="settings-group">
          <h2 className="title-md" style={{ marginBottom: "8px" }}>
            About
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
              <div style={{ display: "flex", gap: "12px" }}>
                <a
                  href={socialLinks.github}
                  target="_blank"
                  rel="noreferrer"
                  className="social-btn"
                  title="GitHub"
                  tabIndex={-1}
                >
                  <FocusableButton className="social-btn">
                    <Code size={20} />
                  </FocusableButton>
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
