import React, { useState } from 'react';
import { Search, X, Download, Loader2 } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import './SearchSubtitlesModal.css';

interface SearchSubtitlesModalProps {
  initialSearchQuery: string;
  initialSeason?: string;
  initialEpisode?: string;
  onClose: () => void;
  onSelectSubtitle: (url: string, title: string) => void;
}

const subLanguageIds = [
  { name: 'English', id: 'eng' },
  { name: 'Spanish', id: 'spa' },
  { name: 'French', id: 'fre' },
  { name: 'German', id: 'ger' },
  { name: 'Italian', id: 'ita' },
  { name: 'Portuguese', id: 'por' },
  { name: 'Russian', id: 'rus' },
  { name: 'Chinese', id: 'chi' },
  { name: 'Japanese', id: 'jpn' },
  { name: 'Korean', id: 'kor' },
  { name: 'Arabic', id: 'ara' },
  { name: 'Hindi', id: 'hin' },
  { name: 'Dutch', id: 'dut' },
  { name: 'Swedish', id: 'swe' },
  { name: 'Polish', id: 'pol' },
  { name: 'Turkish', id: 'tur' },
  { name: 'Danish', id: 'dan' },
  { name: 'Norwegian', id: 'nor' },
  { name: 'Finnish', id: 'fin' },
  { name: 'Vietnamese', id: 'vie' },
  { name: 'Indonesian', id: 'ind' },
];

export const SearchSubtitlesModal: React.FC<SearchSubtitlesModalProps> = ({
  initialSearchQuery,
  initialSeason,
  initialEpisode,
  onClose,
  onSelectSubtitle,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '');
  const [season, setSeason] = useState(initialSeason || '');
  const [episode, setEpisode] = useState(initialEpisode || '');
  const [subId, setSubId] = useState('eng');

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState('');

  const searchSubtitles = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setLoading(true);
      setError('');
      setResults([]);

      const sq = encodeURIComponent(searchQuery.toLowerCase());
      const epPath = episode ? `/episode-${episode}` : '';
      const sqPath = searchQuery?.startsWith('tt') ? `/imdbid-${sq}` : `/query-${sq}`;
      const snPath = season ? `/season-${season}` : '';
      const subPath = subId ? `/sublanguageid-${subId}` : '';

      const url = `https://rest.opensubtitles.org/search${epPath}${sqPath}${snPath}${subPath}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-user-agent': 'VLSub 0.10.2',
        },
      });

      const data = await response.json();
      
      if (!data || data.length === 0) {
        setError('No Results Found');
      } else {
        setResults(data);
      }
    } catch (err: any) {
      console.error('Subtitle search error:', err);
      setError(err?.message || 'Error fetching subtitles');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-subtitles-modal-overlay" onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>
      <div className="search-subtitles-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Search Subtitles</h2>
          <button className="close-btn" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <form className="modal-search-form" onSubmit={searchSubtitles}>
          <input
            className="search-input"
            type="text"
            placeholder="Name or IMDB ID"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <CustomSelect
            className="lang-select-custom"
            value={subId}
            onChange={(val) => setSubId(val)}
            options={subLanguageIds.map(lang => ({
              value: lang.id,
              label: lang.name
            }))}
          />
          <input
            className="number-input"
            type="number"
            placeholder="Season"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          />
          <input
            className="number-input"
            type="number"
            placeholder="Episode"
            value={episode}
            onChange={(e) => setEpisode(e.target.value)}
          />
          <button type="submit" className="search-btn">
            {loading ? <Loader2 size={20} className="spinner" /> : <Search size={20} />}
          </button>
        </form>

        <div className="modal-results">
          {error && <div className="error-msg">{error}</div>}
          {!error && !loading && results.length === 0 && (
            <div className="empty-msg">Enter a query to search</div>
          )}
          
          <div className="results-list">
            {results.map((res: any) => (
              <div key={res.IDSubtitleFile} className="result-item">
                <div className="result-info">
                  <div className="result-title-row">
                    <span className="lang-badge">{res.SubLanguageID}</span>
                    <span className="movie-name">{res.MovieName?.trim()}</span>
                    {Number(res.SeriesSeason) > 0 && <span className="season-ep">S{res.SeriesSeason}</span>}
                    {Number(res.SeriesEpisode) > 0 && <span className="season-ep">E{res.SeriesEpisode}</span>}
                  </div>
                  <div className="result-meta">
                    {res.InfoReleaseGroup} {res.UserNickName}
                  </div>
                </div>
                <button 
                  className="download-btn"
                  onClick={() => {
                    const dlUrl = res.SubDownloadLink?.replace('.gz', '');
                    const title = `${res.InfoReleaseGroup || ''} ${res.UserNickName || ''}`.trim() || 'Online Sub';
                    onSelectSubtitle(dlUrl, title);
                    onClose();
                  }}
                >
                  <Download size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
