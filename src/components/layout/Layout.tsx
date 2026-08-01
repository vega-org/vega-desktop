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
  const tvMode = settingsStorage.isTvModeEnabled();

  const { ref, focusKey, focusSelf } = useFocusable({
    focusable: tvMode,
    trackChildren: true,
    saveLastFocusedChild: true,
    preferredChildFocusKey: "SIDEBAR_HOME",
  });

  useEffect(() => {
    if (tvMode) {
      setTimeout(() => {
        focusSelf();
      }, 50);
    }
  }, [tvMode, focusSelf, location.pathname]);

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
