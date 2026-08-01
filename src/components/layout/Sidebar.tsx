import React from "react";
import { LuMenu as Menu } from "react-icons/lu";
import { useLocation } from "react-router-dom";
import { FocusableNavLink } from "./FocusableNavLink";
import { AnimatedNavIcon, type AnimatedNavIconName } from "./AnimatedNavIcon";
import { FocusableButton } from "./FocusableButton";
import {
  useFocusable,
  FocusContext,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import "./Sidebar.css";

type NavigationDestinationConfig = {
  to: string;
  label: string;
  icon: AnimatedNavIconName;
  focusKey?: string;
};

type NavigationRoot = "/" | "/search" | "/watchlist" | "/downloads" | "/extensions" | "/settings";

const getNavigationRoot = (pathname: string): NavigationRoot => {
  if (pathname.startsWith("/search")) return "/search";
  if (pathname.startsWith("/watchlist")) return "/watchlist";
  if (pathname.startsWith("/downloads")) return "/downloads";
  if (pathname.startsWith("/extensions")) return "/extensions";
  if (pathname.startsWith("/settings")) return "/settings";
  return "/";
};

const primaryDestinations: NavigationDestinationConfig[] = [
  { to: "/", label: "Home", icon: "home", focusKey: "SIDEBAR_HOME" },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/watchlist", label: "Watchlist", icon: "watchlist" },
  { to: "/downloads", label: "Downloads", icon: "download" },
];

const utilityDestinations: NavigationDestinationConfig[] = [
  { to: "/extensions", label: "Extensions", icon: "extensions" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

const NavigationDestination = ({
  to,
  label,
  icon,
  focusKey,
  navigationTarget = to,
  active = false,
}: NavigationDestinationConfig & { navigationTarget?: string; active?: boolean }) => (
  <FocusableNavLink
    focusKey={focusKey}
    to={navigationTarget}
    active={active}
    className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
    title={label}
  >
    {({ isActive }) => (
      <>
        <span className="nav-indicator" aria-hidden="true" />
        <span className="nav-icon" aria-hidden="true">
          <AnimatedNavIcon name={icon} active={isActive} size={24} />
        </span>
        <span className="nav-label">{label}</span>
      </>
    )}
  </FocusableNavLink>
);

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const tvMode = settingsStorage.isTvModeEnabled();
  const [collapsed, setCollapsed] = React.useState(() =>
    localStorage.getItem("vegaSidebarCollapsed") === "true",
  );
  const { ref, focusKey } = useFocusable({
    focusable: tvMode,
    trackChildren: true,
    preferredChildFocusKey: "SIDEBAR_HOME",
  });
  const currentRoot = getNavigationRoot(location.pathname);
  const currentRoute = `${location.pathname}${location.search}${location.hash}`;
  const [lastRoutes, setLastRoutes] = React.useState<Partial<Record<NavigationRoot, string>>>({});

  React.useEffect(() => {
    setLastRoutes((routes) => {
      if (routes[currentRoot] === currentRoute) return routes;
      return { ...routes, [currentRoot]: currentRoute };
    });
  }, [currentRoot, currentRoute]);

  const getNavigationTarget = (root: string) => {
    const destinationRoot = root as NavigationRoot;
    return destinationRoot === currentRoot
      ? destinationRoot
      : lastRoutes[destinationRoot] || destinationRoot;
  };

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem("vegaSidebarCollapsed", String(next));
      return next;
    });
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} ref={ref as any}>
        <div className="sidebar-brand">
          <FocusableButton
            className="sidebar-menu-toggle"
            onClick={toggleSidebar}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            <Menu size={26} />
          </FocusableButton>
          <div className="sidebar-logo" aria-label="Vega">
            <span className="sidebar-brand-icon" aria-hidden="true" />
            <span className="sidebar-brand-name">Vega</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <div className="nav-group">
            {primaryDestinations.map((destination) => (
              <NavigationDestination
                key={destination.to}
                {...destination}
                navigationTarget={getNavigationTarget(destination.to)}
                active={destination.to === currentRoot}
              />
            ))}
          </div>

          <div className="nav-group nav-group-utility">
            {utilityDestinations.map((destination) => (
              <NavigationDestination
                key={destination.to}
                {...destination}
                navigationTarget={getNavigationTarget(destination.to)}
                active={destination.to === currentRoot}
              />
            ))}
          </div>
        </nav>
      </aside>
    </FocusContext.Provider>
  );
};
