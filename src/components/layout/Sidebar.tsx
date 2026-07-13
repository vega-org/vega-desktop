import React from "react";
import {
  LuHouse as Home,
  LuSearch as Search,
  LuBookmark as Bookmark,
  LuSettings as Settings,
  LuBlocks as Blocks,
  LuDownload as Download,
} from "react-icons/lu";
import { FocusableNavLink } from "./FocusableNavLink";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import "./Sidebar.css";

export const Sidebar: React.FC = () => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref, focusKey } = useFocusable({
    focusable: tvMode,
    trackChildren: true,
    preferredChildFocusKey: "SIDEBAR_HOME",
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <aside className="sidebar" ref={ref as any}>
        <nav className="sidebar-nav">
          <FocusableNavLink
            focusKey="SIDEBAR_HOME"
            to="/"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            title="Home"
          >
            <Home size={24} />
          </FocusableNavLink>

          <FocusableNavLink
            to="/search"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            title="Search"
          >
            <Search size={24} />
          </FocusableNavLink>

          <FocusableNavLink
            to="/watchlist"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            title="Watchlist"
          >
            <Bookmark size={24} />
          </FocusableNavLink>

          <FocusableNavLink
            to="/downloads"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            title="Downloads"
          >
            <Download size={24} />
          </FocusableNavLink>

          <div className="nav-spacer" />

          <FocusableNavLink
            to="/extensions"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            title="Extensions"
          >
            <Blocks size={24} />
          </FocusableNavLink>

          <FocusableNavLink
            to="/settings"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            title="Settings"
          >
            <Settings size={24} />
          </FocusableNavLink>
        </nav>
      </aside>
    </FocusContext.Provider>
  );
};
