import React, { useState, useEffect } from 'react';
import { settingsStorage } from '../../lib/storage';
import { CustomSelect } from '../CustomSelect';

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
    const val = parseInt(e.target.value, 10);
    setFontSize(val);
    settingsStorage.setSubtitleFontSize(val);
  };

  const handleFontWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setFontWeight(val);
    settingsStorage.setSubtitleFontWeight(val);
  };

  const handleOutlineSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setOutlineSize(val);
    settingsStorage.setSubtitleOutlineSize(val);
  };

  const handleBottomPaddingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
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
        <input 
          type="range" 
          min="12" 
          max="100" 
          step="2" 
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
        <input 
          type="range" 
          min="100" 
          max="900" 
          step="100" 
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
        <input 
          type="range" 
          min="0" 
          max="10" 
          step="1" 
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
        <input 
          type="range" 
          min="0" 
          max="50" 
          step="5" 
          value={bottomPadding} 
          onChange={handleBottomPaddingChange}
          className="slider"
        />
      </div>
    </div>
  );
};
