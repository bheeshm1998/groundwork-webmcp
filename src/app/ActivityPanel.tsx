import { useState } from 'react';
import { getCapabilities } from '../domain/capabilities';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';

export function ActivityPanel() {
  const [shareMessage, setShareMessage] = useState('');
  const [confirmingReset, setConfirmingReset] = useState(false);
  const state = useWorkspaceStore();
  const capabilityCount = getCapabilities(
    state.canonical,
    state.derived,
    state.analysisFreshness,
    Boolean(state.undo),
  ).size;

  const share = async () => {
    const result = await workspaceService.query({ type: 'create-share-link' });
    const url = (result.data as { url?: string } | undefined)?.url;
    if (!result.ok || !url) return setShareMessage(result.message);
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage('Link copied');
    } catch {
      setShareMessage(url);
    }
  };

  return (
    <section className="panel activity-panel" aria-labelledby="activity-heading">
      <div className="panel-heading">
        <h2 id="activity-heading">Activity</h2>
        <span className="agent-count">
          <i />
          {document.modelContext
            ? `${capabilityCount} agent actions available`
            : 'Manual workspace history'}
        </span>
      </div>
      <ol className="activity-list">
        {state.activity
          .toReversed()
          .slice(0, 6)
          .map((entry) => (
            <li key={entry.id}>
              <span className={`actor ${entry.actor}`}>
                {entry.actor}
                <time dateTime={new Date(entry.timestamp).toISOString()}>
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </span>
              {entry.message}
            </li>
          ))}
      </ol>
      <div className="action-row">
        <button
          type="button"
          onClick={() => void workspaceService.execute({ type: 'undo' })}
          disabled={
            !state.undo || state.operation === 'calculating' || state.operation === 'drawing'
          }
        >
          Undo last change
        </button>
        <button type="button" onClick={share} disabled={state.operation === 'calculating'}>
          Share workspace
        </button>
        <button
          type="button"
          className="ghost-danger"
          onClick={() => {
            if (!confirmingReset) return setConfirmingReset(true);
            setConfirmingReset(false);
            void workspaceService.execute({ type: 'reset' });
          }}
          disabled={state.operation === 'calculating'}
        >
          {confirmingReset ? 'Confirm reset' : 'Reset'}
        </button>
        {confirmingReset ? (
          <button type="button" onClick={() => setConfirmingReset(false)}>
            Cancel
          </button>
        ) : null}
      </div>
      {shareMessage ? <output className="share-output">{shareMessage}</output> : null}
    </section>
  );
}
