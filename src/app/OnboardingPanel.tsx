import { useState, type FormEvent } from 'react';
import type { LocationResult } from '../domain/schemas';
import { SAMPLE_OFFICE } from '../domain/defaults';
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
      await workspaceService.execute({ type: 'reset' });
      await workspaceService.execute({ type: 'set-office', office: SAMPLE_OFFICE });
      await workspaceService.execute({ type: 'add-bike', maxMinutes: 25 });
      await workspaceService.execute({
        type: 'add-access',
        category: 'grocery',
        maxMinutes: 10,
        groceryType: 'supermarket',
      });
      await workspaceService.execute({ type: 'add-access', category: 'park', maxMinutes: 8 });
      await workspaceService.execute({ type: 'combine' });
      setEditingStart(false);
    } finally {
      setLoadingSample(false);
    }
  };

  if ((office || conditionCount > 0) && !editingStart) {
    return (
      <section
        className="panel onboarding-panel compact-onboarding"
        aria-labelledby="decision-heading"
      >
        <div className="eyebrow">Decision setup</div>
        <h1 id="decision-heading">{office ? 'Office selected' : 'Setup in progress'}</h1>
        {office ? (
          <div className="office-chip">
            <span aria-hidden="true">◆</span>
            {office.label}
          </div>
        ) : null}
        <button type="button" onClick={() => setEditingStart(true)}>
          Edit office or sample
        </button>
      </section>
    );
  }

  return (
    <section className="panel onboarding-panel" aria-labelledby="decision-heading">
      <div className="eyebrow">Start with intent</div>
      <h1 id="decision-heading">What location decision are you trying to make?</h1>
      <p className="subtle">
        Ask your browser agent, or build the same analysis manually. Every condition remains visible
        and editable.
      </p>
      <blockquote>
        “Find me a place under a 25-minute bike ride from San Francisco City Hall, within 10 minutes
        of groceries and 8 minutes of a park.”
      </blockquote>
      <button
        className="primary-button"
        type="button"
        onClick={loadSample}
        disabled={loadingSample || operation === 'calculating' || operation === 'drawing'}
        data-testid="load-sample"
      >
        {loadingSample
          ? 'Building sample…'
          : confirmingSample
            ? 'Replace workspace with sample'
            : 'Run the sample analysis'}
      </button>
      {confirmingSample ? (
        <button type="button" className="sample-cancel" onClick={() => setConfirmingSample(false)}>
          Keep current workspace
        </button>
      ) : null}
      <form className="search-form" onSubmit={search}>
        <label htmlFor="office-search">Office address</label>
        <div className="input-row">
          <input
            id="office-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="San Francisco City Hall"
            minLength={2}
          />
          <button
            type="submit"
            className="icon-button"
            aria-label="Search office locations"
            disabled={searching || query.trim().length < 2}
          >
            {searching ? '…' : '→'}
          </button>
        </div>
      </form>
      {matches.length > 0 ? (
        <ul className="search-results" aria-label="Location matches">
          {matches.map((match) => (
            <li key={match.id}>
              <button
                type="button"
                onClick={() => {
                  void workspaceService.execute({
                    type: 'set-office',
                    office: { label: match.label, coordinates: match.coordinates },
                  });
                  setMatches([]);
                  setEditingStart(false);
                }}
              >
                {match.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {searched && matches.length === 0 ? (
        <p className="empty-state" role="status">
          No supported San Francisco locations found. Try a street or landmark.
        </p>
      ) : null}
      {office ? (
        <div className="office-chip">
          <span aria-hidden="true">◆</span>
          {office.label}
        </div>
      ) : null}
    </section>
  );
}
