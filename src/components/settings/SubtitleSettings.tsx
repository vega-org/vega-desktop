import React, { useState, useEffect } from 'react';
import { settingsStorage } from '../../lib/storage';
import { CustomSelect } from '../CustomSelect';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation-react';

const getFontWeightLabel = (weight: number) => {
  if (weight <= 200) return 'Thin';
  if (weight <= 300) return 'Light';
  if (weight <= 400) return 'Normal';
  if (weight <= 500) return 'Medium';
  if (weight <= 600) return 'Semi-Bold';
  if (weight <= 700) return 'Bold';
  if (weight <= 800) return 'Extra-Bold';
  return 'Black';
};

const FONT_FAMILY_OPTIONS = [
  { value: 'sans-serif', label: 'Sans-Serif (Default)' },
  { value: 'Segoe UI', label: 'Segoe UI' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Comic Sans MS', label: 'Comic Sans MS' },
];

const TEXT_COLOR_PRESETS = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Yellow', value: '#FFFF00' },
  { label: 'Cyan', value: '#00FFFF' },
  { label: 'Green', value: '#4ADE80' },
  { label: 'Orange', value: '#FB923C' },
  { label: 'Pink', value: '#F472B6' },
];

const OUTLINE_COLOR_PRESETS = [
  { label: 'Black', value: '#000000' },
  { label: 'Dark Gray', value: '#262626' },
  { label: 'Midnight', value: '#0F172A' },
  { label: 'White', value: '#FFFFFF' },
  { label: 'None', value: 'transparent' },
];

const SHADOW_STYLE_OPTIONS = [
  { value: 'drop', label: 'Drop Shadow (Default)' },
  { value: 'glow', label: 'Soft Glow' },
  { value: 'raised', label: 'Raised (3D Lift)' },
  { value: 'depressed', label: 'Depressed (Carved)' },
  { value: 'none', label: 'None' },
];

const SHADOW_COLOR_PRESETS = [
  { label: 'Black', value: '#000000' },
  { label: 'Dark Gray', value: '#1E293B' },
  { label: 'Midnight', value: '#0F172A' },
  { label: 'White', value: '#FFFFFF' },
  { label: 'Cyan', value: '#00FFFF' },
  { label: 'None', value: 'transparent' },
];

const FocusableSlider = ({ value, min, max, step, onChange, className }: any) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    onArrowPress: (direction) => {
      if (direction === 'left') {
        const newVal = Math.max(min, value - step);
        onChange({ target: { value: newVal } } as any);
        return false; // prevent navigation
      } else if (direction === 'right') {
        const newVal = Math.min(max, value + step);
        onChange({ target: { value: newVal } } as any);
        return false; // prevent navigation
      }
      return true; // allow up/down navigation
    },
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  return (
    <input 
      ref={ref as any}
      type="range" 
      min={min} 
      max={max} 
      step={step} 
      value={value} 
      onChange={onChange}
      tabIndex={tvMode ? 0 : -1}
      className={`${className} ${focused && tvMode ? 'tv-focus' : ''}`}
    />
  );
};

const FocusableColorBtn = ({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color: string;
}) => {
  const tvMode = settingsStorage.isTvModeEnabled();
  const { ref, focused } = useFocusable({
    focusable: tvMode,
    onEnterPress: onClick,
  });

  return (
    <button
      ref={ref as any}
      type="button"
      className={`color-preset-btn ${active ? 'active' : ''} ${focused ? 'tv-focus' : ''}`}
      onClick={onClick}
      title={label}
    >
      <span
        className="color-swatch-circle"
        style={{
          backgroundColor: color === 'transparent' ? 'transparent' : color,
          backgroundImage:
            color === 'transparent'
              ? 'linear-gradient(45deg, #555 25%, transparent 25%), linear-gradient(-45deg, #555 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #555 75%), linear-gradient(-45deg, transparent 75%, #555 75%)'
              : 'none',
          backgroundSize: '6px 6px',
          backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px',
        }}
      />
      <span>{label}</span>
    </button>
  );
};

const ColorPickerRow = ({
  title,
  subtitle,
  value,
  onChange,
  presets,
}: {
  title: string;
  subtitle?: string;
  value: string;
  onChange: (val: string) => void;
  presets: { label: string; value: string }[];
}) => {
  return (
    <div className="settings-row">
      <div className="settings-info">
        <h3 className="label-lg">{title}</h3>
        {subtitle && <p className="body-md text-muted">{subtitle}</p>}
      </div>
      <div className="color-picker-control">
        <div className="color-preset-group">
          {presets.map((preset) => (
            <FocusableColorBtn
              key={preset.value}
              label={preset.label}
              color={preset.value}
              active={value.toLowerCase() === preset.value.toLowerCase()}
              onClick={() => onChange(preset.value)}
            />
          ))}
        </div>
        <div className="custom-color-wrapper">
          <input
            type="color"
            value={value.startsWith('#') ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="custom-color-input"
            title="Custom color"
          />
          <span className="custom-color-hex">{value === 'transparent' ? 'NONE' : value.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
};

export const SubtitleSettings: React.FC = () => {
  const [fontFamily, setFontFamily] = useState<string>('sans-serif');
  const [fontSize, setFontSize] = useState<number>(16);
  const [fontWeight, setFontWeight] = useState<number>(400);
  const [outlineSize, setOutlineSize] = useState<number>(2);
  const [bottomPadding, setBottomPadding] = useState<number>(10);
  const [textColor, setTextColor] = useState<string>('#FFFFFF');
  const [outlineColor, setOutlineColor] = useState<string>('#000000');
  const [shadowColor, setShadowColor] = useState<string>('#000000');
  const [shadowSize, setShadowSize] = useState<number>(2);
  const [shadowStyle, setShadowStyle] = useState<string>('drop');

  useEffect(() => {
    setFontFamily(settingsStorage.getSubtitleFontFamily());
    setFontSize(settingsStorage.getSubtitleFontSize());
    setFontWeight(settingsStorage.getSubtitleFontWeight());
    setOutlineSize(settingsStorage.getSubtitleOutlineSize());
    setBottomPadding(settingsStorage.getSubtitleBottomPadding());
    setTextColor(settingsStorage.getSubtitleTextColor());
    setOutlineColor(settingsStorage.getSubtitleOutlineColor());
    setShadowColor(settingsStorage.getSubtitleShadowColor());
    setShadowSize(settingsStorage.getSubtitleShadowSize());
    setShadowStyle(settingsStorage.getSubtitleShadowStyle());
  }, []);

  const handleFontFamilyChange = (val: string) => {
    setFontFamily(val);
    settingsStorage.setSubtitleFontFamily(val);
  };

  const handleFontSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value as string, 10);
    setFontSize(val);
    settingsStorage.setSubtitleFontSize(val);
  };

  const handleFontWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value as string, 10);
    setFontWeight(val);
    settingsStorage.setSubtitleFontWeight(val);
  };

  const handleOutlineSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value as string, 10);
    setOutlineSize(val);
    settingsStorage.setSubtitleOutlineSize(val);
  };

  const handleBottomPaddingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value as string, 10);
    setBottomPadding(val);
    settingsStorage.setSubtitleBottomPadding(val);
  };

  const handleTextColorChange = (val: string) => {
    setTextColor(val);
    settingsStorage.setSubtitleTextColor(val);
  };

  const handleOutlineColorChange = (val: string) => {
    setOutlineColor(val);
    settingsStorage.setSubtitleOutlineColor(val);
  };

  const handleShadowColorChange = (val: string) => {
    setShadowColor(val);
    settingsStorage.setSubtitleShadowColor(val);
  };

  const handleShadowSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value as string, 10);
    setShadowSize(val);
    settingsStorage.setSubtitleShadowSize(val);
  };

  const handleShadowStyleChange = (val: string) => {
    setShadowStyle(val);
    settingsStorage.setSubtitleShadowStyle(val);
  };

  const isOutlineNone = !outlineColor || outlineColor === 'transparent' || outlineColor === 'none' || outlineSize === 0;
  const isShadowNone = !shadowColor || shadowColor === 'transparent' || shadowColor === 'none';

  const previewFontSize = Math.round(fontSize * 1.15);
  const outerOutline = !isOutlineNone ? outlineSize * 0.55 : 0;
  const strokeWidth = outerOutline * 2;

  const computeTextShadow = (
    style: string,
    size: number,
    color: string,
    isNone: boolean
  ) => {
    if (isNone || style === 'none' || size === 0) {
      return 'none';
    }
    if (style === 'glow') {
      const s = size * 0.8;
      return `0 0 ${(s * 2).toFixed(1)}px ${color}, 0 0 ${(s * 4).toFixed(1)}px ${color}`;
    }
    if (style === 'raised') {
      const s = Math.max(1, size * 0.6);
      return `-${(s * 0.6).toFixed(1)}px -${(s * 0.6).toFixed(1)}px 0 rgba(255,255,255,0.45), ${s.toFixed(1)}px ${s.toFixed(1)}px 0 ${color}`;
    }
    if (style === 'depressed') {
      const s = Math.max(1, size * 0.6);
      return `${s.toFixed(1)}px ${s.toFixed(1)}px 0 rgba(255,255,255,0.35), -${(s * 0.6).toFixed(1)}px -${(s * 0.6).toFixed(1)}px 0 ${color}`;
    }
    // Default: 'drop'
    const s = Math.max(1, size * 0.7);
    return `${s.toFixed(1)}px ${(s * 1.2).toFixed(1)}px 0px ${color}`;
  };

  return (
    <div className="subtitle-settings">
      {/* Live Preview */}
      <div className="subtitle-preview-container">
        <div className="subtitle-preview-box">
          <div className="subtitle-preview-screen">
            <span className="subtitle-preview-badge">Live Preview</span>
            <div className="subtitle-preview-stage">
              <div
                className="subtitle-preview-text"
                style={{
                  fontFamily: fontFamily === 'sans-serif' ? 'Liberation Sans, system-ui, -apple-system, sans-serif' : fontFamily,
                  fontSize: `${previewFontSize}px`,
                  fontWeight: fontWeight,
                  color: textColor,
                  paintOrder: 'stroke fill',
                  WebkitTextStroke:
                    !isOutlineNone && strokeWidth > 0
                      ? `${strokeWidth.toFixed(1)}px ${outlineColor}`
                      : '0px transparent',
                  WebkitTextStrokeWidth: !isOutlineNone && strokeWidth > 0 ? `${strokeWidth.toFixed(1)}px` : '0px',
                  WebkitTextStrokeColor: !isOutlineNone && strokeWidth > 0 ? outlineColor : 'transparent',
                  textShadow: computeTextShadow(shadowStyle, shadowSize, shadowColor, isShadowNone),
                }}
              >
                The quick brown fox jumps over the lazy dog
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-divider" />

      {/* Font Family */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Font Family</h3>
        </div>
        <CustomSelect 
          options={FONT_FAMILY_OPTIONS}
          value={fontFamily}
          onChange={handleFontFamilyChange}
        />
      </div>

      <div className="settings-divider" />

      {/* Font Size */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Font Size ({fontSize}px)</h3>
        </div>
        <FocusableSlider 
          min={12} 
          max={100} 
          step={2} 
          value={fontSize} 
          onChange={handleFontSizeChange}
          className="slider"
        />
      </div>
      
      <div className="settings-divider" />
      
      {/* Font Weight */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Font Weight ({getFontWeightLabel(fontWeight)})</h3>
        </div>
        <FocusableSlider 
          min={100} 
          max={900} 
          step={100} 
          value={fontWeight} 
          onChange={handleFontWeightChange}
          className="slider"
        />
      </div>

      <div className="settings-divider" />

      {/* Text Color */}
      <ColorPickerRow 
        title="Subtitle Color"
        subtitle="Primary text color of subtitles"
        value={textColor}
        onChange={handleTextColorChange}
        presets={TEXT_COLOR_PRESETS}
      />
      
      <div className="settings-divider" />
      
      {/* Outline Size */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Outline Size ({outlineSize}px)</h3>
        </div>
        <FocusableSlider 
          min={0} 
          max={10} 
          step={1} 
          value={outlineSize} 
          onChange={handleOutlineSizeChange}
          className="slider"
        />
      </div>

      <div className="settings-divider" />

      {/* Outline Color */}
      <ColorPickerRow 
        title="Outline Color"
        subtitle="Border stroke color around subtitle text"
        value={outlineColor}
        onChange={handleOutlineColorChange}
        presets={OUTLINE_COLOR_PRESETS}
      />

      <div className="settings-divider" />

      {/* Shadow Style */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Shadow Style</h3>
          <p className="body-md text-muted">Type of shadow effect applied behind subtitles</p>
        </div>
        <CustomSelect 
          options={SHADOW_STYLE_OPTIONS}
          value={shadowStyle}
          onChange={handleShadowStyleChange}
        />
      </div>

      <div className="settings-divider" />

      {/* Shadow Size */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Shadow Size ({shadowSize}px)</h3>
        </div>
        <FocusableSlider 
          min={0} 
          max={10} 
          step={1} 
          value={shadowSize} 
          onChange={handleShadowSizeChange}
          className="slider"
        />
      </div>

      <div className="settings-divider" />

      {/* Shadow Color */}
      <ColorPickerRow 
        title="Shadow Color"
        subtitle="Drop shadow color behind subtitle text"
        value={shadowColor}
        onChange={handleShadowColorChange}
        presets={SHADOW_COLOR_PRESETS}
      />

      <div className="settings-divider" />

      {/* Bottom Padding */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Bottom Padding ({bottomPadding}px)</h3>
        </div>
        <FocusableSlider 
          min={0} 
          max={50} 
          step={5} 
          value={bottomPadding} 
          onChange={handleBottomPaddingChange}
          className="slider"
        />
      </div>
    </div>
  );
};
