import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LuPlus as Plus,
  LuX as X,
  LuGlobe as Globe,
  LuLock as Lock,
  LuKeyRound as Key,
  LuEye as Eye,
  LuEyeOff as EyeOff,
} from "react-icons/lu";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { FocusableButton } from "../layout/FocusableButton";
import { FocusableInput } from "../layout/FocusableInput";
import { useDialogFocusBoundary } from "../../lib/hooks/useDialogFocusBoundary";

interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  isPrivate: boolean;
  setIsPrivate: (value: boolean) => void;
  token: string;
  setToken: (value: string) => void;
  error?: string;
  onAddSource: () => void;
  canCancel: boolean;
}

export const AddSourceDialog: React.FC<AddSourceDialogProps> = ({
  open,
  onOpenChange,
  inputValue,
  setInputValue,
  isPrivate,
  setIsPrivate,
  token,
  setToken,
  error,
  onAddSource,
  canCancel,
}) => {
  const [showToken, setShowToken] = useState(false);
  const actionFocusKey = canCancel ? "ADD_SOURCE_CANCEL" : "ADD_SOURCE_SUBMIT";
  // Row above the action buttons: the token field when private, else the
  // visibility toggle.
  const aboveActionsFocusKey = isPrivate
    ? "ADD_SOURCE_TOKEN"
    : "ADD_SOURCE_PUBLIC";
  const belowToggleFocusKey = isPrivate ? "ADD_SOURCE_TOKEN" : actionFocusKey;

  const toggleArrow =
    (self: "public" | "private") =>
    (direction: string): boolean => {
      if (direction === "up") {
        setFocus("ADD_SOURCE_INPUT");
      } else if (direction === "down") {
        setFocus(belowToggleFocusKey);
      } else if (direction === "right" && self === "public") {
        setFocus("ADD_SOURCE_PRIVATE");
      } else if (direction === "left" && self === "private") {
        setFocus("ADD_SOURCE_PUBLIC");
      }
      return false;
    };

  const renderVisibilityOption = (value: boolean) => {
    const selected = isPrivate === value;
    const Icon = value ? Lock : Globe;
    return (
      <FocusableButton
        focusKey={value ? "ADD_SOURCE_PRIVATE" : "ADD_SOURCE_PUBLIC"}
        className={`source-visibility-option${selected ? " selected" : ""}`}
        role="radio"
        aria-checked={selected}
        onClick={() => setIsPrivate(value)}
        onArrowPress={toggleArrow(value ? "private" : "public")}
      >
        <Icon size={16} aria-hidden="true" /> {value ? "Private" : "Public"}
      </FocusableButton>
    );
  };
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
                  Enter an author name, repo URL or manifest URL.
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
              placeholder="author, author@cb or repo URL"
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
                  setFocus("ADD_SOURCE_PUBLIC");
                  return false;
                }
                return true;
              }}
              aria-label="Provider source"
            />

            <div
              className="source-visibility-toggle"
              role="radiogroup"
              aria-label="Source visibility"
            >
              {renderVisibilityOption(false)}
              {renderVisibilityOption(true)}
            </div>

            {isPrivate && (
              <>
                <div className="source-token-row">
                  <FocusableInput
                    focusKey="ADD_SOURCE_TOKEN"
                    wrapperClassName="extension-dialog-input source-token-input"
                    startIcon={<Key size={19} aria-hidden="true" />}
                    type={showToken ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Access token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onAddSource();
                      }
                    }}
                    onArrowPress={(direction) => {
                      if (direction === "up") {
                        setFocus("ADD_SOURCE_PRIVATE");
                        return false;
                      }
                      if (direction === "down") {
                        setFocus(actionFocusKey);
                        return false;
                      }
                      if (direction === "right") {
                        setFocus("ADD_SOURCE_TOKEN_VISIBILITY");
                        return false;
                      }
                      return true;
                    }}
                    aria-label="Access token"
                  />
                  <FocusableButton
                    focusKey="ADD_SOURCE_TOKEN_VISIBILITY"
                    className="source-token-visibility"
                    aria-label={showToken ? "Hide token" : "Show token"}
                    onClick={() => setShowToken((current) => !current)}
                    onArrowPress={(direction) => {
                      if (direction === "left") {
                        setFocus("ADD_SOURCE_TOKEN");
                      } else if (direction === "up") {
                        setFocus("ADD_SOURCE_PRIVATE");
                      } else if (direction === "down") {
                        setFocus("ADD_SOURCE_SUBMIT");
                      }
                      return false;
                    }}
                  >
                    {showToken ? <EyeOff size={19} /> : <Eye size={19} />}
                  </FocusableButton>
                </div>
                <p className="source-token-hint">
                  GitHub only. Use a fine-grained token with read-only Contents
                  access to this repo. The token is stored on this device.
                </p>
              </>
            )}

            {error && (
              <p className="source-dialog-error" role="alert">
                {error}
              </p>
            )}

            <div className="extensions-dialog-actions">
              {canCancel && (
                <FocusableButton
                  className="dialog-text-button"
                  onClick={handleClose}
                  focusKey="ADD_SOURCE_CANCEL"
                  onArrowPress={(direction) => {
                    if (direction === "up") {
                      setFocus(aboveActionsFocusKey);
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
                    setFocus(aboveActionsFocusKey);
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
