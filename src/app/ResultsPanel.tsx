import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';

function minutes(value: number | null) {
  return value === null ? '—' : `${Math.round(value)}m`;
}

export function ResultsPanel() {
  const derived = useWorkspaceStore((state) => state.derived);
  const selectedId = useWorkspaceStore((state) => state.canonical.selectedCandidateId);

  return (
    <section className="panel results-panel" aria-labelledby="results-heading">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">Calculated result</div>
          <h2 id="results-heading">Matching area</h2>
        </div>
        <strong className="area-stat">{derived.feasibleAreaKm2.toFixed(2)} km²</strong>
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
                onClick={() =>
                  void workspaceService.execute({ type: 'select-candidate', id: candidate.id })
                }
              >
                <span className="candidate-rank">{index + 1}</span>
                <span>
                  <strong>Candidate {index + 1}</strong>
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
              <button
                className="remove-candidate"
                type="button"
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
    </section>
  );
}
