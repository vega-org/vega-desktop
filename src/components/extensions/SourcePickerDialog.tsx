import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LuBlocks as Blocks, LuCheck as Check, LuTrash2 as Trash2, LuX as X } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { useDialogFocusBoundary } from "../../lib/hooks/useDialogFocusBoundary";
import { ProviderSource } from "../../lib/storage/extensionStorage";

interface SourcePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: ProviderSource[];
  activeSource: ProviderSource | null;
  onApplySource: (source: ProviderSource) => void;
  onRequestRemoveSource: (source: ProviderSource) => void;
  restoreFocusKey?: string;
}

export const SourcePickerDialog: React.FC<SourcePickerDialogProps> = ({
  open,
  onOpenChange,
  sources,
  activeSource,
  onApplySource,
  onRequestRemoveSource,
  restoreFocusKey = "EXTENSIONS_SOURCE_PICKER",
}) => {
  const preferredKey = activeSource
    ? `SOURCE_PICKER_ITEM_${activeSource.author}`
    : "SOURCE_PICKER_CLOSE";

  const { ref, DialogFocusProvider } = useDialogFocusBoundary({
    isOpen: open,
    focusKey: "SOURCE_PICKER_DIALOG",
    preferredChildFocusKey: preferredKey,
    restoreFocusKey,
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="extensions-dialog-overlay" />
        <DialogFocusProvider>
          <Dialog.Content
            ref={ref as any}
            className="extensions-dialog-content"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
            }}
          >
            <div className="extensions-dialog-header">
              <div>
                <Dialog.Title>Provider sources</Dialog.Title>
                <Dialog.Description>
                  Choose the manifest used to discover providers.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <FocusableButton
                  focusKey="SOURCE_PICKER_CLOSE"
                  className="extensions-dialog-close"
                  aria-label="Close"
                >
                  <X size={20} />
                </FocusableButton>
              </Dialog.Close>
            </div>

            <div className="source-picker-list">
              {sources.map((source) => {
                const selected = activeSource?.author === source.author;
                return (
                  <div className="source-picker-row" key={source.author}>
                    <FocusableButton
                      className={`source-picker-main ${selected ? "active" : ""}`}
                      onClick={() => {
                        onApplySource(source);
                        onOpenChange(false);
                      }}
                      focusKey={`SOURCE_PICKER_ITEM_${source.author}`}
                    >
                      <span className="source-picker-badge">
                        <Blocks size={19} />
                      </span>
                      <div className="source-picker-copy">
                        <strong>{source.author}</strong>
                        <small>{source.url}</small>
                      </div>
                      {selected && <Check size={20} />}
                    </FocusableButton>
                    <FocusableButton
                      className="source-picker-remove"
                      focusKey={`SOURCE_PICKER_REMOVE_${source.author}`}
                      onClick={() => onRequestRemoveSource(source)}
                      title={`Remove ${source.author}`}
                    >
                      <Trash2 size={18} />
                    </FocusableButton>
                  </div>
                );
              })}
            </div>
          </Dialog.Content>
        </DialogFocusProvider>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
