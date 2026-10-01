import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import "./Layout.css";

export const Layout: React.FC = () => {
  const location = useLocation();
  const isHomePage = location.pathname === "/";
  const isContentPage =
    location.pathname.startsWith("/content/") ||
    location.pathname.startsWith("/watchlist/content/");
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref, focusKey, focusSelf } = useFocusable({
    focusable: tvMode,
    trackChildren: true,
    saveLastFocusedChild: true,
    preferredChildFocusKey: "SIDEBAR_HOME",
  });

  useEffect(() => {
    if (!tvMode) return;

    const hasFocus = () =>
      document.activeElement != null && document.activeElement !== document.body;

    // The 50ms one-shot this replaces could fire before any child registered as focusable,
    // which on slow TV hardware left nothing focused and the D-pad dead with no retry.
    let attempts = 0;
    const interval = window.setInterval(() => {
      if (hasFocus() || attempts++ > 40) {
        window.clearInterval(interval);
        return;
      }
      focusSelf();
    }, 100);

    // Last resort, so a dead remote recovers on the next press instead of staying stuck.
    const recoverFocus = (event: KeyboardEvent) => {
      if (!event.isTrusted || hasFocus()) return;
      if (!event.key.startsWith("Arrow") && event.key !== "Enter") return;
      focusSelf();
    };
    window.addEventListener("keydown", recoverFocus, true);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("keydown", recoverFocus, true);
    };
  }, [tvMode, focusSelf]);

  const needsTopPadding = !isHomePage && !isContentPage;

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="layout-root" ref={ref as any}>
        <Sidebar />
        <div className="layout-main">
          <Topbar />
          <main
            className={`layout-content ${needsTopPadding ? "layout-content-padded" : ""}`}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </FocusContext.Provider>
  );
};
