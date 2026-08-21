import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { resume } from "@noriginmedia/norigin-spatial-navigation-core";
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

const ExtensionInput: React.FC<{
  inputValue: string;
  setInputValue: (value: string) => void;
  onSubmit: () => void;
  tvMode: boolean;
}> = ({ inputValue, setInputValue, onSubmit, tvMode }) => {
  const [isTyping, setIsTyping] = useState(false);
  const nativeInputRef = useRef<HTMLInputElement>(null);
  const { ref, focused, focusSelf } = useFocusable({
    focusable: tvMode,
    focusKey: "EXTENSION_SOURCE_INPUT",
    onEnterPress: () => {
      setIsTyping(true);
      setTimeout(() => nativeInputRef.current?.focus(), 50);
    },
  });

  const beginTyping = () => {
    setIsTyping(true);
    setTimeout(() => nativeInputRef.current?.focus(), 50);
  };

  const finishTyping = () => {
    setIsTyping(false);
    if (tvMode) {
      setTimeout(() => {
        resume();
        focusSelf();
      }, 100);
    }
  };

  return (
    <div
      ref={ref}
      className={`extension-dialog-input ${focused ? "tv-focus" : ""}`}
      onClick={beginTyping}
    >
      <Globe size={19} aria-hidden="true" />
      <input
        ref={nativeInputRef}
        type="text"
        readOnly={tvMode ? !isTyping : false}
        placeholder="GitHub author or provider source URL"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onBlur={finishTyping}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            nativeInputRef.current?.blur();
            onSubmit();
          } else if (event.key === "Escape") {
            nativeInputRef.current?.blur();
          }
          event.stopPropagation();
        }}
        aria-label="Provider source"
      />
    </div>
  );
};

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
  const tvMode = settingsStorage.isTvModeEnabled();

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
      setInputValue("");
      setError("");
      setShowAddSource(false);
      applySource(extensionStorage.getProviderSource() ?? source);
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Enter a GitHub author or a valid provider source URL.",
      );
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
    <main className="extensions-page">
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

      <Dialog.Root open={showSourcePicker} onOpenChange={setShowSourcePicker}>
        <Dialog.Portal>
          <Dialog.Overlay className="extensions-dialog-overlay" />
          <Dialog.Content className="extensions-dialog-content">
            <div className="extensions-dialog-header">
              <div>
                <Dialog.Title>Provider sources</Dialog.Title>
                <Dialog.Description>
                  Choose the manifest used to discover providers.
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="extensions-dialog-close"
                aria-label="Close"
              >
                <X size={20} />
              </Dialog.Close>
            </div>
            <div className="source-picker-list">
              {sources.map((source) => {
                const selected = activeSource?.author === source.author;
                return (
                  <div
                    className={`source-picker-item ${selected ? "selected" : ""}`}
                    key={source.author}
                  >
                    <FocusableButton
                      className="source-picker-main"
                      onClick={() => {
                        applySource(source);
                        setShowSourcePicker(false);
                      }}
                    >
                      <span className="source-control-icon">
                        <Blocks size={19} />
                      </span>
                      <span>
                        <strong>{source.author}</strong>
                        <small>{source.url}</small>
                      </span>
                      {selected && <Check size={20} />}
                    </FocusableButton>
                    <FocusableButton
                      className="source-picker-remove"
                      onClick={() => setSourceToRemove(source)}
                      title={`Remove ${source.author}`}
                    >
                      <Trash2 size={18} />
                    </FocusableButton>
                  </div>
                );
              })}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showAddSource} onOpenChange={setShowAddSource}>
        <Dialog.Portal>
          <Dialog.Overlay className="extensions-dialog-overlay" />
          <Dialog.Content className="extensions-dialog-content add-source-dialog">
            <div className="extensions-dialog-header">
              <div>
                <Dialog.Title>Add source</Dialog.Title>
                <Dialog.Description>
                  Enter a GitHub author or a hosted provider manifest URL.
                </Dialog.Description>
              </div>
              {sources.length > 0 && (
                <Dialog.Close
                  className="extensions-dialog-close"
                  aria-label="Close"
                >
                  <X size={20} />
                </Dialog.Close>
              )}
            </div>
            <ExtensionInput
              inputValue={inputValue}
              setInputValue={setInputValue}
              onSubmit={handleAddSource}
              tvMode={tvMode}
            />
            <div className="extensions-dialog-actions">
              {sources.length > 0 && (
                <Dialog.Close className="dialog-text-button">
                  Cancel
                </Dialog.Close>
              )}
              <FocusableButton
                className="dialog-primary-button"
                onClick={handleAddSource}
              >
                <Plus size={18} /> Add source
              </FocusableButton>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={Boolean(sourceToRemove)}
        onOpenChange={(open) => !open && setSourceToRemove(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="extensions-dialog-overlay nested" />
          <Dialog.Content className="extensions-dialog-content confirm-dialog">
            <span className="confirm-dialog-icon">
              <Trash2 size={23} />
            </span>
            <Dialog.Title>Remove {sourceToRemove?.author}?</Dialog.Title>
            <Dialog.Description>
              Providers installed from this source will also be removed from
              this device.
            </Dialog.Description>
            <div className="extensions-dialog-actions">
              <Dialog.Close className="dialog-text-button">Cancel</Dialog.Close>
              <FocusableButton
                className="dialog-danger-button"
                onClick={() =>
                  sourceToRemove && handleRemoveSource(sourceToRemove)
                }
              >
                Remove source
              </FocusableButton>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={Boolean(providerToRemove)}
        onOpenChange={(open) => !open && setProviderToRemove(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="extensions-dialog-overlay" />
          <Dialog.Content className="extensions-dialog-content confirm-dialog">
            <span className="confirm-dialog-icon">
              <Trash2 size={23} />
            </span>
            <Dialog.Title>
              Uninstall {providerToRemove?.display_name}?
            </Dialog.Title>
            <Dialog.Description>
              You can install this provider again from its source later.
            </Dialog.Description>
            <div className="extensions-dialog-actions">
              <Dialog.Close className="dialog-text-button">Cancel</Dialog.Close>
              <FocusableButton
                className="dialog-danger-button"
                onClick={() =>
                  providerToRemove && handleUninstall(providerToRemove)
                }
              >
                Uninstall
              </FocusableButton>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ProviderSettingsDialog
        provider={settingsProvider}
        open={Boolean(settingsProvider)}
        onOpenChange={(open) => !open && setSettingsProvider(null)}
      />
    </main>
  );
};
