import {enableProxy, proxyEnabled} from '../../platform/proxyHost';
import {useEffect, useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  getPlatformHost,
  isBrowserExtensionInstalled,
  isBrowserExtensionPermissionMissing,
  isTauriRuntime,
  waitForPlatformHost,
} from '../../platform/host';
import {useDialogFocusBoundary} from '../../lib/hooks/useDialogFocusBoundary';
import {FocusableButton} from '../layout/FocusableButton';

export const BROWSER_EXTENSION_STORE_URL = 'https://chromewebstore.google.com/detail/vega/iofleagpffjfcaegclkgbjjfeoinmjhe';

export function browserExtensionRequired() {
  if (isTauriRuntime() || import.meta.env.VITE_TV_HOST) return false;
  if (!isBrowserExtensionInstalled() && proxyEnabled()) return false;
  try {
    const host = getPlatformHost();
    return !(host?.kind === 'browser-extension' && typeof host.request === 'function' &&
      host.capabilities.publicDestinationChecks && host.capabilities.restrictedHeaders &&
      host.capabilities.isolatedCookies && host.capabilities.manualRedirects && host.capabilities.mediaDelivery);
  } catch { return true; }
}

export function useBrowserExtensionRequired() {
  const [required, setRequired] = useState(browserExtensionRequired);
  useEffect(() => {
    let active = true;
    const update = () => {if (active) setRequired(browserExtensionRequired());};
    window.addEventListener('vega-platform-host-change', update);
    window.addEventListener('focus', update);
    const timer = setTimeout(update, 2000);
    void window.vegaPlatformHostReady?.then(update, update);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('vega-platform-host-change', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  return required;
}

export function BrowserExtensionPrompt({open, onOpenChange, onSkip}: {open:boolean; onOpenChange:(open:boolean)=>void; onSkip?:()=>void}) {
  const extensionInstalled = isBrowserExtensionInstalled();
  const {ref, DialogFocusProvider} = useDialogFocusBoundary({isOpen:open,
    focusKey:'BROWSER_EXTENSION_DIALOG',
    preferredChildFocusKey: extensionInstalled ? 'BROWSER_EXTENSION_RELOAD' : 'BROWSER_EXTENSION_INSTALL',
    restoreFocusKey:'EXTENSIONS_ADD_SOURCE'});
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="extensions-dialog-overlay" />
      <DialogFocusProvider>
        <Dialog.Content ref={ref as any} className="extensions-dialog-content"
          onOpenAutoFocus={event=>event.preventDefault()}>
          {extensionInstalled ? (
            <>
              <Dialog.Title>Allow website access in the Vega extension</Dialog.Title>
              <Dialog.Description>The Vega extension is installed, so Vega uses it instead of the hosted proxy. Grant website access to continue.</Dialog.Description>
              <p style={{marginTop:16, lineHeight:1.6}}>Open the Vega extension popup, choose <strong>Allow all websites</strong>, approve the browser prompt, and reload Vega.</p>
              <div className="extensions-dialog-actions" style={{flexWrap:'wrap'}}>
                <FocusableButton focusKey="BROWSER_EXTENSION_CANCEL" className="dialog-text-button"
                  onClick={()=>onOpenChange(false)}>Cancel</FocusableButton>
                <FocusableButton focusKey="BROWSER_EXTENSION_RELOAD" className="dialog-primary-button"
                  onClick={()=>window.location.reload()}>Reload Vega</FocusableButton>
              </div>
            </>
          ) : (
            <>
              <Dialog.Title>Recommended: install the Vega extension</Dialog.Title>
              <Dialog.Description>Install the Vega extension for better playback and provider compatibility. You can also skip it and use the hosted proxy.</Dialog.Description>
              <p style={{marginTop:16, lineHeight:1.6}}>After installing, open the extension and choose <strong>Allow all websites</strong>, then reload Vega.</p>
              <div className="extensions-dialog-actions" style={{flexWrap:'wrap'}}>
                <FocusableButton focusKey="BROWSER_EXTENSION_CANCEL" className="dialog-text-button"
                  onClick={()=>onOpenChange(false)}>Cancel</FocusableButton>
                {onSkip && (
                  <FocusableButton focusKey="BROWSER_EXTENSION_SKIP" className="dialog-text-button"
                    onClick={()=>{enableProxy(); onSkip();}}>Skip and use proxy</FocusableButton>
                )}
                <FocusableButton focusKey="BROWSER_EXTENSION_RELOAD" className="dialog-text-button"
                  onClick={()=>window.location.reload()}>Reload Vega</FocusableButton>
                <FocusableButton focusKey="BROWSER_EXTENSION_INSTALL" className="dialog-primary-button"
                  onClick={()=>window.open(BROWSER_EXTENSION_STORE_URL, '_blank', 'noopener,noreferrer')}>Install extension</FocusableButton>
              </div>
            </>
          )}
        </Dialog.Content>
      </DialogFocusProvider>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function BrowserExtensionPermissionPrompt() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isTauriRuntime() || import.meta.env.VITE_TV_HOST) return;
    let active = true;
    const sync = () => {
      if (!active) return;
      const missing = isBrowserExtensionPermissionMissing();
      if (!missing) {
        setOpen(false);
        setDismissed(false);
      } else if (!dismissed) {
        setOpen(true);
      }
    };

    void waitForPlatformHost().then(sync);
    window.addEventListener('vega-platform-host-change', sync);
    window.addEventListener('focus', sync);
    return () => {
      active = false;
      window.removeEventListener('vega-platform-host-change', sync);
      window.removeEventListener('focus', sync);
    };
  }, [dismissed]);

  return (
    <BrowserExtensionPrompt
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setDismissed(true);
      }}
    />
  );
}
