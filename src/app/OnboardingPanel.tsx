import { useState, type FormEvent } from 'react';
import type { LocationResult } from '../domain/schemas';
import { SAMPLE_OFFICE } from '../domain/defaults';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';

export function OnboardingPanel() {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<LocationResult[]>([]);
  const [loadingSample, setLoadingSample] = useState(false);
  const office = useWorkspaceStore((state) => state.canonical.office);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const result = await workspaceService.query({ type: 'search-locations', query });
    setMatches((result.data as LocationResult[] | undefined) ?? []);
  };

  const loadSample = async () => {
    setLoadingSample(true);
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
    await workspaceService.execute({ type: 'rank' });
    setLoadingSample(false);
  };

  return (
    <section className="panel onboarding-panel" aria-labelledby="decision-heading">
      <div className="eyebrow">Start with intent</div>
      <h1 id="decision-heading">What location decision are you trying to make?</h1>
      <p className="subtle">
        Ask your browser agent, or build the same analysis manually. Every condition remains visible
        and editable.
      </p>
      <blockquote>
        “Find me a place under a 25-minute bike ride from 1 Market Street, within 10 minutes of
        groceries and 8 minutes of a park.”
      </blockquote>
      <button
        className="primary-button"
        type="button"
        onClick={loadSample}
        disabled={loadingSample}
        data-testid="load-sample"
      >
        {loadingSample ? 'Building sample…' : 'Run the sample analysis'}
      </button>
      <form className="search-form" onSubmit={search}>
        <label htmlFor="office-search">Office address</label>
        <div className="input-row">
          <input
            id="office-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="1 Market Street"
          />
          <button type="submit" className="icon-button" aria-label="Search office locations">
            →
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
                }}
              >
                {match.label}
              </button>
            </li>
          ))}
        </ul>
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
