import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CANONICAL, EMPTY_DERIVED } from '../domain/defaults';
import { workspaceService } from '../domain/workspace-service';
import { useWorkspaceStore } from '../store/workspace-store';
import { ConditionsPanel } from './ConditionsPanel';

describe('ConditionsPanel', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      canonical: {
        ...structuredClone(EMPTY_CANONICAL),
        conditions: [
          {
            id: 'school-1',
            kind: 'access',
            category: 'school',
            mode: 'walk',
            label: '10-minute walk to schools',
            visible: true,
            maxMinutes: 10,
          },
        ],
      },
      derived: structuredClone(EMPTY_DERIVED),
      operation: 'idle',
      analysisFreshness: 'not-combined',
      drawingReady: true,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('commits one activity-producing command for a single Enter edit', async () => {
    const execute = vi.spyOn(workspaceService, 'execute').mockResolvedValue({
      ok: true,
      message: 'Updated a priority.',
    });
    const view = render(<ConditionsPanel />);
    const input = view.getByLabelText('Minutes for 10-minute walk to schools');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledWith({
      type: 'update-condition',
      id: 'school-1',
      maxMinutes: 15,
      actor: 'user',
    });
  });
});
