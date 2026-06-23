import React from 'react';
import useThemeStore from '../lib/zustand/themeStore';
import { themes, socialLinks } from '../lib/constants';
import { Monitor, Check, Code, Coffee } from 'lucide-react';
import { SubtitleSettings } from '../components/settings/SubtitleSettings';
import { PreferencesSettings } from '../components/settings/PreferencesSettings';
import './SettingsPage.css';

export const SettingsPage: React.FC = () => {
  const { primary, themeBackground, setPrimary, setThemeBackground } = useThemeStore();
  const [appVersion, setAppVersion] = React.useState('Loading...');

  React.useEffect(() => {
    import('@tauri-apps/api/app')
      .then(app => app.getVersion())
      .then(v => setAppVersion(`Version ${v}`))
      .catch(() => setAppVersion('Version 1.0.0'));
  }, []);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="headline-lg">Settings</h1>
      </div>

      <div className="settings-content">
        {/* Appearance Group */}
        <section className="settings-group">
          <h2 className="title-md mb-sm flex items-center gap-2">
            <Monitor size={20} /> Appearance
          </h2>
          <div className="settings-card">

            {/* Background Theme */}
            <div className="settings-row">
              <div className="settings-info">
                <h3 className="label-lg">Background Theme</h3>
                <p className="body-md text-muted">Choose the overall background color of the app</p>
              </div>
              <div className="theme-toggle-group">
                <button
                  className={`theme-toggle-btn ${themeBackground === 'oled' ? 'active' : ''}`}
                  onClick={() => setThemeBackground('oled')}
                >
                  Black
                </button>
                <button
                  className={`theme-toggle-btn ${themeBackground === 'gray' ? 'active' : ''}`}
                  onClick={() => setThemeBackground('gray')}
                >
                  Gray
                </button>
                {/* <button 
                  className={`theme-toggle-btn ${themeBackground === 'white' ? 'active' : ''}`}
                  onClick={() => setThemeBackground('white')}
                >
                  White
                </button> */}
              </div>
            </div>

            <div className="settings-divider" />

            {/* Accent Color */}
            <div className="settings-row">
              <div className="settings-info">
                <h3 className="label-lg">Accent Color</h3>
                <p className="body-md text-muted">Choose your preferred primary color</p>
              </div>
              <div className="accent-color-grid">
                {themes.map(t => {
                  const isMatch = primary?.toLowerCase() === t.color?.toLowerCase();
                  return (
                    <button
                      key={t.name}
                      className={`accent-color-btn ${isMatch ? 'active' : ''}`}
                      style={{ backgroundColor: t.color }}
                      onClick={() => setPrimary(t.color)}
                      title={t.name}
                      aria-label={`Set accent color to ${t.name}`}
                    >
                      {isMatch && <Check size={16} color={t.color === '#FFFFFF' ? '#000' : '#FFF'} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Preferences Group */}
        <section className="settings-group">
          <h2 className="title-md mb-sm flex items-center gap-2">
            Preferences
          </h2>
          <div className="settings-card">
            <PreferencesSettings />
          </div>
        </section>

        {/* Subtitles Group */}
        <section className="settings-group">
          <h2 className="title-md mb-sm flex items-center gap-2">
            Subtitles
          </h2>
          <div className="settings-card">
            <SubtitleSettings />
          </div>
        </section>

        {/* About Group */}
        <section className="settings-group">
          <h2 className="title-md mb-sm">About</h2>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-info">
                <h3 className="label-lg">Vega Desktop</h3>
                <p className="body-md text-muted">{appVersion}</p>
              </div>
              <div className="flex gap-3">
                <a
                  href={socialLinks.github}
                  target="_blank"
                  rel="noreferrer"
                  className="social-btn"
                  title="GitHub"
                >
                  <Code size={20} />
                </a>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
};
