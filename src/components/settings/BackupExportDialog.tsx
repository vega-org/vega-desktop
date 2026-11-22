import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LuX as X } from "react-icons/lu";
import { ALL_BACKUP_SECTIONS, type BackupSelection } from "../../lib/backup";
import { useDialogFocusBoundary } from "../../lib/hooks/useDialogFocusBoundary";
import { FocusableButton } from "../layout/FocusableButton";
import { Switch } from "../ui/switch";
import "./BackupExportDialog.css";

interface BackupExportDialogProps {
  open: boolean;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (selection: BackupSelection) => void;
  restoreFocusKey?: string;
}

const BACKUP_SECTION_OPTIONS = [
  ["settings", "Settings", "Preferences, appearance and player settings"],
  ["library", "Library", "Saved titles, categories and assignments"],
  ["providers", "Providers", "Installed providers, sources and provider code"],
  ["history", "Watch history", "Continue watching titles and resume positions"],
  ["progress", "Watch progress", "Watched and partly watched episodes"],
] as const;

export const BackupExportDialog: React.FC<BackupExportDialogProps> = ({
  open,
  busy = false,
  onOpenChange,
  onExport,
  restoreFocusKey = "SETTINGS_BACKUP_EXPORT",
}) => {
  const [selection, setSelection] = useState<BackupSelection>(ALL_BACKUP_SECTIONS);

  useEffect(() => {
    if (open) {
      setSelection({ ...ALL_BACKUP_SECTIONS });
    }
  }, [open]);

  const canExport = Object.values(selection).some(Boolean);
  const { ref, DialogFocusProvider } = useDialogFocusBoundary({
    isOpen: open,
    focusKey: "BACKUP_EXPORT_DIALOG",
    preferredChildFocusKey: "BACKUP_EXPORT_CONFIRM",
    restoreFocusKey,
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="extensions-dialog-overlay" />
        <DialogFocusProvider>
          <Dialog.Content
            ref={ref as any}
            className="extensions-dialog-content backup-export-dialog"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <div className="extensions-dialog-header">
              <Dialog.Title>Export backup</Dialog.Title>
              <FocusableButton
                className="extensions-dialog-close"
                focusKey="BACKUP_EXPORT_CLOSE"
                onClick={() => onOpenChange(false)}
                aria-label="Close backup options"
              >
                <X size={20} />
              </FocusableButton>
            </div>
            <Dialog.Description>
              Choose what to include in the backup file.
            </Dialog.Description>

            <div className="backup-export-list">
              {BACKUP_SECTION_OPTIONS.map(([key, title, description]) => (
                <div key={key} className="backup-export-row">
                  <div className="backup-export-row-info">
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                  <Switch
                    checked={selection[key]}
                    onCheckedChange={(checked) =>
                      setSelection((previous) => ({ ...previous, [key]: checked }))
                    }
                    aria-label={title}
                  />
                </div>
              ))}
            </div>

            {!canExport && (
              <p className="backup-export-warning">Select at least one section.</p>
            )}

            <div className="extensions-dialog-actions">
              <FocusableButton
                className="dialog-text-button"
                focusKey="BACKUP_EXPORT_CANCEL"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </FocusableButton>
              <FocusableButton
                className="dialog-primary-button"
                focusKey="BACKUP_EXPORT_CONFIRM"
                disabled={!canExport || busy}
                onClick={() => {
                  if (canExport && !busy) {
                    onExport(selection);
                  }
                }}
              >
                {busy ? "Exporting..." : "Export"}
              </FocusableButton>
            </div>
          </Dialog.Content>
        </DialogFocusProvider>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
