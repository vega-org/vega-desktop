import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import './Layout.css';

export const Layout: React.FC = () => {
  const location = useLocation();
  const isHomePage = location.pathname === '/';
  const isContentPage = location.pathname.startsWith('/content/');

  // Since Topbar has negative margin to hover over the hero image on home/meta pages,
  // we need to push the content down manually on other pages so the topbar doesn't hide text.
  const needsTopPadding = !isHomePage && !isContentPage;

  return (
    <div className="layout-root">
      <Sidebar />
      <div className="layout-main">
        <Topbar />
        <main 
          className="layout-content" 
          style={{ paddingTop: needsTopPadding ? '72px' : '0' }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
};
