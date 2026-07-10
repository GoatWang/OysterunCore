/* eslint-disable import/first */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import { configClass, varsClass } from 'folds';

enableMapSet();

import './index.css';

import { trimTrailingSlash } from './app/utils/common';
import App from './app/pages/App';

// import i18n (needs to be bundled ;))
import './app/i18n';
import { pushSessionToSW } from './sw-session';
import { getFallbackSession } from './app/state/sessions';

const ROUTEC_MATRIX_RECOVERY_EVENT = 'oysterun-routec-matrix-resume';
const ROUTEC_MATRIX_RECOVERY_SW_MESSAGE = 'oysterunRouteCMatrixResume';

document.body.classList.add(configClass, varsClass);

// Register Service Worker
if ('serviceWorker' in navigator) {
  const webChatServiceWorkerScope = '/app/sessions/';
  const swUrl =
    import.meta.env.MODE === 'production'
      ? `${trimTrailingSlash(import.meta.env.BASE_URL)}/sw.js`
      : `/dev-sw.js?dev-sw`;

  const sendSessionToSW = () => {
    const session = getFallbackSession();
    pushSessionToSW(session?.baseUrl, session?.accessToken);
  };

  navigator.serviceWorker
    .register(swUrl, { scope: webChatServiceWorkerScope })
    .then(sendSessionToSW);
  navigator.serviceWorker.ready.then(sendSessionToSW);

    navigator.serviceWorker.addEventListener('message', (ev) => {
      const { type } = ev.data ?? {};

      if (type === 'requestSession') {
        sendSessionToSW();
        return;
      }

      if (type === ROUTEC_MATRIX_RECOVERY_SW_MESSAGE) {
        window.dispatchEvent(
          new CustomEvent(ROUTEC_MATRIX_RECOVERY_EVENT, {
            detail: {
              reason: 'service_worker_notification_resume',
              source: 'service_worker',
              targetUrl: typeof ev.data?.targetUrl === 'string' ? ev.data.targetUrl : null,
              sameUrl: ev.data?.sameUrl === true,
              dashboard_auth_cleared: false,
              raw_secret_material_exposed: false,
            },
          })
        );
      }
    });
  }

const mountApp = () => {
  const rootContainer = document.getElementById('root');

  if (rootContainer === null) {
    console.error('Root container element not found!');
    return;
  }

  const root = createRoot(rootContainer);
  root.render(<App />);
};

mountApp();
