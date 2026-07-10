import { useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { ask, message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { settingsStorage } from '../storage';
import axios from 'axios';

// Helper to compare semver versions simply for Android
const isNewer = (latest: string, current: string) => {
  if (!latest || !current) return false;
  const l = latest.replace(/[^0-9.]/g, '').split('.').map(Number);
  const c = current.replace(/[^0-9.]/g, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const lPart = l[i] || 0;
    const cPart = c[i] || 0;
    if (lPart > cPart) return true;
    if (lPart < cPart) return false;
  }
  return false;
};

export const checkAppUpdates = async (manual = false) => {
  try {
    const userAgent = navigator.userAgent.toLowerCase();

    // 0. Disable updater for Microsoft Store builds
    if (import.meta.env.VITE_IS_MS_STORE === 'true') {
      if (manual) {
        message('Updates are managed automatically by the Microsoft Store.', { title: 'Microsoft Store', kind: 'info' });
      }
      return;
    }
    // 1. Custom fallback for Android
    if (userAgent.includes('android')) {
      const { data: release } = await axios.get(
        'https://api.github.com/repos/vega-org/vega-desktop/releases/latest'
      );
      const latestVersion = release?.tag_name;
      const currentVersion = await getVersion();
      
      if (latestVersion && isNewer(latestVersion, currentVersion)) {
        const wantToUpdate = await ask(
          `Version ${latestVersion} is available! Would you like to go to the download page to get the new APK?`,
          { title: 'Vega App Update', kind: 'info' }
        );
        if (wantToUpdate) {
          openUrl(release.html_url);
        }
      } else if (manual) {
        message('You are already on the latest version of Vega App.', { title: 'Up to Date', kind: 'info' });
      }
      return;
    }

    // 2. Official Tauri Auto-Updater for Desktop
    const { check } = await import('@tauri-apps/plugin-updater');
    
    // Checks the endpoints defined in tauri.conf.json
    const update = await check();

    if (!update) {
      if (manual) {
        message('You are already on the latest version of Vega Desktop.', { title: 'Up to Date', kind: 'info' });
      }
      return;
    }

    const autoInstall = settingsStorage.isAutoDownloadEnabled();

    if (!autoInstall) {
      const wantToUpdate = await ask(
        `Version ${update.version} is available!\n\nRelease notes:\n${update.body || 'New version available.'}\n\nWould you like to install it now?`,
        { title: 'Vega Desktop Update', kind: 'info' }
      );
      if (!wantToUpdate) return;
    } else {
      // If auto install is ON, just show a toast/message that we're downloading
      message(`Downloading new version (${update.version}) in the background. The app will restart when ready.`, { title: 'Updating Vega Desktop' });
    }

    console.log(`Downloading update ${update.version}...`);

    let downloaded = 0;
    let contentLength = 0;

    // This seamlessly downloads the patch and overwrites the files silently
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength || 0;
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          if (downloaded % (1024 * 1024 * 5) === 0) {
            console.log(`Downloaded ${downloaded} of ${contentLength} bytes`);
          }
          break;
        case 'Finished':
          console.log('Download finished! Restarting...');
          break;
      }
    });

    // NOTE: On Windows, downloadAndInstall will automatically close the app and launch the installer in silent mode.
    // So the app will restart itself automatically here!

  } catch (err: any) {
    console.error('Failed to check for app updates:', err);
    if (manual) {
      message('Failed to check for updates. Please check your internet connection.', { title: 'Error', kind: 'error' });
    }
  }
};

export const useAppUpdater = () => {
  useEffect(() => {
    // @ts-ignore - Tauri injects this globally
    if (!window.__TAURI_INTERNALS__) return;

    if (!settingsStorage.isAutoCheckUpdateEnabled()) return;

    // Run after a short delay so we don't slow down initial render
    const timer = setTimeout(() => {
      checkAppUpdates(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);
};
