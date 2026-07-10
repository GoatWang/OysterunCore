import { ReactNode, useCallback, useMemo } from 'react';
import { Capabilities, validateAuthMetadata, ValidatedAuthMetadata } from 'matrix-js-sdk';
import { AsyncStatus, useAsyncCallbackValue } from '../hooks/useAsyncCallback';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { MediaConfig } from '../hooks/useMediaConfig';
import { promiseFulfilledResult } from '../utils/common';

export type ServerConfigs = {
  capabilities?: Capabilities;
  mediaConfig?: MediaConfig;
  authMetadata?: ValidatedAuthMetadata;
};

type ServerConfigsLoaderProps = {
  children: (configs: ServerConfigs) => ReactNode;
};
export function ServerConfigsLoader({ children }: ServerConfigsLoaderProps) {
  const mx = useMatrixClient();
  const fallbackConfigs = useMemo<ServerConfigs>(
    () => ({
      mediaConfig: {
        media_config_loaded: false,
        media_upload_enabled: false,
        media_upload_unavailable_reason:
          'File uploads are unavailable while media configuration is loading.',
      },
    }),
    []
  );

  const [configsState] = useAsyncCallbackValue<ServerConfigs, unknown>(
    useCallback(async () => {
      const result = await Promise.allSettled([
        mx.getCapabilities(),
        mx.getMediaConfig(),
        mx.getAuthMetadata(),
      ]);

      const capabilities = promiseFulfilledResult(result[0]);
      const mediaConfig = promiseFulfilledResult(result[1]);
      const authMetadata = promiseFulfilledResult(result[2]);
      let validatedAuthMetadata: ValidatedAuthMetadata | undefined;

      try {
        validatedAuthMetadata = validateAuthMetadata(authMetadata);
      } catch (e) {
        console.error(e);
      }

      return {
        capabilities,
        mediaConfig: mediaConfig
          ? {
              ...mediaConfig,
              media_config_loaded: true,
            }
          : {
              media_config_loaded: false,
              media_upload_enabled: false,
              media_upload_unavailable_reason:
                'File uploads are unavailable because media configuration could not be loaded.',
            },
        authMetadata: validatedAuthMetadata,
      };
    }, [mx])
  );

  const configs: ServerConfigs =
    configsState.status === AsyncStatus.Success ? configsState.data : fallbackConfigs;

  return children(configs);
}
