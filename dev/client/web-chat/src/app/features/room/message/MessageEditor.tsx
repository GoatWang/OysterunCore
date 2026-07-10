import React, {
  KeyboardEventHandler,
  MouseEventHandler,
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  Box,
  Chip,
  Icon,
  IconButton,
  Icons,
  Line,
  PopOut,
  RectCords,
  Spinner,
  Text,
  as,
  config,
} from 'folds';
import { Editor, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { isKeyHotkey } from 'is-hotkey';
import {
  AUTOCOMPLETE_PREFIXES,
  AutocompletePrefix,
  AutocompleteQuery,
  CustomEditor,
  EmoticonAutocomplete,
  RoomMentionAutocomplete,
  Toolbar,
  UserMentionAutocomplete,
  createEmoticonElement,
  getAutocompleteQuery,
  getPrevWorldRange,
  htmlToEditorInput,
  moveCursor,
  plainToEditorInput,
  useEditor,
} from '../../../components/editor';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { UseStateProvider } from '../../../components/UseStateProvider';
import { EmojiBoard } from '../../../components/emoji-board';
import { AsyncStatus, useAsyncCallback } from '../../../hooks/useAsyncCallback';
import { getEditedEvent } from '../../../utils/room';
import { mobileOrTablet } from '../../../utils/user-agent';
import { useComposingCheck } from '../../../hooks/useComposingCheck';
import { isOysterunPhoneComposerMode } from '../../../../oysterun/OysterunComposerInputPolicy';

type MessageEditorProps = {
  roomId: string;
  room: Room;
  mEvent: MatrixEvent;
  imagePackRooms?: Room[];
  onCancel: () => void;
};
export const MessageEditor = as<'div', MessageEditorProps>(
  ({ room, roomId, mEvent, imagePackRooms, onCancel, ...props }, ref) => {
    const editor = useEditor();
    const [enterForNewline] = useSetting(settingsAtom, 'enterForNewline');
    const [globalToolbar] = useSetting(settingsAtom, 'editorToolbar');
    const [isMarkdown] = useSetting(settingsAtom, 'isMarkdown');
    const [toolbar, setToolbar] = useState(globalToolbar);
    const isComposing = useComposingCheck();
    const phoneComposerMode = isOysterunPhoneComposerMode();
    const submitWithBareEnter = !phoneComposerMode && !enterForNewline;

    const [autocompleteQuery, setAutocompleteQuery] =
      useState<AutocompleteQuery<AutocompletePrefix>>();

    const getPrevBodyAndFormattedBody = useCallback((): [
      string | undefined,
      string | undefined
    ] => {
      const evtId = mEvent.getId()!;
      const evtTimeline = room.getTimelineForEvent(evtId);
      const editedEvent =
        evtTimeline && getEditedEvent(evtId, mEvent, evtTimeline.getTimelineSet());

      const content = editedEvent?.getContent()['m.new_content'] ?? mEvent.getContent();
      const { body, formatted_body: customHtml }: Record<string, unknown> = content;

      return [
        typeof body === 'string' ? body : undefined,
        typeof customHtml === 'string' ? customHtml : undefined,
      ];
    }, [room, mEvent]);

    const [saveState, save] = useAsyncCallback(useCallback(async () => undefined, []));

    const handleSave = useCallback(() => {
      if (saveState.status !== AsyncStatus.Loading) {
        save();
      }
    }, [saveState, save]);

    const handleKeyDown: KeyboardEventHandler = useCallback(
      (evt) => {
        if (
          (isKeyHotkey('mod+enter', evt) || (submitWithBareEnter && isKeyHotkey('enter', evt))) &&
          !isComposing(evt)
        ) {
          evt.preventDefault();
          handleSave();
        }
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          onCancel();
        }
      },
      [onCancel, handleSave, submitWithBareEnter, isComposing]
    );

    const handleKeyUp: KeyboardEventHandler = useCallback(
      (evt) => {
        if (isKeyHotkey('escape', evt)) {
          evt.preventDefault();
          return;
        }

        const prevWordRange = getPrevWorldRange(editor);
        const query = prevWordRange
          ? getAutocompleteQuery<AutocompletePrefix>(editor, prevWordRange, AUTOCOMPLETE_PREFIXES)
          : undefined;
        setAutocompleteQuery(query);
      },
      [editor]
    );

    const handleCloseAutocomplete = useCallback(() => {
      ReactEditor.focus(editor);
      setAutocompleteQuery(undefined);
    }, [editor]);

    const handleEmoticonSelect = (key: string, shortcode: string) => {
      editor.insertNode(createEmoticonElement(key, shortcode));
      moveCursor(editor);
    };

    useEffect(() => {
      const [body, customHtml] = getPrevBodyAndFormattedBody();

      const initialValue =
        typeof customHtml === 'string'
          ? htmlToEditorInput(customHtml, isMarkdown)
          : plainToEditorInput(typeof body === 'string' ? body : '', isMarkdown);

      Transforms.select(editor, {
        anchor: Editor.start(editor, []),
        focus: Editor.end(editor, []),
      });

      editor.insertFragment(initialValue);
      if (!mobileOrTablet()) ReactEditor.focus(editor);
    }, [editor, getPrevBodyAndFormattedBody, isMarkdown]);

    useEffect(() => {
      if (saveState.status === AsyncStatus.Success) {
        onCancel();
      }
    }, [saveState, onCancel]);

    return (
      <div {...props} ref={ref}>
        {autocompleteQuery?.prefix === AutocompletePrefix.RoomMention && (
          <RoomMentionAutocomplete
            roomId={roomId}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.UserMention && (
          <UserMentionAutocomplete
            room={room}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        {autocompleteQuery?.prefix === AutocompletePrefix.Emoticon && (
          <EmoticonAutocomplete
            imagePackRooms={imagePackRooms || []}
            editor={editor}
            query={autocompleteQuery}
            requestClose={handleCloseAutocomplete}
          />
        )}
        <CustomEditor
          enterKeyHint={phoneComposerMode ? 'enter' : undefined}
          editor={editor}
          placeholder="Edit message..."
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          bottom={
            <>
              <Box
                style={{ padding: config.space.S200, paddingTop: 0 }}
                alignItems="End"
                justifyContent="SpaceBetween"
                gap="100"
              >
                <Box gap="Inherit">
                  <Chip
                    onClick={handleSave}
                    variant="Primary"
                    radii="Pill"
                    disabled={saveState.status === AsyncStatus.Loading}
                    outlined
                    before={
                      saveState.status === AsyncStatus.Loading ? (
                        <Spinner variant="Primary" fill="Soft" size="100" />
                      ) : undefined
                    }
                  >
                    <Text size="B300">Save</Text>
                  </Chip>
                  <Chip onClick={onCancel} variant="SurfaceVariant" radii="Pill">
                    <Text size="B300">Cancel</Text>
                  </Chip>
                </Box>
                <Box gap="Inherit">
                  <IconButton
                    variant="SurfaceVariant"
                    size="300"
                    radii="300"
                    onClick={() => setToolbar(!toolbar)}
                  >
                    <Icon size="400" src={toolbar ? Icons.AlphabetUnderline : Icons.Alphabet} />
                  </IconButton>
                  <UseStateProvider initial={undefined}>
                    {(anchor: RectCords | undefined, setAnchor) => (
                      <PopOut
                        anchor={anchor}
                        alignOffset={-8}
                        position="Top"
                        align="End"
                        content={
                          <EmojiBoard
                            imagePackRooms={imagePackRooms ?? []}
                            returnFocusOnDeactivate={false}
                            onEmojiSelect={handleEmoticonSelect}
                            onCustomEmojiSelect={handleEmoticonSelect}
                            requestClose={() => {
                              setAnchor((v) => {
                                if (v) {
                                  if (!mobileOrTablet()) ReactEditor.focus(editor);
                                  return undefined;
                                }
                                return v;
                              });
                            }}
                          />
                        }
                      >
                        <IconButton
                          aria-pressed={anchor !== undefined}
                          onClick={
                            ((evt) =>
                              setAnchor(
                                evt.currentTarget.getBoundingClientRect()
                              )) as MouseEventHandler<HTMLButtonElement>
                          }
                          variant="SurfaceVariant"
                          size="300"
                          radii="300"
                        >
                          <Icon size="400" src={Icons.Smile} filled={anchor !== undefined} />
                        </IconButton>
                      </PopOut>
                    )}
                  </UseStateProvider>
                </Box>
              </Box>
              {toolbar && (
                <div>
                  <Line variant="SurfaceVariant" size="300" />
                  <Toolbar />
                </div>
              )}
            </>
          }
        />
      </div>
    );
  }
);
