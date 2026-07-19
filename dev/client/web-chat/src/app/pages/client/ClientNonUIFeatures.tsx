import { useAtomValue } from 'jotai';
import { IRoomTimelineData, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import React, { ReactNode, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import NotificationSound from '../../../../public/sound/notification.ogg';
import { notificationPermission, setFavicon } from '../../utils/dom';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import {
  getOysterunBootstrappedHostSessionName,
  getOysterunHostSessionChatPath,
  isOysterunCompleteMessageNotificationPolicyEnabled,
} from '../../../oysterun/OysterunHostClient';
import {
  bindOysterunIOSLocalNotificationActions,
  getOysterunCompleteMessageNotificationCandidateFromMatrixEvent,
  getOysterunCompleteMessageNotificationReleaseFromMatrixEvent,
  notifyOysterunCompleteMessage,
  rememberOysterunCompleteMessageNotificationKey,
  type OysterunCompleteMessageNotificationCandidate,
  type OysterunCompleteMessageNotificationRelease,
} from '../../../oysterun/OysterunCompleteMessageNotification';
import {
  bindOysterunIOSRemotePushNotificationActions,
  ensureOysterunIOSPushRegistered,
  isOysterunCapacitorIOSRuntime,
} from '../../../oysterun/OysterunNotificationRuntime';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { getHomeRoomPath } from '../pathUtils';

const OYSTERUN_FAVICON_PATH = '/static/favicons/oysterun_logo_v5.PNG';
const MAX_COMPLETE_MESSAGE_NOTIFICATION_TURNS = 500;

function rememberCompleteMessageTurnState<T>(
  map: Map<string, T>,
  providerTurnId: string,
  value: T
): void {
  map.set(providerTurnId, value);
  while (map.size > MAX_COMPLETE_MESSAGE_NOTIFICATION_TURNS) {
    const oldest = map.keys().next().value;
    if (!oldest) break;
    map.delete(oldest);
  }
}

function SystemEmojiFeature() {
  const [twitterEmoji] = useSetting(settingsAtom, 'twitterEmoji');

  if (twitterEmoji) {
    document.documentElement.style.setProperty('--font-emoji', 'Twemoji');
  } else {
    document.documentElement.style.setProperty('--font-emoji', 'Twemoji_DISABLED');
  }

  return null;
}

function PageZoomFeature() {
  const [pageZoom] = useSetting(settingsAtom, 'pageZoom');

  if (pageZoom === 100) {
    document.documentElement.style.removeProperty('font-size');
  } else {
    document.documentElement.style.setProperty('font-size', `calc(1em * ${pageZoom / 100})`);
  }

  return null;
}

function FaviconUpdater() {
  const roomToUnread = useAtomValue(roomToUnreadAtom);

  useEffect(() => {
    setFavicon(OYSTERUN_FAVICON_PATH);
  }, [roomToUnread]);

  return null;
}

function OysterunCompleteMessageNotifications() {
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const capacitorIOSRuntime = isOysterunCapacitorIOSRuntime();
  const audioRef = useRef<HTMLAudioElement>(null);
  const showNotificationsRef = useRef(true);
  const notificationSoundRef = useRef(true);
  const pendingCompleteMessageCandidatesRef = useRef<
    Map<string, OysterunCompleteMessageNotificationCandidate>
  >(new Map());
  const providerCompletionReleasesRef = useRef<
    Map<string, OysterunCompleteMessageNotificationRelease>
  >(new Map());
  const sessionName = getOysterunBootstrappedHostSessionName();
  const notificationUrl =
    getOysterunHostSessionChatPath() || `${window.location.pathname}${window.location.search}`;
  const [showNotifications] = useSetting(settingsAtom, 'showNotifications');
  const [notificationSound] = useSetting(settingsAtom, 'isNotificationSounds');

  useEffect(() => {
    showNotificationsRef.current = showNotifications;
  }, [showNotifications]);

  useEffect(() => {
    notificationSoundRef.current = !capacitorIOSRuntime && notificationSound;
  }, [capacitorIOSRuntime, notificationSound]);

  const playWebsiteNotificationSound = useCallback(() => {
    const audioElement = audioRef.current;
    audioElement?.play();
  }, []);

  const notifyReleasedCandidate = useCallback(
    async (candidate: OysterunCompleteMessageNotificationCandidate) => {
      const per_session_notification_enabled =
        await isOysterunCompleteMessageNotificationPolicyEnabled(candidate);
      if (!per_session_notification_enabled) return;
      if (!rememberOysterunCompleteMessageNotificationKey(candidate.key)) return;
      const eventPath = getHomeRoomPath(candidate.roomId, candidate.eventId);

      if (showNotificationsRef.current) {
        if (capacitorIOSRuntime || notificationPermission('granted')) {
          void notifyOysterunCompleteMessage(candidate, {
            icon: OYSTERUN_FAVICON_PATH,
            onClick: () => {
              if (!window.closed) {
                navigate(eventPath);
              }
            },
          });
        }
      }

      if (!capacitorIOSRuntime && notificationSoundRef.current) {
        playWebsiteNotificationSound();
      }
    },
    [capacitorIOSRuntime, navigate, playWebsiteNotificationSound]
  );

  useEffect(() => {
    if (capacitorIOSRuntime) {
      void bindOysterunIOSLocalNotificationActions();
      void bindOysterunIOSRemotePushNotificationActions();
      void ensureOysterunIOSPushRegistered();
    }

    const handleTimelineEvent = (
      mEvent: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: IRoomTimelineData
    ) => {
      if (!room || !data.liveEvent || toStartOfTimeline || removed || room.isSpaceRoom()) return;
      const eventPath = getHomeRoomPath(room.roomId, mEvent.getId() ?? undefined);
      const release = getOysterunCompleteMessageNotificationReleaseFromMatrixEvent(mEvent, room);
      if (release) {
        const pending = pendingCompleteMessageCandidatesRef.current.get(release.providerTurnId);
        pendingCompleteMessageCandidatesRef.current.delete(release.providerTurnId);
        rememberCompleteMessageTurnState(
          providerCompletionReleasesRef.current,
          release.providerTurnId,
          release
        );
        if (release.successful && pending) {
          void notifyReleasedCandidate(pending);
        }
        return;
      }

      const candidate = getOysterunCompleteMessageNotificationCandidateFromMatrixEvent(
        mEvent,
        room,
        {
          sessionName,
          url: notificationUrl || eventPath,
        }
      );
      if (!candidate) return;

      const providerTurnId = candidate.providerTurnId;
      if (!providerTurnId) return;
      const priorRelease = providerCompletionReleasesRef.current.get(providerTurnId);
      if (priorRelease) {
        if (priorRelease.successful) {
          void notifyReleasedCandidate(candidate);
        }
        return;
      }
      rememberCompleteMessageTurnState(
        pendingCompleteMessageCandidatesRef.current,
        providerTurnId,
        candidate
      );
    };

    mx.on(RoomEvent.Timeline, handleTimelineEvent);
    return () => {
      mx.removeListener(RoomEvent.Timeline, handleTimelineEvent);
    };
  }, [capacitorIOSRuntime, mx, sessionName, notificationUrl, notifyReleasedCandidate]);

  return capacitorIOSRuntime ? null : (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio ref={audioRef} style={{ display: 'none' }}>
      <source src={NotificationSound} type="audio/ogg" />
    </audio>
  );
}

type ClientNonUIFeaturesProps = {
  children: ReactNode;
};

export function ClientNonUIFeatures({ children }: ClientNonUIFeaturesProps) {
  return (
    <>
      <SystemEmojiFeature />
      <PageZoomFeature />
      <FaviconUpdater />
      <OysterunCompleteMessageNotifications />
      {children}
    </>
  );
}
