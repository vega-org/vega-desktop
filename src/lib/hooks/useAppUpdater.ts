import { useEffect } from 'react';
import { isTauriRuntime } from '../../platform/host';
import { settingsStorage } from '../storage';
import { checkAppUpdates, getWebosUpdateVersion } from '../updater/appUpdater';

export { checkAppUpdates };

export const useAppUpdater = () => {
  useEffect(() => {
    if (!isTauriRuntime() && !getWebosUpdateVersion()) return;
    if (import.meta.env?.VITE_IS_MS_STORE === 'true') return;
    if (!settingsStorage.isAutoCheckUpdateEnabled()) return;

    const timer = setTimeout(() => {
      void checkAppUpdates(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);
};
