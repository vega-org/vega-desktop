import React, { useState, useEffect } from "react";
import { settingsStorage } from "../../lib/storage";
import type { PlayerEngineKind } from "../../lib/storage/SettingsStorage";
import { open } from "@tauri-apps/plugin-dialog";
import { LuFolderOpen as FolderOpen } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { Switch } from "../ui/switch";

export const PlayerSettings: React.FC = () => {
  const [showSeekButtons, setShowSeekButtons] = useState<boolean>(true);
  const [showEpisodeSidebarButton, setShowEpisodeSidebarButton] =
    useState<boolean>(true);
  const [hwAccelEnabled, setHwAccelEnabled] = useState<boolean>(false);
  const [externalPlayerEnabled, setExternalPlayerEnabled] = useState(false);
  const [vlcEnabled, setVlcEnabled] = useState(false);
  const [vlcPath, setVlcPath] = useState("");
  const [playerEngine, setPlayerEngine] = useState<PlayerEngineKind>(() =>
    settingsStorage.getPlayerEngine(),
  );
  const mpvSupported = settingsStorage.isMpvEngineSupported();

  const isAndroid = navigator.userAgent.toLowerCase().includes("android");

  useEffect(() => {
    setShowSeekButtons(!settingsStorage.hideSeekButtons());
    setShowEpisodeSidebarButton(settingsStorage.showPlayerEpisodeSidebar());
    setHwAccelEnabled(settingsStorage.isHardwareAccelerationEnabled());
    setExternalPlayerEnabled(settingsStorage.isExternalPlayerEnabled());
    setVlcEnabled(settingsStorage.isVlcEnabled());
    setVlcPath(settingsStorage.getVlcPath());
  }, []);

  const handleToggleSeekButtons = (enabled: boolean) => {
    setShowSeekButtons(enabled);
    settingsStorage.setHideSeekButtons(!enabled);
  };

  const handleToggleEpisodeSidebarButton = (enabled: boolean) => {
    setShowEpisodeSidebarButton(enabled);
    settingsStorage.setShowPlayerEpisodeSidebar(enabled);
  };

  const handleSelectEngine = (engine: PlayerEngineKind) => {
    setPlayerEngine(engine);
    settingsStorage.setPlayerEngine(engine);
  };

  const handleToggleHwAccel = () => {
    const nextState = !hwAccelEnabled;
    setHwAccelEnabled(nextState);
    settingsStorage.setHardwareAccelerationEnabled(nextState);
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

  return (
    <div className="player-settings">
      {/* Player Seek Buttons */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Seek Buttons</h3>
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

      {/* Episode Sidebar Button */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Episode List Button</h3>
          <p className="body-md text-muted">
            Show button on the right edge to quickly open the episode list sidebar
          </p>
        </div>
        <Switch
          checked={showEpisodeSidebarButton}
          onCheckedChange={handleToggleEpisodeSidebarButton}
          aria-label="Show player episode list button"
        />
      </div>

      <div className="settings-divider" />

      {mpvSupported && (
        <>
          {/* Player Engine (Windows only) */}
          <div className="settings-row">
            <div className="settings-info">
              <h3 className="label-lg">Player Engine</h3>
              <p className="body-md text-muted">
                {playerEngine === "mpv"
                  ? "mpv: plays HEVC, 4K and HDR with GPU decoding and low CPU use."
                  : "Built-in: browser video with FFmpeg conversion for unsupported formats."}{" "}
                Applies the next time the player opens.
              </p>
            </div>
            <div className="theme-toggle-group">
              <FocusableButton
                className={`theme-toggle-btn ${playerEngine === "builtin" ? "active" : ""}`}
                onClick={() => handleSelectEngine("builtin")}
              >
                Built-in
              </FocusableButton>
              <FocusableButton
                className={`theme-toggle-btn ${playerEngine === "mpv" ? "active" : ""}`}
                onClick={() => handleSelectEngine("mpv")}
              >
                mpv
              </FocusableButton>
            </div>
          </div>

          <div className="settings-divider" />
        </>
      )}

      {playerEngine === "mpv" && (
        <>
          {/* Hardware Acceleration (mpv only) */}
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
        </>
      )}

      {/* External Player / VLC */}
      {isAndroid ? (
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
      ) : (
        <>
          <div className="settings-row">
            <div className="settings-info">
              <h3 className="label-lg">VLC Player</h3>
              <p className="body-md text-muted">
                Open the selected server directly in VLC instead of Vega&apos;s
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
            <>
              <div className="settings-divider" />
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
            </>
          )}
        </>
      )}
    </div>
  );
};
