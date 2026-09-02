import { useEffect, useState, type FormEvent } from 'react';
import type { LocationResult } from '../domain/schemas';
import { CITIES } from '../domain/cities';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';

export function OnboardingPanel() {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<LocationResult[]>([]);
  const [loadingSample, setLoadingSample] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [confirmingSample, setConfirmingSample] = useState(false);
  const [editingStart, setEditingStart] = useState(false);
  const office = useWorkspaceStore((state) => state.canonical.office);
  const conditionCount = useWorkspaceStore((state) => state.canonical.conditions.length);
  const operation = useWorkspaceStore((state) => state.operation);
  const cityId = useWorkspaceStore((state) => state.cityId);
  const workspaceEpoch = useWorkspaceStore((state) => state.workspaceEpoch);
  const city = CITIES[cityId];

  useEffect(() => {
    setQuery('');
    setMatches([]);
    setSearched(false);
    setConfirmingSample(false);
    setEditingStart(false);
  }, [workspaceEpoch]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearched(false);
    try {
      const result = await workspaceService.query({ type: 'search-locations', query });
      setMatches((result.data as LocationResult[] | undefined) ?? []);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  };

  const loadSample = async () => {
    if ((office || conditionCount > 0) && !confirmingSample) {
      setConfirmingSample(true);
      return;
    }
    setConfirmingSample(false);
    setLoadingSample(true);
    try {
      const commands = [
        { type: 'reset' as const },
        { type: 'set-office' as const, office: city.sampleOffice },
        { type: 'add-bike' as const, maxMinutes: city.samplePriorities.bikeMinutes },
        {
          type: 'add-access' as const,
          category: 'grocery' as const,
          maxMinutes: city.samplePriorities.groceryMinutes,
          groceryType: 'supermarket' as const,
        },
        {
          type: 'add-access' as const,
          category: 'park' as const,
          maxMinutes: city.samplePriorities.parkMinutes,
        },
        { type: 'combine' as const },
      ];
      for (const command of commands) {
        const result = await workspaceService.execute(command);
        if (!result.ok) break;
      }
    } finally {
      setLoadingSample(false);
    }
  };

  if (office && !editingStart) {
    return (
      <section className="setup-section destination-summary" aria-labelledby="destination-heading">
        <div className="setup-heading-row">
          <div>
            <p className="step-label">1 · Destination</p>
            <h1 id="destination-heading">Your regular destination</h1>
          </div>
          <span className="step-complete">Set</span>
        </div>
        <div className="destination-card">
          <span className="destination-marker" aria-hidden="true" />
          <div>
            <small>Commute to</small>
            <strong>{office.label}</strong>
          </div>
          <button type="button" className="text-button" onClick={() => setEditingStart(true)}>
            Change
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="setup-section destination-setup" aria-labelledby="destination-heading">
      <p className="step-label">Step 1 of 3</p>
      <h1 id="destination-heading">Where do you need to go?</h1>
      <p className="setup-description">Choose your workplace or another regular destination.</p>

      <form className="destination-search" onSubmit={search}>
        <label htmlFor="office-search">Search {city.name}</label>
        <div className="search-control">
          <input
            id="office-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Company, address, street, or landmark"
            minLength={2}
            autoFocus={!office}
          />
          <button
            type="submit"
            className="primary-button compact-primary"
            disabled={searching || query.trim().length < 2}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {matches.length > 0 ? (
        <ul className="search-results" aria-label="Location matches">
          {matches.map((match) => (
            <li key={`${match.id}-${match.kind}-${match.coordinates.join(',')}`}>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const result = await workspaceService.execute({
                      type: 'set-office',
                      office: { label: match.label, coordinates: match.coordinates },
                    });
                    if (result.ok) {
                      setMatches([]);
                      setEditingStart(false);
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

      <div className="sample-option">
        <span>Not ready to start your own plan?</span>
        <button
          type="button"
          className="text-button"
          onClick={loadSample}
          disabled={loadingSample || operation === 'calculating' || operation === 'drawing'}
          data-testid="load-sample"
        >
          {loadingSample
            ? 'Preparing example…'
            : confirmingSample
              ? 'Replace with example'
              : 'Try an example'}
        </button>
        {confirmingSample ? (
          <button
            type="button"
            className="text-button muted-text-button"
            onClick={() => setConfirmingSample(false)}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </section>
  );
}
