import { extensionStorage, ProviderExtension } from "../storage/extensionStorage";
import { extensionManager } from "./ExtensionManager";
import { settingsStorage } from "../storage";
import { toast } from "../zustand/toastStore";

export interface UpdateInfo {
  provider: ProviderExtension;
  currentVersion: string;
  newVersion: string;
  hasUpdate: boolean;
}

class UpdateProvidersService {
  private isUpdating = false;
  private updateCheckInterval: ReturnType<typeof setInterval> | null = null;
  private readonly updateCheckIntervalMs = 15 * 60 * 1000;
  private lastAutoCheckTime = 0;
  private focusHandler: (() => void) | null = null;

  private ensureInstalledProvidersHaveSource(
    providers: ProviderExtension[],
  ): ProviderExtension[] {
    const defaultSource = extensionStorage.getProviderSource();
    if (!defaultSource) {
      return providers;
    }

    let hasChanges = false;
    const normalized = providers.map((provider) => {
      if (provider.source?.author && provider.source?.url) {
        return provider;
      }

      hasChanges = true;
      return {
        ...provider,
        source: {
          author: defaultSource.author,
          url: defaultSource.url,
        },
      };
    });

    if (hasChanges) {
      extensionStorage.setInstalledProviders(normalized);
    }

    return normalized;
  }

  /**
   * Check for updates for all installed providers
   */
  async checkForUpdates(force = true): Promise<UpdateInfo[]> {
    try {
      // Ensure legacy users are migrated before running update checks.
      await extensionManager.initialize();

      const installedProviders = this.ensureInstalledProvidersHaveSource(
        extensionStorage.getInstalledProviders(),
      );
      const sources = new Map<string, ProviderExtension[]>();
      const sourceByAuthor = new Map<string, { author: string; url: string }>();

      for (const provider of installedProviders) {
        if (provider.source) {
          const author = provider.source.author || "unknown";
          if (!sourceByAuthor.has(author)) {
            sourceByAuthor.set(author, provider.source);
          }
        }
      }

      for (const [author, source] of sourceByAuthor.entries()) {
        try {
          const availableProviders =
            await extensionManager.fetchManifest(source, force);
          sources.set(author, availableProviders);
        } catch (error) {
          console.warn(`Failed to fetch source ${author} for updates:`, error);
          sources.set(author, []);
        }
      }

      const updateInfos: UpdateInfo[] = [];

      for (const installed of installedProviders) {
        const available = sources
          .get(installed.source?.author || "unknown")
          ?.find((p) => p.value === installed.value);

        if (
          available &&
          this.isNewerVersion(available.version, installed.version)
        ) {
          updateInfos.push({
            provider: available,
            currentVersion: installed.version,
            newVersion: available.version,
            hasUpdate: true,
          });
        } else {
          updateInfos.push({
            provider: installed,
            currentVersion: installed.version,
            newVersion: installed.version,
            hasUpdate: false,
          });
        }
      }

      return updateInfos;
    } catch (error) {
      console.error("Error checking for updates:", error);
      return [];
    }
  }

  /**
   * Update a specific provider
   */
  async updateProvider(provider: ProviderExtension): Promise<boolean> {
    try {
      // Uninstall old version
      extensionStorage.uninstallProvider(
        provider.value,
        provider.source?.author,
      );

      // Install new version
      await extensionManager.installProvider(provider);

      return true;
    } catch (error) {
      console.error("Error updating provider:", error);
      return false;
    }
  }

  /**
   * Update multiple providers with progress notifications
   */
  async updateProviders(
    providers: ProviderExtension[],
    options?: { showNotifications?: boolean },
  ): Promise<{
    updated: ProviderExtension[];
    failed: ProviderExtension[];
  }> {
    if (this.isUpdating || providers.length === 0) {
      return { updated: [], failed: [] };
    }

    const shouldNotify = options?.showNotifications ?? true;

    this.isUpdating = true;
    const updated: ProviderExtension[] = [];
    const failed: ProviderExtension[] = [];

    try {
      // Show updating notification
      if (shouldNotify) {
        await this.showUpdatingNotification(providers);
      }

      for (const provider of providers) {
        const success = await this.updateProvider(provider);
        if (success) {
          updated.push(provider);
        } else {
          failed.push(provider);
        }
      }

      // Show completion notification
      if (shouldNotify) {
        await this.showUpdateCompleteNotification(updated, failed);
      }

      return { updated, failed };
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Check for updates and automatically start updating if updates are available
   */
  async checkForUpdatesAndAutoUpdate(force = true): Promise<UpdateInfo[]> {
    const updateInfos = await this.checkForUpdates(force);
    const availableUpdates = updateInfos.filter((info) => info.hasUpdate);
    if (availableUpdates.length > 0) {
      // Automatically start updating instead of just showing notification.
      const providersToUpdate = availableUpdates.map((update) => update.provider);
      const showNotifications = settingsStorage.isNotificationsEnabled();
      // Don't await here to avoid blocking - let it run in background
      this.updateProviders(providersToUpdate, { showNotifications });
    }
    return updateInfos;
  }

  /**
   * Check for updates without auto-updating (for manual refresh)
   */
  async checkForUpdatesManual(force = true): Promise<UpdateInfo[]> {
    return await this.checkForUpdates(force);
  }

  /**
   * Start automatic update checking
   */
  startAutomaticUpdateCheck(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
    }
    if (this.focusHandler) {
      window.removeEventListener("focus", this.focusHandler);
      document.removeEventListener("visibilitychange", this.focusHandler);
    }

    // Check immediately on startup
    this.checkForUpdatesAndAutoUpdate(true).catch((error) => {
      console.warn("Automatic provider update check failed:", error);
    });

    // Check on window focus / visibility change with a 30s cooldown
    this.focusHandler = () => {
      const now = Date.now();
      if (
        document.visibilityState === "visible" &&
        now - this.lastAutoCheckTime > 30000 &&
        !this.isUpdating
      ) {
        this.lastAutoCheckTime = now;
        this.checkForUpdatesAndAutoUpdate(true).catch((error) => {
          console.warn("Focus provider update check failed:", error);
        });
      }
    };

    window.addEventListener("focus", this.focusHandler);
    document.addEventListener("visibilitychange", this.focusHandler);

    // Continue checking periodically in the background
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdatesAndAutoUpdate(true).catch((error) => {
        console.warn("Scheduled provider update check failed:", error);
      });
    }, this.updateCheckIntervalMs);
  }

  /**
   * Stop automatic update checking
   */
  stopAutomaticUpdateCheck(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
    if (this.focusHandler) {
      window.removeEventListener("focus", this.focusHandler);
      document.removeEventListener("visibilitychange", this.focusHandler);
      this.focusHandler = null;
    }
  }

  /**
   * Compare version strings to determine if newVersion is newer than currentVersion
   */
  private isNewerVersion(newVersion: string, currentVersion: string): boolean {
    const parseVersion = (version: string) => {
      return version.split(".").map((part) => parseInt(part, 10) || 0);
    };

    const newParts = parseVersion(newVersion);
    const currentParts = parseVersion(currentVersion);

    for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
      const newPart = newParts[i] || 0;
      const currentPart = currentParts[i] || 0;

      if (newPart > currentPart) {
        return true;
      }
      if (newPart < currentPart) {
        return false;
      }
    }

    return false;
  }

  /**
   * Show notification when providers are being updated
   */
  private async showUpdatingNotification(
    providers: ProviderExtension[],
  ): Promise<void> {
    toast({
      title: "Updating Extensions",
      message: `Updating ${providers.length} extension${providers.length > 1 ? "s" : ""}...`,
      type: "info",
      duration: 3000,
    });
  }

  private async showUpdateCompleteNotification(
    updated: ProviderExtension[],
    failed: ProviderExtension[],
  ): Promise<void> {
    if (updated.length === 0 && failed.length === 0) return;

    if (updated.length > 0 && failed.length === 0) {
      toast({
        title: "Extensions Updated",
        message: `Successfully updated: ${updated.map((p) => p.display_name).join(", ")}`,
        type: "success",
        duration: 4500,
      });
    } else if (updated.length > 0 && failed.length > 0) {
      toast({
        title: "Extensions Update",
        message: `${updated.length} updated, ${failed.length} failed (${failed.map((p) => p.display_name).join(", ")})`,
        type: "warning",
        duration: 5000,
      });
    } else {
      toast({
        title: "Update Failed",
        message: `Failed to update ${failed.length} extension(s)`,
        type: "error",
        duration: 5000,
      });
    }
  }

  /**
   * Get current updating state
   */
  get updating(): boolean {
    return this.isUpdating;
  }
}

export const updateProvidersService = new UpdateProvidersService();
