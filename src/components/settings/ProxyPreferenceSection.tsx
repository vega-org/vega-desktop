import React, { useState, useEffect, useCallback } from "react";
import { settingsStorage } from "../../lib/storage";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { FocusableButton } from "../layout/FocusableButton";
import {
  startByeDpi,
  stopByeDpi,
  getByeDpiStatus,
  startWarp,
  stopWarp,
  getWarpStatus,
  BYEDPI_PRESETS,
  ProxyStatus,
} from "../../lib/services/proxyService";
import { LuCheck as Check, LuRotateCcw as Reset, LuShieldCheck as ShieldCheck } from "react-icons/lu";

export const ProxyPreferenceSection: React.FC = () => {
  const [warpEnabled, setWarpEnabled] = useState<boolean>(false);
  const [warpStatus, setWarpStatus] = useState<ProxyStatus | null>(null);
  const [warpLoading, setWarpLoading] = useState<boolean>(false);

  const [byeDpiEnabled, setByeDpiEnabled] = useState<boolean>(false);
  const [byeDpiStatus, setByeDpiStatus] = useState<ProxyStatus | null>(null);
  const [byeDpiLoading, setByeDpiLoading] = useState<boolean>(false);

  const [cmdArgs, setCmdArgs] = useState<string>("");
  const [argsSaved, setArgsSaved] = useState<boolean>(false);

  const refreshStatuses = useCallback(async () => {
    try {
      const [wStatus, bStatus] = await Promise.all([
        getWarpStatus(),
        getByeDpiStatus(),
      ]);
      setWarpStatus(wStatus);
      setByeDpiStatus(bStatus);
    } catch (e) {
      console.warn("[ProxyPreference] Failed to fetch proxy statuses:", e);
    }
  }, []);

  useEffect(() => {
    setWarpEnabled(settingsStorage.isWarpEnabled());
    setByeDpiEnabled(settingsStorage.isByeDpiEnabled());
    setCmdArgs(settingsStorage.getByeDpiCmdArgs());
    refreshStatuses();
  }, [refreshStatuses]);

  const handleToggleWarp = async () => {
    if (warpLoading) return;
    const target = !warpEnabled;
    setWarpLoading(true);

    try {
      if (target) {
        setByeDpiEnabled(false);
        const status = await startWarp();
        setWarpEnabled(true);
        setWarpStatus(status);
        setByeDpiStatus({ proxy_type: "byedpi", is_running: false, port: null, error: null });
      } else {
        const status = await stopWarp();
        setWarpEnabled(false);
        setWarpStatus(status);
      }
    } catch (err) {
      console.error("[ProxyPreference] Failed to toggle WARP:", err);
      setWarpEnabled(settingsStorage.isWarpEnabled());
    } finally {
      setWarpLoading(false);
      refreshStatuses();
    }
  };

  const handleToggleByeDpi = async () => {
    if (byeDpiLoading) return;
    const target = !byeDpiEnabled;
    setByeDpiLoading(true);

    try {
      if (target) {
        setWarpEnabled(false);
        const status = await startByeDpi(cmdArgs);
        setByeDpiEnabled(true);
        setByeDpiStatus(status);
        setWarpStatus({ proxy_type: "warp", is_running: false, port: null, error: null });
      } else {
        const status = await stopByeDpi();
        setByeDpiEnabled(false);
        setByeDpiStatus(status);
      }
    } catch (err) {
      console.error("[ProxyPreference] Failed to toggle ByeDPI:", err);
      setByeDpiEnabled(settingsStorage.isByeDpiEnabled());
    } finally {
      setByeDpiLoading(false);
      refreshStatuses();
    }
  };

  const handleSelectPreset = async (presetArgs: string) => {
    setCmdArgs(presetArgs);
    settingsStorage.setByeDpiCmdArgs(presetArgs);
    setArgsSaved(true);
    setTimeout(() => setArgsSaved(false), 2000);

    if (byeDpiEnabled) {
      setByeDpiLoading(true);
      try {
        const status = await startByeDpi(presetArgs);
        setByeDpiStatus(status);
      } catch (err) {
        console.error("[ProxyPreference] Failed to restart ByeDPI with preset:", err);
      } finally {
        setByeDpiLoading(false);
      }
    }
  };

  const handleSaveArgs = async () => {
    const trimmed = cmdArgs.trim();
    settingsStorage.setByeDpiCmdArgs(trimmed);
    setArgsSaved(true);
    setTimeout(() => setArgsSaved(false), 2000);

    if (byeDpiEnabled) {
      setByeDpiLoading(true);
      try {
        const status = await startByeDpi(trimmed);
        setByeDpiStatus(status);
      } catch (err) {
        console.error("[ProxyPreference] Failed to restart ByeDPI with new args:", err);
      } finally {
        setByeDpiLoading(false);
      }
    }
  };

  const handleResetArgs = () => {
    const defaultArgs = "--split 1 --disorder 1 --auto=torst";
    setCmdArgs(defaultArgs);
    settingsStorage.setByeDpiCmdArgs(defaultArgs);
    setArgsSaved(true);
    setTimeout(() => setArgsSaved(false), 2000);

    if (byeDpiEnabled) {
      handleSelectPreset(defaultArgs);
    }
  };

  return (
    <>
      {/* Cloudflare WARP Mode */}
      <div className="settings-row" style={{ alignItems: "flex-start" }}>
        <div className="settings-info">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 className="label-lg">Cloudflare WARP Mode</h3>
            {warpStatus?.is_running && (
              <span className="proxy-active-badge">
                <span className="proxy-active-dot" />
                Active :{warpStatus.port}
              </span>
            )}
          </div>
          <p className="body-md text-muted">
            Tunnel requests through Cloudflare MASQUE privacy proxy. Bypasses ISP IP/SNI blocking.
          </p>
        </div>
        <div className="settings-stacked-control">
          <Switch
            checked={warpEnabled}
            onCheckedChange={handleToggleWarp}
            disabled={warpLoading}
            aria-label="Toggle Cloudflare WARP"
          />
        </div>
      </div>

      <div className="settings-divider" />

      {/* Anti-DPI (ByeDPI) Mode */}
      <div className="settings-row" style={{ alignItems: "flex-start" }}>
        <div className="settings-info" style={{ width: "100%", maxWidth: "560px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h3 className="label-lg">Anti-DPI Mode (ByeDPI)</h3>
            {byeDpiStatus?.is_running && (
              <span className="proxy-active-badge">
                <span className="proxy-active-dot" />
                Active :{byeDpiStatus.port}
              </span>
            )}
          </div>
          <p className="body-md text-muted">
            Local TCP desynchronization proxy. Defeats ISP Deep Packet Inspection without a VPN or remote server.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", fontSize: "11px", color: "var(--primary)" }}>
            <ShieldCheck size={14} />
            <span>Works in direct synergy with DNS over HTTPS (DoH)</span>
          </div>

          {byeDpiEnabled && (
            <div style={{ marginTop: "14px", display: "grid", gap: "10px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--on-surface-variant)" }}>
                Strategy Presets:
              </div>
              <div className="quality-options" style={{ justifyContent: "flex-start", marginTop: 0 }}>
                {BYEDPI_PRESETS.map((preset) => {
                  const isSelected = cmdArgs.trim() === preset.args.trim();
                  return (
                    <FocusableButton
                      key={preset.id}
                      className={`quality-option ${isSelected ? "active" : ""}`}
                      onClick={() => handleSelectPreset(preset.args)}
                      title={preset.args}
                    >
                      {preset.label}
                    </FocusableButton>
                  );
                })}
              </div>

              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--on-surface-variant)", marginTop: "4px" }}>
                Command Line Arguments:
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <Input
                  type="text"
                  value={cmdArgs}
                  onChange={(e) => setCmdArgs(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveArgs()}
                  placeholder="--split 1 --disorder 1 --auto=torst"
                  className="tmdb-key-input"
                  style={{ fontFamily: "monospace", fontSize: "11px" }}
                />
                <FocusableButton
                  className={`theme-toggle-btn ${argsSaved ? "active" : ""}`}
                  onClick={handleSaveArgs}
                  style={{ minWidth: "68px" }}
                >
                  {argsSaved ? <Check size={14} /> : "Save"}
                </FocusableButton>
                <FocusableButton
                  className="theme-toggle-btn"
                  onClick={handleResetArgs}
                  title="Reset to default"
                  style={{ padding: "0 10px" }}
                >
                  <Reset size={14} />
                </FocusableButton>
              </div>
            </div>
          )}
        </div>
        <div className="settings-stacked-control">
          <Switch
            checked={byeDpiEnabled}
            onCheckedChange={handleToggleByeDpi}
            disabled={byeDpiLoading}
            aria-label="Toggle Anti-DPI Mode"
          />
        </div>
      </div>
    </>
  );
};
