import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { LocationResult } from '../domain/schemas';
import { CITIES } from '../domain/cities';
import { buildStarterPrompts } from '../domain/starter-prompts';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';

export function OnboardingPanel() {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<LocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const [copyMessage, setCopyMessage] = useState('');
  const searchController = useRef<AbortController | null>(null);
  const destinations = useWorkspaceStore((state) => state.canonical.destinations);
  const operation = useWorkspaceStore((state) => state.operation);
  const cityId = useWorkspaceStore((state) => state.cityId);
  const workspaceEpoch = useWorkspaceStore((state) => state.workspaceEpoch);
  const initialized = useWorkspaceStore((state) => state.initialized);
  const city = CITIES[cityId];
  const prompts = useMemo(() => buildStarterPrompts(city), [city]);
  const mutationsDisabled = operation === 'calculating' || operation === 'drawing';

  useEffect(() => {
    searchController.current?.abort();
    setQuery('');
    setMatches([]);
    setSearched(false);
    setPromptIndex(0);
    setCopyMessage('');
  }, [workspaceEpoch]);

  const runSearch = useCallback(async (value: string) => {
    if (value.trim().length < 2) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSearching(true);
    setSearched(false);
    try {
      const result = await workspaceService.query(
        { type: 'search-locations', query: value },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setMatches((result.data as LocationResult[] | undefined) ?? []);
      setSearched(true);
    } finally {
      if (searchController.current === controller) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized || query.trim().length < 2) {
      searchController.current?.abort();
      setMatches([]);
      setSearched(false);
      setSearching(false);
      return;
    }
    const timeout = window.setTimeout(() => void runSearch(query), 280);
    return () => window.clearTimeout(timeout);
  }, [initialized, query, runSearch]);

  useEffect(() => () => searchController.current?.abort(), []);

  const search = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompts[promptIndex] ?? '');
      setCopyMessage('Copied. Paste it into your browser assistant.');
    } catch {
      setCopyMessage('Select the text and press Ctrl+C to copy it.');
    }
  };

  return (
    <section className="setup-section destination-setup" aria-labelledby="destination-heading">
      <div className="setup-heading-row">
        <div>
          <p className="step-label">1 · Destinations</p>
          <h1 id="destination-heading">Where do you need to go?</h1>
        </div>
        <span className="priority-count">{destinations.length}/4</span>
      </div>
      <p className="setup-description">Add workplaces, schools, or other regular destinations.</p>

      {destinations.length > 0 ? (
        <ul className="destination-list" aria-label="Current destinations">
          {destinations.map((destination) => (
            <li key={destination.id} className="destination-card">
              <span className="destination-marker" aria-hidden="true" />
              <div>
                <small>Travel to</small>
                <strong>{destination.label}</strong>
              </div>
              <button
                type="button"
                className="text-button danger-text"
                disabled={mutationsDisabled}
                onClick={() =>
                  void workspaceService.execute({
                    type: 'remove-destination',
                    id: destination.id,
                    actor: 'user',
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {destinations.length < 4 ? (
        <form className="destination-search" onSubmit={search}>
          <label htmlFor="destination-search">Search {city.name}</label>
          <div className="search-control">
            <input
              id="destination-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                initialized ? 'Company, address, street, or landmark' : 'Preparing local search…'
              }
              aria-describedby="search-help"
              minLength={2}
              autoFocus={destinations.length === 0}
              disabled={!initialized}
            />
            <button
              type="submit"
              className="primary-button compact-primary"
              disabled={!initialized || searching || query.trim().length < 2}
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          <small id="search-help" className="search-help">
            Typo-tolerant search · results update as you type
          </small>
        </form>
      ) : null}

      {matches.length > 0 ? (
        <ul className="search-results" aria-label="Location matches">
          {matches.map((match) => (
            <li key={`${match.id}-${match.kind}-${match.coordinates.join(',')}`}>
              <button
                type="button"
                disabled={mutationsDisabled}
                onClick={() => {
                  void (async () => {
                    const result = await workspaceService.execute({
                      type: 'add-destination',
                      actor: 'user',
                      destination: { label: match.label, coordinates: match.coordinates },
                    });
                    if (result.ok) {
                      setQuery('');
                      setMatches([]);
                      setSearched(false);
                    }
                  })();
                }}
              >
                <span className="search-result-marker" aria-hidden="true" />
                <span className="search-result-copy">
                  <strong>{match.label}</strong>
                  <small>
                    {match.kind === 'street' ? 'Street' : 'Place'} ·{' '}
                    {match.coordinates[1].toFixed(3)}, {match.coordinates[0].toFixed(3)}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {searched && matches.length === 0 ? (
        <p className="form-message" role="status">
          No match found. Try a street name or a well-known landmark.
        </p>
      ) : null}

      <details className="starter-prompt-panel" open={destinations.length === 0}>
        <summary>
          <span className="section-kicker">Try with ChatGPT</span>
          <strong>
            {destinations.length === 0
              ? 'Plan this map with your browser assistant'
              : 'Open agent starter prompt'}
          </strong>
        </summary>
        <div>
          <p>Copy one prompt, then watch ChatGPT operate the same workspace beside you.</p>
        </div>
        <div className="prompt-variations" aria-label="Prompt variations">
          {prompts.map((_, index) => (
            <button
              key={index}
              type="button"
              className={promptIndex === index ? 'prompt-option selected' : 'prompt-option'}
              aria-pressed={promptIndex === index}
              onClick={() => {
                setPromptIndex(index);
                setCopyMessage('');
              }}
            >
              {index + 1}
            </button>
          ))}
        </div>
        <textarea
          readOnly
          value={prompts[promptIndex]}
          aria-label={`Starter prompt ${promptIndex + 1}`}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className="quiet-button copy-prompt-button" onClick={copyPrompt}>
          Copy prompt
        </button>
        {copyMessage ? <output className="prompt-copy-status">{copyMessage}</output> : null}
      </details>
    </section>
  );
}
