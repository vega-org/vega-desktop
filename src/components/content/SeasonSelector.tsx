import React, { type CSSProperties, useEffect, useId, useState } from "react";
import * as Select from "@radix-ui/react-select";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation-react";
import { LuCheck as Check, LuChevronDown as ChevronDown } from "react-icons/lu";
import type { Link } from "../../lib/providers/types";
import { settingsStorage } from "../../lib/storage";

interface SeasonSelectorProps {
  seasons: Link[];
  activeSeason: Link | null;
  onChange: (season: Link) => void;
  themeStyle?: CSSProperties;
}

export const SeasonSelector: React.FC<SeasonSelectorProps> = ({
  seasons,
  activeSeason,
  onChange,
  themeStyle,
}) => {
  const [open, setOpen] = useState(false);
  const instanceId = useId().replace(/:/g, "");
  const tvMode = settingsStorage.isTvModeEnabled();
  const triggerFocusKey = `SEASON_SELECT_TRIGGER_${instanceId}`;
  const selectedIndex = Math.max(
    seasons.findIndex((season) => season.title === activeSeason?.title),
    0,
  );
  const optionFocusKey = (index: number) =>
    `SEASON_SELECT_OPTION_${instanceId}_${index}`;
  const {
    ref,
    focused,
    focusSelf: focusTrigger,
  } = useFocusable({
    focusable: tvMode,
    focusKey: triggerFocusKey,
    onEnterPress: () => setOpen((current) => !current),
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });
  const {
    ref: contentRef,
    focusKey,
    focusSelf,
  } = useFocusable({
    focusable: tvMode && open,
    isFocusBoundary: true,
    trackChildren: true,
    preferredChildFocusKey: optionFocusKey(selectedIndex),
  });

  useEffect(() => {
    if (!open || !tvMode) return;
    const timer = window.setTimeout(() => focusSelf(), 0);
    return () => window.clearTimeout(timer);
  }, [focusSelf, open, tvMode]);

  return (
    <Select.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && tvMode) {
          window.setTimeout(() => focusTrigger(), 0);
        }
      }}
      value={activeSeason?.title}
      onValueChange={(value) => {
        const season = seasons.find((item) => item.title === value);
        if (season) onChange(season);
      }}
    >
      <Select.Trigger
        ref={ref as React.Ref<HTMLButtonElement>}
        className={`season-select-trigger ${focused ? "tv-focus" : ""}`}
        aria-label="Choose season"
      >
        <Select.Value placeholder="Choose season" />
        <Select.Icon>
          <ChevronDown size={18} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <FocusContext.Provider value={focusKey}>
          <Select.Content
            ref={contentRef as React.Ref<HTMLDivElement>}
            className="season-select-content"
            position="popper"
            sideOffset={7}
            style={themeStyle}
            onCloseAutoFocus={(event) => {
              if (tvMode) event.preventDefault();
            }}
          >
            <Select.Viewport>
              {seasons.map((season, index) => (
                <SeasonOption
                  key={season.title}
                  season={season}
                  focusKey={optionFocusKey(index)}
                  onSelect={() => {
                    onChange(season);
                    setOpen(false);
                    if (tvMode) window.setTimeout(() => focusTrigger(), 0);
                  }}
                />
              ))}
            </Select.Viewport>
          </Select.Content>
        </FocusContext.Provider>
      </Select.Portal>
    </Select.Root>
  );
};

const SeasonOption: React.FC<{
  season: Link;
  onSelect: () => void;
  focusKey: string;
}> = ({ season, onSelect, focusKey }) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    focusKey,
    onEnterPress: onSelect,
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  return (
    <Select.Item
      ref={ref as React.Ref<HTMLDivElement>}
      className={`season-select-item ${focused ? "tv-focus" : ""}`}
      value={season.title}
    >
      <Select.ItemText>{season.title}</Select.ItemText>
      <Select.ItemIndicator>
        <Check size={16} />
      </Select.ItemIndicator>
    </Select.Item>
  );
};
