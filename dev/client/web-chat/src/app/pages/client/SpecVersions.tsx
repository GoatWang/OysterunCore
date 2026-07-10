import React, { ReactNode } from 'react';
import { Box, Dialog, config, Text, Button } from 'folds';
import { SpecVersionsLoader } from '../../components/SpecVersionsLoader';
import { SpecVersionsProvider } from '../../hooks/useSpecVersions';
import { SplashScreen } from '../../components/splash-screen';

export function SpecVersions({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  return (
    <SpecVersionsLoader
      baseUrl={baseUrl}
      fallback={() => (
        <SplashScreen loadingStage="matrix_versions" loadingSurface="web_chat_spec_versions" />
      )}
      error={(err, retry, ignore) => (
        <SplashScreen
          loadingStage="matrix_versions_error"
          loadingSurface="web_chat_spec_versions_error"
          recoveryVisible
        >
          <Box direction="Column" grow="Yes" alignItems="Center" justifyContent="Center" gap="400">
            <Dialog>
              <Box direction="Column" gap="400" style={{ padding: config.space.S400 }}>
                <Text>
                  Unable to connect to the homeserver. The homeserver or your internet connection may be down.
                </Text>
                <Button variant="Critical" onClick={retry}>
                  <Text as="span" size="B400">
                    Retry
                  </Text>
                </Button>
                <Button variant="Critical" onClick={ignore} fill="Soft">
                  <Text as="span" size="B400">
                    Continue
                  </Text>
                </Button>
              </Box>
            </Dialog>
          </Box>
        </SplashScreen>
      )}
    >
      {(versions) => <SpecVersionsProvider value={versions}>{children}</SpecVersionsProvider>}
    </SpecVersionsLoader>
  );
}
