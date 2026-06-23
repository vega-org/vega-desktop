import React, { useState, useEffect } from 'react';
import { Blocks, Plus, Trash2, DownloadCloud, RotateCcw } from 'lucide-react';
import useContentStore from '../lib/zustand/contentStore';
import { extensionManager } from '../lib/services/ExtensionManager';
import { extensionStorage, ProviderSource, ProviderExtension } from '../lib/storage/extensionStorage';
import { createProviderSource } from '../lib/utils/helpers';
import './ExtensionsPage.css';

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
          <input 
            type="text" 
            placeholder="Enter source name or url to add provider" 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="input-field"
          />
          <button className="btn-primary" onClick={handleAddSource}>
            <Plus size={20} /> Add Source
          </button>
        </div>

        {sources.length > 0 && (
          <div className="source-list">
            {sources.map(source => (
              <div 
                key={source.author} 
                className={`source-card ${activeSource?.author === source.author ? 'active' : ''}`}
                onClick={() => {
                  extensionStorage.setDefaultProviderSource(source.author);
                  loadSources();
                }}
              >
                <div>
                  <h3 className="label-lg">{source.author}</h3>
                  <p className="label-md text-muted">{source.url}</p>
                </div>
                {activeSource?.author === source.author && (
                  <button className="icon-btn" onClick={(e) => { e.stopPropagation(); refreshManifest(source); }} disabled={isLoading}>
                    <RotateCcw size={20} className={isLoading ? 'spin' : ''} />
                  </button>
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
            {installedProviders.map(provider => (
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
                    <button className="btn-secondary" onClick={() => setProvider(provider)}>
                      Set Active
                    </button>
                  )}
                  <button className="icon-btn danger" onClick={() => handleUninstall(provider.value, provider.source.author)}>
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="providers-column">
          <h2 className="headline-md mb-md">Available</h2>
          <div className="provider-list">
            {availableProviders.map(provider => {
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
                  <button 
                    className="btn-primary" 
                    onClick={() => handleInstall(provider)}
                    disabled={isLoading}
                  >
                    <DownloadCloud size={20} /> Install
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
