import type { AreaGeometry } from '../domain/schemas';
import { useWorkspaceStore } from '../store/workspace-store';

let pending:
  | {
      resolve: (geometry: AreaGeometry) => void;
      reject: (reason?: unknown) => void;
      cleanup?: () => void;
    }
  | undefined;

export function requestPreferenceDraw(signal?: AbortSignal): Promise<AreaGeometry> {
  if (pending) return Promise.reject(new Error('A drawing request is already active.'));
  if (signal?.aborted) return Promise.reject(new Error('Drawing was cancelled.'));
  const state = useWorkspaceStore.getState();
  if (!state.drawingReady) return Promise.reject(new Error('The map drawing tools are not ready.'));
  if (state.operation === 'calculating' || state.operation === 'drawing')
    return Promise.reject(new Error('Finish the current workspace operation first.'));
  return new Promise((resolve, reject) => {
    const onAbort = () => cancelPreferenceDraw('Drawing was cancelled.');
    signal?.addEventListener('abort', onAbort, { once: true });
    pending = {
      resolve,
      reject,
      cleanup: () => signal?.removeEventListener('abort', onAbort),
    };
    state.commit({ operation: 'drawing', error: null });
    window.dispatchEvent(new CustomEvent('groundwork:start-draw'));
  });
}

export function completePreferenceDraw(geometry: AreaGeometry): boolean {
  if (!pending) return false;
  pending?.cleanup?.();
  pending?.resolve(geometry);
  pending = undefined;
  useWorkspaceStore.getState().commit({ operation: 'idle' });
  return true;
}

export function cancelPreferenceDraw(message = 'Drawing was cancelled.'): void {
  pending?.cleanup?.();
  pending?.reject(new Error(message));
  pending = undefined;
  useWorkspaceStore.getState().commit({ operation: 'idle' });
  window.dispatchEvent(new CustomEvent('groundwork:cancel-draw'));
}
