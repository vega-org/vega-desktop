import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ProviderSwitcher } from './ProviderSwitcher';
import './Topbar.css';

export const Topbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  if (location.pathname !== '/') {
    return null;
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/?q=${encodeURIComponent(query.trim())}`);
    } else {
      navigate(`/`);
    }
  };

  return (
    <header className="topbar">
      <form className="search-container" onSubmit={handleSearch}>
        <Search size={20} className="search-icon" />
        <input 
          type="text" 
          placeholder="Search movies, TV shows..." 
          className="search-input body-md"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </form>
      <div className="topbar-actions">
        <ProviderSwitcher />
      </div>
    </header>
  );
};
