import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';

function minutes(value: number | null) {
  return value === null ? '—' : `${Math.round(value)}m`;
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
    <section className="panel results-panel" aria-labelledby="results-heading">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">Calculated result</div>
          <h2 id="results-heading">Matching area</h2>
        </div>
        <strong className="area-stat">{areaLabel(derived.feasibleAreaKm2)}</strong>
      </div>
      {derived.restriction ? (
        <p className="restriction">{derived.restriction.message}</p>
      ) : (
        <p className="empty-state">Combine at least two conditions to reveal the overlap.</p>
      )}
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
                <span>
                  <strong>{candidate.name}</strong>
                  <small>{candidate.tradeoff}</small>
                </span>
              </button>
              <dl>
                <div>
                  <dt>Bike</dt>
                  <dd>{minutes(candidate.bikeMinutes)}</dd>
                </div>
                <div>
                  <dt>Grocery</dt>
                  <dd>{minutes(candidate.groceryMinutes)}</dd>
                </div>
                <div>
                  <dt>Park</dt>
                  <dd>{minutes(candidate.parkMinutes)}</dd>
                </div>
              </dl>
              {candidate.comfortable.length > 0 ? (
                <p className="candidate-detail">
                  Comfortable margin: {candidate.comfortable.join(', ')}.
                </p>
              ) : null}
              {candidate.nearestGrocery ? (
                <p className="candidate-detail">Nearest grocery: {candidate.nearestGrocery}.</p>
              ) : null}
              {candidate.nearestPark ? (
                <p className="candidate-detail">Nearest park: {candidate.nearestPark}.</p>
              ) : null}
              {candidate.closeToFailing ? (
                <p className="candidate-warning">Tightest edge: {candidate.closeToFailing}.</p>
              ) : null}
              <button
                className="remove-candidate"
                type="button"
                aria-label={`Remove candidate ${index + 1} from consideration`}
                disabled={mutationsDisabled}
                onClick={() =>
                  void workspaceService.execute({ type: 'remove-candidate', id: candidate.id })
                }
              >
                Remove
              </button>
            </article>
          ))}
        </div>
      ) : null}
      {derived.feasibleRegion ? (
        <details className="method-panel">
          <summary>How this is calculated</summary>
          <p>
            Bicycle and walking minutes use a checksum-pinned OpenStreetMap street graph on this
            device. Reachable edges include an interpolated cutoff point; candidates are tested
            against DataSF neighborhood polygons and named with the nearest OSM cross-street.
          </p>
          <p>
            Limits: no live traffic, hills, closures, opening hours, entrance accessibility, or
            housing availability. OSM completeness varies and modeled times are not guarantees.
          </p>
        </details>
      ) : null}
    </section>
  );
}
