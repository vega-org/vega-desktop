import React, { type CSSProperties } from "react";
import * as Select from "@radix-ui/react-select";
import { LuCheck as Check, LuChevronDown as ChevronDown } from "react-icons/lu";
import type { Link } from "../../lib/providers/types";

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
  return (
    <Select.Root
      value={activeSeason?.title}
      onValueChange={(value) => {
        const season = seasons.find((item) => item.title === value);
        if (season) onChange(season);
      }}
    >
      <Select.Trigger
        className="season-select-trigger"
        aria-label="Choose season"
      >
        <Select.Value placeholder="Choose season" />
        <Select.Icon>
          <ChevronDown size={18} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="season-select-content"
          position="popper"
          sideOffset={7}
          style={themeStyle}
        >
          <Select.Viewport>
            {seasons.map((season) => (
              <Select.Item
                className="season-select-item"
                value={season.title}
                key={season.title}
              >
                <Select.ItemText>{season.title}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={16} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};
