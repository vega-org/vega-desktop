import React, { useState, useRef, useEffect } from 'react';
import { Blocks, ChevronDown, Check } from 'lucide-react';
import useContentStore from '../../lib/zustand/contentStore';
import { FocusableButton } from './FocusableButton';
import './ProviderSwitcher.css';

export const ProviderSwitcher: React.FC = () => {
  const { installedProviders, provider: activeProvider, setProvider } = useContentStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!installedProviders || installedProviders.length === 0) {
    return null;
  }

  const handleSelect = (provider: any) => {
    setProvider(provider);
    setIsOpen(false);
  };

  return (
    <div className="provider-switcher-container" ref={dropdownRef}>
      <FocusableButton
        className="provider-switcher-button glass-overlay"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Blocks size={18} />
        <span className="label-md truncate">
          {activeProvider?.display_name || 'Select Provider'}
        </span>
        <ChevronDown size={18} className={`chevron ${isOpen ? 'open' : ''}`} />
      </FocusableButton>

      {isOpen && (
        <div className="provider-dropdown glass-overlay">
          {installedProviders.map(provider => (
            <FocusableButton
              key={`${provider.source?.author}:${provider.value}`}
              className={`provider-option ${activeProvider?.value === provider.value ? 'active' : ''}`}
              onClick={() => handleSelect(provider)}
            >
              <div className="provider-option-info">
                {provider.icon ? (
                  <img src={provider.icon} alt="" className="provider-icon-small" />
                ) : (
                  <Blocks size={16} />
                )}
                <span className="label-md truncate">{provider.display_name}</span>
              </div>
              {activeProvider?.value === provider.value && (
                <Check size={16} className="text-primary" />
              )}
            </FocusableButton>
          ))}
        </div>
      )}
    </div>
  );
};
