import React, { CSSProperties, ReactNode } from 'react';
import { Box, Chip, Icon, Icons, Text, toRem } from 'folds';
import { IContent, MsgType } from 'matrix-js-sdk';
import { JUMBO_EMOJI_REG, URL_REG } from '../../utils/regex';
import { trimReplyFromBody } from '../../utils/room';
import { MessageTextBody } from './layout';
import {
  MessageBadEncryptedContent,
  MessageBrokenContent,
  MessageDeletedContent,
  MessageEditedContent,
  MessageUnsupportedContent,
} from './content';
import {
  IAudioContent,
  IAudioInfo,
  IEncryptedFile,
  IFileContent,
  IFileInfo,
  IImageContent,
  IImageInfo,
  IThumbnailContent,
  IVideoContent,
  IVideoInfo,
  MATRIX_SPOILER_PROPERTY_NAME,
  MATRIX_SPOILER_REASON_PROPERTY_NAME,
} from '../../../types/matrix/common';
import { FALLBACK_MIMETYPE, getBlobSafeMimeType } from '../../utils/mimeTypes';
import { parseGeoUri, scaleYDimension } from '../../utils/common';
import { Attachment, AttachmentBox, AttachmentContent, AttachmentHeader } from './attachment';
import { FileHeader, FileDownloadButton } from './FileHeader';

export const OYSTERUN_MULTI_MEDIA_MSGTYPE = 'org.oysterun.multi_media';
const OYSTERUN_ROUTE_C_MEDIA_NAMESPACE = 'org.oysterun.media.v1';
const OYSTERUN_ROUTE_C_MULTI_MEDIA_CONTRACT = 'routec_multi_media_product_message_v1';

export function MBadEncrypted() {
  return (
    <Text>
      <MessageBadEncryptedContent />
    </Text>
  );
}

type RedactedContentProps = {
  reason?: string;
};
export function RedactedContent({ reason }: RedactedContentProps) {
  return (
    <Text>
      <MessageDeletedContent reason={reason} />
    </Text>
  );
}

export function UnsupportedContent() {
  return (
    <Text>
      <MessageUnsupportedContent />
    </Text>
  );
}

export function BrokenContent() {
  return (
    <Text>
      <MessageBrokenContent />
    </Text>
  );
}

type RenderBodyProps = {
  body: string;
  customBody?: string;
};
type MTextProps = {
  edited?: boolean;
  content: Record<string, unknown>;
  renderBody: (props: RenderBodyProps) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
  style?: CSSProperties;
};
export function MText({ edited, content, renderBody, renderUrlsPreview, style }: MTextProps) {
  const { body, formatted_body: customBody } = content;

  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const urlsMatch = renderUrlsPreview && trimmedBody.match(URL_REG);
  const urls = urlsMatch ? [...new Set(urlsMatch)] : undefined;

  return (
    <>
      <MessageTextBody
        preWrap={typeof customBody !== 'string'}
        jumboEmoji={JUMBO_EMOJI_REG.test(trimmedBody)}
        style={style}
      >
        {renderBody({
          body: trimmedBody,
          customBody: typeof customBody === 'string' ? customBody : undefined,
        })}
        {edited && <MessageEditedContent />}
      </MessageTextBody>
      {renderUrlsPreview && urls && urls.length > 0 && renderUrlsPreview(urls)}
    </>
  );
}

type MEmoteProps = {
  displayName: string;
  edited?: boolean;
  content: Record<string, unknown>;
  renderBody: (props: RenderBodyProps) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
};
export function MEmote({
  displayName,
  edited,
  content,
  renderBody,
  renderUrlsPreview,
}: MEmoteProps) {
  const { body, formatted_body: customBody } = content;

  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const urlsMatch = renderUrlsPreview && trimmedBody.match(URL_REG);
  const urls = urlsMatch ? [...new Set(urlsMatch)] : undefined;

  return (
    <>
      <MessageTextBody
        emote
        preWrap={typeof customBody !== 'string'}
        jumboEmoji={JUMBO_EMOJI_REG.test(trimmedBody)}
      >
        <b>{`${displayName} `}</b>
        {renderBody({
          body: trimmedBody,
          customBody: typeof customBody === 'string' ? customBody : undefined,
        })}
        {edited && <MessageEditedContent />}
      </MessageTextBody>
      {renderUrlsPreview && urls && urls.length > 0 && renderUrlsPreview(urls)}
    </>
  );
}

type MNoticeProps = {
  edited?: boolean;
  content: Record<string, unknown>;
  renderBody: (props: RenderBodyProps) => ReactNode;
  renderUrlsPreview?: (urls: string[]) => ReactNode;
};
export function MNotice({ edited, content, renderBody, renderUrlsPreview }: MNoticeProps) {
  const { body, formatted_body: customBody } = content;

  if (typeof body !== 'string') return <BrokenContent />;
  const trimmedBody = trimReplyFromBody(body);
  const urlsMatch = renderUrlsPreview && trimmedBody.match(URL_REG);
  const urls = urlsMatch ? [...new Set(urlsMatch)] : undefined;

  return (
    <>
      <MessageTextBody
        notice
        preWrap={typeof customBody !== 'string'}
        jumboEmoji={JUMBO_EMOJI_REG.test(trimmedBody)}
      >
        {renderBody({
          body: trimmedBody,
          customBody: typeof customBody === 'string' ? customBody : undefined,
        })}
        {edited && <MessageEditedContent />}
      </MessageTextBody>
      {renderUrlsPreview && urls && urls.length > 0 && renderUrlsPreview(urls)}
    </>
  );
}

type RenderImageContentProps = {
  body: string;
  filename?: string;
  info?: IImageInfo & IThumbnailContent;
  mimeType?: string;
  url: string;
  encInfo?: IEncryptedFile;
  markedAsSpoiler?: boolean;
  spoilerReason?: string;
};
type MImageProps = {
  content: IImageContent;
  renderImageContent: (props: RenderImageContentProps) => ReactNode;
  outlined?: boolean;
};
export function MImage({ content, renderImageContent, outlined }: MImageProps) {
  const imgInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  if (typeof mxcUrl !== 'string') {
    return <BrokenContent />;
  }
  const height = scaleYDimension(imgInfo?.w || 400, 400, imgInfo?.h || 400);

  return (
    <Attachment outlined={outlined}>
      <AttachmentBox
        style={{
          height: toRem(height < 48 ? 48 : height),
        }}
      >
        {renderImageContent({
          body: content.body || 'Image',
          info: imgInfo,
          mimeType: imgInfo?.mimetype,
          url: mxcUrl,
          encInfo: content.file,
          markedAsSpoiler: content[MATRIX_SPOILER_PROPERTY_NAME],
          spoilerReason: content[MATRIX_SPOILER_REASON_PROPERTY_NAME],
        })}
      </AttachmentBox>
    </Attachment>
  );
}

type RenderVideoContentProps = {
  body: string;
  info: IVideoInfo & IThumbnailContent;
  mimeType: string;
  url: string;
  encInfo?: IEncryptedFile;
  markedAsSpoiler?: boolean;
  spoilerReason?: string;
};
type MVideoProps = {
  content: IVideoContent;
  renderAsFile: () => ReactNode;
  renderVideoContent: (props: RenderVideoContentProps) => ReactNode;
  outlined?: boolean;
};
export function MVideo({ content, renderAsFile, renderVideoContent, outlined }: MVideoProps) {
  const videoInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  const safeMimeType = getBlobSafeMimeType(videoInfo?.mimetype ?? '');

  if (!videoInfo || !safeMimeType.startsWith('video') || typeof mxcUrl !== 'string') {
    if (mxcUrl) {
      return renderAsFile();
    }
    return <BrokenContent />;
  }

  const height = scaleYDimension(videoInfo.w || 400, 400, videoInfo.h || 400);

  const filename = content.filename ?? content.body ?? 'Video';

  return (
    <Attachment outlined={outlined}>
      <AttachmentHeader>
        <FileHeader
          body={filename}
          mimeType={safeMimeType}
          after={
            <FileDownloadButton
              filename={filename}
              url={mxcUrl}
              mimeType={safeMimeType}
              encInfo={content.file}
            />
          }
        />
      </AttachmentHeader>
      <AttachmentBox
        style={{
          height: toRem(height < 48 ? 48 : height),
        }}
      >
        {renderVideoContent({
          body: content.body || 'Video',
          info: videoInfo,
          mimeType: safeMimeType,
          url: mxcUrl,
          encInfo: content.file,
          markedAsSpoiler: content[MATRIX_SPOILER_PROPERTY_NAME],
          spoilerReason: content[MATRIX_SPOILER_REASON_PROPERTY_NAME],
        })}
      </AttachmentBox>
    </Attachment>
  );
}

type RenderAudioContentProps = {
  info: IAudioInfo;
  mimeType: string;
  url: string;
  encInfo?: IEncryptedFile;
};
type MAudioProps = {
  content: IAudioContent;
  renderAsFile: () => ReactNode;
  renderAudioContent: (props: RenderAudioContentProps) => ReactNode;
  outlined?: boolean;
};
export function MAudio({ content, renderAsFile, renderAudioContent, outlined }: MAudioProps) {
  const audioInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  const safeMimeType = getBlobSafeMimeType(audioInfo?.mimetype ?? '');

  if (!audioInfo || !safeMimeType.startsWith('audio') || typeof mxcUrl !== 'string') {
    if (mxcUrl) {
      return renderAsFile();
    }
    return <BrokenContent />;
  }

  const filename = content.filename ?? content.body ?? 'Audio';
  return (
    <Attachment outlined={outlined}>
      <AttachmentHeader>
        <FileHeader
          body={filename}
          mimeType={safeMimeType}
          after={
            <FileDownloadButton
              filename={filename}
              url={mxcUrl}
              mimeType={safeMimeType}
              encInfo={content.file}
            />
          }
        />
      </AttachmentHeader>
      <AttachmentBox>
        <AttachmentContent>
          {renderAudioContent({
            info: audioInfo,
            mimeType: safeMimeType,
            url: mxcUrl,
            encInfo: content.file,
          })}
        </AttachmentContent>
      </AttachmentBox>
    </Attachment>
  );
}

type RenderFileContentProps = {
  body: string;
  info: IFileInfo & IThumbnailContent;
  mimeType: string;
  url: string;
  encInfo?: IEncryptedFile;
};
type MFileProps = {
  content: IFileContent;
  renderFileContent: (props: RenderFileContentProps) => ReactNode;
  outlined?: boolean;
};
export function MFile({ content, renderFileContent, outlined }: MFileProps) {
  const fileInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;

  if (typeof mxcUrl !== 'string') {
    return <BrokenContent />;
  }

  return (
    <Attachment outlined={outlined}>
      <AttachmentHeader>
        <FileHeader
          body={content.filename ?? content.body ?? 'Unnamed File'}
          mimeType={fileInfo?.mimetype ?? FALLBACK_MIMETYPE}
        />
      </AttachmentHeader>
      <AttachmentBox>
        <AttachmentContent>
          {renderFileContent({
            body: content.filename ?? content.body ?? 'File',
            info: fileInfo ?? {},
            mimeType: fileInfo?.mimetype ?? FALLBACK_MIMETYPE,
            url: mxcUrl,
            encInfo: content.file,
          })}
        </AttachmentContent>
      </AttachmentBox>
    </Attachment>
  );
}

type OysterunMultiMediaCaption = {
  body: string;
  formattedBody?: string;
  linkAnnotations?: unknown[];
};

export type OysterunMultiMediaRenderableAttachment = {
  index: number;
  content: IImageContent | IVideoContent | IAudioContent | IFileContent;
};

type MMultiMediaProps = {
  content: Record<string, unknown>;
  renderAttachment: (attachment: OysterunMultiMediaRenderableAttachment) => ReactNode;
  renderCaption: (caption: OysterunMultiMediaCaption) => ReactNode;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function inferRouteCMultiMediaMsgType(rawMsgType: unknown, mimetype: string): MsgType {
  if (
    rawMsgType === MsgType.Image ||
    rawMsgType === MsgType.Video ||
    rawMsgType === MsgType.Audio ||
    rawMsgType === MsgType.File
  ) {
    return rawMsgType;
  }
  const normalizedMime = mimetype.toLowerCase();
  if (normalizedMime.startsWith('image/')) return MsgType.Image;
  if (normalizedMime.startsWith('video/')) return MsgType.Video;
  if (normalizedMime.startsWith('audio/')) return MsgType.Audio;
  return MsgType.File;
}

function getOysterunMultiMediaPayload(content: Record<string, unknown>):
  | {
      attachments: OysterunMultiMediaRenderableAttachment[];
      caption?: OysterunMultiMediaCaption;
    }
  | undefined {
  if (content.msgtype !== OYSTERUN_MULTI_MEDIA_MSGTYPE) return undefined;
  const metadata = content[OYSTERUN_ROUTE_C_MEDIA_NAMESPACE];
  if (!isRecord(metadata) || metadata.contract !== OYSTERUN_ROUTE_C_MULTI_MEDIA_CONTRACT) {
    return undefined;
  }
  if (!Array.isArray(metadata.attachments) || metadata.attachments.length < 2) {
    return undefined;
  }

  const attachments: OysterunMultiMediaRenderableAttachment[] = [];
  for (const [position, rawAttachment] of metadata.attachments.entries()) {
    if (!isRecord(rawAttachment)) return undefined;
    if (rawAttachment.index !== position) return undefined;
    const filename = nonEmptyString(rawAttachment.filename);
    const contentUri = nonEmptyString(rawAttachment.content_uri);
    const mimetype = nonEmptyString(rawAttachment.mimetype);
    const byteSize = rawAttachment.byte_size;
    if (!filename || !contentUri || !mimetype || typeof byteSize !== 'number') {
      return undefined;
    }
    const msgtype = inferRouteCMultiMediaMsgType(rawAttachment.msgtype, mimetype);
    const info = isRecord(rawAttachment.info) ? { ...rawAttachment.info } : {};
    info.mimetype = mimetype;
    info.size = byteSize;
    attachments.push({
      index: position,
      content: {
        msgtype,
        body: filename,
        filename,
        url: contentUri,
        info,
      } as IImageContent | IVideoContent | IAudioContent | IFileContent,
    });
  }

  const rawCaption = metadata.caption;
  const captionBody = isRecord(rawCaption) ? nonEmptyString(rawCaption.body) : '';
  const formattedBody =
    isRecord(rawCaption) && typeof rawCaption.formatted_body === 'string'
      ? rawCaption.formatted_body
      : undefined;
  const linkAnnotations =
    isRecord(rawCaption) &&
    Array.isArray(rawCaption.link_annotations) &&
    rawCaption.link_annotations.length > 0
      ? rawCaption.link_annotations
      : undefined;

  return {
    attachments,
    caption: captionBody
      ? {
          body: captionBody,
          formattedBody,
          linkAnnotations,
        }
      : undefined,
  };
}

export function MMultiMedia({ content, renderAttachment, renderCaption }: MMultiMediaProps) {
  const payload = getOysterunMultiMediaPayload(content);
  if (!payload) return <BrokenContent />;

  return (
    <Box
      direction="Column"
      gap="200"
      data-oysterun-routec-multi-media-message="true"
      data-oysterun-routec-multi-media-attachment-count={String(payload.attachments.length)}
    >
      <Box direction="Column" gap="200">
        {payload.attachments.map((attachment) => (
          <Box
            key={`${attachment.index}:${attachment.content.url ?? attachment.content.filename}`}
            data-oysterun-routec-multi-media-attachment-index={String(attachment.index)}
          >
            {renderAttachment(attachment)}
          </Box>
        ))}
      </Box>
      {payload.caption && renderCaption(payload.caption)}
    </Box>
  );
}

type MLocationProps = {
  content: IContent;
};
export function MLocation({ content }: MLocationProps) {
  const geoUri = content.geo_uri;
  if (typeof geoUri !== 'string') return <BrokenContent />;
  const location = parseGeoUri(geoUri);
  if (!location) return <BrokenContent />;

  return (
    <Box direction="Column" alignItems="Start" gap="100">
      <Text size="T400">{geoUri}</Text>
      <Chip
        as="a"
        size="400"
        href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`}
        target="_blank"
        rel="noreferrer noopener"
        variant="Primary"
        radii="Pill"
        before={<Icon src={Icons.External} size="50" />}
      >
        <Text size="B300">Open Location</Text>
      </Chip>
    </Box>
  );
}

type MStickerProps = {
  content: IImageContent;
  renderImageContent: (props: RenderImageContentProps) => ReactNode;
};
export function MSticker({ content, renderImageContent }: MStickerProps) {
  const imgInfo = content?.info;
  const mxcUrl = content.file?.url ?? content.url;
  if (typeof mxcUrl !== 'string') {
    return <MessageBrokenContent />;
  }
  const height = scaleYDimension(imgInfo?.w || 152, 152, imgInfo?.h || 152);

  return (
    <AttachmentBox
      style={{
        height: toRem(height < 48 ? 48 : height),
        width: toRem(152),
      }}
    >
      {renderImageContent({
        body: content.body || 'Sticker',
        info: imgInfo,
        mimeType: imgInfo?.mimetype,
        url: mxcUrl,
        encInfo: content.file,
      })}
    </AttachmentBox>
  );
}
