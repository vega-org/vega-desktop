import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Search, Bookmark, Settings, Blocks, Download } from 'lucide-react';
// import logo from '../../assets/logo.png';
import './Sidebar.css';

export const Sidebar: React.FC = () => {
  return (
    <aside className="sidebar">
      {/* <div className="sidebar-logo">
        <img src={logo} alt="Vega Logo" className="logo-img" />
      </div> */}

      <nav className="sidebar-nav">
        <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Home">
          <Home size={24} />
        </NavLink>

        <NavLink to="/search" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Search">
          <Search size={24} />
        </NavLink>

        <NavLink to="/watchlist" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Watchlist">
          <Bookmark size={24} />
        </NavLink>

        <NavLink to="/downloads" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Downloads">
          <Download size={24} />
        </NavLink>

        <div className="nav-spacer" />

        <NavLink to="/extensions" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Extensions">
          <Blocks size={24} />
        </NavLink>

        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="Settings">
          <Settings size={24} />
        </NavLink>
      </nav>
    </aside>
  );
};
