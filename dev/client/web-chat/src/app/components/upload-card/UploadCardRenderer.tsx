import React, { ReactNode } from 'react';
import { Badge, Box, Chip, Icon, IconButton, Icons, Text, config, toRem } from 'folds';
import { UploadCard, UploadCardError } from './UploadCard';
import { TUploadContent } from '../../utils/matrix';
import { bytesToSize, getFileTypeIcon } from '../../utils/common';
import { TUploadItem, TUploadMetadata } from '../../state/room/roomInputDrafts';
import { useObjectURL } from '../../hooks/useObjectURL';
import { useMediaUploadAvailability } from '../../hooks/useMediaConfig';

type PreviewImageProps = {
  fileItem: TUploadItem;
};
function PreviewImage({ fileItem }: PreviewImageProps) {
  const { originalFile, metadata } = fileItem;
  const fileUrl = useObjectURL(originalFile);

  return (
    <img
      style={{
        objectFit: 'contain',
        width: '100%',
        height: toRem(152),
        filter: metadata.markedAsSpoiler ? 'blur(44px)' : undefined,
      }}
      alt={originalFile.name}
      src={fileUrl}
      data-oysterun-routec-media-staged-preview="image_local_object_url_no_upload"
      data-oysterun-clean-session-media-staged-preview="image_local_object_url_no_upload"
    />
  );
}

type PreviewVideoProps = {
  fileItem: TUploadItem;
};
function PreviewVideo({ fileItem }: PreviewVideoProps) {
  const { originalFile, metadata } = fileItem;
  const fileUrl = useObjectURL(originalFile);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      style={{
        objectFit: 'contain',
        width: '100%',
        height: toRem(152),
        filter: metadata.markedAsSpoiler ? 'blur(44px)' : undefined,
      }}
      src={fileUrl}
      data-oysterun-routec-media-staged-preview="video_local_object_url_no_upload"
      data-oysterun-clean-session-media-staged-preview="video_local_object_url_no_upload"
    />
  );
}

type MediaPreviewProps = {
  fileItem: TUploadItem;
  onSpoiler: (marked: boolean) => void;
  children: ReactNode;
};
function MediaPreview({ fileItem, onSpoiler, children }: MediaPreviewProps) {
  const { originalFile, metadata } = fileItem;
  const fileUrl = useObjectURL(originalFile);

  return fileUrl ? (
    <Box
      style={{
        borderRadius: config.radii.R300,
        overflow: 'hidden',
        backgroundColor: 'black',
        position: 'relative',
      }}
      data-oysterun-routec-media-staged-resource="object_url_revoked_on_unmount"
      data-oysterun-clean-session-media-staged-resource="object_url_revoked_on_unmount"
    >
      {children}
      <Box
        justifyContent="End"
        style={{
          position: 'absolute',
          bottom: config.space.S100,
          left: config.space.S100,
          right: config.space.S100,
        }}
      >
        <Chip
          variant={metadata.markedAsSpoiler ? 'Warning' : 'Secondary'}
          fill="Soft"
          radii="Pill"
          aria-pressed={metadata.markedAsSpoiler}
          before={<Icon src={Icons.EyeBlind} size="50" />}
          onClick={() => onSpoiler(!metadata.markedAsSpoiler)}
        >
          <Text size="B300">Spoiler</Text>
        </Chip>
      </Box>
    </Box>
  ) : null;
}

type UploadCardRendererProps = {
  isEncrypted?: boolean;
  fileItem: TUploadItem;
  setMetadata: (fileItem: TUploadItem, metadata: TUploadMetadata) => void;
  onRemove: (file: TUploadContent) => void;
};
export function UploadCardRenderer({
  isEncrypted,
  fileItem,
  setMetadata,
  onRemove,
}: UploadCardRendererProps) {
  const mediaUploadAvailability = useMediaUploadAvailability();
  const allowSize = mediaUploadAvailability.maxUploadSize;
  const { metadata } = fileItem;
  const { file } = fileItem;
  const uploadUnavailable = !mediaUploadAvailability.enabled;
  const fileSizeExceeded = !uploadUnavailable && file.size >= allowSize;
  const fileTypeLabel = file.type || 'application/octet-stream';
  const localPreviewKind = fileItem.originalFile.type.startsWith('image')
    ? 'image'
    : fileItem.originalFile.type.startsWith('video')
    ? 'video'
    : 'file';

  const handleSpoiler = (marked: boolean) => {
    setMetadata(fileItem, { ...metadata, markedAsSpoiler: marked });
  };

  const removeUpload = () => {
    onRemove(file);
  };

  return (
    <UploadCard
      radii="300"
      before={<Icon src={getFileTypeIcon(Icons, file.type)} />}
      after={
        <IconButton
          onClick={removeUpload}
          aria-label="Cancel Upload"
          variant="SurfaceVariant"
          radii="Pill"
          size="300"
        >
          <Icon src={Icons.Cross} size="200" />
        </IconButton>
      }
      bottom={
        <>
          {fileItem.originalFile.type.startsWith('image') && (
            <MediaPreview fileItem={fileItem} onSpoiler={handleSpoiler}>
              <PreviewImage fileItem={fileItem} />
            </MediaPreview>
          )}
          {fileItem.originalFile.type.startsWith('video') && (
            <MediaPreview fileItem={fileItem} onSpoiler={handleSpoiler}>
              <PreviewVideo fileItem={fileItem} />
            </MediaPreview>
          )}
          {!fileItem.originalFile.type.startsWith('image') &&
            !fileItem.originalFile.type.startsWith('video') && (
              <Box
                direction="Column"
                gap="100"
                data-oysterun-routec-media-staged-preview="file_metadata_no_upload"
                data-oysterun-clean-session-media-staged-preview="file_metadata_no_upload"
                data-oysterun-routec-media-staged-kind={localPreviewKind}
                data-oysterun-clean-session-media-staged-kind={localPreviewKind}
              >
                <Text size="T200" priority="300">
                  {fileTypeLabel}
                </Text>
                <Text size="T200" priority="300">
                  {bytesToSize(file.size)}
                </Text>
              </Box>
            )}
          {uploadUnavailable && (
            <UploadCardError>
              <Text
                size="T200"
                data-oysterun-media-upload-guard="disabled_upload_card_no_upload"
                data-oysterun-media-upload-disabled-reason={mediaUploadAvailability.reason}
              >
                {mediaUploadAvailability.message ?? 'File uploads are unavailable in this chat.'}
              </Text>
            </UploadCardError>
          )}
          {!uploadUnavailable && !fileSizeExceeded && (
            <Text
              size="T200"
              priority="300"
              data-oysterun-routec-media-staged-preview="local_preview_waiting_for_explicit_send_no_upload"
              data-oysterun-clean-session-media-staged-preview="local_preview_waiting_for_explicit_send_no_upload"
              data-oysterun-routec-media-send-commit="explicit_send_uploads_one_staged_file"
              data-oysterun-clean-session-media-send-commit="explicit_send_uploads_one_staged_file"
              data-oysterun-routec-media-staged-kind={localPreviewKind}
              data-oysterun-clean-session-media-staged-kind={localPreviewKind}
            >
              Staged locally for preview. Press Send to upload and send this file.
            </Text>
          )}
          {!uploadUnavailable && fileSizeExceeded && (
            <UploadCardError>
              <Text size="T200">
                The file size exceeds the limit. Maximum allowed size is{' '}
                <b>{bytesToSize(allowSize)}</b>, but the uploaded file is{' '}
                <b>{bytesToSize(file.size)}</b>.
              </Text>
            </UploadCardError>
          )}
        </>
      }
    >
      <Text size="H6" truncate>
        {file.name}
      </Text>
      <Badge
        variant="Secondary"
        fill="Soft"
        radii="Pill"
        data-oysterun-routec-media-staged-preview="single_file_local_preview_no_upload"
        data-oysterun-clean-session-media-staged-preview="single_file_local_preview_no_upload"
        data-oysterun-routec-media-staged-kind={localPreviewKind}
        data-oysterun-clean-session-media-staged-kind={localPreviewKind}
        data-oysterun-routec-media-encrypted-room={isEncrypted ? 'true' : 'false'}
        data-oysterun-clean-session-media-encrypted-room={isEncrypted ? 'true' : 'false'}
      >
        <Text size="L400">Staged</Text>
      </Badge>
    </UploadCard>
  );
}
