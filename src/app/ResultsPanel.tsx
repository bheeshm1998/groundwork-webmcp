import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';

function minutes(value: number | null) {
  return value === null ? '—' : `${Math.round(value)} min`;
}

function areaLabel(value: number) {
  if (value > 0 && value < 0.01) return '<0.01 km²';
  return `${value.toFixed(2)} km²`;
}

export function ResultsPanel() {
  const derived = useWorkspaceStore((state) => state.derived);
  const selectedId = useWorkspaceStore((state) => state.canonical.selectedCandidateId);
  const operation = useWorkspaceStore((state) => state.operation);
  const mutationsDisabled = operation === 'calculating' || operation === 'drawing';

  return (
    <section className="results-panel" aria-labelledby="results-heading">
      <div className="results-intro">
        <p className="step-label">3 · Results</p>
        <h2 id="results-heading">Your matching areas</h2>
        <p>
          <strong>{areaLabel(derived.feasibleAreaKm2)}</strong> of San Francisco fits your current
          priorities.
        </p>
      </div>

      {derived.candidates.length > 0 ? (
        <div className="candidate-list" data-testid="candidate-list">
          {derived.candidates.map((candidate, index) => (
            <article
              key={candidate.id}
              className={`candidate-card ${selectedId === candidate.id ? 'selected' : ''}`}
            >
              <button
                type="button"
                className="candidate-main"
                aria-pressed={selectedId === candidate.id}
                aria-label={`Select candidate ${index + 1} at ${candidate.coordinates[1].toFixed(3)}, ${candidate.coordinates[0].toFixed(3)}`}
                disabled={mutationsDisabled}
                onClick={() =>
                  void workspaceService.execute({ type: 'select-candidate', id: candidate.id })
                }
              >
                <span className="candidate-rank">{index + 1}</span>
                <span className="candidate-title">
                  <small>{index === 0 ? 'Best balance' : `Option ${index + 1}`}</small>
                  <strong>{candidate.name}</strong>
                </span>
              </button>

              <dl className="candidate-metrics">
                <div>
                  <dt>Bike</dt>
                  <dd>{minutes(candidate.bikeMinutes)}</dd>
                </div>
                <div>
                  <dt>Groceries</dt>
                  <dd>{minutes(candidate.groceryMinutes)}</dd>
                </div>
                <div>
                  <dt>Park</dt>
                  <dd>{minutes(candidate.parkMinutes)}</dd>
                </div>
              </dl>

              <details className="candidate-details">
                <summary>View details</summary>
                <p>{candidate.tradeoff}</p>
                {candidate.comfortable.length > 0 ? (
                  <p>Comfortable margin: {candidate.comfortable.join(', ')}.</p>
                ) : null}
                {candidate.closeToFailing ? (
                  <p className="candidate-warning">Closest limit: {candidate.closeToFailing}.</p>
                ) : null}
                <button
                  className="text-button danger-text"
                  type="button"
                  disabled={mutationsDisabled}
                  onClick={() =>
                    void workspaceService.execute({ type: 'remove-candidate', id: candidate.id })
                  }
                >
                  Remove this option
                </button>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <div className="no-results">
          <strong>No matching area yet</strong>
          <p>Try increasing one of your time limits or removing a priority.</p>
        </div>
      )}

      {derived.restriction ? (
        <details className="result-insight">
          <summary>What is limiting my search?</summary>
          <p>{derived.restriction.message}</p>
        </details>
      ) : null}

      {derived.feasibleRegion ? (
        <details className="method-panel">
          <summary>About these estimates</summary>
          <p>
            Times are modeled from OpenStreetMap streets. They do not include live traffic, hills,
            closures, opening hours, or housing availability.
          </p>
        </details>
      ) : null}
    </section>
  );
}
