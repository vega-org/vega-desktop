import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LuPlus as Plus, LuX as X, LuGlobe as Globe } from "react-icons/lu";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { FocusableButton } from "../layout/FocusableButton";
import { FocusableInput } from "../layout/FocusableInput";
import { useDialogFocusBoundary } from "../../lib/hooks/useDialogFocusBoundary";

interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  onAddSource: () => void;
  canCancel: boolean;
}

export const AddSourceDialog: React.FC<AddSourceDialogProps> = ({
  open,
  onOpenChange,
  inputValue,
  setInputValue,
  onAddSource,
  canCancel,
}) => {
  const { ref, DialogFocusProvider } = useDialogFocusBoundary({
    isOpen: open,
    focusKey: "ADD_SOURCE_DIALOG",
    preferredChildFocusKey: "ADD_SOURCE_INPUT",
    restoreFocusKey: canCancel
      ? "EXTENSIONS_SOURCE_PICKER"
      : "EXTENSIONS_ADD_SOURCE",
  });

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
        else onOpenChange(true);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="extensions-dialog-overlay" />
        <DialogFocusProvider>
          <Dialog.Content
            ref={ref as any}
            className="extensions-dialog-content add-source-dialog"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
            }}
          >
            <div className="extensions-dialog-header">
              <div>
                <Dialog.Title>Add source</Dialog.Title>
                <Dialog.Description>
                  Enter a GitHub author or a hosted provider manifest URL.
                </Dialog.Description>
              </div>
              <FocusableButton
                focusKey="ADD_SOURCE_CLOSE"
                className="extensions-dialog-close"
                aria-label="Close"
                onClick={handleClose}
                onArrowPress={(direction) => {
                  if (direction === "down") {
                    setFocus("ADD_SOURCE_INPUT");
                    return false;
                  }
                  return true;
                }}
              >
                <X size={20} />
              </FocusableButton>
            </div>

            <FocusableInput
              focusKey="ADD_SOURCE_INPUT"
              wrapperClassName="extension-dialog-input"
              startIcon={<Globe size={19} aria-hidden="true" />}
              type="text"
              placeholder="GitHub author or provider source URL"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddSource();
                }
              }}
              onArrowPress={(direction) => {
                if (direction === "up") {
                  setFocus("ADD_SOURCE_CLOSE");
                  return false;
                }
                if (direction === "down") {
                  if (canCancel) {
                    setFocus("ADD_SOURCE_CANCEL");
                  } else {
                    setFocus("ADD_SOURCE_SUBMIT");
                  }
                  return false;
                }
                return true;
              }}
              aria-label="Provider source"
            />

            <div className="extensions-dialog-actions">
              {canCancel && (
                <FocusableButton
                  className="dialog-text-button"
                  onClick={handleClose}
                  focusKey="ADD_SOURCE_CANCEL"
                  onArrowPress={(direction) => {
                    if (direction === "up") {
                      setFocus("ADD_SOURCE_INPUT");
                      return false;
                    }
                    if (direction === "right") {
                      setFocus("ADD_SOURCE_SUBMIT");
                      return false;
                    }
                    return true;
                  }}
                >
                  Cancel
                </FocusableButton>
              )}
              <FocusableButton
                className="dialog-primary-button"
                onClick={onAddSource}
                focusKey="ADD_SOURCE_SUBMIT"
                onArrowPress={(direction) => {
                  if (direction === "up") {
                    setFocus("ADD_SOURCE_INPUT");
                    return false;
                  }
                  if (direction === "left") {
                    if (canCancel) {
                      setFocus("ADD_SOURCE_CANCEL");
                      return false;
                    }
                    return false;
                  }
                  return true;
                }}
              >
                <Plus size={18} /> Add source
              </FocusableButton>
            </div>
          </Dialog.Content>
        </DialogFocusProvider>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
