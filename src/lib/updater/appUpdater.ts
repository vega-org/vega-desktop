import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import type { Update } from '@tauri-apps/plugin-updater';
import { isTauriRuntime } from '../../platform/host';
import { settingsStorage } from '../storage';
import { useAppUpdateStore } from '../zustand/appUpdateStore';
import { toast } from '../zustand/toastStore';
import {
  GITHUB_RELEASES_API,
  buildReleaseTagUrl,
  fetchGitHubReleaseInfo,
  formatReleaseNotes,
  isNewerVersion,
  isSafeHttpUrl,
} from './releaseNotes';

export function getWebosUpdateVersion(): string | undefined {
  return import.meta.env?.VITE_TV_HOST === 'webos'
    ? import.meta.env.VITE_APP_VERSION
    : undefined;
}

let pendingUpdate: Update | null = null;
let activeAttemptId = 0;
let activeCheckPromise: Promise<void> | null = null;

async function closeUpdateHandle(update: Update | null): Promise<void> {
  if (!update) return;
  if (pendingUpdate === update) {
    pendingUpdate = null;
  }
  await update.close().catch(() => {});
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isSafeHttpUrl(url)) return;
  if (getWebosUpdateVersion() && typeof window !== 'undefined') {
    const { PalmServiceBridge } = window as Window & {
      PalmServiceBridge?: new () => {
        onservicecallback: (response: string) => void;
        call: (uri: string, params: string) => void;
      };
    };
    try {
      if (PalmServiceBridge) {
        const bridge = new PalmServiceBridge();
        bridge.onservicecallback = (response) => {
          try {
            if (JSON.parse(response).returnValue === true) return;
          } catch {}
          window.location.assign(url);
        };
        bridge.call('luna://com.webos.applicationManager/launch', JSON.stringify({
          id: 'com.webos.app.browser',
          params: { target: url },
        }));
        return;
      }
    } catch {}
    window.location.assign(url);
    return;
  }
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
}

function isRateLimitError(error: unknown): boolean {
  const err = error as {
    status?: number;
    response?: { status?: number };
    message?: string;
  } | null;
  const status = err?.status ?? err?.response?.status;
  if (status === 403 || status === 429) return true;
  return typeof err?.message === 'string' && /rate limit/i.test(err.message);
}

async function checkGitHubUpdates(
  currentVersion: string,
  manual: boolean,
  restoreFocusKey?: string,
): Promise<void> {
  const response = await fetch(`${GITHUB_RELEASES_API}/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 403 || response.status === 429) {
    throw Object.assign(new Error('GitHub API rate limit exceeded'), {
      status: response.status,
    });
  }
  if (!response.ok) {
    throw new Error(`Release check failed (${response.status})`);
  }
  const release = (await response.json()) as {
    tag_name?: string;
    body?: string;
    html_url?: string;
  };
  const latestVersion = release?.tag_name ?? '';
  if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
    await closeUpdateHandle(pendingUpdate);
    useAppUpdateStore.getState().showAvailable({
      currentVersion,
      targetVersion: latestVersion,
      releaseNotes:
        formatReleaseNotes(release.body) || 'A new version of Vega is available.',
      releaseUrl:
        release.html_url && isSafeHttpUrl(release.html_url)
          ? release.html_url
          : buildReleaseTagUrl(latestVersion),
      canAutoDownload: false,
      restoreFocusKey,
    });
    return;
  }

  if (manual) {
    toast({
      title: 'Up to Date',
      message: 'You are already on the latest version of Vega.',
      type: 'success',
    });
  }
}

async function checkDesktopUpdates(
  manual: boolean,
  restoreFocusKey?: string,
): Promise<void> {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();

  if (!update) {
    if (manual) {
      toast({
        title: 'Up to Date',
        message: 'You are already on the latest version of Vega Desktop.',
        type: 'success',
      });
    }
    return;
  }

  await closeUpdateHandle(pendingUpdate);
  pendingUpdate = update;

  const currentVersion =
    update.currentVersion || (await getVersion().catch(() => ''));
  const { notes, releaseUrl } = await fetchGitHubReleaseInfo(
    update.version,
    update.body,
  );

  useAppUpdateStore.getState().showAvailable({
    currentVersion,
    targetVersion: update.version,
    releaseNotes: notes,
    releaseUrl,
    canAutoDownload: true,
    restoreFocusKey,
  });
}

async function downloadAndInstallUpdate(update: Update): Promise<void> {
  const attemptId = ++activeAttemptId;
  const store = useAppUpdateStore.getState();
  store.setDownloading();

  let downloadedBytes = 0;
  let totalBytes: number | null = null;
  let lastEmitAt = 0;
  let lastPercent: number | null = null;

  try {
    await update.download((event) => {
      if (attemptId !== activeAttemptId) return;

      switch (event.event) {
        case 'Started': {
          const length = event.data.contentLength;
          totalBytes =
            typeof length === 'number' && Number.isFinite(length) && length > 0
              ? length
              : null;
          lastPercent = totalBytes ? 0 : null;
          lastEmitAt = Date.now();
          useAppUpdateStore.getState().updateProgress({
            downloadedBytes: 0,
            totalBytes,
            percent: lastPercent,
          });
          break;
        }
        case 'Progress': {
          downloadedBytes += event.data.chunkLength || 0;
          const percent = totalBytes
            ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
            : null;
          const now = Date.now();
          if (
            now - lastEmitAt >= 80 ||
            percent !== lastPercent ||
            lastEmitAt === 0
          ) {
            lastEmitAt = now;
            lastPercent = percent;
            useAppUpdateStore.getState().updateProgress({
              downloadedBytes,
              totalBytes,
              percent,
            });
          }
          break;
        }
        case 'Finished': {
          lastPercent = 100;
          lastEmitAt = Date.now();
          useAppUpdateStore.getState().updateProgress({
            downloadedBytes: totalBytes ?? downloadedBytes,
            totalBytes,
            percent: 100,
          });
          break;
        }
      }
    });

    if (attemptId !== activeAttemptId) {
      await closeUpdateHandle(update);
      return;
    }
  } catch (error) {
    if (attemptId !== activeAttemptId) {
      await closeUpdateHandle(update);
      return;
    }
    console.error('Failed to download app update:', error);
    useAppUpdateStore
      .getState()
      .setError(
        error instanceof Error
          ? error.message
          : 'Failed to download the update. Please check your connection and try again.',
      );
    return;
  }

  useAppUpdateStore.getState().setInstalling();
  if (pendingUpdate === update) {
    pendingUpdate = null;
  }

  try {
    await update.install();
  } catch (error) {
    if (attemptId !== activeAttemptId) return;
    console.error('Failed to install app update:', error);
    useAppUpdateStore
      .getState()
      .setError(
        error instanceof Error
          ? error.message
          : 'Failed to install the downloaded update.',
      );
    return;
  }

  if (attemptId !== activeAttemptId) return;

  try {
    await invoke('restart_app');
  } catch {
    // Some platforms/configurations may not relaunch cleanly via command; offer manual restart.
  }

  if (attemptId === activeAttemptId) {
    useAppUpdateStore.getState().setInstalled();
  }
}

export const checkAppUpdates = async (
  manual = false,
  options?: { restoreFocusKey?: string },
): Promise<void> => {
  const webosVersion = getWebosUpdateVersion();
  if (!webosVersion && !isTauriRuntime()) return;

  const currentStage = useAppUpdateStore.getState().stage;
  if (currentStage === 'downloading' || currentStage === 'installing') {
    return;
  }

  if (import.meta.env?.VITE_IS_MS_STORE === 'true') {
    if (manual) {
      toast({
        title: 'Microsoft Store',
        message: 'Updates are managed automatically by the Microsoft Store.',
        type: 'info',
      });
    }
    return;
  }

  if (activeCheckPromise) {
    return activeCheckPromise;
  }

  const runCheck = async () => {
    useAppUpdateStore.getState().setChecking(true);
    try {
      const userAgent =
        typeof navigator !== 'undefined'
          ? navigator.userAgent.toLowerCase()
          : '';
      if (webosVersion || userAgent.includes('android')) {
        await checkGitHubUpdates(webosVersion || await getVersion(), manual, options?.restoreFocusKey);
      } else {
        await checkDesktopUpdates(manual, options?.restoreFocusKey);
      }
    } catch (error) {
      console.error('Failed to check for app updates:', error);
      if (manual) {
        const rateLimited = isRateLimitError(error);
        toast({
          title: rateLimited ? 'Rate Limited' : 'Update Check Failed',
          message: rateLimited
            ? 'GitHub API rate limit exceeded. Please wait a few minutes before trying again.'
            : 'Failed to check for updates. Please check your internet connection.',
          type: 'error',
        });
      }
    } finally {
      useAppUpdateStore.getState().setChecking(false);
      activeCheckPromise = null;
    }
  };

  activeCheckPromise = runCheck();
  return activeCheckPromise;
};

export const startAppUpdate = async (): Promise<void> => {
  const { canAutoDownload, releaseUrl } = useAppUpdateStore.getState();

  if (
    !canAutoDownload ||
    !settingsStorage.isAutoDownloadEnabled() ||
    !pendingUpdate
  ) {
    await openExternalUrl(releaseUrl);
    await closeUpdateHandle(pendingUpdate);
    useAppUpdateStore.getState().reset();
    return;
  }

  await downloadAndInstallUpdate(pendingUpdate);
};

export const cancelOrDismissAppUpdate = (): void => {
  const { stage } = useAppUpdateStore.getState();
  if (stage === 'installing') return;

  if (stage === 'downloading') {
    activeAttemptId++;
    useAppUpdateStore.getState().reset();
    return;
  }

  void closeUpdateHandle(pendingUpdate);
  useAppUpdateStore.getState().reset();
};

export const retryAppUpdate = async (): Promise<void> => {
  if (pendingUpdate) {
    await downloadAndInstallUpdate(pendingUpdate);
    return;
  }

  try {
    useAppUpdateStore.getState().setDownloading();
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      useAppUpdateStore.getState().reset();
      toast({
        title: 'Up to Date',
        message: 'You are already on the latest version of Vega Desktop.',
        type: 'success',
      });
      return;
    }
    pendingUpdate = update;
    await downloadAndInstallUpdate(update);
  } catch (error) {
    console.error('Failed to retry app update:', error);
    useAppUpdateStore
      .getState()
      .setError(
        error instanceof Error
          ? error.message
          : 'Failed to retry the update. Please check your internet connection.',
      );
  }
};

export const restartAfterUpdate = async (): Promise<void> => {
  try {
    await invoke('restart_app');
  } catch (error) {
    console.error('Failed to restart after update:', error);
    toast({
      title: 'Restart Required',
      message: 'Please close and reopen Vega manually to finish updating.',
      type: 'error',
    });
  }
};

export const openUpdateReleasePage = async (): Promise<void> => {
  const { releaseUrl } = useAppUpdateStore.getState();
  await openExternalUrl(releaseUrl);
};

export const resetAppUpdaterForTest = async (): Promise<void> => {
  activeAttemptId++;
  activeCheckPromise = null;
  await closeUpdateHandle(pendingUpdate);
  useAppUpdateStore.getState().reset();
};
