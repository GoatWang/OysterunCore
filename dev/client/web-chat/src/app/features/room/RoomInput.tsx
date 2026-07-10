import React, {
  Component,
  ErrorInfo,
  KeyboardEventHandler,
  RefObject,
  ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { isKeyHotkey } from 'is-hotkey';
import { EventType, MsgType, RelationType } from 'matrix-js-sdk/lib/@types/event';
import type { IContent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { ReactEditor } from 'slate-react';
import { Descendant, Editor, Transforms } from 'slate';
import {
  Box,
  Dialog,
  Icon,
  IconButton,
  Icons,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  Scroll,
  Text,
  config,
  toRem,
} from 'folds';

import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  CustomEditor,
  Toolbar,
  toMatrixCustomHTML,
  toPlainText,
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  AutocompleteQuery,
  getAutocompleteQuery,
  getPrevAutocompleteRange,
  resetEditor,
  RoomMentionAutocomplete,
  UserMentionAutocomplete,
  EmoticonAutocomplete,
  createEmoticonElement,
  moveCursor,
  resetEditorHistory,
  customHtmlEqualsPlainText,
  trimCustomHtml,
  isEmptyEditor,
  getBeginCommand,
  trimCommand,
  getMentions,
} from '../../components/editor';
import { EmojiBoard, EmojiBoardTab } from '../../components/emoji-board';
import { UseStateProvider } from '../../components/UseStateProvider';
import { TUploadContent, getImageInfo, getMxIdLocalPart, mxcUrlToHttp } from '../../utils/matrix';
import { useTypingStatusUpdater } from '../../hooks/useTypingStatusUpdater';
import { useFilePasteHandler } from '../../hooks/useFilePasteHandler';
import { useFileDropZone } from '../../hooks/useFileDrop';
import {
  TUploadItem,
  TUploadMetadata,
  createRouteCComposerDraftScope,
  deleteRouteCComposerDraft,
  readRouteCComposerDraft,
  roomIdToMsgDraftAtomFamily,
  roomIdToReplyDraftAtomFamily,
  roomIdToUploadItemsAtomFamily,
  roomUploadAtomFamily,
  writeRouteCComposerDraft,
} from '../../state/room/roomInputDrafts';
import { UploadCardRenderer } from '../../components/upload-card';
import {
  UploadBoard,
  UploadBoardContent,
  UploadBoardHeader,
  UploadBoardImperativeHandlers,
} from '../../components/upload-board';
import { Upload, UploadStatus, createUploadFamilyObserverAtom } from '../../state/upload';
import { getImageUrlBlob, loadImageElement } from '../../utils/dom';
import { safeFile } from '../../utils/mimeTypes';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { getMemberDisplayName, getMentionContent, trimReplyFromBody } from '../../utils/room';
import { CommandAutocomplete } from './CommandAutocomplete';
import { RouteCPathAutocomplete } from './RouteCPathAutocomplete';
import {
  selectComposerPrimaryAction,
  type OysterunRouteCRespondingState,
} from '../../../oysterun/OysterunMessageLifecycle';
import { Command, SHRUG, TABLEFLIP, UNFLIP, useCommands } from '../../hooks/useCommands';
import { mobileOrTablet } from '../../utils/user-agent';
import { useElementSizeObserver } from '../../hooks/useElementSizeObserver';
import { ReplyLayout, ThreadIndicator } from '../../components/message';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useMediaUploadAvailability } from '../../hooks/useMediaConfig';
import { useImagePackRooms } from '../../hooks/useImagePackRooms';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import colorMXID from '../../../util/colorMXID';
import { useIsDirectRoom } from '../../hooks/useRoom';
import { useAccessiblePowerTagColors, useGetMemberPowerTag } from '../../hooks/useMemberPowerTag';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useTheme } from '../../hooks/useTheme';
import { useRoomCreatorsTag } from '../../hooks/useRoomCreatorsTag';
import { usePowerLevelTags } from '../../hooks/usePowerLevelTags';
import { useComposingCheck } from '../../hooks/useComposingCheck';
import {
  createOysterunRouteCMatrixClientRequestId,
  sendOysterunMatrixMessage,
} from '../../../oysterun/OysterunSendAdapter';
import { buildOysterunComposerProofAttributes } from '../../../oysterun/OysterunProofFields';
import {
  consumeOysterunRouteCInsertPathQuery,
  createOysterunHostLoopSchedule,
  getOysterunMatrixRoomId,
  getOysterunRouteCComposerDraftHostSessionId,
  hasOysterunHostSessionRoute,
  interruptOysterunHostSession,
  isOysterunRouteCLegacyStopLoopCommand,
  isOysterunRouteCLoopCliCommand,
  notifyOysterunRouteCOptimisticProviderResponding,
  OYSTERUN_LEGACY_STOPLOOP_DEMOTED_MESSAGE,
  runOysterunHostTerminalCommand,
} from '../../../oysterun/OysterunHostClient';
import { isOysterunPhoneComposerMode } from '../../../oysterun/OysterunComposerInputPolicy';
import {
  OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_INFO_KEY,
  prepareRouteCImageDisplayDerivativeUpload,
  type RouteCImageDisplayDerivativeDiagnostics,
} from './RouteCImageDisplayDerivative';

interface RoomInputProps {
  editor: Editor;
  fileDropContainerRef: RefObject<HTMLElement>;
  roomId: string;
  room: Room;
  routeCRespondingState: OysterunRouteCRespondingState;
}

function isOysterunBangBangInterruptCommand(plainText: string): boolean {
  return plainText.startsWith('!!');
}

function getOysterunSingleBangTerminalCommand(plainText: string): string | undefined {
  if (!plainText.startsWith('!') || plainText.startsWith('!!')) return undefined;
  const command = plainText.slice(1).trim();
  return command.length > 0 ? command : undefined;
}

function cloneOysterunMsgDraft(draft: Descendant[]): Descendant[] {
  return JSON.parse(JSON.stringify(draft)) as Descendant[];
}

function hasOysterunMsgDraft(draft: Descendant[]): boolean {
  return draft.length > 0;
}

function getOysterunRouteCPathInsertSeparator(editor: Editor): string {
  const currentText = Editor.string(editor, []);
  if (!currentText) return '';
  return /\s$/.test(currentText) ? '' : '\n';
}

function shouldShowOysterunGenericComposerDecorations(routeCChatShell: boolean): boolean {
  // Route C keeps upload, text, send, and P3.6 helpers while removing generic decoration tools.
  return !routeCChatShell;
}

function routeCUploadPendingIdentity(item: TUploadItem, index: number): string {
  const file = item.file;
  const fileName = 'name' in file && typeof file.name === 'string' ? file.name : `blob-${index}`;
  const lastModified =
    'lastModified' in file && typeof file.lastModified === 'number' ? file.lastModified : 0;
  return `${fileName}:${file.size}:${lastModified}`;
}

const OYSTERUN_ROUTE_C_DISABLED_AUTOCOMPLETE_PREFIXES = new Set<AutocompletePrefix>([
  AutocompletePrefix.RoomMention,
  AutocompletePrefix.Emoticon,
]);
const OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_COMMAND = 'install_oysterun_skill';
const OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_PREFIX = `/${OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_COMMAND}`;
const OYSTERUN_P185_COMPOSER_IME_GUARD = 'p185-composer-ime-guard';
const OYSTERUN_P185_COMPOSER_LOCAL_ERROR_BOUNDARY = 'p185-composer-local-error-boundary';
const OYSTERUN_P185_COMPOSER_COMPOSITION_SETTLE_MS = 520;

type RouteCComposerLocalErrorBoundaryProps = {
  children: ReactNode;
  recoveryKey: number;
  onRecover: (error: unknown, info: ErrorInfo) => void;
};

type RouteCComposerLocalErrorBoundaryState = {
  crashed: boolean;
};

function isRouteCComposerInvalidSelectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = `${error.name}\n${error.message}\n${error.stack ?? ''}`;
  return (
    details.includes('The object is in an invalid state') &&
    details.includes('collapseToEnd')
  );
}

class RouteCComposerLocalErrorBoundary extends Component<
  RouteCComposerLocalErrorBoundaryProps,
  RouteCComposerLocalErrorBoundaryState
> {
  state: RouteCComposerLocalErrorBoundaryState = {
    crashed: false,
  };

  static getDerivedStateFromError(error: unknown): RouteCComposerLocalErrorBoundaryState {
    if (!isRouteCComposerInvalidSelectionError(error)) throw error;
    return {
      crashed: true,
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (isRouteCComposerInvalidSelectionError(error)) {
      this.props.onRecover(error, info);
    }
  }

  componentDidUpdate(prevProps: RouteCComposerLocalErrorBoundaryProps): void {
    if (this.state.crashed && prevProps.recoveryKey !== this.props.recoveryKey) {
      this.setState({
        crashed: false,
      });
    }
  }

  render(): ReactNode {
    if (this.state.crashed) {
      return (
        <Box
          direction="Column"
          gap="100"
          style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
          data-oysterun-routec-p185-composer-local-error-boundary={
            OYSTERUN_P185_COMPOSER_LOCAL_ERROR_BOUNDARY
          }
          data-oysterun-routec-p185-composer-recovery-state="recovering"
        >
          <Text size="T200" priority="300" role="status" aria-live="polite">
            Composer recovered. Continue typing.
          </Text>
        </Box>
      );
    }
    return this.props.children;
  }
}

type RouteCLoopCliStatus = {
  state: 'pending' | 'created' | 'enabled_existing' | 'error';
  message: string;
  duplicatePrevented?: boolean;
};

type RouteCSendPendingToken = {
  key: string;
  clientRequestId: string;
};

type RouteCMatrixMediaUploadResponse = {
  content_uri?: string;
  saved_path?: string;
  saved_path_source?: string;
  filename?: string;
  mimetype?: string;
  byte_size?: number;
  sha256?: string;
  routec_host_owned_matrix_media_storage?: boolean;
};

const OYSTERUN_ROUTE_C_MEDIA_NAMESPACE = 'org.oysterun.media.v1';
const OYSTERUN_ROUTE_C_MULTI_MEDIA_MSGTYPE = 'org.oysterun.multi_media';
const OYSTERUN_ROUTE_C_MULTI_MEDIA_CONTRACT = 'routec_multi_media_product_message_v1';

type RouteCMultiMediaProductAttachment = {
  index: number;
  filename: string;
  content_uri: string;
  saved_path?: string;
  saved_path_source?: string;
  mimetype: string;
  byte_size: number;
  sha256?: string;
  msgtype: MsgType;
  info: Record<string, unknown>;
  [OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_INFO_KEY]?: RouteCImageDisplayDerivativeDiagnostics;
};

type RouteCStagedMediaUpload = RouteCMultiMediaProductAttachment & {
  attachment_index: number;
  fileItem: TUploadItem;
  msgtype: MsgType;
  body: string;
  info: Record<string, unknown>;
  display_derivative_diagnostics?: RouteCImageDisplayDerivativeDiagnostics;
};

function getRouteCUploadFilename(fileItem: TUploadItem): string {
  const candidate =
    'name' in fileItem.originalFile && typeof fileItem.originalFile.name === 'string'
      ? fileItem.originalFile.name.trim()
      : '';
  return candidate || 'upload.bin';
}

function getRouteCMediaMimeType(file: TUploadContent): string {
  return file.type || 'application/octet-stream';
}

function getRouteCMatrixMediaMsgType(file: TUploadContent): MsgType {
  const mimeType = getRouteCMediaMimeType(file).toLowerCase();
  if (mimeType.startsWith('image/')) return MsgType.Image;
  if (mimeType.startsWith('video/')) return MsgType.Video;
  if (mimeType.startsWith('audio/')) return MsgType.Audio;
  return MsgType.File;
}

function getRouteCMediaBody(caption: string, fileItem: TUploadItem): string {
  const trimmedCaption = caption.trim();
  if (trimmedCaption) return trimmedCaption;
  return getRouteCUploadFilename(fileItem);
}

async function getRouteCStagedMediaInfo({
  fileItem,
  uploadFile,
  diagnostics,
}: {
  fileItem: TUploadItem;
  uploadFile: TUploadContent;
  diagnostics?: RouteCImageDisplayDerivativeDiagnostics;
}): Promise<Record<string, unknown>> {
  const { originalFile } = fileItem;
  const info: Record<string, unknown> = {
    mimetype: getRouteCMediaMimeType(uploadFile),
    size: uploadFile.size,
  };
  if (diagnostics) {
    info[OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_INFO_KEY] = diagnostics;
  }
  if (getRouteCMatrixMediaMsgType(originalFile) !== MsgType.Image) {
    return info;
  }

  const imageUrl = URL.createObjectURL(uploadFile);
  try {
    const imageElement = await loadImageElement(imageUrl);
    return {
      ...info,
      ...getImageInfo(imageElement, uploadFile),
    };
  } catch (err) {
    console.warn('[oysterun-routec] image metadata probe failed for staged media send', err);
    return info;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function uploadRouteCStagedMedia({
  mx,
  fileItem,
  caption,
  attachmentIndex,
}: {
  mx: ReturnType<typeof useMatrixClient>;
  fileItem: TUploadItem;
  caption: string;
  attachmentIndex: number;
}): Promise<RouteCStagedMediaUpload> {
  const filename = getRouteCUploadFilename(fileItem);
  const displayUpload = await prepareRouteCImageDisplayDerivativeUpload({
    file: fileItem.file,
    originalFile: fileItem.originalFile,
    filename,
  });
  const uploadFile = displayUpload.file;
  const mimetype = getRouteCMediaMimeType(uploadFile);
  const uploaded = (await mx.uploadContent(uploadFile, {
    name: filename,
    type: mimetype,
    includeFilename: true,
  })) as RouteCMatrixMediaUploadResponse;
  if (!uploaded.content_uri) {
    throw new Error('Matrix media upload did not return a content_uri');
  }

  const body = getRouteCMediaBody(caption, fileItem);
  const msgtype = getRouteCMatrixMediaMsgType(fileItem.originalFile);
  const info = await getRouteCStagedMediaInfo({
    fileItem,
    uploadFile,
    diagnostics: displayUpload.diagnostics,
  });
  if (uploaded.mimetype) info.mimetype = uploaded.mimetype;
  if (typeof uploaded.byte_size === 'number') info.size = uploaded.byte_size;

  return {
    attachment_index: attachmentIndex,
    fileItem,
    msgtype,
    body,
    filename,
    content_uri: uploaded.content_uri,
    saved_path: uploaded.saved_path,
    saved_path_source: uploaded.saved_path_source ?? 'host_owned_routec_matrix_media_store',
    mimetype: uploaded.mimetype ?? mimetype,
    byte_size: uploaded.byte_size ?? uploadFile.size,
    sha256: uploaded.sha256,
    info,
    display_derivative_diagnostics: displayUpload.diagnostics,
    ...(displayUpload.diagnostics
      ? {
          [OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_INFO_KEY]: displayUpload.diagnostics,
        }
      : {}),
  };
}

function buildRouteCStagedMediaMessageContent({
  upload,
}: {
  upload: RouteCStagedMediaUpload;
}): IContent {
  return {
    msgtype: upload.msgtype,
    body: upload.body,
    filename: upload.filename,
    url: upload.content_uri,
    info: upload.info,
    [OYSTERUN_ROUTE_C_MEDIA_NAMESPACE]: {
      routec_phase17_3_media_send_commit: true,
      one_explicit_send_commits_one_matrix_media_event: true,
      one_explicit_send_commits_one_matrix_media_event_per_file: false,
      upload_occurs_only_during_explicit_send: true,
      split_text_event_created: false,
      content_uri: upload.content_uri,
      saved_path: upload.saved_path,
      saved_path_source: upload.saved_path_source,
      filename: upload.filename,
      mimetype: upload.mimetype,
      byte_size: upload.byte_size,
      sha256: upload.sha256,
      provider_prompt_shape: '[Attached files]\\n<saved_path>\\n\\nUser message:\\n<caption/text>',
      provider_prompt_user_message: upload.body,
      routec_host_owned_matrix_media_storage: true,
      ...(upload.display_derivative_diagnostics
        ? {
            [OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_INFO_KEY]:
              upload.display_derivative_diagnostics,
          }
        : {}),
    },
  };
}

function buildRouteCMultiMediaProductMessageContent({
  uploads,
  caption,
}: {
  uploads: RouteCStagedMediaUpload[];
  caption: string;
}): IContent {
  const captionBody = caption.trim();
  const body = captionBody || `${uploads.length} attached files`;
  const attachments: RouteCMultiMediaProductAttachment[] = uploads.map((upload) => ({
    index: upload.attachment_index,
    filename: upload.filename,
    content_uri: upload.content_uri,
    saved_path: upload.saved_path,
    saved_path_source: upload.saved_path_source,
    mimetype: upload.mimetype,
    byte_size: upload.byte_size,
    sha256: upload.sha256,
    msgtype: upload.msgtype,
    info: upload.info,
    ...(upload.display_derivative_diagnostics
      ? {
          [OYSTERUN_ROUTE_C_IMAGE_DISPLAY_DERIVATIVE_INFO_KEY]:
            upload.display_derivative_diagnostics,
        }
      : {}),
  }));

  return {
    msgtype: OYSTERUN_ROUTE_C_MULTI_MEDIA_MSGTYPE,
    body,
    [OYSTERUN_ROUTE_C_MEDIA_NAMESPACE]: {
      contract: OYSTERUN_ROUTE_C_MULTI_MEDIA_CONTRACT,
      routec_phase160_multi_media_product_message: true,
      one_explicit_send_commits_one_matrix_media_event: true,
      one_explicit_send_commits_one_matrix_media_event_per_file: false,
      upload_occurs_only_during_explicit_send: true,
      split_text_event_created: false,
      provider_prompt_shape: '[Attached files]\\n<saved_path>...\\n\\nUser message:\\n<caption/text>',
      provider_prompt_user_message: body,
      attachments,
      attachment_count: attachments.length,
      caption: {
        body: captionBody,
        formatted_body: null,
        link_annotations: [],
      },
    },
  };
}

function getOysterunRouteCAllowedAutocompleteQuery(
  routeCChatShell: boolean,
  query: AutocompleteQuery<AutocompletePrefix> | undefined
): AutocompleteQuery<AutocompletePrefix> | undefined {
  if (
    routeCChatShell &&
    query &&
    OYSTERUN_ROUTE_C_DISABLED_AUTOCOMPLETE_PREFIXES.has(query.prefix)
  ) {
    return undefined;
  }
  return query;
}

function getOysterunComposerPlainText(value: Descendant[], isMarkdown: boolean): string {
  return toPlainText(value, isMarkdown).trim();
}

function normalizeOysterunLocalSkillInstallCommandTail(rawTail: string): string {
  return rawTail.replace(/^\s+/, ' ');
}

function getOysterunRouteCLocalSkillInstallComposerText(
  plainText: string,
  commandName?: string
): string | undefined {
  const trimmed = plainText.trim();
  if (!trimmed) return undefined;
  const normalizedCommandName = commandName?.trim().toLocaleLowerCase();
  if (normalizedCommandName === OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_COMMAND) {
    const tail = trimmed.toLocaleLowerCase().startsWith(OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_PREFIX)
      ? trimmed.slice(OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_PREFIX.length)
      : '';
    return `${OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_PREFIX}${normalizeOysterunLocalSkillInstallCommandTail(
      tail
    )}`.trim();
  }
  if (!trimmed.toLocaleLowerCase().startsWith(OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_PREFIX)) {
    return undefined;
  }
  const nextChar = trimmed.charAt(OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_PREFIX.length);
  if (nextChar && !/\s/.test(nextChar)) return undefined;
  return `${OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_PREFIX}${normalizeOysterunLocalSkillInstallCommandTail(
    trimmed.slice(OYSTERUN_ROUTE_C_LOCAL_SKILL_INSTALL_PREFIX.length)
  )}`.trim();
}

export const RoomInput = forwardRef<HTMLDivElement, RoomInputProps>(
  ({ editor, fileDropContainerRef, roomId, room, routeCRespondingState }, ref) => {
    const mx = useMatrixClient();
    const useAuthentication = useMediaAuthentication();
    const [enterForNewline] = useSetting(settingsAtom, 'enterForNewline');
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
    const [legacyUsernameColor] = useSetting(settingsAtom, 'legacyUsernameColor');
    const direct = useIsDirectRoom();
    const commands = useCommands(mx, room);
    const emojiBtnRef = useRef<HTMLButtonElement>(null);
    const roomToParents = useAtomValue(roomToParentsAtom);
    const powerLevels = usePowerLevelsContext();
    const creators = useRoomCreators(room);

    const routeCComposerDraftScope = useMemo(() => {
      const hostSessionId = getOysterunRouteCComposerDraftHostSessionId();
      if (!hostSessionId) return undefined;
      return createRouteCComposerDraftScope(hostSessionId, getOysterunMatrixRoomId() ?? roomId);
    }, [roomId]);
    const msgDraftKey = routeCComposerDraftScope?.storageKey ?? roomId;
    const [msgDraft, setMsgDraft] = useAtom(roomIdToMsgDraftAtomFamily(msgDraftKey));
    const [replyDraft, setReplyDraft] = useAtom(roomIdToReplyDraftAtomFamily(roomId));
    const replyUserID = replyDraft?.userId;

    const powerLevelTags = usePowerLevelTags(room, powerLevels);
    const creatorsTag = useRoomCreatorsTag();
    const getMemberPowerTag = useGetMemberPowerTag(room, creators, powerLevels);
    const theme = useTheme();
    const accessibleTagColors = useAccessiblePowerTagColors(
      theme.kind,
      creatorsTag,
      powerLevelTags
    );

    const replyPowerTag = replyUserID ? getMemberPowerTag(replyUserID) : undefined;
    const replyPowerColor = replyPowerTag?.color
      ? accessibleTagColors.get(replyPowerTag.color)
      : undefined;
    const replyUsernameColor =
      legacyUsernameColor || direct ? colorMXID(replyUserID ?? '') : replyPowerColor;

    const [uploadBoard, setUploadBoard] = useState(true);
    const [selectedFiles, setSelectedFiles] = useAtom(roomIdToUploadItemsAtomFamily(roomId));
    const routeCFileInputRef = useRef<HTMLInputElement>(null);
    const uploadFamilyObserverAtom = createUploadFamilyObserverAtom(
      roomUploadAtomFamily,
      selectedFiles.map((f) => f.file)
    );
    const uploadBoardHandlers = useRef<UploadBoardImperativeHandlers>();
    const routeCInsertPathConsumedRef = useRef<string>();
    const phoneComposerMode = isOysterunPhoneComposerMode();
    const submitWithBareEnter = !phoneComposerMode && !enterForNewline;
    const draftInsertedKeyRef = useRef<string>();
    const [routeCLoopCliStatus, setRouteCLoopCliStatus] = useState<RouteCLoopCliStatus>();
    const [mediaUploadNotice, setMediaUploadNotice] = useState<string>();
    const [routeCInterruptInFlight, setRouteCInterruptInFlight] = useState(false);
    const mediaUploadAvailability = useMediaUploadAvailability();
    const mediaUploadEnabled = mediaUploadAvailability.enabled;
    const mediaUploadDisabledMessage =
      mediaUploadAvailability.message ?? 'File uploads are unavailable in this chat.';
    const routeCStagedMediaSendReadyMessage =
      selectedFiles.length > 1
        ? `${selectedFiles.length} files are staged locally. Press Send to upload and send one media event per file.`
        : 'Media is staged locally. Press Send to upload and send one media event.';
    const routeCChatShell = hasOysterunHostSessionRoute();
    const showGenericComposerDecorations =
      shouldShowOysterunGenericComposerDecorations(routeCChatShell);
    const [routeCSendPendingKey, setRouteCSendPendingKey] = useState<string | null>(null);
    const routeCSendPendingRef = useRef<RouteCSendPendingToken | null>(null);
    const routeCSendPending = routeCSendPendingKey !== null;

    const beginRouteCSendPending = useCallback(
      (key: string): RouteCSendPendingToken | null => {
        if (!routeCChatShell) {
          return {
            key,
            clientRequestId: createOysterunRouteCMatrixClientRequestId(),
          };
        }
        if (routeCSendPendingRef.current) return null;
        const token = {
          key,
          clientRequestId: createOysterunRouteCMatrixClientRequestId(),
        };
        routeCSendPendingRef.current = token;
        setRouteCSendPendingKey(key);
        return token;
      },
      [routeCChatShell]
    );

    const finishRouteCSendPending = useCallback((token: RouteCSendPendingToken | null) => {
      if (!token || routeCSendPendingRef.current?.clientRequestId !== token.clientRequestId) {
        return;
      }
      routeCSendPendingRef.current = null;
      setRouteCSendPendingKey(null);
    }, []);

    const imagePackRooms: Room[] = useImagePackRooms(roomId, roomToParents);

    const [toolbar, setToolbar] = useSetting(settingsAtom, 'editorToolbar');
    const [autocompleteQuery, setAutocompleteQuery] =
      useState<AutocompleteQuery<AutocompletePrefix>>();
    const [routeCAtMode, setRouteCAtMode] = useState<'path' | 'member'>('path');
    const [routeCComposerPlainText, setRouteCComposerPlainText] = useState(() =>
      getOysterunComposerPlainText(editor.children, isMarkdown)
    );
    const [routeCComposerRecoveryKey, setRouteCComposerRecoveryKey] = useState(0);
    const routeCPostCompositionRefreshTimerRef = useRef<number>();

    const sendTypingStatus = useTypingStatusUpdater(mx, roomId);

    const handleFiles = useCallback(
      async (files: File[]) => {
        if (!mediaUploadEnabled) {
          setMediaUploadNotice(mediaUploadDisabledMessage);
          return;
        }
        setMediaUploadNotice(undefined);
        setUploadBoard(true);
        const fileItems: TUploadItem[] = files.map((selectedFile) => {
          const file = safeFile(selectedFile);
          return {
            file,
            originalFile: file,
            encInfo: undefined,
            metadata: {
              markedAsSpoiler: false,
            },
          };
        });
        setSelectedFiles({
          type: 'PUT',
          item: fileItems,
        });
      },
      [mediaUploadDisabledMessage, mediaUploadEnabled, setSelectedFiles]
    );
    const handleRouteCFileInputChange = useCallback(
      (evt: React.ChangeEvent<HTMLInputElement>) => {
        const files = evt.currentTarget.files ? Array.from(evt.currentTarget.files) : [];
        evt.currentTarget.value = '';
        if (files.length > 0) handleFiles(files);
      },
      [handleFiles]
    );
    const handlePaste = useFilePasteHandler(handleFiles);
    const dropZoneVisible = useFileDropZone(fileDropContainerRef, handleFiles);
    const [hideStickerBtn, setHideStickerBtn] = useState(document.body.clientWidth < 500);

    const isComposing = useComposingCheck();

    useElementSizeObserver(
      useCallback(() => fileDropContainerRef.current, [fileDropContainerRef]),
      useCallback((width) => setHideStickerBtn(width < 500), [])
    );

    useEffect(() => {
      if (mediaUploadEnabled) {
        setMediaUploadNotice(undefined);
      }
    }, [mediaUploadEnabled]);

    const clearMsgDraft = useCallback(() => {
      setMsgDraft([]);
      if (routeCComposerDraftScope) {
        deleteRouteCComposerDraft(routeCComposerDraftScope);
      }
    }, [routeCComposerDraftScope, setMsgDraft]);

    useEffect(() => {
      if (draftInsertedKeyRef.current === msgDraftKey) return;
      draftInsertedKeyRef.current = msgDraftKey;
      const persistedRouteCDraft = routeCComposerDraftScope
        ? readRouteCComposerDraft(routeCComposerDraftScope)
        : [];
      const draftToInsert = hasOysterunMsgDraft(msgDraft) ? msgDraft : persistedRouteCDraft;
      if (!hasOysterunMsgDraft(draftToInsert)) return;
      const clonedDraft = cloneOysterunMsgDraft(draftToInsert);
      Transforms.insertFragment(editor, clonedDraft);
      if (!hasOysterunMsgDraft(msgDraft)) {
        setMsgDraft(clonedDraft);
      }
    }, [editor, msgDraft, msgDraftKey, routeCComposerDraftScope, setMsgDraft]);

    useEffect(() => {
      const insertPath = consumeOysterunRouteCInsertPathQuery();
      if (!insertPath) return;
      const consumedKey = `${roomId}:${insertPath}`;
      if (routeCInsertPathConsumedRef.current === consumedKey) return;
      routeCInsertPathConsumedRef.current = consumedKey;

      const editorWasEmpty = isEmptyEditor(editor);
      const insertTarget = editorWasEmpty ? Editor.start(editor, []) : Editor.end(editor, []);
      Transforms.select(editor, insertTarget);
      const separator = editorWasEmpty ? '' : getOysterunRouteCPathInsertSeparator(editor);
      Transforms.insertText(editor, `${separator}${insertPath}`);
      ReactEditor.focus(editor);
    }, [editor, roomId]);

    useEffect(() => {
      const persistCurrentDraft = () => {
        if (!isEmptyEditor(editor)) {
          const parsedDraft = cloneOysterunMsgDraft(editor.children);
          setMsgDraft(parsedDraft);
          if (routeCComposerDraftScope) {
            writeRouteCComposerDraft(routeCComposerDraftScope, parsedDraft);
          }
          return;
        }
        setMsgDraft([]);
        if (routeCComposerDraftScope) {
          deleteRouteCComposerDraft(routeCComposerDraftScope);
        }
      };
      window.addEventListener('pagehide', persistCurrentDraft);
      return () => {
        window.removeEventListener('pagehide', persistCurrentDraft);
        persistCurrentDraft();
        resetEditor(editor);
        resetEditorHistory(editor);
      };
    }, [msgDraftKey, routeCComposerDraftScope, editor, setMsgDraft]);

    useEffect(() => {
      setRouteCComposerPlainText(getOysterunComposerPlainText(editor.children, isMarkdown));
    }, [editor, isMarkdown]);

    const handleFileMetadata = useCallback(
      (fileItem: TUploadItem, metadata: TUploadMetadata) => {
        setSelectedFiles({
          type: 'REPLACE',
          item: fileItem,
          replacement: { ...fileItem, metadata },
        });
      },
      [setSelectedFiles]
    );

    const handleRemoveUpload = useCallback(
      (upload: TUploadContent | TUploadContent[]) => {
        const uploads = Array.isArray(upload) ? upload : [upload];
        setSelectedFiles({
          type: 'DELETE',
          item: selectedFiles.filter((f) => uploads.find((u) => u === f.file)),
        });
        uploads.forEach((u) => roomUploadAtomFamily.remove(u));
      },
      [setSelectedFiles, selectedFiles]
    );

    const handleCancelUpload = (uploads: Upload[]) => {
      uploads.forEach((upload) => {
        if (upload.status === UploadStatus.Loading) {
          mx.cancelUpload(upload.promise);
        }
      });
      handleRemoveUpload(uploads.map((upload) => upload.file));
    };

    const submit = useCallback(async () => {
      const commandName = getBeginCommand(editor);
      let plainText = toPlainText(editor.children, isMarkdown).trim();
      let customHtml = trimCustomHtml(
        toMatrixCustomHTML(editor.children, {
          allowTextFormatting: true,
          allowBlockMarkdown: isMarkdown,
          allowInlineMarkdown: isMarkdown,
        })
      );
      let msgType = MsgType.Text;
      const routeCLocalSkillInstallText = hasOysterunHostSessionRoute()
        ? getOysterunRouteCLocalSkillInstallComposerText(plainText, commandName)
        : undefined;
      if (routeCLocalSkillInstallText) {
        plainText = routeCLocalSkillInstallText;
        customHtml = routeCLocalSkillInstallText;
      }

      if (hasOysterunHostSessionRoute() && isOysterunBangBangInterruptCommand(plainText)) {
        if (routeCInterruptInFlight) return;
        setRouteCInterruptInFlight(true);
        resetEditor(editor);
        resetEditorHistory(editor);
        setRouteCComposerPlainText('');
        clearMsgDraft();
        setReplyDraft(undefined);
        sendTypingStatus(false);
        interruptOysterunHostSession({
          matrixRoomId: roomId,
          command: plainText,
        }).catch((err: unknown) => {
          console.error('[oysterun-routec] !! interrupt request failed', err);
        }).finally(() => setRouteCInterruptInFlight(false));
        return;
      }

      if (hasOysterunHostSessionRoute() && plainText === '!') {
        return;
      }

      if (hasOysterunHostSessionRoute() && isOysterunRouteCLegacyStopLoopCommand(plainText)) {
        setRouteCLoopCliStatus({
          state: 'error',
          message: OYSTERUN_LEGACY_STOPLOOP_DEMOTED_MESSAGE,
        });
        sendTypingStatus(false);
        return;
      }

      if (hasOysterunHostSessionRoute() && isOysterunRouteCLoopCliCommand(plainText)) {
        const pendingToken = beginRouteCSendPending(`loop-cli:${roomId}:${plainText}`);
        if (!pendingToken) {
          setRouteCLoopCliStatus({
            state: 'pending',
            message: 'Loop request already pending.',
            duplicatePrevented: true,
          });
          sendTypingStatus(false);
          return;
        }
        setRouteCLoopCliStatus({
          state: 'pending',
          message: 'Creating Loop...',
          duplicatePrevented: false,
        });
        sendTypingStatus(false);
        createOysterunHostLoopSchedule({
          matrixRoomId: roomId,
          command: plainText,
          clientRequestId: pendingToken.clientRequestId,
        })
          .then((response) => {
            resetEditor(editor);
            resetEditorHistory(editor);
            setRouteCComposerPlainText('');
            clearMsgDraft();
            setReplyDraft(undefined);
            setRouteCLoopCliStatus({
              state:
                response.status === 'scheduler_loop_enabled_existing'
                  ? 'enabled_existing'
                  : 'created',
              message:
                response.status === 'scheduler_loop_enabled_existing'
                  ? 'Loop enabled.'
                  : 'Loop created.',
              duplicatePrevented: response.duplicate_prevented,
            });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            setRouteCLoopCliStatus({
              state: 'error',
              message,
            });
            console.error('[oysterun-routec] /loop scheduler request failed', err);
          })
          .finally(() => finishRouteCSendPending(pendingToken));
        return;
      }

      const terminalCommand = hasOysterunHostSessionRoute()
        ? getOysterunSingleBangTerminalCommand(plainText)
        : undefined;
      if (terminalCommand) {
        resetEditor(editor);
        resetEditorHistory(editor);
        setRouteCComposerPlainText('');
        clearMsgDraft();
        setReplyDraft(undefined);
        sendTypingStatus(false);
        runOysterunHostTerminalCommand({
          matrixRoomId: roomId,
          command: terminalCommand,
        }).catch((err: unknown) => {
          console.error('[oysterun-routec] ! terminal command request failed', err);
        });
        return;
      }

      if (selectedFiles.length > 0) {
        if (!mediaUploadEnabled) {
          setMediaUploadNotice(mediaUploadDisabledMessage);
          sendTypingStatus(false);
          return;
        }
        const orderedFiles = Array.from(selectedFiles).reverse();
        const pendingToken = routeCChatShell
          ? beginRouteCSendPending(
              `media:${roomId}:${orderedFiles
                .map(routeCUploadPendingIdentity)
                .join('|')}:${plainText}`
            )
          : null;
        if (routeCChatShell && !pendingToken) {
          setMediaUploadNotice('Send already pending for staged media.');
          sendTypingStatus(false);
          return;
        }
        setRouteCLoopCliStatus(undefined);
        setMediaUploadNotice(
          orderedFiles.length > 1
            ? `Uploading ${orderedFiles.length} staged files for Send...`
            : 'Uploading staged media for Send...'
        );
        sendTypingStatus(false);
        try {
          const uploadedFiles: RouteCStagedMediaUpload[] = [];
          for (const [attachmentIndex, fileItem] of orderedFiles.entries()) {
            uploadedFiles.push(
              await uploadRouteCStagedMedia({
                mx,
                fileItem,
                caption: plainText,
                attachmentIndex,
              })
            );
          }
          if (uploadedFiles.length > 1) {
            const content = buildRouteCMultiMediaProductMessageContent({
              uploads: uploadedFiles,
              caption: plainText,
            });
            await sendOysterunMatrixMessage(mx, roomId, content as any, {
              clientRequestId: pendingToken?.clientRequestId,
            });
          } else {
            const [upload] = uploadedFiles;
            const content = buildRouteCStagedMediaMessageContent({
              upload,
            });
            await sendOysterunMatrixMessage(mx, roomId, content as any, {
              clientRequestId: pendingToken?.clientRequestId,
            });
          }
          selectedFiles.forEach((item) => roomUploadAtomFamily.remove(item.file));
          setSelectedFiles({
            type: 'DELETE',
            item: selectedFiles,
          });
          resetEditor(editor);
          resetEditorHistory(editor);
          setRouteCComposerPlainText('');
          clearMsgDraft();
          setReplyDraft(undefined);
          setMediaUploadNotice(undefined);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setMediaUploadNotice(`Media send failed: ${message}`);
          console.error('[oysterun-routec] staged media send failed', err);
        } finally {
          finishRouteCSendPending(pendingToken);
        }
        return;
      }

      const routeCProviderSlashCommand =
        hasOysterunHostSessionRoute() && commandName && !commands[commandName as Command];
      if (commandName && !routeCProviderSlashCommand) {
        plainText = trimCommand(commandName, plainText);
        customHtml = trimCommand(commandName, customHtml);
      }
      if (commandName === Command.Me) {
        msgType = MsgType.Emote;
      } else if (commandName === Command.Notice) {
        msgType = MsgType.Notice;
      } else if (commandName === Command.Shrug) {
        plainText = `${SHRUG} ${plainText}`;
        customHtml = `${SHRUG} ${customHtml}`;
      } else if (commandName === Command.TableFlip) {
        plainText = `${TABLEFLIP} ${plainText}`;
        customHtml = `${TABLEFLIP} ${customHtml}`;
      } else if (commandName === Command.UnFlip) {
        plainText = `${UNFLIP} ${plainText}`;
        customHtml = `${UNFLIP} ${customHtml}`;
      } else if (commandName && !routeCProviderSlashCommand) {
        const commandContent = commands[commandName as Command];
        if (commandContent) {
          commandContent.exe(plainText);
        }
        resetEditor(editor);
        resetEditorHistory(editor);
        setRouteCComposerPlainText('');
        sendTypingStatus(false);
        return;
      }

      if (plainText === '') return;

      setRouteCLoopCliStatus(undefined);

      const body = plainText;
      const formattedBody = customHtml;
      const mentionData = getMentions(mx, roomId, editor);

      const content: IContent = {
        msgtype: msgType,
        body,
      };

      if (replyDraft && replyDraft.userId !== mx.getUserId()) {
        mentionData.users.add(replyDraft.userId);
      }

      const mMentions = getMentionContent(Array.from(mentionData.users), mentionData.room);
      content['m.mentions'] = mMentions;

      if (replyDraft || !customHtmlEqualsPlainText(formattedBody, body)) {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = formattedBody;
      }
      if (replyDraft) {
        content['m.relates_to'] = {
          'm.in_reply_to': {
            event_id: replyDraft.eventId,
          },
        };
        if (replyDraft.relation?.rel_type === RelationType.Thread) {
          content['m.relates_to'].event_id = replyDraft.relation.event_id;
          content['m.relates_to'].rel_type = RelationType.Thread;
          content['m.relates_to'].is_falling_back = false;
        }
      }
      const pendingToken = routeCChatShell
        ? beginRouteCSendPending(`message:${roomId}:${body}`)
        : null;
      if (routeCChatShell && !pendingToken) {
        sendTypingStatus(false);
        return;
      }
      const optimisticClientRequestId = pendingToken?.clientRequestId;
      if (optimisticClientRequestId) {
        notifyOysterunRouteCOptimisticProviderResponding({
          status: 'accepted',
          roomId,
          clientRequestId: optimisticClientRequestId,
        });
      }
      sendOysterunMatrixMessage(mx, roomId, content as any, {
        clientRequestId: pendingToken?.clientRequestId,
      })
        .then((response: any) => {
          if (optimisticClientRequestId) {
            notifyOysterunRouteCOptimisticProviderResponding({
              status: 'accepted',
              roomId,
              clientRequestId: optimisticClientRequestId,
              eventId: typeof response?.event_id === 'string' ? response.event_id : null,
            });
          }
          clearMsgDraft();
        })
        .catch((err: unknown) => {
          if (optimisticClientRequestId) {
            notifyOysterunRouteCOptimisticProviderResponding({
              status: 'failed',
              roomId,
              clientRequestId: optimisticClientRequestId,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
          console.error('[oysterun-routec] message send failed', err);
        })
        .finally(() => finishRouteCSendPending(pendingToken));
      resetEditor(editor);
      resetEditorHistory(editor);
      setRouteCComposerPlainText('');
      setReplyDraft(undefined);
      sendTypingStatus(false);
    }, [
      mx,
      roomId,
      editor,
      replyDraft,
      sendTypingStatus,
      setReplyDraft,
      isMarkdown,
      commands,
      clearMsgDraft,
      selectedFiles,
      mediaUploadDisabledMessage,
      mediaUploadEnabled,
      setMediaUploadNotice,
      setSelectedFiles,
      routeCInterruptInFlight,
      routeCChatShell,
      beginRouteCSendPending,
      finishRouteCSendPending,
    ]);

    const routeCPrimaryAction = routeCChatShell
      ? selectComposerPrimaryAction(routeCRespondingState.rawLifecycle, routeCComposerPlainText)
      : 'send';
    const routeCInterruptButtonDisabled =
      routeCPrimaryAction === 'interrupt' && routeCInterruptInFlight;
    const routeCSendButtonDisabled = routeCPrimaryAction === 'send' && routeCSendPending;
    const routeCPrimaryButtonDisabled = routeCInterruptButtonDisabled || routeCSendButtonDisabled;
    const routeCPrimaryButtonLabel =
      routeCPrimaryAction === 'interrupt' ? 'Stop response' : 'Send message';

    const handleRouteCPrimaryAction = useCallback(() => {
      if (routeCPrimaryAction === 'interrupt') {
        if (routeCInterruptInFlight) return;
        setRouteCInterruptInFlight(true);
        sendTypingStatus(false);
        interruptOysterunHostSession({
          matrixRoomId: roomId,
          command: '!!',
        }).catch((err: unknown) => {
          console.error('[oysterun-routec] stop-square interrupt request failed', err);
        }).finally(() => setRouteCInterruptInFlight(false));
        return;
      }
      void submit();
    }, [roomId, routeCInterruptInFlight, routeCPrimaryAction, sendTypingStatus, submit]);

    const handleEditorChange = useCallback(
      (value: Descendant[]) => {
        setRouteCComposerPlainText(getOysterunComposerPlainText(value, isMarkdown));
      },
      [isMarkdown]
    );

    const handleKeyDown: KeyboardEventHandler = useCallback(
      (evt) => {
        if (
          (isKeyHotkey('mod+enter', evt) || (submitWithBareEnter && isKeyHotkey('enter', evt))) &&
          !isComposing(evt)
        ) {
          evt.preventDefault();
          void submit();
        }
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          if (autocompleteQuery) {
            setAutocompleteQuery(undefined);
            setRouteCAtMode('path');
            return;
          }
          setReplyDraft(undefined);
        }
      },
      [submit, setReplyDraft, submitWithBareEnter, autocompleteQuery, isComposing]
    );

    const refreshAutocompleteQuery = useCallback(() => {
      const prevWordRange = getPrevAutocompleteRange(editor);
      const query = prevWordRange
        ? getAutocompleteQuery<AutocompletePrefix>(editor, prevWordRange, AUTOCOMPLETE_PREFIXES)
        : undefined;
      const nextQuery = getOysterunRouteCAllowedAutocompleteQuery(routeCChatShell, query);
      setAutocompleteQuery(nextQuery);
      if (nextQuery?.prefix !== AutocompletePrefix.UserMention) {
        setRouteCAtMode('path');
      }
    }, [editor, routeCChatShell]);

    const clearRouteCPostCompositionRefresh = useCallback(() => {
      if (routeCPostCompositionRefreshTimerRef.current === undefined) return;
      window.clearTimeout(routeCPostCompositionRefreshTimerRef.current);
      routeCPostCompositionRefreshTimerRef.current = undefined;
    }, []);

    const scheduleRouteCPostCompositionRefresh = useCallback(() => {
      clearRouteCPostCompositionRefresh();
      routeCPostCompositionRefreshTimerRef.current = window.setTimeout(() => {
        routeCPostCompositionRefreshTimerRef.current = undefined;
        refreshAutocompleteQuery();
      }, OYSTERUN_P185_COMPOSER_COMPOSITION_SETTLE_MS);
    }, [clearRouteCPostCompositionRefresh, refreshAutocompleteQuery]);

    useEffect(
      () => () => {
        clearRouteCPostCompositionRefresh();
      },
      [clearRouteCPostCompositionRefresh]
    );

    const handleKeyUp: KeyboardEventHandler = useCallback(
      (evt) => {
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          return;
        }

        if (isComposing(evt)) {
          setAutocompleteQuery(undefined);
          setRouteCAtMode('path');
          scheduleRouteCPostCompositionRefresh();
          return;
        }

        clearRouteCPostCompositionRefresh();

        if (!hideActivity) {
          sendTypingStatus(!isEmptyEditor(editor));
        }

        refreshAutocompleteQuery();
      },
      [
        clearRouteCPostCompositionRefresh,
        editor,
        hideActivity,
        isComposing,
        refreshAutocompleteQuery,
        scheduleRouteCPostCompositionRefresh,
        sendTypingStatus,
      ]
    );

    const handleCloseAutocomplete = useCallback(() => {
      setAutocompleteQuery(undefined);
      setRouteCAtMode('path');
      ReactEditor.focus(editor);
    }, [editor]);

    const handleRouteCComposerRecover = useCallback(
      (error: unknown, info: ErrorInfo) => {
        setAutocompleteQuery(undefined);
        setRouteCAtMode('path');
        setRouteCComposerRecoveryKey((current) => current + 1);
        console.warn('[oysterun-routec] recovered composer invalid selection', {
          error,
          componentStack: info.componentStack,
        });
      },
      []
    );

    const handleRouteCMemberMode = useCallback(() => {
      setRouteCAtMode('member');
      ReactEditor.focus(editor);
    }, [editor]);

    const handleEmoticonSelect = (key: string, shortcode: string) => {
      editor.insertNode(createEmoticonElement(key, shortcode));
      moveCursor(editor);
    };

    const handleStickerSelect = async (mxc: string, shortcode: string, label: string) => {
      const stickerUrl = mxcUrlToHttp(mx, mxc, useAuthentication);
      if (!stickerUrl) return;

      const info = await getImageInfo(
        await loadImageElement(stickerUrl),
        await getImageUrlBlob(stickerUrl)
      );

      mx.sendEvent(roomId, EventType.Sticker, {
        body: label,
        url: mxc,
        info,
      });
    };

    return (
      <div
        ref={ref}
        {...buildOysterunComposerProofAttributes(roomId)}
        data-oysterun-routec-insert-path-consumer={
          routeCChatShell ? 'query_insert_path_to_cinny_composer' : undefined
        }
        data-oysterun-clean-session-insert-path-consumer={
          routeCChatShell ? 'query_insert_path_to_cinny_composer' : undefined
        }
        data-oysterun-routec-insert-path-room-id={routeCChatShell ? roomId : undefined}
        data-oysterun-clean-session-insert-path-room-id={routeCChatShell ? roomId : undefined}
        data-oysterun-routec-p185-composer-ime-guard={
          routeCChatShell ? OYSTERUN_P185_COMPOSER_IME_GUARD : undefined
        }
      >
        <RouteCComposerLocalErrorBoundary
          recoveryKey={routeCComposerRecoveryKey}
          onRecover={handleRouteCComposerRecover}
        >
          <div
            key={routeCComposerRecoveryKey}
            data-oysterun-routec-p185-composer-local-error-boundary={
              routeCChatShell ? OYSTERUN_P185_COMPOSER_LOCAL_ERROR_BOUNDARY : undefined
            }
          >
            {selectedFiles.length > 0 && (
          <UploadBoard
            header={
              <UploadBoardHeader
                open={uploadBoard}
                onToggle={() => setUploadBoard(!uploadBoard)}
                uploadFamilyObserverAtom={uploadFamilyObserverAtom}
                imperativeHandlerRef={uploadBoardHandlers}
                onCancel={handleCancelUpload}
                uploadAvailable={mediaUploadEnabled}
                uploadUnavailableMessage={mediaUploadDisabledMessage}
                uploadUnavailableReason={mediaUploadAvailability.reason}
                stagedPreview
                stagedPreviewMessage={routeCStagedMediaSendReadyMessage}
              />
            }
          >
            {uploadBoard && (
              <Scroll size="300" hideTrack visibility="Hover">
                <UploadBoardContent>
                  {Array.from(selectedFiles)
                    .reverse()
                    .map((fileItem, index) => (
                      <UploadCardRenderer
                        // eslint-disable-next-line react/no-array-index-key
                        key={index}
                        isEncrypted={!!fileItem.encInfo}
                        fileItem={fileItem}
                        setMetadata={handleFileMetadata}
                        onRemove={handleRemoveUpload}
                      />
                    ))}
                </UploadBoardContent>
              </Scroll>
            )}
          </UploadBoard>
        )}
        <Overlay
          open={dropZoneVisible}
          backdrop={<OverlayBackdrop />}
          style={{ pointerEvents: 'none' }}
        >
          <OverlayCenter>
            <Dialog variant="Primary">
              <Box
                direction="Column"
                justifyContent="Center"
                alignItems="Center"
                gap="500"
                style={{ padding: toRem(60) }}
              >
                <Icon size="600" src={Icons.File} />
                <Text size="H4" align="Center">
                  {mediaUploadEnabled
                    ? `Drop Files in "${room?.name || 'Room'}"`
                    : 'File uploads unavailable'}
                </Text>
                <Text align="Center">
                  {mediaUploadEnabled
                    ? 'Drag and drop files here or click for selection dialog'
                    : mediaUploadDisabledMessage}
                </Text>
              </Box>
            </Dialog>
          </OverlayCenter>
        </Overlay>
        {autocompleteQuery?.prefix === AutocompletePrefix.RoomMention && (
          <RoomMentionAutocomplete
            roomId={roomId}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.UserMention &&
          routeCChatShell &&
          routeCAtMode === 'path' && (
            <RouteCPathAutocomplete
              room={room}
              editor={editor}
              query={autocompleteQuery}
              requestClose={handleCloseAutocomplete}
              requestMemberMode={handleRouteCMemberMode}
              requestRefresh={refreshAutocompleteQuery}
            />
          )}
        {autocompleteQuery?.prefix === AutocompletePrefix.UserMention &&
          (!routeCChatShell || routeCAtMode === 'member') && (
            <UserMentionAutocomplete
              room={room}
              editor={editor}
              query={autocompleteQuery}
              requestClose={handleCloseAutocomplete}
            />
          )}
        {showGenericComposerDecorations &&
          autocompleteQuery?.prefix === AutocompletePrefix.Emoticon && (
            <EmoticonAutocomplete
              imagePackRooms={imagePackRooms}
              editor={editor}
              query={autocompleteQuery}
              requestClose={handleCloseAutocomplete}
            />
          )}
        {autocompleteQuery?.prefix === AutocompletePrefix.Command && (
          <CommandAutocomplete
            room={room}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
            routeCActiveTokenMode={routeCChatShell}
          />
        )}
        {routeCChatShell && routeCLoopCliStatus && (
          <Box
            direction="Column"
            gap="100"
            style={{ padding: `${config.space.S100} ${config.space.S300} 0` }}
            data-testid="oysterun-routec-loop-cli-status"
            data-oysterun-clean-session-testid="oysterun-clean-session-loop-cli-status"
            data-oysterun-routec-loop-cli-state={routeCLoopCliStatus.state}
            data-oysterun-clean-session-loop-cli-state={routeCLoopCliStatus.state}
            data-oysterun-routec-loop-cli-duplicate-prevented={
              routeCLoopCliStatus.duplicatePrevented === undefined
                ? undefined
                : String(routeCLoopCliStatus.duplicatePrevented)
            }
            data-oysterun-clean-session-loop-cli-duplicate-prevented={
              routeCLoopCliStatus.duplicatePrevented === undefined
                ? undefined
                : String(routeCLoopCliStatus.duplicatePrevented)
            }
          >
            <Text
              size="T200"
              priority={routeCLoopCliStatus.state === 'error' ? '400' : '300'}
              role={routeCLoopCliStatus.state === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {routeCLoopCliStatus.message}
            </Text>
          </Box>
        )}
        <CustomEditor
          editableName="RoomInput"
          enterKeyHint={phoneComposerMode ? 'enter' : undefined}
          editor={editor}
          placeholder="Send a message..."
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onChange={handleEditorChange}
          onPaste={handlePaste}
          top={
            <>
              {mediaUploadNotice && (
                <Box
                  direction="Column"
                  gap="100"
                  style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
                  data-oysterun-media-upload-guard="disabled_upload_notice_no_upload"
                  data-oysterun-media-upload-disabled-reason={mediaUploadAvailability.reason}
                  data-oysterun-routec-media-send-guard={
                    selectedFiles.length > 1
                      ? 'multi_file_media_staged_for_explicit_send'
                      : undefined
                  }
                  data-oysterun-clean-session-media-send-guard={
                    selectedFiles.length > 1
                      ? 'multi_file_media_staged_for_explicit_send'
                      : undefined
                  }
                  data-oysterun-routec-media-send-commit={
                    mediaUploadNotice === 'Uploading staged media for Send...' ||
                    mediaUploadNotice.startsWith('Uploading ')
                      ? 'explicit_send_uploading_staged_files'
                      : undefined
                  }
                  data-oysterun-clean-session-media-send-commit={
                    mediaUploadNotice === 'Uploading staged media for Send...' ||
                    mediaUploadNotice.startsWith('Uploading ')
                      ? 'explicit_send_uploading_staged_files'
                      : undefined
                  }
                >
                  <Text size="T200" priority="300" role="status" aria-live="polite">
                    {mediaUploadNotice}
                  </Text>
                </Box>
              )}
              {replyDraft && (
                <div>
                  <Box
                    alignItems="Center"
                    gap="300"
                    style={{ padding: `${config.space.S200} ${config.space.S300} 0` }}
                  >
                    <IconButton
                      onClick={() => setReplyDraft(undefined)}
                      variant="SurfaceVariant"
                      size="300"
                      radii="300"
                    >
                      <Icon src={Icons.Cross} size="50" />
                    </IconButton>
                    <Box direction="Row" gap="200" alignItems="Center">
                      {replyDraft.relation?.rel_type === RelationType.Thread && <ThreadIndicator />}
                      <ReplyLayout
                        userColor={replyUsernameColor}
                        username={
                          <Text size="T300" truncate>
                            <b>
                              {getMemberDisplayName(room, replyDraft.userId) ??
                                getMxIdLocalPart(replyDraft.userId) ??
                                replyDraft.userId}
                            </b>
                          </Text>
                        }
                      >
                        <Text size="T300" truncate>
                          {trimReplyFromBody(replyDraft.body)}
                        </Text>
                      </ReplyLayout>
                    </Box>
                  </Box>
                </div>
              )}
            </>
          }
          before={
            <>
              <input
                ref={routeCFileInputRef}
                type="file"
                multiple
                aria-hidden="true"
                tabIndex={-1}
                data-oysterun-routec-media-file-input="dom_attached_for_ios_wkwebview"
                data-oysterun-clean-session-media-file-input="dom_attached_for_ios_wkwebview"
                onChange={handleRouteCFileInputChange}
                style={{
                  position: 'fixed',
                  width: 1,
                  height: 1,
                  opacity: 0,
                  pointerEvents: 'none',
                  left: 0,
                  top: 0,
                }}
              />
              <IconButton
                onClick={() => {
                  if (!mediaUploadEnabled) {
                    setMediaUploadNotice(mediaUploadDisabledMessage);
                    return;
                  }
                  routeCFileInputRef.current?.click();
                }}
                variant="SurfaceVariant"
                size="300"
                radii="300"
                aria-label={mediaUploadEnabled ? 'Attach files' : 'File uploads unavailable'}
                aria-disabled={!mediaUploadEnabled}
                title={mediaUploadEnabled ? 'Attach files' : mediaUploadDisabledMessage}
                data-oysterun-media-upload-guard={
                  mediaUploadEnabled ? 'upload_available' : 'disabled_upload_affordance_no_upload'
                }
                data-oysterun-media-upload-disabled-reason={
                  mediaUploadEnabled ? undefined : mediaUploadAvailability.reason
                }
              >
                <Icon src={Icons.PlusCircle} />
              </IconButton>
            </>
          }
          after={
            <>
              {showGenericComposerDecorations && (
                <>
                  <IconButton
                    variant="SurfaceVariant"
                    size="300"
                    radii="300"
                    onClick={() => setToolbar(!toolbar)}
                  >
                    <Icon src={toolbar ? Icons.AlphabetUnderline : Icons.Alphabet} />
                  </IconButton>
                  <UseStateProvider initial={undefined}>
                    {(emojiBoardTab: EmojiBoardTab | undefined, setEmojiBoardTab) => (
                      <PopOut
                        offset={16}
                        alignOffset={-44}
                        position="Top"
                        align="End"
                        anchor={
                          emojiBoardTab === undefined
                            ? undefined
                            : emojiBtnRef.current?.getBoundingClientRect() ?? undefined
                        }
                        content={
                          <EmojiBoard
                            tab={emojiBoardTab}
                            onTabChange={setEmojiBoardTab}
                            imagePackRooms={imagePackRooms}
                            returnFocusOnDeactivate={false}
                            onEmojiSelect={handleEmoticonSelect}
                            onCustomEmojiSelect={handleEmoticonSelect}
                            onStickerSelect={handleStickerSelect}
                            requestClose={() => {
                              setEmojiBoardTab((t) => {
                                if (t) {
                                  if (!mobileOrTablet()) ReactEditor.focus(editor);
                                  return undefined;
                                }
                                return t;
                              });
                            }}
                          />
                        }
                      >
                        {!hideStickerBtn && (
                          <IconButton
                            aria-pressed={emojiBoardTab === EmojiBoardTab.Sticker}
                            onClick={() => setEmojiBoardTab(EmojiBoardTab.Sticker)}
                            variant="SurfaceVariant"
                            size="300"
                            radii="300"
                          >
                            <Icon
                              src={Icons.Sticker}
                              filled={emojiBoardTab === EmojiBoardTab.Sticker}
                            />
                          </IconButton>
                        )}
                        <IconButton
                          ref={emojiBtnRef}
                          aria-pressed={
                            hideStickerBtn ? !!emojiBoardTab : emojiBoardTab === EmojiBoardTab.Emoji
                          }
                          onClick={() => setEmojiBoardTab(EmojiBoardTab.Emoji)}
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                        >
                          <Icon
                            src={Icons.Smile}
                            filled={
                              hideStickerBtn
                                ? !!emojiBoardTab
                                : emojiBoardTab === EmojiBoardTab.Emoji
                            }
                          />
                        </IconButton>
                      </PopOut>
                    )}
                  </UseStateProvider>
                </>
              )}
              <IconButton
                onClick={handleRouteCPrimaryAction}
                disabled={routeCPrimaryButtonDisabled}
                variant="SurfaceVariant"
                size="300"
                radii="300"
                aria-label={routeCPrimaryButtonLabel}
                title={routeCPrimaryButtonLabel}
                data-testid={
                  routeCPrimaryAction === 'interrupt'
                    ? 'oysterun-routec-stop-response-button'
                    : 'oysterun-routec-send-button'
                }
                data-oysterun-clean-session-testid={
                  routeCPrimaryAction === 'interrupt'
                    ? 'oysterun-clean-session-stop-response-button'
                    : 'oysterun-clean-session-send-button'
                }
                data-oysterun-room-id={roomId}
                data-oysterun-routec-primary-action={routeCChatShell ? routeCPrimaryAction : undefined}
                data-oysterun-clean-session-primary-action={
                  routeCChatShell ? routeCPrimaryAction : undefined
                }
                data-oysterun-routec-primary-action-source={
                  routeCPrimaryAction === 'interrupt'
                    ? 'responding_empty_composer_interrupt'
                    : undefined
                }
                data-oysterun-clean-session-primary-action-source={
                  routeCPrimaryAction === 'interrupt'
                    ? 'responding_empty_composer_interrupt'
                    : undefined
                }
                data-oysterun-routec-agent-responding={
                  routeCChatShell ? String(routeCRespondingState.agentResponding) : undefined
                }
                data-oysterun-clean-session-agent-responding={
                  routeCChatShell ? String(routeCRespondingState.agentResponding) : undefined
                }
                data-oysterun-routec-composer-text-empty={
                  routeCChatShell ? String(routeCComposerPlainText.length === 0) : undefined
                }
                data-oysterun-clean-session-composer-text-empty={
                  routeCChatShell ? String(routeCComposerPlainText.length === 0) : undefined
                }
                data-oysterun-routec-stop-response-endpoint={
                  routeCPrimaryAction === 'interrupt' ? '/session/interrupt' : undefined
                }
                data-oysterun-clean-session-stop-response-endpoint={
                  routeCPrimaryAction === 'interrupt' ? '/session/interrupt' : undefined
                }
                data-oysterun-routec-interrupt-in-flight={
                  routeCChatShell ? String(routeCInterruptInFlight) : undefined
                }
                data-oysterun-clean-session-interrupt-in-flight={
                  routeCChatShell ? String(routeCInterruptInFlight) : undefined
                }
                data-oysterun-routec-interrupt-one-shot-disabled={
                  routeCChatShell ? String(routeCInterruptButtonDisabled) : undefined
                }
                data-oysterun-clean-session-interrupt-one-shot-disabled={
                  routeCChatShell ? String(routeCInterruptButtonDisabled) : undefined
                }
                data-oysterun-routec-send-pending={
                  routeCChatShell ? String(routeCSendPending) : undefined
                }
                data-oysterun-clean-session-send-pending={
                  routeCChatShell ? String(routeCSendPending) : undefined
                }
                data-oysterun-routec-send-pending-key={
                  routeCChatShell ? routeCSendPendingKey ?? '' : undefined
                }
                data-oysterun-clean-session-send-pending-key={
                  routeCChatShell ? routeCSendPendingKey ?? '' : undefined
                }
                data-oysterun-routec-send-one-shot-disabled={
                  routeCChatShell ? String(routeCSendButtonDisabled) : undefined
                }
                data-oysterun-clean-session-send-one-shot-disabled={
                  routeCChatShell ? String(routeCSendButtonDisabled) : undefined
                }
                data-oysterun-routec-provider-lifecycle-source={
                  routeCChatShell ? routeCRespondingState.providerLifecycleSource : undefined
                }
                data-oysterun-clean-session-provider-lifecycle-source={
                  routeCChatShell ? routeCRespondingState.providerLifecycleSource : undefined
                }
                data-oysterun-routec-provider-lifecycle-state={
                  routeCChatShell ? routeCRespondingState.providerLifecycleState : undefined
                }
                data-oysterun-clean-session-provider-lifecycle-state={
                  routeCChatShell ? routeCRespondingState.providerLifecycleState : undefined
                }
                data-oysterun-routec-related-polling-allowed={
                  routeCChatShell ? String(routeCRespondingState.relatedPollingAllowed) : undefined
                }
                data-oysterun-clean-session-related-polling-allowed={
                  routeCChatShell ? String(routeCRespondingState.relatedPollingAllowed) : undefined
                }
              >
                {routeCPrimaryAction === 'interrupt' ? (
                  <span
                    aria-hidden="true"
                    data-oysterun-routec-stop-square-icon="true"
                    data-oysterun-clean-session-stop-square-icon="true"
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      backgroundColor: 'currentColor',
                      display: 'inline-block',
                    }}
                  />
                ) : (
                  <Icon src={Icons.Send} />
                )}
              </IconButton>
            </>
          }
          bottom={
            showGenericComposerDecorations &&
            toolbar && (
              <div>
                <Line variant="SurfaceVariant" size="300" />
                <Toolbar />
              </div>
            )
          }
            />
          </div>
        </RouteCComposerLocalErrorBoundary>
      </div>
    );
  }
);
