import { MatrixClient, SyncState } from 'matrix-js-sdk';
import React, { useCallback, useState } from 'react';
import { Box, config, Line, Text } from 'folds';
import { useSyncState } from '../../hooks/useSyncState';
import { ContainerColor } from '../../styles/ContainerColor.css';

type StateData = {
  current: SyncState | null;
  previous: SyncState | null | undefined;
};

type SyncStatusPresentation = {
  variant: 'Warning' | 'Critical';
  label: string;
};

function getSyncStatusPresentation(current: SyncState | null): SyncStatusPresentation | null {
  switch (current) {
    case SyncState.Catchup:
      return { variant: 'Warning', label: 'Catching up...' };
    case SyncState.Reconnecting:
      return { variant: 'Warning', label: 'Connection Lost! Reconnecting...' };
    case SyncState.Error:
      return { variant: 'Critical', label: 'Connection Lost!' };
    case SyncState.Prepared:
    case SyncState.Syncing:
    default:
      return null;
  }
}

type SyncStatusProps = {
  mx: MatrixClient;
};
export function SyncStatus({ mx }: SyncStatusProps) {
  const [stateData, setStateData] = useState<StateData>({
    current: null,
    previous: undefined,
  });

  useSyncState(
    mx,
    useCallback((current, previous) => {
      setStateData((s) => {
        if (s.current === current && s.previous === previous) {
          return s;
        }
        return { current, previous };
      });
    }, [])
  );

  const presentation = getSyncStatusPresentation(stateData.current);

  if (!presentation) return null;

  return (
    <Box direction="Column" shrink="No">
      <Box
        className={ContainerColor({ variant: presentation.variant })}
        style={{ padding: `${config.space.S100} 0` }}
        alignItems="Center"
        justifyContent="Center"
      >
        <Text size="L400">{presentation.label}</Text>
      </Box>
      <Line variant={presentation.variant} size="300" />
    </Box>
  );
}
