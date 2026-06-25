import React, { useState, useEffect, useRef } from 'react';
import { Blocks, Plus, Trash2, DownloadCloud, RotateCcw } from 'lucide-react';
import useContentStore from '../lib/zustand/contentStore';
import { extensionManager } from '../lib/services/ExtensionManager';
import { extensionStorage, ProviderSource, ProviderExtension } from '../lib/storage/extensionStorage';
import { createProviderSource } from '../lib/utils/helpers';
import { FocusableButton } from '../components/layout/FocusableButton';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation-react';
import { resume } from '@noriginmedia/norigin-spatial-navigation-core';
import { settingsStorage } from '../lib/storage';
import './ExtensionsPage.css';

const ExtensionInput: React.FC<{
  focusKey?: string;
  inputValue: string;
  setInputValue: (v: string) => void;
  handleAddSource: () => void;
  tvMode: boolean;
}> = ({ focusKey, inputValue, setInputValue, handleAddSource, tvMode }) => {
  const [isTyping, setIsTyping] = useState(false);
  const nativeInputRef = useRef<HTMLInputElement>(null);

  const { ref: focusRef, focused, focusSelf } = useFocusable({
    focusable: tvMode,
    focusKey,
    onArrowPress: (direction) => {
      // Prevent focus from flying off screen upwards since there's no topbar here
      if (direction === 'up') return false;
      return true;
    },
    onEnterPress: () => {
      setIsTyping(true);
      setTimeout(() => {
        nativeInputRef.current?.focus();
      }, 50);
    }
  });

  const handleInputBlur = () => {
    setIsTyping(false);
    setTimeout(() => {
      resume();
      focusSelf();
    }, 100);
  };

  return (
    <div
      // @ts-ignore
      ref={focusRef}
      className={`input-wrapper ${focused ? 'tv-focus' : ''}`}
      style={{ flex: 1, display: 'flex', background: 'transparent', border: 'none', padding: 0, margin: 0, outline: 'none', cursor: 'text' }}
      onClick={() => {
        setIsTyping(true);
        setTimeout(() => nativeInputRef.current?.focus(), 50);
      }}
    >
      <input
        ref={nativeInputRef}
        type="text"
        tabIndex={-1}
        readOnly={tvMode ? !isTyping : false}
        placeholder="Enter source name or url to add provider"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleInputBlur}
        onKeyDown={(e) => {
          if (isTyping) {
            if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.stopPropagation();
              e.preventDefault();
              nativeInputRef.current?.blur();
            } else if (e.key === 'Enter') {
              e.stopPropagation();
              e.preventDefault();
              nativeInputRef.current?.blur();
              handleAddSource();
            } else {
              e.stopPropagation();
            }
          } else {
            nativeInputRef.current?.blur();
          }
        }}
        className="input-field"
        style={{ width: '100%', outline: 'none', background: 'transparent', border: 'none', color: 'inherit' }}
      />
    </div>
  );
};

export const ExtensionsPage: React.FC = () => {
  const {
    installedProviders,
    availableProviders,
    setInstalledProviders,
    setAvailableProviders,
    provider: activeProvider,
    setProvider
  } = useContentStore();

  const [inputValue, setInputValue] = useState('');
  const [sources, setSources] = useState<ProviderSource[]>([]);
  const [activeSource, setActiveSource] = useState<ProviderSource | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const tvMode = settingsStorage.isTvModeEnabled();

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    const allSources = extensionStorage.getProviderSources();
    setSources(allSources);
    const defaultSource = extensionStorage.getProviderSource();
    setActiveSource(defaultSource || allSources[0] || null);

    if (defaultSource) {
      refreshManifest(defaultSource);
    }
  };

  const refreshManifest = async (source: ProviderSource) => {
    try {
      setIsLoading(true);
      setError('');
      const providers = await extensionManager.fetchManifest(source, true);
      setAvailableProviders(providers);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch manifest');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSource = () => {
    if (!inputValue.trim()) {
      setError('Enter a valid source URL or GitHub author.');
      return;
    }
    try {
      const parsedSource = createProviderSource(inputValue);
      extensionStorage.addProviderSources(parsedSource.author, parsedSource.url);
      extensionStorage.setDefaultProviderSource(parsedSource.author);
      setInputValue('');
      loadSources();
    } catch (err: any) {
      setError(err.message || 'Enter a valid source URL or GitHub author.');
    }
  };

  const handleInstall = async (provider: ProviderExtension) => {
    try {
      setIsLoading(true);
      await extensionManager.installProvider(provider);
      setInstalledProviders(extensionStorage.getInstalledProviders());
      // Auto set as active if it's the first one
      if (installedProviders.length === 0) {
        setProvider(provider);
      }
    } catch (err: any) {
      setError(err.message || `Failed to install ${provider.display_name}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUninstall = (providerValue: string, sourceAuthor?: string) => {
    extensionManager.uninstallProvider(providerValue, sourceAuthor);
    setInstalledProviders(extensionStorage.getInstalledProviders());
    if (activeProvider?.value === providerValue) {
      const remaining = extensionStorage.getInstalledProviders();
      if (remaining.length > 0) {
        setProvider(remaining[0]);
      }
    }
  };

  return (
    <div className="extensions-page">
      <div className="page-header">
        <div className="page-header-icon">
          <Blocks size={36} />
        </div>
        <div className="page-header-content">
          <h1 className="display-lg">Extensions</h1>
          <p className="body-lg text-muted">Manage your content providers</p>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      <div className="sources-section glass-overlay">
        <h2 className="headline-md">Provider Sources</h2>
        <div className="add-source-form">
          <ExtensionInput
            focusKey="EXTENSION_INPUT"
            inputValue={inputValue}
            setInputValue={setInputValue}
            handleAddSource={handleAddSource}
            tvMode={tvMode}
          />
          <FocusableButton className="btn-primary" onClick={handleAddSource}>
            <Plus size={20} /> Add Source
          </FocusableButton>
        </div>

        {sources.length > 0 && (
          <div className="source-list">
            {sources.map(source => (
              <div
                key={source.author}
                className={`source-card ${activeSource?.author === source.author ? 'active' : ''}`}
                style={{ display: 'flex', padding: 0, overflow: 'hidden' }}
              >
                <FocusableButton
                  style={{ flex: 1, textAlign: 'left', padding: '16px', background: 'transparent', border: 'none', color: 'inherit' }}
                  onClick={() => {
                    extensionStorage.setDefaultProviderSource(source.author);
                    loadSources();
                  }}
                >
                  <h3 className="label-lg">{source.author}</h3>
                  <p className="label-md text-muted">{source.url}</p>
                </FocusableButton>

                {activeSource?.author === source.author && (
                  <div style={{ display: 'flex', alignItems: 'center', paddingRight: '16px' }}>
                    <FocusableButton
                      className="icon-btn"
                      onClick={(e: any) => { e.stopPropagation(); refreshManifest(source); }}
                      disabled={isLoading}
                    >
                      <RotateCcw size={20} className={isLoading ? 'spin' : ''} />
                    </FocusableButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="providers-grid">
        <div className="providers-column">
          <h2 className="headline-md mb-md">Installed</h2>
          <div className="provider-list">
            {installedProviders.length === 0 && (
              <p className="text-muted body-md">No providers installed yet.</p>
            )}
            {installedProviders.filter(p => !p.disabled).map(provider => (
              <div key={provider.value} className="provider-card installed glass-overlay">
                <div className="provider-info">
                  <div className="provider-icon">
                    {provider.icon ? <img src={provider.icon} alt={provider.display_name} /> : <Blocks />}
                  </div>
                  <div>
                    <h3 className="body-lg">{provider.display_name}</h3>
                    <p className="label-md text-muted">v{provider.version} • {provider.type}</p>
                  </div>
                </div>
                <div className="provider-actions">
                  {activeProvider?.value === provider.value ? (
                    <span className="badge active">Active</span>
                  ) : (
                    <FocusableButton className="btn-secondary" onClick={() => setProvider(provider)}>
                      Set Active
                    </FocusableButton>
                  )}
                  <FocusableButton className="icon-btn danger" onClick={() => handleUninstall(provider.value, provider.source.author)}>
                    <Trash2 size={20} />
                  </FocusableButton>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="providers-column">
          <h2 className="headline-md mb-md">Available</h2>
          <div className="provider-list">
            {availableProviders.filter(p => !p.disabled).map(provider => {
              const isInstalled = installedProviders.some(p => p.value === provider.value);
              if (isInstalled) return null;

              return (
                <div key={provider.value} className="provider-card available glass-overlay">
                  <div className="provider-info">
                    <div className="provider-icon">
                      {provider.icon ? <img src={provider.icon} alt={provider.display_name} /> : <Blocks />}
                    </div>
                    <div>
                      <h3 className="body-lg">{provider.display_name}</h3>
                      <p className="label-md text-muted">v{provider.version} • {provider.type}</p>
                    </div>
                  </div>
                  <FocusableButton
                    className="btn-primary"
                    onClick={() => handleInstall(provider)}
                    disabled={isLoading}
                  >
                    <DownloadCloud size={20} /> Install
                  </FocusableButton>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

