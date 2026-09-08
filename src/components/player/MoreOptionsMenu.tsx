import React, { useRef, useState, useEffect } from "react";
import { useFocusable, FocusContext } from "@noriginmedia/norigin-spatial-navigation-react";
import {
  LuZoomIn as ZoomIn,
  LuMinus as Minus,
  LuPlus as Plus,
  LuKeyboard as Keyboard,
  LuExternalLink as ExternalLink,
  LuCopy as Copy,
} from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { settingsStorage } from "../../lib/storage";

interface MoreOptionsMenuProps {
  zoomLevel?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  onSetZoom?: (zoom: number) => void;
  onToggleShortcuts?: () => void;
  onOpenVlc?: () => void;
  onCopyLink?: () => void;
  onClose: () => void;
}

export const MoreOptionsMenu: React.FC<MoreOptionsMenuProps> = ({
  zoomLevel = 100,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onSetZoom,
  onToggleShortcuts,
  onOpenVlc,
  onCopyLink,
  onClose,
}) => {
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;

  const { ref: menuRef, focusKey, focusSelf } = useFocusable({
    isFocusBoundary: true,
    trackChildren: true,
    focusKey: "PLAYER_MORE_MENU",
    focusable: tvMode,
  });

  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [customZoomInput, setCustomZoomInput] = useState(String(zoomLevel));
  const zoomInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCustomZoomInput(String(zoomLevel));
  }, [zoomLevel]);

  useEffect(() => {
    if (isEditingZoom) {
      zoomInputRef.current?.focus();
      zoomInputRef.current?.select();
    }
  }, [isEditingZoom]);

  useEffect(() => {
    if (tvMode) {
      const timer = setTimeout(() => focusSelf(), 30);
      return () => clearTimeout(timer);
    }
  }, [focusSelf, tvMode]);

  const handleSaveCustomZoom = () => {
    const parsed = parseInt(customZoomInput, 10);
    if (!isNaN(parsed) && parsed >= 50 && parsed <= 300) {
      onSetZoom?.(parsed);
    } else {
      setCustomZoomInput(String(zoomLevel));
    }
    setIsEditingZoom(false);
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={menuRef} className="inline-menu right wide" onClick={stop}>
        <div className="inline-menu-zoom-row">
          <div className="inline-menu-zoom-label">
            <ZoomIn size={18} />
            <span>Zoom</span>
          </div>
          <div className="inline-menu-zoom-actions">
            <FocusableButton
              type="button"
              className="zoom-stepper-btn"
              focusable={true}
              focusKey="ZOOM_MINUS"
              onClick={(e) => {
                e.stopPropagation();
                onZoomOut?.();
              }}
              disabled={zoomLevel <= 50}
              title="Zoom out (-10%)"
              aria-label="Zoom out"
            >
              <Minus size={13} />
            </FocusableButton>

            {isEditingZoom ? (
              <div
                className="zoom-input-wrapper"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  ref={zoomInputRef}
                  type="number"
                  min={50}
                  max={300}
                  step={1}
                  className="zoom-level-input"
                  value={customZoomInput}
                  onChange={(e) => setCustomZoomInput(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveCustomZoom();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setCustomZoomInput(String(zoomLevel));
                      setIsEditingZoom(false);
                    }
                  }}
                  onBlur={handleSaveCustomZoom}
                />
                <span className="zoom-input-percent">%</span>
              </div>
            ) : (
              <FocusableButton
                type="button"
                className={`zoom-level-badge ${zoomLevel !== 100 ? "custom" : ""}`}
                focusable={true}
                focusKey="ZOOM_VALUE"
                onClick={(e) => {
                  e.stopPropagation();
                  setCustomZoomInput(String(zoomLevel));
                  setIsEditingZoom(true);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onResetZoom?.();
                }}
                title="Click to enter custom zoom %, double-click to reset"
              >
                {zoomLevel}%
              </FocusableButton>
            )}

            <FocusableButton
              type="button"
              className="zoom-stepper-btn"
              focusable={true}
              focusKey="ZOOM_PLUS"
              onClick={(e) => {
                e.stopPropagation();
                onZoomIn?.();
              }}
              disabled={zoomLevel >= 300}
              title="Zoom in (+10%)"
              aria-label="Zoom in"
            >
              <Plus size={13} />
            </FocusableButton>
          </div>
        </div>

        {onToggleShortcuts && (
          <FocusableButton
            focusable={true}
            focusKey="MORE_SHORTCUTS"
            className="inline-menu-item"
            onClick={() => {
              onClose();
              onToggleShortcuts();
            }}
          >
            <Keyboard size={18} />
            <span>Keyboard shortcuts</span>
          </FocusableButton>
        )}

        {onOpenVlc && (
          <FocusableButton
            focusable={true}
            focusKey="MORE_VLC"
            className="inline-menu-item"
            onClick={() => {
              onClose();
              onOpenVlc();
            }}
          >
            <ExternalLink size={18} />
            <span>Open in VLC</span>
          </FocusableButton>
        )}

        {onCopyLink && (
          <FocusableButton
            focusable={true}
            focusKey="MORE_COPY_LINK"
            className="inline-menu-item"
            onClick={() => {
              onClose();
              onCopyLink();
            }}
          >
            <Copy size={18} />
            <span>Copy stream link</span>
          </FocusableButton>
        )}
      </div>
    </FocusContext.Provider>
  );
};
