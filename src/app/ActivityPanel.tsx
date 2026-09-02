import { useState } from 'react';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';

export function ActivityPanel() {
  const [shareMessage, setShareMessage] = useState('');
  const [confirmingReset, setConfirmingReset] = useState(false);
  const state = useWorkspaceStore();

  const share = async () => {
    const result = await workspaceService.query({ type: 'create-share-link' });
    const url = (result.data as { url?: string } | undefined)?.url;
    if (!result.ok || !url) return setShareMessage(result.message);
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage('Share link copied');
    } catch {
      setShareMessage(url);
    }
  };

  return (
    <div className="activity-panel">
      <div className="workspace-actions">
        <button
          type="button"
          onClick={() => void workspaceService.execute({ type: 'undo' })}
          disabled={
            !state.undo || state.operation === 'calculating' || state.operation === 'drawing'
          }
        >
          Undo last change
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={share}
          disabled={state.operation === 'calculating'}
        >
          Share plan
        </button>
      </div>
      {shareMessage ? <output className="share-output">{shareMessage}</output> : null}

      <div className="activity-heading">
        <h3>Recent changes</h3>
        <span>Saved in this browser</span>
      </div>
      {state.activity.length > 0 ? (
        <ol className="activity-list">
          {state.activity
            .toReversed()
            .slice(0, 8)
            .map((entry) => (
              <li key={entry.id}>
                <span>{entry.message}</span>
                <time dateTime={new Date(entry.timestamp).toISOString()}>
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </li>
            ))}
        </ol>
      ) : (
        <p className="empty-activity">Your changes will appear here.</p>
      )}

      <div className="reset-area">
        <button
          type="button"
          className="text-button danger-text"
          onClick={() => {
            if (!confirmingReset) return setConfirmingReset(true);
            setConfirmingReset(false);
            void workspaceService.execute({ type: 'reset' });
          }}
          disabled={state.operation === 'calculating'}
        >
          {confirmingReset ? 'Confirm start over' : 'Start over'}
        </button>
        {confirmingReset ? (
          <button type="button" className="text-button" onClick={() => setConfirmingReset(false)}>
            Cancel
          </button>
        ) : null}
      </div>

      <p className="workspace-footnote">
        {document.modelContext
          ? 'Browser assistant connected'
          : 'You are using Groundwork manually. Your analysis stays on this device.'}
      </p>
    </div>
  );
}
