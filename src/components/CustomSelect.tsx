import React, { useState, useRef, useEffect } from 'react';
import {
  LuCheck as Check,
  LuChevronDown as ChevronDown,
  LuChevronUp as ChevronUp,
} from 'react-icons/lu';
import { FocusableButton } from './layout/FocusableButton';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation-react';
import { settingsStorage } from '../lib/storage';
import './CustomSelect.css';

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  options,
  value,
  onChange,
  className = '',
  placeholder = 'Select...'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref: focusRef, focusKey } = useFocusable({
    focusable: tvMode && isOpen,
    isFocusBoundary: true,
    trackChildren: true,
  });

  return (
    <div className={`custom-select-container ${className}`} ref={containerRef}>
      <FocusableButton
        type="button"
        className="custom-select-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="custom-select-value">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="custom-select-icon">
          {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </span>
      </FocusableButton>

      {isOpen && (
        <FocusContext.Provider value={focusKey}>
          <ul className="custom-select-list" role="listbox" ref={focusRef as any}>
            {options.map((option) => (
              <SelectOptionItem 
                key={option.value}
                option={option}
                isSelected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              />
            ))}
          </ul>
        </FocusContext.Provider>
      )}
    </div>
  );
};

const SelectOptionItem: React.FC<{option: Option, isSelected: boolean, onClick: () => void}> = ({option, isSelected, onClick}) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    onEnterPress: onClick,
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  return (
    <li
      ref={ref as any}
      className={`custom-select-option ${isSelected ? 'selected' : ''} ${focused ? 'tv-focus' : ''}`}
      role="option"
      aria-selected={isSelected}
      onClick={onClick}
    >
      <span>{option.label}</span>
      {isSelected && <Check className="custom-select-check" aria-hidden="true" />}
    </li>
  );
};
