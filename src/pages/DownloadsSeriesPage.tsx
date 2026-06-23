import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDownloadStore, DownloadItem } from '../lib/zustand/downloadStore';
import { Play, ArrowLeft, Trash2 } from 'lucide-react';
import { CustomSelect } from '../components/CustomSelect';
import './DownloadsPage.css';

export const DownloadsSeriesPage = () => {
  const { showName } = useParams<{ showName: string }>();
  const navigate = useNavigate();
  const { downloads, cancelDownload } = useDownloadStore();

  const decodedShowName = decodeURIComponent(showName || '');

  // Get all completed downloads for this show
  const showDownloads = useMemo(() => {
    return Object.values(downloads).filter(
      d => d.status === 'completed' && (d.showName === decodedShowName || d.title === decodedShowName)
    );
  }, [downloads, decodedShowName]);

  // Extract unique seasons
  const seasons = useMemo(() => {
    const sList = new Set<string>();
    showDownloads.forEach(d => {
      sList.add(d.seasonTitle || 'Extras');
    });
    return Array.from(sList).sort();
  }, [showDownloads]);

  const [activeSeason, setActiveSeason] = useState<string>(seasons.length > 0 ? seasons[0] : 'Extras');

  // If no downloads left, go back
  if (showDownloads.length === 0) {
    navigate('/downloads', { replace: true });
    return null;
  }

  const poster = showDownloads[0]?.poster;
  const imdbId = showDownloads[0]?.imdbId;

  const currentSeasonDownloads = showDownloads.filter(d => (d.seasonTitle || 'Extras') === activeSeason);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handlePlay = (item: DownloadItem, index: number) => {
    // Pass the entire season list so we can do next/prev
    const episodeList = currentSeasonDownloads.map(d => ({
      title: d.episodeName || d.title,
      link: d.filePath
    }));

    navigate('/player', {
      state: {
        episodeList,
        linkIndex: index,
        type: item.type || 'series',
        primaryTitle: item.showName || item.title,
        secondaryTitle: item.seasonTitle,
        poster: { poster: item.poster },
        providerValue: 'local',
        infoUrl: item.filePath
      }
    });
  };

  return (
    <div className="downloads-page">
      <div className="downloads-header" style={{ marginBottom: '40px', display: 'flex', alignItems: 'center', gap: '20px' }}>
        <button className="icon-btn back-btn glass-overlay" onClick={() => navigate('/downloads')}>
          <ArrowLeft size={24} />
        </button>
        <h1 className="headline-lg" style={{ margin: 0 }}>{decodedShowName}</h1>
      </div>

      <div className="series-downloads-content" style={{ display: 'flex', gap: '32px' }}>
        <div className="series-poster-col" style={{ width: '280px', flexShrink: 0 }}>
          <div style={{ 
            backgroundImage: `url(${poster || ''})`, 
            aspectRatio: '2/3',
            width: '100%',
            borderRadius: '16px',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)'
          }} />
          <div className="series-meta" style={{ marginTop: '16px' }}>
            <h2 className="title-md">{decodedShowName}</h2>
            {imdbId && <p className="text-muted body-sm">IMDb: {imdbId}</p>}
            <p className="text-muted body-sm">{showDownloads.length} Episodes Downloaded</p>
          </div>
        </div>

        <div className="series-episodes-col" style={{ flex: 1 }}>
          {seasons.length > 1 && (
            <div className="season-selector" style={{ marginBottom: '20px' }}>
              <CustomSelect
                options={seasons.map(s => ({ value: s, label: s }))}
                value={activeSeason}
                onChange={val => setActiveSeason(val)}
                className="season-selector-custom"
              />
            </div>
          )}

          <div className="episodes-list">
            {currentSeasonDownloads.map((item, idx) => (
              <div 
                key={item.id} 
                className="episode-card glass-overlay"
                onClick={() => handlePlay(item, idx)}
                style={{ display: 'flex', alignItems: 'center', padding: '16px', borderRadius: '12px', marginBottom: '12px', cursor: 'pointer', background: 'rgba(255, 255, 255, 0.05)' }}
              >
                <div className="episode-number" style={{ width: '40px', fontSize: '1.2rem', fontWeight: 'bold', color: 'rgba(255,255,255,0.5)' }}>
                  {idx + 1}
                </div>
                <div className="episode-info" style={{ flex: 1 }}>
                  <h4 className="label-lg">{item.episodeName || item.title}</h4>
                  <p className="text-muted body-sm" style={{ marginTop: '4px' }}>{formatBytes(item.totalBytes)}</p>
                </div>
                <div className="episode-actions" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button 
                    className="icon-btn" 
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelDownload(item.id);
                    }}
                    style={{ color: 'rgba(255, 255, 255, 0.4)' }}
                    title="Delete Download"
                  >
                    <Trash2 size={20} />
                  </button>
                  <button className="icon-btn" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}>
                    <Play size={20} fill="currentColor" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
