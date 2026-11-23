import React, { useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { doesFocusableExist, setFocus } from '@noriginmedia/norigin-spatial-navigation-core';
import {
  LuCircleAlert as AlertCircle,
  LuCircleCheck as CheckCircle,
  LuDownload as Download,
  LuLoaderCircle as Loader,
  LuSparkles as Sparkles,
  LuX as X,
} from 'react-icons/lu';
import { useDialogFocusBoundary } from '../../lib/hooks/useDialogFocusBoundary';
import { settingsStorage } from '../../lib/storage';
import {
  cancelOrDismissAppUpdate,
  openUpdateReleasePage,
  restartAfterUpdate,
  retryAppUpdate,
  startAppUpdate,
} from '../../lib/updater/appUpdater';
import {
  formatBytes,
  formatVersionLabel,
} from '../../lib/updater/releaseNotes';
import { useAppUpdateStore } from '../../lib/zustand/appUpdateStore';
import { FocusableButton } from '../layout/FocusableButton';
import { ReleaseNotesMarkdown } from './ReleaseNotesMarkdown';
import './AppUpdateDialog.css';

const STAGE_TITLES = {
  available: 'Update Available',
  downloading: 'Downloading Update',
  installing: 'Installing Update',
  installed: 'Update Installed',
  error: 'Update Failed',
} as const;

export const AppUpdateDialog: React.FC = () => {
  const {
    stage,
    currentVersion,
    targetVersion,
    releaseNotes,
    canAutoDownload,
    progress,
    errorMessage,
    restoreFocusKey,
  } = useAppUpdateStore();

  const isOpen = stage !== 'idle';
  const canDirectUpdate =
    canAutoDownload && settingsStorage.isAutoDownloadEnabled();
  const isBusyStage = stage === 'downloading' || stage === 'installing';

  const preferredChildFocusKey =
    stage === 'available'
      ? 'APP_UPDATE_CONFIRM'
      : stage === 'downloading'
        ? 'APP_UPDATE_CANCEL'
        : stage === 'installed'
          ? 'APP_UPDATE_RESTART'
          : stage === 'error'
            ? 'APP_UPDATE_RETRY'
            : undefined;

  const { ref, DialogFocusProvider } = useDialogFocusBoundary({
    isOpen,
    focusKey: 'APP_UPDATE_DIALOG',
    preferredChildFocusKey,
    restoreFocusKey,
  });

  useEffect(() => {
    if (!isOpen || !preferredChildFocusKey) return;
    const timer = window.setTimeout(() => {
      if (doesFocusableExist(preferredChildFocusKey)) {
        setFocus(preferredChildFocusKey);
      }
    }, 35);
    return () => window.clearTimeout(timer);
  }, [isOpen, stage, preferredChildFocusKey]);

  if (!isOpen) return null;

  const currentLabel = formatVersionLabel(currentVersion);
  const targetLabel = formatVersionLabel(targetVersion);
  const versionSummary =
    currentLabel && targetLabel && currentLabel !== targetLabel
      ? `${currentLabel} -> ${targetLabel}`
      : targetLabel || currentLabel;

  const renderStageIcon = () => {
    switch (stage) {
      case 'available':
        return <Sparkles size={20} />;
      case 'downloading':
        return <Download size={20} />;
      case 'installing':
        return <Loader size={20} className="app-update-spin" />;
      case 'installed':
        return <CheckCircle size={20} />;
      case 'error':
        return <AlertCircle size={20} />;
    }
  };

  const progressText =
    progress.totalBytes !== null
      ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
      : `${formatBytes(progress.downloadedBytes)} downloaded`;

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (open || isBusyStage) return;
        cancelOrDismissAppUpdate();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="extensions-dialog-overlay" />
        <DialogFocusProvider>
          <Dialog.Content
            ref={ref as any}
            className="extensions-dialog-content app-update-dialog"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              if (isBusyStage) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (isBusyStage) event.preventDefault();
            }}
          >
            <div className="extensions-dialog-header">
              <div className="app-update-title-row">
                <span
                  className={`app-update-icon ${stage === 'error' ? 'error' : ''}`}
                  aria-hidden="true"
                >
                  {renderStageIcon()}
                </span>
                <div className="app-update-heading">
                  <Dialog.Title>{STAGE_TITLES[stage]}</Dialog.Title>
                  {versionSummary && (
                    <span className="app-update-version-pill">
                      {versionSummary}
                    </span>
                  )}
                </div>
              </div>
              {stage !== 'installing' && (
                <FocusableButton
                  className="extensions-dialog-close"
                  focusKey="APP_UPDATE_CLOSE"
                  onClick={cancelOrDismissAppUpdate}
                  aria-label="Close update dialog"
                >
                  <X size={20} />
                </FocusableButton>
              )}
            </div>

            {stage === 'available' && (
              <>
                <Dialog.Description className="app-update-subtitle">
                  {canDirectUpdate
                    ? 'A new version of Vega is ready to install.'
                    : 'A new version of Vega is available on GitHub.'}
                </Dialog.Description>
                <div className="app-update-notes-label">What&apos;s New</div>
                <div className="app-update-notes" tabIndex={0}>
                  <ReleaseNotesMarkdown markdown={releaseNotes} />
                </div>
                <div className="extensions-dialog-actions">
                  <FocusableButton
                    className="dialog-text-button"
                    focusKey="APP_UPDATE_LATER"
                    onClick={cancelOrDismissAppUpdate}
                  >
                    Later
                  </FocusableButton>
                  <FocusableButton
                    className="dialog-primary-button"
                    focusKey="APP_UPDATE_CONFIRM"
                    onClick={() => void startAppUpdate()}
                  >
                    {canDirectUpdate ? 'Update' : 'Open Release Page'}
                  </FocusableButton>
                </div>
              </>
            )}

            {stage === 'downloading' && (
              <>
                <Dialog.Description className="app-update-subtitle">
                  Downloading Vega {targetLabel || targetVersion}...
                </Dialog.Description>
                <div className="app-update-progress-section">
                  <div
                    className="app-update-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress.percent ?? undefined}
                    aria-label="Update download progress"
                  >
                    <div
                      className={`app-update-progress-fill ${
                        progress.percent === null ? 'indeterminate' : ''
                      }`}
                      style={
                        progress.percent !== null
                          ? { width: `${progress.percent}%` }
                          : undefined
                      }
                    />
                  </div>
                  <div className="app-update-progress-meta">
                    <span>{progressText}</span>
                    {progress.percent !== null && (
                      <span>{progress.percent}%</span>
                    )}
                  </div>
                </div>
                <div className="extensions-dialog-actions">
                  <FocusableButton
                    className="dialog-text-button"
                    focusKey="APP_UPDATE_CANCEL"
                    onClick={cancelOrDismissAppUpdate}
                  >
                    Cancel
                  </FocusableButton>
                </div>
              </>
            )}

            {stage === 'installing' && (
              <>
                <Dialog.Description className="app-update-subtitle">
                  Installing Vega {targetLabel || targetVersion}...
                </Dialog.Description>
                <div className="app-update-progress-section">
                  <div
                    className="app-update-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={100}
                    aria-label="Installing update"
                  >
                    <div
                      className="app-update-progress-fill"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <p className="app-update-installing-note">
                    Vega will restart automatically once installation finishes.
                  </p>
                </div>
              </>
            )}

            {stage === 'installed' && (
              <>
                <Dialog.Description className="app-update-subtitle">
                  Vega {targetLabel || targetVersion} has been installed.
                  Restart Vega to finish updating.
                </Dialog.Description>
                <div className="extensions-dialog-actions">
                  <FocusableButton
                    className="dialog-text-button"
                    focusKey="APP_UPDATE_LATER"
                    onClick={cancelOrDismissAppUpdate}
                  >
                    Later
                  </FocusableButton>
                  <FocusableButton
                    className="dialog-primary-button"
                    focusKey="APP_UPDATE_RESTART"
                    onClick={() => void restartAfterUpdate()}
                  >
                    Restart Now
                  </FocusableButton>
                </div>
              </>
            )}

            {stage === 'error' && (
              <>
                <Dialog.Description className="app-update-subtitle">
                  Could not complete the update.
                </Dialog.Description>
                {errorMessage && (
                  <p className="app-update-error-box">{errorMessage}</p>
                )}
                <div className="extensions-dialog-actions">
                  <FocusableButton
                    className="dialog-text-button"
                    focusKey="APP_UPDATE_CLOSE_ERR"
                    onClick={cancelOrDismissAppUpdate}
                  >
                    Close
                  </FocusableButton>
                  <FocusableButton
                    className="dialog-text-button"
                    focusKey="APP_UPDATE_OPEN_PAGE"
                    onClick={() => void openUpdateReleasePage()}
                  >
                    Release Page
                  </FocusableButton>
                  <FocusableButton
                    className="dialog-primary-button"
                    focusKey="APP_UPDATE_RETRY"
                    onClick={() => void retryAppUpdate()}
                  >
                    Retry
                  </FocusableButton>
                </div>
              </>
            )}
          </Dialog.Content>
        </DialogFocusProvider>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
