import React, { useState, useEffect, useRef } from "react";
import {
  LuBlocks as Blocks,
  LuPlus as Plus,
  LuTrash2 as Trash2,
  LuCloudDownload as DownloadCloud,
  LuRotateCcw as RotateCcw,
  LuSearch as SearchIcon,
  LuLayoutGrid as GridIcon,
  LuList as ListIcon,
  LuSparkles as SparklesIcon,
  LuX as CloseIcon,
} from "react-icons/lu";
import useContentStore from "../lib/zustand/contentStore";
import { extensionManager } from "../lib/services/ExtensionManager";
import {
  extensionStorage,
  ProviderSource,
  ProviderExtension,
} from "../lib/storage/extensionStorage";
import { createProviderSource } from "../lib/utils/helpers";
import { FocusableButton } from "../components/layout/FocusableButton";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { resume } from "@noriginmedia/norigin-spatial-navigation-core";
import { settingsStorage } from "../lib/storage";
import "./ExtensionsPage.css";

const ExtensionInput: React.FC<{
  focusKey?: string;
  inputValue: string;
  setInputValue: (v: string) => void;
  handleAddSource: () => void;
  tvMode: boolean;
}> = ({ focusKey, inputValue, setInputValue, handleAddSource, tvMode }) => {
  const [isTyping, setIsTyping] = useState(false);
  const nativeInputRef = useRef<HTMLInputElement>(null);

  const {
    ref: focusRef,
    focused,
    focusSelf,
  } = useFocusable({
    focusable: tvMode,
    focusKey,
    onArrowPress: (direction) => {
      if (direction === "up") return false;
      return true;
    },
    onEnterPress: () => {
      setIsTyping(true);
      setTimeout(() => {
        nativeInputRef.current?.focus();
      }, 50);
    },
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
      className={`input-wrapper ${focused ? "tv-focus" : ""}`}
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
            if (
              e.key === "Escape" ||
              e.key === "ArrowDown" ||
              e.key === "ArrowUp"
            ) {
              e.stopPropagation();
              e.preventDefault();
              nativeInputRef.current?.blur();
            } else if (e.key === "Enter") {
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
        style={{
          width: "100%",
          outline: "none",
          background: "transparent",
          border: "none",
          color: "inherit",
          padding: "14px 20px",
          borderRadius: "8px"
        }}
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
    setProvider,
  } = useContentStore();

  const [inputValue, setInputValue] = useState("");
  const [sources, setSources] = useState<ProviderSource[]>([]);
  const [activeSource, setActiveSource] = useState<ProviderSource | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"installed" | "discover">("installed");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [viewType, setViewType] = useState<"grid" | "list">("grid");
  const [isSourcesModalOpen, setIsSourcesModalOpen] = useState(false);

  const uniqueTypes = React.useMemo(() => {
    const types = new Set<string>();
    installedProviders.forEach((p) => {
      if (p.type) types.add(p.type);
    });
    availableProviders.forEach((p) => {
      if (p.type) types.add(p.type);
    });
    return Array.from(types).sort();
  }, [installedProviders, availableProviders]);

  const filteredInstalled = React.useMemo(() => {
    return installedProviders
      .filter((p) => !p.disabled)
      .filter((p) => {
        const matchesSearch = p.display_name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesType = filterType === "all" || p.type === filterType;
        return matchesSearch && matchesType;
      });
  }, [installedProviders, searchQuery, filterType]);

  const filteredAvailable = React.useMemo(() => {
    return availableProviders
      .filter((p) => !p.disabled)
      .filter((p) => !installedProviders.some((i) => i.value === p.value))
      .filter((p) => {
        const matchesSearch = p.display_name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesType = filterType === "all" || p.type === filterType;
        return matchesSearch && matchesType;
      });
  }, [availableProviders, installedProviders, searchQuery, filterType]);

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
      setError("");
      const providers = await extensionManager.fetchManifest(source, true);
      setAvailableProviders(providers);
    } catch (err: any) {
      setError(err.message || "Failed to fetch manifest");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSource = () => {
    if (!inputValue.trim()) {
      setError("Enter a valid source URL or GitHub author.");
      return;
    }
    try {
      const parsedSource = createProviderSource(inputValue);
      extensionStorage.addProviderSources(
        parsedSource.author,
        parsedSource.url,
      );
      extensionStorage.setDefaultProviderSource(parsedSource.author);
      setInputValue("");
      loadSources();
    } catch (err: any) {
      setError(err.message || "Enter a valid source URL or GitHub author.");
    }
  };

  const handleInstall = async (provider: ProviderExtension) => {
    try {
      setIsLoading(true);
      await extensionManager.installProvider(provider);
      setInstalledProviders(extensionStorage.getInstalledProviders());
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
      <div className="page-header flex justify-between items-center w-full" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div className="page-header-icon">
            <Blocks size={40} />
          </div>
          <div className="page-header-content">
            <h1 className="display-lg" style={{ margin: 0 }}>Extensions</h1>
            <p className="body-lg text-muted">Manage your content providers</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <FocusableButton 
            className="btn-secondary" 
            onClick={() => setIsSourcesModalOpen(true)}
            style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 600, height: '44px', borderRadius: '12px' }}
          >
            <Plus size={16} /> Manage Sources
          </FocusableButton>
          
          {/* Total Providers Stats Card */}
          <div className="total-providers-card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', height: '44px' }}>
            <div className="badge-icon-wrapper" style={{ padding: '4px', borderRadius: '6px', background: 'rgba(255, 178, 190, 0.1)', border: '1px solid rgba(255, 178, 190, 0.2)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Blocks size={16} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ fontSize: '9px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px', color: 'rgba(255,255,255,0.4)', lineHeight: 1 }}>Total Providers</span>
              <span style={{ fontSize: '16px', fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                {installedProviders.length + availableProviders.filter(p => !installedProviders.some(i => i.value === p.value)).length}
              </span>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Tabs and Toolbar Row */}
      <div className="tabs-and-toolbar-row">
        <div className="tabs-container">
          <FocusableButton
            className={`tab-button ${activeTab === "installed" ? "active" : ""}`}
            onClick={() => setActiveTab("installed")}
          >
            Installed ({installedProviders.length})
          </FocusableButton>
          <FocusableButton
            className={`tab-button ${activeTab === "discover" ? "active" : ""}`}
            onClick={() => setActiveTab("discover")}
          >
            Discover ({availableProviders.filter(p => !installedProviders.some(i => i.value === p.value)).length})
          </FocusableButton>
        </div>

        <div className="toolbar-section">
          {/* Search box */}
          <div className="search-wrapper">
            <SearchIcon size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search providers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          {/* Type Dropdown */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="filter-select"
          >
            <option value="all">All</option>
            {uniqueTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          {/* View Toggles */}
          <div className="view-toggle-buttons">
            <FocusableButton
              className={`toggle-btn ${viewType === "grid" ? "active" : ""}`}
              onClick={() => setViewType("grid")}
              title="Grid View"
            >
              <GridIcon size={18} />
            </FocusableButton>
            <FocusableButton
              className={`toggle-btn ${viewType === "list" ? "active" : ""}`}
              onClick={() => setViewType("list")}
              title="List View"
            >
              <ListIcon size={18} />
            </FocusableButton>
          </div>
        </div>
      </div>

      {/* Installed Grid / List */}
      {activeTab === "installed" && (
        <div className={`extensions-grid ${viewType}`}>
          {filteredInstalled.length === 0 ? (
            <div className="empty-grid-message">
              No matching installed extensions found.
            </div>
          ) : (
            filteredInstalled.map((provider) => (
              <div key={provider.value} className={`extension-card ${viewType}`}>
                <div className="extension-card-top">
                  <div className="extension-header">
                    <div className="extension-icon-container">
                      {provider.icon ? (
                        <img src={provider.icon} alt={provider.display_name} />
                      ) : (
                        <Blocks size={20} className="text-white/60" />
                      )}
                    </div>
                    <div className="extension-details">
                      <h3 className="extension-name">
                        {provider.display_name}
                        {activeProvider?.value === provider.value && (
                          <span className="active-dot-wrapper">
                            <span className="active-dot-ping"></span>
                            <span className="active-dot"></span>
                          </span>
                        )}
                      </h3>
                      <p className="extension-meta">
                        v{provider.version} • {provider.type}
                      </p>
                    </div>
                  </div>
                  <FocusableButton className="menu-btn" title="More options">
                    <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor" style={{ opacity: 0.6 }}>
                      <circle cx="2" cy="2" r="2" />
                      <circle cx="2" cy="8" r="2" />
                      <circle cx="2" cy="14" r="2" />
                    </svg>
                  </FocusableButton>
                </div>
                <div className="extension-actions">
                  {activeProvider?.value === provider.value ? (
                    <span className="active-badge">Active</span>
                  ) : (
                    <FocusableButton
                      className="btn-secondary"
                      onClick={() => setProvider(provider)}
                    >
                      Set Active
                    </FocusableButton>
                  )}
                  <FocusableButton
                    className="uninstall-btn"
                    onClick={() =>
                      handleUninstall(provider.value, provider.source.author)
                    }
                    title="Uninstall extension"
                  >
                    <Trash2 size={18} />
                  </FocusableButton>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Discover/Available Grid / List */}
      {activeTab === "discover" && (
        <div className={`extensions-grid ${viewType}`}>
          {filteredAvailable.length === 0 ? (
            <div className="empty-grid-message">
              No matching available extensions found.
            </div>
          ) : (
            filteredAvailable.map((provider) => (
              <div key={provider.value} className={`extension-card ${viewType}`}>
                <div className="extension-card-top">
                  <div className="extension-header">
                    <div className="extension-icon-container">
                      {provider.icon ? (
                        <img src={provider.icon} alt={provider.display_name} />
                      ) : (
                        <Blocks size={20} className="text-white/60" />
                      )}
                    </div>
                    <div className="extension-details">
                      <h3 className="extension-name">
                        {provider.display_name}
                      </h3>
                      <p className="extension-meta">
                        v{provider.version} • {provider.type}
                      </p>
                    </div>
                  </div>
                  <FocusableButton className="menu-btn" title="More options">
                    <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor" style={{ opacity: 0.6 }}>
                      <circle cx="2" cy="2" r="2" />
                      <circle cx="2" cy="8" r="2" />
                      <circle cx="2" cy="14" r="2" />
                    </svg>
                  </FocusableButton>
                </div>
                <div className="extension-actions discover-actions">
                  <FocusableButton
                    className="btn-primary"
                    onClick={() => handleInstall(provider)}
                    disabled={isLoading}
                  >
                    <DownloadCloud size={16} /> Install
                  </FocusableButton>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Bottom helper banner */}
      <div className="bottom-info-banner" style={{ display: 'flex', justifySelf: 'center', alignSelf: 'center', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '16px 24px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)', width: 'fit-content', marginTop: '48px', color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>
        <SparklesIcon size={16} style={{ color: 'var(--primary)' }} />
        <span>Extensions help you connect to and manage content providers across different sources.</span>
      </div>

      {/* Provider Sources Modal Pop-up */}
      {isSourcesModalOpen && (
        <div className="sources-modal-overlay" onClick={() => setIsSourcesModalOpen(false)}>
          <div className="sources-modal-container glass-overlay" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="headline-md" style={{ margin: 0, fontSize: '1.25rem' }}>Provider Sources</h2>
              <FocusableButton className="close-btn" onClick={() => setIsSourcesModalOpen(false)}>
                <CloseIcon size={20} />
              </FocusableButton>
            </div>
            
            <div className="modal-body">
              <div className="add-source-form" style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                <div style={{ flex: 1 }}>
                  <ExtensionInput
                    focusKey="EXTENSION_INPUT"
                    inputValue={inputValue}
                    setInputValue={setInputValue}
                    handleAddSource={handleAddSource}
                    tvMode={tvMode}
                  />
                </div>
                <FocusableButton className="btn-primary" onClick={handleAddSource} style={{ padding: '0 20px', borderRadius: '8px' }}>
                  Add Source
                </FocusableButton>
              </div>

              {sources.length > 0 ? (
                <div className="source-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                  {sources.map((source) => (
                    <div
                      key={source.author}
                      className={`source-card ${activeSource?.author === source.author ? "active" : ""}`}
                      style={{ display: "flex", width: '100%', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                      <FocusableButton
                        style={{
                          flex: 1,
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          color: "inherit",
                          padding: 0,
                        }}
                        onClick={() => {
                          extensionStorage.setDefaultProviderSource(source.author);
                          loadSources();
                        }}
                      >
                        <h3 className="label-lg" style={{ margin: 0, fontSize: '0.95rem' }}>{source.author}</h3>
                        <p className="label-md text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.8rem', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>{source.url}</p>
                      </FocusableButton>

                      {activeSource?.author === source.author && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: '8px',
                          }}
                        >
                          <FocusableButton
                            className="icon-btn"
                            onClick={(e: any) => {
                              e.stopPropagation();
                              refreshManifest(source);
                            }}
                            disabled={isLoading}
                            style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '6px', padding: '6px', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <RotateCcw
                              size={16}
                              className={isLoading ? "spin" : ""}
                            />
                          </FocusableButton>
                          <FocusableButton
                            className="icon-btn text-error"
                            onClick={(e: any) => {
                              e.stopPropagation();
                              extensionStorage.removeProviderSource(source.author);
                              loadSources();
                            }}
                            style={{ background: 'rgba(255, 82, 82, 0.1)', border: 'none', borderRadius: '6px', padding: '6px', color: '#ff5252', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <Trash2 size={16} />
                          </FocusableButton>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-sources-message" style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem' }}>
                  No sources added yet. Enter a manifest URL above to get started.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
