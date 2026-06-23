import React, { useState, useEffect } from 'react';
import { settingsStorage } from '../../lib/storage';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';

const QUALITIES = ['360p', '480p', '720p', '1080p', '4k'];

export const PreferencesSettings: React.FC = () => {
  const [downloadLocation, setDownloadLocation] = useState<string>('vega');
  const [excludedQualities, setExcludedQualities] = useState<string[]>([]);

  useEffect(() => {
    setDownloadLocation(settingsStorage.getDownloadLocation());
    setExcludedQualities(settingsStorage.getExcludedQualities());
  }, []);

  const handleChangeDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        setDownloadLocation(selected);
        settingsStorage.setDownloadLocation(selected);
      }
    } catch (err) {
      console.error('Failed to open dialog:', err);
    }
  };

  const handleResetDir = () => {
    setDownloadLocation('vega');
    settingsStorage.resetDownloadLocation();
  };

  const handleToggleQuality = (quality: string) => {
    const updated = excludedQualities.includes(quality)
      ? excludedQualities.filter(q => q !== quality)
      : [...excludedQualities, quality];
    
    setExcludedQualities(updated);
    settingsStorage.setExcludedQualities(updated);
  };

  return (
    <div className="preferences-settings">
      {/* Download Directory */}
      <div className="settings-row">
        <div className="settings-info">
          <h3 className="label-lg">Download Directory</h3>
          <p className="body-md text-muted" style={{ wordBreak: 'break-all' }}>
            {downloadLocation === 'vega' ? 'Default (Documents/VegaDownloads)' : downloadLocation}
          </p>
        </div>
        <div className="flex gap-2">
          <button 
            className="theme-toggle-btn active flex items-center gap-2"
            onClick={handleChangeDir}
          >
            <FolderOpen size={16} /> Change
          </button>
          {downloadLocation !== 'vega' && (
            <button 
              className="theme-toggle-btn"
              onClick={handleResetDir}
            >
              Reset
            </button>
          )}
        </div>
      </div>
      
      <div className="settings-divider" />
      
      {/* Excluded Qualities */}
      <div className="settings-row">
        <div className="settings-info w-full">
          <h3 className="label-lg">Excluded Qualities</h3>
          <p className="body-md text-muted mb-sm">Select qualities you want to hide from playback and downloads.</p>
          
          <div className="mt-sm" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {QUALITIES.map(q => {
              const isExcluded = excludedQualities.includes(q);
              return (
                <button
                  key={q}
                  className={`quality-toggle-btn ${isExcluded ? 'excluded' : ''}`}
                  onClick={() => handleToggleQuality(q)}
                  title={isExcluded ? 'Click to Include' : 'Click to Exclude'}
                >
                  {q}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
