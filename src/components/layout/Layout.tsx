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
  const isContentPage = location.pathname.startsWith("/content/");
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

  // Since Topbar has negative margin to hover over the hero image on home/meta pages,
  // we need to push the content down manually on other pages so the topbar doesn't hide text.
  const needsTopPadding = !isHomePage && !isContentPage;

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="layout-root" ref={ref as any}>
        <Sidebar />
        <div className="layout-main">
          <Topbar />
          <main
            className="layout-content"
            style={{ paddingTop: needsTopPadding ? "72px" : "0" }}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </FocusContext.Provider>
  );
};
