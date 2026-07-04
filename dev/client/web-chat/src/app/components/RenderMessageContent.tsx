import React from 'react';
import { MsgType } from 'matrix-js-sdk';
import { HTMLReactParserOptions } from 'html-react-parser';
import { Opts } from 'linkifyjs';
import { config } from 'folds';
import {
  AudioContent,
  DownloadFile,
  FileContent,
  ImageContent,
  MAudio,
  MBadEncrypted,
  MEmote,
  MFile,
  MImage,
  MLocation,
  MMultiMedia,
  MNotice,
  MText,
  MVideo,
  OYSTERUN_MULTI_MEDIA_MSGTYPE,
  ReadPdfFile,
  ReadTextFile,
  RenderBody,
  ThumbnailContent,
  UnsupportedContent,
  VideoContent,
} from './message';
import { UrlPreviewCard, UrlPreviewHolder } from './url-preview';
import { Image, MediaControl, Video } from './media';
import { ImageViewer } from './image-viewer';
import { PdfViewer } from './Pdf-viewer';
import { TextViewer } from './text-viewer';
import { testMatrixTo } from '../plugins/matrix-to';
import {
  OysterunSemanticRenderer,
  getOysterunSemanticPayload,
  isOysterunTerminalSemanticType,
  isOysterunToolSemanticType,
  isOysterunProviderCompletionMarkerContent,
  type OysterunSemanticControlOutcome,
  type OysterunToolCompression,
} from '../../oysterun/OysterunSemanticRenderer';
import type { OysterunLinkAnnotation } from './message/RenderBody';
import type {
  IAudioContent,
  IFileContent,
  IImageContent,
  IVideoContent,
} from '../../types/matrix/common';

type RenderMessageContentProps = {
  displayName: string;
  msgType: string;
  ts: number;
  edited?: boolean;
  getContent: <T>() => T;
  mediaAutoLoad?: boolean;
  urlPreview?: boolean;
  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
  outlineAttachment?: boolean;
  oysterunControlOutcome?: OysterunSemanticControlOutcome;
  oysterunToolCompression?: OysterunToolCompression;
};
export function RenderMessageContent({
  displayName,
  msgType,
  ts,
  edited,
  getContent,
  mediaAutoLoad,
  urlPreview,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
  outlineAttachment,
  oysterunControlOutcome,
  oysterunToolCompression,
}: RenderMessageContentProps) {
  const renderUrlsPreview = (urls: string[]) => {
    const filteredUrls = urls.filter((url) => !testMatrixTo(url));
    if (filteredUrls.length === 0) return undefined;
    return (
      <UrlPreviewHolder>
        {filteredUrls.map((url) => (
          <UrlPreviewCard key={url} url={url} ts={ts} />
        ))}
      </UrlPreviewHolder>
    );
  };
  const getOysterunLinkAnnotations = (content: Record<string, unknown>) =>
    Array.isArray(content.link_annotations)
      ? (content.link_annotations as OysterunLinkAnnotation[])
      : undefined;
  const isOysterunToolOrTerminalSemanticContent = (content: Record<string, unknown>) => {
    const payload = getOysterunSemanticPayload(content);
    const semanticType = payload?.semantic_type ?? payload?.semantic_category;
    return isOysterunToolSemanticType(semanticType) || isOysterunTerminalSemanticType(semanticType);
  };
  const getOysterunRenderableLinkAnnotations = (content: Record<string, unknown>) =>
    isOysterunToolOrTerminalSemanticContent(content)
      ? undefined
      : getOysterunLinkAnnotations(content);

  const renderMessageBody = (props: { body: string; customBody?: string }) => (
    <RenderBody
      {...props}
      oysterunLinkAnnotations={getOysterunRenderableLinkAnnotations(
        getContent<Record<string, unknown>>()
      )}
      highlightRegex={highlightRegex}
      htmlReactParserOptions={htmlReactParserOptions}
      linkifyOpts={linkifyOpts}
    />
  );
  const renderCaption = () => {
    const content: IImageContent = getContent();
    if (content.filename && content.filename !== content.body) {
      return (
        <MText
          style={{ marginTop: config.space.S200 }}
          edited={edited}
          content={content}
          renderBody={(props) => (
            <RenderBody
              {...props}
              oysterunLinkAnnotations={getOysterunLinkAnnotations(content)}
              highlightRegex={highlightRegex}
              htmlReactParserOptions={htmlReactParserOptions}
              linkifyOpts={linkifyOpts}
            />
          )}
          renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
        />
      );
    }
    return null;
  };

  const semanticContent = getContent<Record<string, unknown>>();
  if (isOysterunProviderCompletionMarkerContent(semanticContent)) {
    return null;
  }
  if (getOysterunSemanticPayload(semanticContent)) {
    return (
      <OysterunSemanticRenderer
        content={semanticContent}
        fallbackBody={typeof semanticContent.body === 'string' ? semanticContent.body : ''}
        formattedBody={
          typeof semanticContent.formatted_body === 'string'
            ? semanticContent.formatted_body
            : undefined
        }
        renderBody={renderMessageBody}
        controlOutcome={oysterunControlOutcome}
        toolCompression={oysterunToolCompression}
      />
    );
  }

  const renderFile = (content: IFileContent = getContent()) => (
    <>
      <MFile
        content={content}
        renderFileContent={({ body, mimeType, info, encInfo, url }) => (
          <FileContent
            body={body}
            mimeType={mimeType}
            renderAsPdfFile={() => (
              <ReadPdfFile
                body={body}
                mimeType={mimeType}
                url={url}
                encInfo={encInfo}
                renderViewer={(p) => <PdfViewer {...p} />}
              />
            )}
            renderAsTextFile={() => (
              <ReadTextFile
                body={body}
                mimeType={mimeType}
                url={url}
                encInfo={encInfo}
                renderViewer={(p) => <TextViewer {...p} />}
              />
            )}
          >
            <DownloadFile body={body} mimeType={mimeType} url={url} encInfo={encInfo} info={info} />
          </FileContent>
        )}
        outlined={outlineAttachment}
      />
      {renderCaption()}
    </>
  );

  if (msgType === MsgType.Text) {
    return (
      <MText
        edited={edited}
        content={getContent()}
        renderBody={(props) => (
          <RenderBody
            {...props}
            oysterunLinkAnnotations={getOysterunLinkAnnotations(getContent<Record<string, unknown>>())}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  if (msgType === MsgType.Emote) {
    return (
      <MEmote
        displayName={displayName}
        edited={edited}
        content={getContent()}
        renderBody={(props) => (
          <RenderBody
            {...props}
            oysterunLinkAnnotations={getOysterunLinkAnnotations(getContent<Record<string, unknown>>())}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  if (msgType === MsgType.Notice) {
    return (
      <MNotice
        edited={edited}
        content={getContent()}
        renderBody={(props) => (
          <RenderBody
            {...props}
            oysterunLinkAnnotations={getOysterunLinkAnnotations(getContent<Record<string, unknown>>())}
            highlightRegex={highlightRegex}
            htmlReactParserOptions={htmlReactParserOptions}
            linkifyOpts={linkifyOpts}
          />
        )}
        renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
      />
    );
  }

  if (msgType === MsgType.Image) {
    return (
      <>
        <MImage
          content={getContent()}
          renderImageContent={(props) => (
            <ImageContent
              {...props}
              autoPlay={mediaAutoLoad}
              renderImage={(p) => <Image {...p} loading="lazy" />}
              renderViewer={(p) => <ImageViewer {...p} />}
            />
          )}
          outlined={outlineAttachment}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.Video) {
    return (
      <>
        <MVideo
          content={getContent()}
          renderAsFile={renderFile}
          renderVideoContent={({ body, info, ...props }) => (
            <VideoContent
              body={body}
              info={info}
              {...props}
              renderThumbnail={
                mediaAutoLoad
                  ? () => (
                      <ThumbnailContent
                        info={info}
                        renderImage={(src) => (
                          <Image alt={body} title={body} src={src} loading="lazy" />
                        )}
                      />
                    )
                  : undefined
              }
              renderVideo={(p) => <Video {...p} />}
            />
          )}
          outlined={outlineAttachment}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.Audio) {
    return (
      <>
        <MAudio
          content={getContent()}
          renderAsFile={renderFile}
          renderAudioContent={(props) => (
            <AudioContent {...props} renderMediaControl={(p) => <MediaControl {...p} />} />
          )}
          outlined={outlineAttachment}
        />
        {renderCaption()}
      </>
    );
  }

  if (msgType === MsgType.File) {
    return renderFile();
  }

  if (msgType === OYSTERUN_MULTI_MEDIA_MSGTYPE) {
    const multiMediaContent = getContent<Record<string, unknown>>();
    return (
      <MMultiMedia
        content={multiMediaContent}
        renderAttachment={({ content }) => {
          if (content.msgtype === MsgType.Image) {
            return (
              <MImage
                content={content as IImageContent}
                renderImageContent={(props) => (
                  <ImageContent
                    {...props}
                    autoPlay={mediaAutoLoad}
                    renderImage={(p) => <Image {...p} loading="lazy" />}
                    renderViewer={(p) => <ImageViewer {...p} />}
                  />
                )}
                outlined={outlineAttachment}
              />
            );
          }
          if (content.msgtype === MsgType.Video) {
            return (
              <MVideo
                content={content as IVideoContent}
                renderAsFile={() => renderFile(content as IFileContent)}
                renderVideoContent={({ body, info, ...props }) => (
                  <VideoContent
                    body={body}
                    info={info}
                    {...props}
                    renderThumbnail={
                      mediaAutoLoad
                        ? () => (
                            <ThumbnailContent
                              info={info}
                              renderImage={(src) => (
                                <Image alt={body} title={body} src={src} loading="lazy" />
                              )}
                            />
                          )
                        : undefined
                    }
                    renderVideo={(p) => <Video {...p} />}
                  />
                )}
                outlined={outlineAttachment}
              />
            );
          }
          if (content.msgtype === MsgType.Audio) {
            return (
              <MAudio
                content={content as IAudioContent}
                renderAsFile={() => renderFile(content as IFileContent)}
                renderAudioContent={(props) => (
                  <AudioContent {...props} renderMediaControl={(p) => <MediaControl {...p} />} />
                )}
                outlined={outlineAttachment}
              />
            );
          }
          return renderFile(content as IFileContent);
        }}
        renderCaption={(caption) => {
          const captionAnnotations =
            (caption.linkAnnotations as OysterunLinkAnnotation[] | undefined) ??
            getOysterunLinkAnnotations(multiMediaContent);
          const captionContent = {
            body: caption.body,
            formatted_body: caption.formattedBody,
            link_annotations: captionAnnotations,
          };
          return (
            <MText
              style={{ marginTop: config.space.S200 }}
              edited={edited}
              content={captionContent}
              renderBody={(props) => (
                <RenderBody
                  {...props}
                  oysterunLinkAnnotations={captionAnnotations}
                  highlightRegex={highlightRegex}
                  htmlReactParserOptions={htmlReactParserOptions}
                  linkifyOpts={linkifyOpts}
                />
              )}
              renderUrlsPreview={urlPreview ? renderUrlsPreview : undefined}
            />
          );
        }}
      />
    );
  }

  if (msgType === MsgType.Location) {
    return <MLocation content={getContent()} />;
  }

  if (msgType === 'm.bad.encrypted') {
    return <MBadEncrypted />;
  }

  return <UnsupportedContent />;
}
