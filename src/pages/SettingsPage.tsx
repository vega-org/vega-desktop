import React from "react";
import useThemeStore from "../lib/zustand/themeStore";
import { themes } from "../lib/constants";
import { 
  LuMonitor as Monitor, 
  LuCheck as Check,
  LuSlidersHorizontal as Sliders,
  LuCaptions as ClosedCaption,
  LuInfo as Info,
  LuChevronRight as ChevronRight,
  LuRefreshCw as RefreshCw
} from "react-icons/lu";
import { SubtitleSettings } from "../components/settings/SubtitleSettings";
import { PreferencesSettings } from "../components/settings/PreferencesSettings";
import { GitHubStarButton } from "../components/settings/GitHubStarButton";
import { checkAppUpdates } from "../lib/hooks/useAppUpdater";
import { FocusableButton } from "../components/layout/FocusableButton";
import logo from "../assets/logo.png";

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
        <p className="body-md text-muted page-subtitle">
          Customize Vega v1.4.3b to your preference
        </p>
      </div>

      <div className="settings-content">
        {/* Preferences Group */}
        <section className="settings-group">
          <h2 className="title-md flex items-center gap-2">
            <Sliders size={20} /> Preferences
          </h2>
          <div className="settings-card">
            <PreferencesSettings />
          </div>
        </section>

        {/* Appearance Group */}
        <section className="settings-group">
          <h2 className="title-md flex items-center gap-2">
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
                <FocusableButton
                  className={`theme-toggle-btn ${themeBackground === "deep-blue" ? "active" : ""}`}
                  onClick={() => setThemeBackground("deep-blue")}
                >
                  Deep Blue
                </FocusableButton>
                <FocusableButton
                  className={`theme-toggle-btn ${themeBackground === "white" ? "active" : ""}`}
                  onClick={() => setThemeBackground("white")}
                >
                  White
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

        {/* Subtitles Group */}
        <section className="settings-group">
          <h2 className="title-md flex items-center gap-2">
            <ClosedCaption size={20} /> Subtitles
          </h2>
          <div className="settings-card">
            <SubtitleSettings />
          </div>
        </section>

        {/* About Group */}
        <section className="settings-group">
          <h2 className="title-md flex items-center gap-2">
            <Info size={20} /> About
          </h2>
          <div className="settings-card">
            <div className="settings-row about-row-content">
              <div className="about-logo-wrapper">
                <img src={logo} alt="Vega Logo" className="about-logo" />
              </div>
              <div className="settings-info flex-1">
                <h3 className="label-lg">Vega v1.4.3b</h3>
                <p className="body-md text-muted">{appVersion}</p>
                <FocusableButton
                  className="update-btn"
                  onClick={() => checkAppUpdates(true)}
                >
                  <RefreshCw size={14} className="update-btn-icon" />
                  <span>Check for Updates</span>
                </FocusableButton>
              </div>
              <div className="about-chevron-wrapper">
                <ChevronRight size={20} className="about-chevron" />
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
