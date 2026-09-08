import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LuTrash2 as Trash2 } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { useDialogFocusBoundary } from "../../lib/hooks/useDialogFocusBoundary";

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  isDanger?: boolean;
  focusKeyPrefix: string;
  icon?: React.ReactNode;
  onConfirm: () => void;
  restoreFocusKey?: string;
}

export const ConfirmActionDialog: React.FC<ConfirmActionDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  isDanger = true,
  focusKeyPrefix,
  icon = <Trash2 size={23} />,
  onConfirm,
  restoreFocusKey = "EXTENSIONS_SOURCE_PICKER",
}) => {
  const cancelKey = `${focusKeyPrefix}_CANCEL`;
  const confirmKey = `${focusKeyPrefix}_CONFIRM`;

  const { ref, DialogFocusProvider } = useDialogFocusBoundary({
    isOpen: open,
    focusKey: `${focusKeyPrefix}_DIALOG`,
    preferredChildFocusKey: cancelKey,
    restoreFocusKey,
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="extensions-dialog-overlay" />
        <DialogFocusProvider>
          <Dialog.Content
            ref={ref as any}
            className="extensions-dialog-content confirm-dialog"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
            }}
          >
            {icon && <span className="confirm-dialog-icon">{icon}</span>}
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
            <div className="extensions-dialog-actions">
              <FocusableButton
                className="dialog-text-button"
                onClick={() => onOpenChange(false)}
                focusKey={cancelKey}
              >
                {cancelLabel}
              </FocusableButton>
              <FocusableButton
                className={isDanger ? "dialog-danger-button" : "dialog-primary-button"}
                onClick={onConfirm}
                focusKey={confirmKey}
              >
                {confirmLabel}
              </FocusableButton>
            </div>
          </Dialog.Content>
        </DialogFocusProvider>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
