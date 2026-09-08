import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFocusable, FocusContext } from "@noriginmedia/norigin-spatial-navigation-react";
import { setFocus, doesFocusableExist } from "@noriginmedia/norigin-spatial-navigation-core";
import {
  LuBlocks as Blocks,
  LuCheck as Check,
  LuChevronDown as ChevronDown,
  LuCircleAlert as AlertCircle,
  LuCloudDownload as DownloadCloud,
  LuGlobe as Globe,
  LuPackageOpen as PackageOpen,
  LuPlus as Plus,
  LuRefreshCw as RefreshCw,
  LuSettings as SettingsIcon,
  LuTrash2 as Trash2,
  LuX as X,
} from "react-icons/lu";
import { ProviderSettingsDialog } from "../components/settings/ProviderSettingsDialog";
import { SourcePickerDialog } from "../components/extensions/SourcePickerDialog";
import { AddSourceDialog } from "../components/extensions/AddSourceDialog";
import { ConfirmActionDialog } from "../components/extensions/ConfirmActionDialog";
import { FocusableButton } from "../components/layout/FocusableButton";
import { extensionManager } from "../lib/services/ExtensionManager";
import { updateProvidersService } from "../lib/services/UpdateProviders";
import { settingsStorage } from "../lib/storage";
import { toast } from "../lib/zustand/toastStore";
import {
  extensionStorage,
  type ProviderExtension,
  type ProviderSource,
} from "../lib/storage/extensionStorage";
import { createProviderSource } from "../lib/utils/helpers";
import useContentStore from "../lib/zustand/contentStore";
import "./ExtensionsPage.css";

const isNewerVersion = (newVersion: string, currentVersion: string): boolean => {
  const parseVersion = (v: string) =>
    v.split(".").map((p) => parseInt(p, 10) || 0);
  const n = parseVersion(newVersion);
  const c = parseVersion(currentVersion);
  for (let i = 0; i < Math.max(n.length, c.length); i++) {
    const np = n[i] || 0;
    const cp = c[i] || 0;
    if (np > cp) return true;
    if (np < cp) return false;
  }
  return false;
};

const providerKey = (provider: ProviderExtension) =>
  `${provider.source?.author ?? ""}:${provider.value}`;

const isSameProvider = (
  left: ProviderExtension | null | undefined,
  right: ProviderExtension | null | undefined,
) =>
  Boolean(
    left &&
    right &&
    left.value === right.value &&
    left.source?.author === right.source?.author,
  );



const ProviderIdentity = ({ provider }: { provider: ProviderExtension }) => (
  <div className="provider-identity">
    <div className="provider-icon" aria-hidden="true">
      {provider.icon ? <img src={provider.icon} alt="" /> : <Globe size={24} />}
    </div>
    <div className="provider-copy">
      <h3>{provider.display_name}</h3>
      <div className="provider-metadata">
        <span>v{provider.version}</span>
        <span className="provider-chip">{provider.type}</span>
        <span className="provider-chip source">{provider.source?.author}</span>
      </div>
    </div>
  </div>
);

export const ExtensionsPage: React.FC = () => {
  const {
    installedProviders,
    availableProviders,
    setInstalledProviders,
    setAvailableProviders,
    provider: activeProvider,
    setProvider,
  } = useContentStore();

  const [sources, setSources] = useState<ProviderSource[]>([]);
  const [activeSource, setActiveSource] = useState<ProviderSource | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [operationKey, setOperationKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sourceToRemove, setSourceToRemove] = useState<ProviderSource | null>(
    null,
  );
  const [providerToRemove, setProviderToRemove] =
    useState<ProviderExtension | null>(null);
  const [settingsProvider, setSettingsProvider] =
    useState<ProviderExtension | null>(null);
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const isAnyDialogOpen = Boolean(
    showSourcePicker ||
    showAddSource ||
    sourceToRemove ||
    providerToRemove ||
    settingsProvider
  );

  const { ref: pageFocusRef, focusKey: pageFocusKey } = useFocusable({
    focusable: !isAnyDialogOpen,
    trackChildren: true,
    saveLastFocusedChild: true,
    preferredChildFocusKey: "EXTENSIONS_SOURCE_PICKER",
  });

  const prevAnyDialogOpen = useRef(isAnyDialogOpen);
  useEffect(() => {
    if (prevAnyDialogOpen.current && !isAnyDialogOpen && tvMode) {
      let attempts = 0;
      const restoreFocus = () => {
        const target =
          sources.length > 0
            ? "EXTENSIONS_SOURCE_PICKER"
            : "EXTENSIONS_ADD_SOURCE";
        if (doesFocusableExist(target)) {
          setFocus(target);
        } else if (attempts < 8) {
          attempts++;
          setTimeout(restoreFocus, 35);
        }
      };
      setTimeout(restoreFocus, 40);
    }
    prevAnyDialogOpen.current = isAnyDialogOpen;
  }, [isAnyDialogOpen, tvMode, sources.length]);

  useEffect(() => {
    if (tvMode && !isAnyDialogOpen) {
      const timer = setTimeout(() => {
        const target =
          sources.length > 0
            ? "EXTENSIONS_SOURCE_PICKER"
            : "EXTENSIONS_ADD_SOURCE";
        if (doesFocusableExist(target)) {
          setFocus(target);
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [tvMode, isAnyDialogOpen, sources.length]);


  const refreshManifest = async (source: ProviderSource) => {
    try {
      setRefreshing(true);
      setError("");
      const providers = await extensionManager.fetchManifest(source, true);
      setAvailableProviders(providers);
      await updateProvidersService.checkForUpdatesAndAutoUpdate(true);
      setInstalledProviders(extensionStorage.getInstalledProviders());
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not refresh this provider source.",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const applySource = (source: ProviderSource, shouldRefresh = true) => {
    extensionStorage.setDefaultProviderSource(source.author);
    setSources(extensionStorage.getProviderSources());
    setActiveSource(source);
    setAvailableProviders(
      extensionStorage.getAvailableProviders(source.author),
    );
    if (shouldRefresh) void refreshManifest(source);
  };

  const loadSources = () => {
    const nextSources = extensionStorage.getProviderSources();
    const nextActive =
      extensionStorage.getProviderSource() ?? nextSources[0] ?? null;
    setSources(nextSources);
    setActiveSource(nextActive);
    setAvailableProviders(
      nextActive
        ? extensionStorage.getAvailableProviders(nextActive.author)
        : [],
    );
    if (nextActive) {
      const cached = extensionStorage.getAvailableProviders(nextActive.author);
      if (cached.length === 0) {
        void refreshManifest(nextActive);
      }
    } else {
      setShowAddSource(true);
    }
  };

  useEffect(() => {
    loadSources();
  }, []);

  const providers = useMemo(() => {
    const combined = new Map<
      string,
      ProviderExtension & { hasUpdate?: boolean; latestVersion?: string }
    >();

    availableProviders
      .filter((provider) => !provider.disabled)
      .forEach((provider) => combined.set(providerKey(provider), provider));

    installedProviders
      .filter((provider) => !provider.disabled)
      .forEach((provider) => {
        const available = combined.get(providerKey(provider));
        const hasSettings = Boolean(
          provider.hasSettings || available?.hasSettings,
        );
        const hasUpdate = Boolean(
          available && isNewerVersion(available.version, provider.version),
        );
        combined.set(providerKey(provider), {
          ...available,
          ...provider,
          hasSettings,
          hasUpdate,
          latestVersion: available?.version,
        });
      });

    return Array.from(combined.values()).sort((left, right) =>
      left.display_name.localeCompare(right.display_name),
    );
  }, [availableProviders, installedProviders]);

  const handleAddSource = () => {
    if (!inputValue.trim()) {
      setError("Enter a GitHub author or a valid provider source URL.");
      return;
    }

    try {
      const source = createProviderSource(inputValue);
      extensionStorage.addProviderSources(source.author, source.url);
      extensionStorage.setDefaultProviderSource(source.author);
      const nextSources = extensionStorage.getProviderSources();
      setSources(nextSources);
      setInputValue("");
      setError("");
      setShowAddSource(false);
      applySource(extensionStorage.getProviderSource() ?? source);
      if (tvMode) {
        let attempts = 0;
        const focusPicker = () => {
          if (doesFocusableExist("EXTENSIONS_SOURCE_PICKER")) {
            setFocus("EXTENSIONS_SOURCE_PICKER");
          } else if (doesFocusableExist("EXTENSIONS_ADD_SOURCE")) {
            setFocus("EXTENSIONS_ADD_SOURCE");
          } else if (attempts < 12) {
            attempts++;
            setTimeout(focusPicker, 35);
          }
        };
        setTimeout(focusPicker, 40);
      }
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Enter a GitHub author or a valid provider source URL.",
      );
    }
  };

  const handleCloseAddSource = () => {
    setShowAddSource(false);
    if (tvMode) {
      let attempts = 0;
      const restoreFocus = () => {
        const target =
          extensionStorage.getProviderSources().length > 0
            ? "EXTENSIONS_SOURCE_PICKER"
            : "EXTENSIONS_ADD_SOURCE";
        if (doesFocusableExist(target)) {
          setFocus(target);
        } else if (attempts < 8) {
          attempts++;
          setTimeout(restoreFocus, 35);
        }
      };
      setTimeout(restoreFocus, 40);
    }
  };

  const handleInstall = async (provider: ProviderExtension) => {
    const key = providerKey(provider);
    try {
      setOperationKey(key);
      setError("");
      await extensionManager.installProvider(provider);
      const nextInstalled = extensionStorage.getInstalledProviders();
      setInstalledProviders(nextInstalled);
      const activeStillExists = nextInstalled.some((item) =>
        isSameProvider(item, activeProvider),
      );
      if (!activeStillExists) {
        const installedProvider = nextInstalled.find((item) =>
          isSameProvider(item, provider),
        );
        if (installedProvider) setProvider(installedProvider);
      }
      if (tvMode) {
        let attempts = 0;
        const focusActions = () => {
          if (doesFocusableExist(`PROVIDER_SETTINGS_${key}`)) {
            setFocus(`PROVIDER_SETTINGS_${key}`);
          } else if (doesFocusableExist(`PROVIDER_REMOVE_${key}`)) {
            setFocus(`PROVIDER_REMOVE_${key}`);
          } else if (doesFocusableExist(`PROVIDER_USE_${key}`)) {
            setFocus(`PROVIDER_USE_${key}`);
          } else if (attempts < 10) {
            attempts++;
            setTimeout(focusActions, 40);
          } else {
            setFocus("EXTENSIONS_SOURCE_PICKER");
          }
        };
        setTimeout(focusActions, 50);
      }
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : `Could not install ${provider.display_name}.`,
      );
    } finally {
      setOperationKey(null);
    }
  };

  const handleUpdate = async (
    provider: ProviderExtension & { latestVersion?: string },
  ) => {
    const key = providerKey(provider);
    try {
      setOperationKey(key);
      setError("");
      const targetProvider: ProviderExtension = {
        ...provider,
        version: provider.latestVersion || provider.version,
      };
      await updateProvidersService.updateProvider(targetProvider);
      const nextInstalled = extensionStorage.getInstalledProviders();
      setInstalledProviders(nextInstalled);
      toast({
        title: "Extension Updated",
        message: `${provider.display_name} updated to v${targetProvider.version}`,
        type: "success",
      });
      if (tvMode) {
        let attempts = 0;
        const focusUpdate = () => {
          if (doesFocusableExist(`PROVIDER_SETTINGS_${key}`)) {
            setFocus(`PROVIDER_SETTINGS_${key}`);
          } else if (doesFocusableExist(`PROVIDER_REMOVE_${key}`)) {
            setFocus(`PROVIDER_REMOVE_${key}`);
          } else if (attempts < 10) {
            attempts++;
            setTimeout(focusUpdate, 40);
          }
        };
        setTimeout(focusUpdate, 50);
      }
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : `Could not update ${provider.display_name}.`,
      );
    } finally {
      setOperationKey(null);
    }
  };

  const handleUninstall = (provider: ProviderExtension) => {
    const key = providerKey(provider);
    extensionManager.uninstallProvider(provider.value, provider.source?.author);
    const remaining = extensionStorage.getInstalledProviders();
    setInstalledProviders(remaining);
    if (isSameProvider(activeProvider, provider)) {
      setProvider(
        remaining[0] ?? {
          value: "",
          display_name: "",
          type: "global",
          installed: false,
          disabled: false,
          version: "0.0.1",
          icon: "",
          source: { author: "", url: "" },
        },
      );
    }
    setProviderToRemove(null);
    if (tvMode) {
      let attempts = 0;
      const focusInstall = () => {
        if (doesFocusableExist(`PROVIDER_INSTALL_${key}`)) {
          setFocus(`PROVIDER_INSTALL_${key}`);
        } else if (attempts < 10) {
          attempts++;
          setTimeout(focusInstall, 40);
        } else {
          setFocus("EXTENSIONS_SOURCE_PICKER");
        }
      };
      setTimeout(focusInstall, 50);
    }
  };

  const handleRemoveSource = (source: ProviderSource) => {
    const providersFromSource = extensionStorage
      .getInstalledProviders()
      .filter((provider) => provider.source?.author === source.author);
    providersFromSource.forEach((provider) =>
      extensionManager.uninstallProvider(provider.value, source.author),
    );
    extensionStorage.removeProviderSource(source.author);

    const remainingInstalled = extensionStorage.getInstalledProviders();
    setInstalledProviders(remainingInstalled);
    if (activeProvider?.source?.author === source.author) {
      setProvider(
        remainingInstalled[0] ?? {
          value: "",
          display_name: "",
          type: "global",
          installed: false,
          disabled: false,
          version: "0.0.1",
          icon: "",
          source: { author: "", url: "" },
        },
      );
    }

    const nextSources = extensionStorage.getProviderSources();
    const nextActive =
      extensionStorage.getProviderSource() ?? nextSources[0] ?? null;
    setSources(nextSources);
    setActiveSource(nextActive);
    setSourceToRemove(null);
    if (nextActive) {
      applySource(nextActive);
    } else {
      setAvailableProviders([]);
      setShowSourcePicker(false);
      setShowAddSource(true);
    }
  };

  return (
    <FocusContext.Provider value={pageFocusKey}>
      <main ref={pageFocusRef} className="extensions-page">
      <header className="extensions-header">
        <div>
          <p className="extensions-eyebrow">Settings</p>
          <h1>Providers</h1>
          <p>Install and choose streaming sources</p>
        </div>
        <FocusableButton
          className="extensions-refresh-button"
          onClick={() => activeSource && void refreshManifest(activeSource)}
          disabled={!activeSource || refreshing}
          title="Refresh providers"
          focusKey="EXTENSIONS_REFRESH"
        >
          <RefreshCw size={20} className={refreshing ? "spin" : ""} />
        </FocusableButton>
      </header>

      {error && (
        <div className="extensions-error" role="alert">
          <AlertCircle size={19} />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            <X size={18} />
          </button>
        </div>
      )}

      <section
        className="source-control"
        aria-labelledby="provider-source-label"
      >
        <p id="provider-source-label">Provider source</p>
        <div className="source-control-row">
          <FocusableButton
            className="active-source-button"
            onClick={() => setShowSourcePicker(true)}
            disabled={sources.length === 0}
            focusKey="EXTENSIONS_SOURCE_PICKER"
          >
            <span className="source-control-icon">
              <Blocks size={21} />
            </span>
            <span className="active-source-copy">
              <small>
                {activeSource ? "Active source" : "No source selected"}
              </small>
              <strong>{activeSource?.author ?? "Add a source to begin"}</strong>
            </span>
            <ChevronDown size={20} />
          </FocusableButton>
          <FocusableButton
            className="add-source-button"
            onClick={() => setShowAddSource(true)}
            title="Add provider source"
            focusKey="EXTENSIONS_ADD_SOURCE"
          >
            <Plus size={23} />
          </FocusableButton>
        </div>
      </section>

      <section className="providers-section" aria-labelledby="providers-title">
        <div className="providers-section-heading">
          <div>
            <h2 id="providers-title">Providers</h2>
            <p>
              {providers.length}{" "}
              {providers.length === 1 ? "provider" : "providers"}
            </p>
          </div>
          {refreshing && (
            <span className="refreshing-label">
              <RefreshCw size={14} className="spin" /> Refreshing
            </span>
          )}
        </div>

        {providers.length === 0 ? (
          <div className="providers-empty-state">
            <span className="providers-empty-icon">
              <PackageOpen size={31} />
            </span>
            <h3>No providers available</h3>
            <p>
              {activeSource
                ? "Refresh this source or choose another one."
                : "Add a provider source to get started."}
            </p>
            {!activeSource && (
              <FocusableButton
                className="empty-add-source"
                onClick={() => setShowAddSource(true)}
                focusKey="EXTENSIONS_EMPTY_ADD_SOURCE"
              >
                <Plus size={18} /> Add source
              </FocusableButton>
            )}
          </div>
        ) : (
          <div className="providers-list">
            {providers.map((provider) => {
              const key = providerKey(provider);
              const installed = installedProviders.some((item) =>
                isSameProvider(item, provider),
              );
              const active =
                installed && isSameProvider(activeProvider, provider);
              const busy = operationKey === key;

              return (
                <article
                  className={`provider-card ${active ? "active" : ""} ${installed && !active ? "selectable" : ""}`}
                  key={key}
                  onClick={
                    installed && !active
                      ? () => setProvider(provider)
                      : undefined
                  }
                >
                  {installed && !active ? (
                    <FocusableButton
                      className="provider-select-target"
                      onClick={(event) => {
                        event.stopPropagation();
                        setProvider(provider);
                      }}
                      title={`Use ${provider.display_name}`}
                      aria-label={`Use ${provider.display_name}`}
                      focusKey={`PROVIDER_USE_${key}`}
                    >
                      <ProviderIdentity provider={provider} />
                    </FocusableButton>
                  ) : (
                    <ProviderIdentity provider={provider} />
                  )}
                  <div
                    className="provider-actions"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {installed ? (
                      <>
                        {active ? (
                          <span className="active-provider-chip">
                            <Check size={15} /> In use
                          </span>
                        ) : null}
                        {provider.hasUpdate && (
                          <FocusableButton
                            className="provider-update-button"
                            onClick={() => void handleUpdate(provider)}
                            disabled={busy}
                            title={`Update ${provider.display_name} to v${provider.latestVersion || ""}`}
                            focusKey={`PROVIDER_UPDATE_${key}`}
                          >
                            {busy ? (
                              <RefreshCw size={16} className="spin" />
                            ) : (
                              <RefreshCw size={16} />
                            )}
                            {busy ? "Updating" : "Update"}
                          </FocusableButton>
                        )}
                        {provider.hasSettings && (
                          <FocusableButton
                            className="provider-settings-button"
                            onClick={() => setSettingsProvider(provider)}
                            title={`${provider.display_name} Settings`}
                            focusKey={`PROVIDER_SETTINGS_${key}`}
                          >
                            <SettingsIcon size={18} />
                          </FocusableButton>
                        )}
                        <FocusableButton
                          className="provider-remove-button"
                          onClick={() => setProviderToRemove(provider)}
                          title={`Uninstall ${provider.display_name}`}
                          focusKey={`PROVIDER_REMOVE_${key}`}
                        >
                          <Trash2 size={18} />
                        </FocusableButton>
                      </>
                    ) : (
                      <FocusableButton
                        className="provider-install-button"
                        onClick={() => void handleInstall(provider)}
                        disabled={busy}
                        focusKey={`PROVIDER_INSTALL_${key}`}
                      >
                        {busy ? (
                          <RefreshCw size={18} className="spin" />
                        ) : (
                          <DownloadCloud size={18} />
                        )}
                        {busy ? "Installing" : "Install"}
                      </FocusableButton>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div
        style={{
          height: 100,
          minHeight: 100,
          width: "100%",
          flexShrink: 0,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      />

      <SourcePickerDialog
        open={showSourcePicker}
        onOpenChange={(open) => {
          setShowSourcePicker(open);
          if (!open && tvMode) {
            setTimeout(() => setFocus("EXTENSIONS_SOURCE_PICKER"), 50);
          }
        }}
        sources={sources}
        activeSource={activeSource}
        onApplySource={applySource}
        onRequestRemoveSource={setSourceToRemove}
      />

      <AddSourceDialog
        open={showAddSource}
        onOpenChange={(open) => {
          if (!open) handleCloseAddSource();
          else setShowAddSource(true);
        }}
        inputValue={inputValue}
        setInputValue={setInputValue}
        onAddSource={handleAddSource}
        canCancel={sources.length > 0}
      />

      <ConfirmActionDialog
        open={Boolean(sourceToRemove)}
        onOpenChange={(open) => {
          if (!open) {
            setSourceToRemove(null);
            if (tvMode)
              setTimeout(() => setFocus("EXTENSIONS_SOURCE_PICKER"), 50);
          }
        }}
        title={`Remove ${sourceToRemove?.author}?`}
        description="Providers installed from this source will also be removed from this device."
        confirmLabel="Remove source"
        focusKeyPrefix="REMOVE_SOURCE"
        onConfirm={() => {
          if (sourceToRemove) handleRemoveSource(sourceToRemove);
          if (tvMode)
            setTimeout(() => setFocus("EXTENSIONS_SOURCE_PICKER"), 50);
        }}
      />

      <ConfirmActionDialog
        open={Boolean(providerToRemove)}
        onOpenChange={(open) => {
          if (!open) {
            setProviderToRemove(null);
            if (tvMode)
              setTimeout(() => setFocus("EXTENSIONS_SOURCE_PICKER"), 50);
          }
        }}
        title={`Uninstall ${providerToRemove?.display_name}?`}
        description="You can install this provider again from its source later."
        confirmLabel="Uninstall"
        focusKeyPrefix="REMOVE_PROVIDER"
        onConfirm={() => {
          if (providerToRemove) handleUninstall(providerToRemove);
          setProviderToRemove(null);
          if (tvMode)
            setTimeout(() => setFocus("EXTENSIONS_SOURCE_PICKER"), 50);
        }}
      />

      <ProviderSettingsDialog
        provider={settingsProvider}
        open={Boolean(settingsProvider)}
        onOpenChange={(open) => {
          if (!open) {
            setSettingsProvider(null);
            if (tvMode)
              setTimeout(() => setFocus("EXTENSIONS_SOURCE_PICKER"), 50);
          }
        }}
      />
    </main>
  </FocusContext.Provider>
  );
};
