import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  doesFocusableExist,
  setFocus,
} from "@noriginmedia/norigin-spatial-navigation-core";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LuArrowLeft as ArrowLeft,
  LuCheck as Check,
  LuCircle as Circle,
  LuCircleCheck as CircleCheck,
  LuPlus as Plus,
  LuX as X,
} from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { FocusableInput } from "../layout/FocusableInput";
import { useDialogFocusBoundary } from "../../lib/hooks/useDialogFocusBoundary";
import {
  LIBRARY_COLORS,
  LIBRARY_EMOJIS,
  LIBRARY_ICON_KEYS,
} from "../../lib/library/libraryIcons";
import {
  DEFAULT_COLLECTION_ID,
  getItemCollectionIds,
  type LibraryCollection,
  type WatchListItem,
} from "../../lib/storage/WatchListStorage";
import useWatchListStore from "../../lib/zustand/watchListStore";
import { LibraryIcon } from "./LibraryIcon";
import "./LibraryCollectionDialog.css";

interface LibraryCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title to save. Opens the category picker for it. */
  item?: WatchListItem;
  /** Category to edit. Without `item` or this, the dialog creates one. */
  collection?: LibraryCollection;
  /** Called with the category after it was created or edited. */
  onSaved?: (collection: LibraryCollection) => void;
  /** Focus key to return to when the dialog closes (TV navigation). */
  restoreFocusKey?: string;
}

type Step = "pick" | "edit";
type IconTab = "icons" | "emoji";

const NAME_MAX_LENGTH = 40;
const FIRST_PICK_KEY = "LIB_DLG_PICK_0";
const NEW_PICK_KEY = "LIB_DLG_NEW";
const NAME_KEY = "LIB_DLG_NAME";

/**
 * Save a title to library categories, or create and edit a category with a
 * name, icon (icon or emoji) and color. One dialog for both, so creating a
 * category while saving a title does not stack dialogs.
 */
export const LibraryCollectionDialog: React.FC<LibraryCollectionDialogProps> = ({
  open,
  onOpenChange,
  item,
  collection,
  onSaved,
  restoreFocusKey,
}) => {
  const watchList = useWatchListStore((state) => state.watchList);
  const collections = useWatchListStore((state) => state.collections);
  const setItemCollections = useWatchListStore((state) => state.setItemCollections);
  const createCollection = useWatchListStore((state) => state.createCollection);
  const updateCollection = useWatchListStore((state) => state.updateCollection);
  const deleteCollection = useWatchListStore((state) => state.deleteCollection);

  const [step, setStep] = useState<Step>(item ? "pick" : "edit");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("popcorn");
  const [color, setColor] = useState<string | undefined>(undefined);
  const [iconTab, setIconTab] = useState<IconTab>("icons");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const editing = step === "edit" && Boolean(collection) && !item;

  // Reset only when the dialog opens or its target changes. Parents build
  // `item` inline, so a new object each render must not reset the form.
  const itemLink = item?.link;
  const collectionId = collection?.id;
  useEffect(() => {
    if (!open) return;
    setStep(item ? "pick" : "edit");
    setName(collection?.name || "");
    setIcon(collection?.icon || "popcorn");
    setColor(collection?.color);
    setIconTab(
      collection?.icon && !LIBRARY_ICON_KEYS.includes(collection.icon)
        ? "emoji"
        : "icons",
    );
    setConfirmDelete(false);
  }, [open, itemLink, collectionId]);

  // With no categories, the picker starts on "New category".
  const firstPickKey = collections.length > 0 ? FIRST_PICK_KEY : NEW_PICK_KEY;
  const { ref, DialogFocusProvider } = useDialogFocusBoundary({
    isOpen: open,
    focusKey: "LIB_DLG",
    preferredChildFocusKey: item ? firstPickKey : NAME_KEY,
    restoreFocusKey,
  });

  // Switching between picker and editor unmounts the focused control. Move
  // TV focus to the first control of the new step.
  const previousStep = useRef(step);
  useEffect(() => {
    if (!open || previousStep.current === step) {
      previousStep.current = step;
      return;
    }
    previousStep.current = step;
    const target = step === "pick" ? firstPickKey : NAME_KEY;
    let attempts = 0;
    let timer = 0;
    const tryFocus = () => {
      if (doesFocusableExist(target)) setFocus(target);
      else if (attempts++ < 10) timer = window.setTimeout(tryFocus, 30);
    };
    timer = window.setTimeout(tryFocus, 30);
    return () => window.clearTimeout(timer);
  }, [open, step]);

  const existingIds = useMemo(
    () => new Set(collections.map((c) => c.id)),
    [collections],
  );
  const savedItem = item
    ? watchList.find((saved) => saved.link === item.link)
    : undefined;
  const selectedIds = savedItem ? getItemCollectionIds(savedItem, existingIds) : [];

  const close = () => onOpenChange(false);

  const toggleCollection = (id: string) => {
    if (!item) return;
    const next = selectedIds.includes(id)
      ? selectedIds.filter((selected) => selected !== id)
      : [...selectedIds, id];
    setItemCollections(savedItem || item, next);
  };

  const openCreate = () => {
    setName("");
    setIcon("popcorn");
    setColor(undefined);
    setIconTab("icons");
    setStep("edit");
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (editing && collection) {
      updateCollection(collection.id, { name: trimmed, icon, color });
      onSaved?.({ ...collection, name: trimmed, icon, color });
      close();
      return;
    }
    const created = createCollection({ name: trimmed, icon, color });
    onSaved?.(created);
    if (item) {
      // Saving a title: put it in the new category, then show the picker.
      setItemCollections(savedItem || item, [...selectedIds, created.id]);
      setStep("pick");
    } else {
      close();
    }
  };

  const handleDelete = () => {
    if (!collection) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteCollection(collection.id);
    close();
  };

  const backOrClose = () => {
    if (step === "edit" && item) setStep("pick");
    else close();
  };

  const renderPicker = () => (
    <>
      <div className="extensions-dialog-header">
        <div>
          <Dialog.Title>Save to library</Dialog.Title>
          <Dialog.Description className="library-dialog-subtitle">
            {item?.title}
          </Dialog.Description>
        </div>
        <FocusableButton
          focusKey="LIB_DLG_CLOSE"
          className="extensions-dialog-close"
          aria-label="Close"
          onClick={close}
        >
          <X size={20} />
        </FocusableButton>
      </div>
      <div className="library-pick-list" role="group" aria-label="Categories">
        {collections.map((row, index) => {
          const checked = selectedIds.includes(row.id);
          return (
            <FocusableButton
              key={row.id}
              focusKey={`LIB_DLG_PICK_${index}`}
              className={`library-pick-row${checked ? " selected" : ""}`}
              role="checkbox"
              aria-checked={checked}
              onClick={() => toggleCollection(row.id)}
            >
              <LibraryIcon icon={row.icon} color={row.color} size={18} tile />
              <span className="library-pick-name">{row.name}</span>
              {checked ? (
                <CircleCheck size={22} className="library-pick-check" />
              ) : (
                <Circle size={22} className="library-pick-check" />
              )}
            </FocusableButton>
          );
        })}
        <FocusableButton
          focusKey={NEW_PICK_KEY}
          className="library-pick-row library-pick-new"
          onClick={openCreate}
        >
          <span className="library-pick-new-icon">
            <Plus size={20} />
          </span>
          <span className="library-pick-name">New category</span>
        </FocusableButton>
      </div>
      <div className="extensions-dialog-actions">
        <FocusableButton
          focusKey="LIB_DLG_DONE"
          className="dialog-primary-button"
          onClick={close}
        >
          Done
        </FocusableButton>
      </div>
    </>
  );

  // Where titles only in the deleted category end up (see deleteCollection).
  const watchlist = collections.find((c) => c.id === DEFAULT_COLLECTION_ID);
  const deleteNote =
    watchlist && collection?.id !== DEFAULT_COLLECTION_ID
      ? `Titles stay in your library. Titles only in this category move to ${watchlist.name}.`
      : "Titles stay in your library and show under All.";

  const renderEditor = () => {
    const choices = iconTab === "icons" ? LIBRARY_ICON_KEYS : LIBRARY_EMOJIS;
    const canSave = name.trim().length > 0;
    return (
      <>
        <div className="extensions-dialog-header">
          <div className="library-dialog-title-row">
            {item && (
              <FocusableButton
                focusKey="LIB_DLG_BACK"
                className="extensions-dialog-close"
                aria-label="Back to categories"
                onClick={backOrClose}
              >
                <ArrowLeft size={20} />
              </FocusableButton>
            )}
            <Dialog.Title>{editing ? "Edit category" : "New category"}</Dialog.Title>
          </div>
          <FocusableButton
            focusKey="LIB_DLG_CLOSE"
            className="extensions-dialog-close"
            aria-label="Close"
            onClick={close}
          >
            <X size={20} />
          </FocusableButton>
        </div>
        <Dialog.Description className="sr-only">
          Pick a name, an icon and a color for the category.
        </Dialog.Description>

        <div className="library-editor-name">
          <LibraryIcon icon={icon} color={color} size={24} tile />
          <FocusableInput
            focusKey={NAME_KEY}
            wrapperClassName="extension-dialog-input library-name-input"
            type="text"
            placeholder="Category name"
            maxLength={NAME_MAX_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            aria-label="Category name"
          />
        </div>

        <div className="library-icon-tabs" role="tablist">
          {(["icons", "emoji"] as IconTab[]).map((tab) => (
            <FocusableButton
              key={tab}
              focusKey={`LIB_DLG_TAB_${tab}`}
              role="tab"
              aria-selected={iconTab === tab}
              className={`library-icon-tab${iconTab === tab ? " selected" : ""}`}
              onClick={() => setIconTab(tab)}
            >
              {tab === "icons" ? "Icons" : "Emoji"}
            </FocusableButton>
          ))}
        </div>

        <div className="library-icon-grid" role="listbox" aria-label="Icon">
          {choices.map((choice) => (
            <FocusableButton
              key={choice}
              role="option"
              aria-selected={icon === choice}
              aria-label={`Icon ${choice}`}
              className={`library-icon-choice${icon === choice ? " selected" : ""}`}
              onClick={() => setIcon(choice)}
            >
              <LibraryIcon icon={choice} color={color} size={22} />
            </FocusableButton>
          ))}
        </div>

        <div className="library-color-row" role="radiogroup" aria-label="Color">
          {[undefined, ...LIBRARY_COLORS].map((swatch) => (
            <FocusableButton
              key={swatch || "default"}
              role="radio"
              aria-checked={color === swatch}
              aria-label={swatch ? `Color ${swatch}` : "Theme color"}
              className={`library-color-swatch${color === swatch ? " selected" : ""}`}
              style={{ background: swatch || "var(--primary-container)" }}
              onClick={() => setColor(swatch)}
            >
              {color === swatch && <Check size={14} />}
            </FocusableButton>
          ))}
        </div>

        {editing && confirmDelete && (
          <p className="library-delete-hint">
            {deleteNote}
          </p>
        )}

        <div className="extensions-dialog-actions">
          {editing ? (
            <FocusableButton
              focusKey="LIB_DLG_DELETE"
              className="dialog-danger-button"
              onClick={handleDelete}
            >
              {confirmDelete ? "Confirm delete" : "Delete"}
            </FocusableButton>
          ) : (
            <FocusableButton
              focusKey="LIB_DLG_CANCEL"
              className="dialog-text-button"
              onClick={backOrClose}
            >
              Cancel
            </FocusableButton>
          )}
          <FocusableButton
            focusKey="LIB_DLG_SAVE"
            className="dialog-primary-button"
            disabled={!canSave}
            onClick={handleSave}
          >
            {editing ? "Save" : "Create"}
          </FocusableButton>
        </div>
      </>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="extensions-dialog-overlay" />
        <DialogFocusProvider>
          <Dialog.Content
            ref={ref as any}
            className="extensions-dialog-content library-dialog"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => {
              if (step === "edit" && item) {
                e.preventDefault();
                setStep("pick");
              }
            }}
          >
            {step === "pick" ? renderPicker() : renderEditor()}
          </Dialog.Content>
        </DialogFocusProvider>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
