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
      className={`${className} ${focused ? 'tv-focus' : ''}`}
    />
  );
};

export const SubtitleSettings: React.FC = () => {
  const [fontFamily, setFontFamily] = useState<string>('sans-serif');
  const [fontSize, setFontSize] = useState<number>(16);
  const [fontWeight, setFontWeight] = useState<number>(400);
  const [outlineSize, setOutlineSize] = useState<number>(2);
  const [bottomPadding, setBottomPadding] = useState<number>(10);

  useEffect(() => {
    setFontFamily(settingsStorage.getSubtitleFontFamily());
    setFontSize(settingsStorage.getSubtitleFontSize());
    setFontWeight(settingsStorage.getSubtitleFontWeight());
    setOutlineSize(settingsStorage.getSubtitleOutlineSize());
    setBottomPadding(settingsStorage.getSubtitleBottomPadding());
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

  return (
    <div className="subtitle-settings">
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

      <div className="settings-divider" />

      {/* Subtitle Live Preview Box */}
      <div className="settings-row flex-col items-stretch pt-4 pb-2" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        <h3 className="label-lg text-muted" style={{ marginBottom: '12px' }}>Live Preview</h3>
        <div 
          className="relative w-full h-32 rounded-xl border border-white/10 overflow-hidden flex items-center justify-center"
          style={{
            position: 'relative',
            width: '100%',
            height: '120px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: "radial-gradient(circle at center, #2d2e3d 0%, #0d0e12 100%)",
          }}
        >
          {/* Subtle cinematic visual overlay */}
          <div 
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.05,
              backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
              backgroundSize: "20px 20px"
            }}
          />
          <span
            style={{
              zIndex: 10,
              color: '#ffffff',
              fontFamily: fontFamily,
              fontSize: `${fontSize}px`,
              fontWeight: fontWeight,
              textShadow: outlineSize > 0 
                ? `0 0 ${outlineSize}px #000, 0 0 ${outlineSize}px #000, 0 0 ${outlineSize}px #000, 0 0 ${outlineSize}px #000` 
                : 'none',
              paddingBottom: `${bottomPadding}px`,
              transition: 'all 0.15s ease-out',
            }}
          >
            Example Subtitle Text
          </span>
        </div>
      </div>
    </div>
  );
};
