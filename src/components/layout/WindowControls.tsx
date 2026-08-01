import React from "react";
import {
  LuCopy as Restore,
  LuMinus as Minimize,
  LuSquare as Maximize,
  LuX as Close,
} from "react-icons/lu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "./WindowControls.css";

const appWindow = getCurrentWindow();

export const WindowControls: React.FC = () => {
  const [maximized, setMaximized] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const maximizedRef = React.useRef(false);

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;

    const updateWindowState = async (ensureVisible = false) => {
      try {
        const [isMaximized, isFullscreen] = await Promise.all([
          appWindow.isMaximized(),
          appWindow.isFullscreen(),
        ]);
        const enteredMaximized = isMaximized && !maximizedRef.current;
        maximizedRef.current = isMaximized;
        setMaximized(isMaximized);
        setFullscreen(isFullscreen);
        if (!isFullscreen && (enteredMaximized || ensureVisible)) {
          await invoke("ensure_window_in_work_area", {
            maximized: isMaximized,
          });
        }
      } catch {
        // The browser preview does not expose a native Tauri window.
      }
    };

    void updateWindowState(true);
    appWindow
      .onResized(() => void updateWindowState())
      .then((stopListening) => {
        unlisten = stopListening;
      })
      .catch(() => {});

    return () => unlisten?.();
  }, []);

  if (fullscreen) return null;

  const toggleMaximize = async () => {
    try {
      await appWindow.toggleMaximize();
      const isMaximized = await appWindow.isMaximized();
      maximizedRef.current = isMaximized;
      setMaximized(isMaximized);
      await invoke("ensure_window_in_work_area", {
        maximized: isMaximized,
      });
    } catch (error) {
      console.error("Failed to toggle window maximize state", error);
    }
  };

  return (
    <div
      className="window-titlebar-overlay"
      data-tauri-drag-region
      onDoubleClick={() => void toggleMaximize()}
    >
      <div className="window-controls" aria-label="Window controls">
        <button
          type="button"
          className="window-control"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => void appWindow.minimize()}
        >
          <Minimize size={17} />
        </button>
        <button
          type="button"
          className="window-control"
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => void toggleMaximize()}
        >
          {maximized ? <Restore size={14} /> : <Maximize size={14} />}
        </button>
        <button
          type="button"
          className="window-control window-control-close"
          aria-label="Close"
          title="Close"
          onClick={() => void appWindow.close()}
        >
          <Close size={18} />
        </button>
      </div>
    </div>
  );
};
