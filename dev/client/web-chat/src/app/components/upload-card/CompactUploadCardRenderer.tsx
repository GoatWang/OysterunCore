import React, { useEffect } from 'react';
import { Chip, Icon, IconButton, Icons, Text, color } from 'folds';
import { UploadCard, UploadCardError, CompactUploadCardProgress } from './UploadCard';
import { TUploadAtom, UploadStatus, UploadSuccess, useBindUploadAtom } from '../../state/upload';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { TUploadContent } from '../../utils/matrix';
import { bytesToSize, getFileTypeIcon } from '../../utils/common';
import { useMediaUploadAvailability } from '../../hooks/useMediaConfig';

type CompactUploadCardRendererProps = {
  isEncrypted?: boolean;
  uploadAtom: TUploadAtom;
  onRemove: (file: TUploadContent) => void;
  onComplete?: (upload: UploadSuccess) => void;
};
export function CompactUploadCardRenderer({
  isEncrypted,
  uploadAtom,
  onRemove,
  onComplete,
}: CompactUploadCardRendererProps) {
  const mx = useMatrixClient();
  const mediaUploadAvailability = useMediaUploadAvailability();
  const allowSize = mediaUploadAvailability.maxUploadSize;

  const { upload, startUpload, cancelUpload } = useBindUploadAtom(mx, uploadAtom, isEncrypted);
  const { file } = upload;
  const uploadUnavailable = !mediaUploadAvailability.enabled;
  const fileSizeExceeded = !uploadUnavailable && file.size >= allowSize;

  if (upload.status === UploadStatus.Idle && !uploadUnavailable && !fileSizeExceeded) {
    startUpload();
  }

  const removeUpload = () => {
    cancelUpload();
    onRemove(file);
  };

  useEffect(() => {
    if (uploadUnavailable && upload.status === UploadStatus.Loading) {
      cancelUpload();
    }
  }, [uploadUnavailable, upload.status, cancelUpload]);

  useEffect(() => {
    if (!uploadUnavailable && upload.status === UploadStatus.Success) {
      onComplete?.(upload);
    }
  }, [uploadUnavailable, upload, onComplete]);

  return (
    <UploadCard
      compact
      outlined
      radii="300"
      before={<Icon src={getFileTypeIcon(Icons, file.type)} />}
      after={
        <>
          {upload.status === UploadStatus.Error && !uploadUnavailable && (
            <Chip
              as="button"
              onClick={startUpload}
              aria-label="Retry Upload"
              variant="Critical"
              radii="Pill"
              outlined
            >
              <Text size="B300">Retry</Text>
            </Chip>
          )}
          <IconButton
            onClick={removeUpload}
            aria-label="Cancel Upload"
            variant="SurfaceVariant"
            radii="Pill"
            size="300"
          >
            <Icon src={Icons.Cross} size="200" />
          </IconButton>
        </>
      }
    >
      {upload.status === UploadStatus.Success ? (
        <>
          <Text size="H6" truncate>
            {file.name}
          </Text>
          <Icon style={{ color: color.Success.Main }} src={Icons.Check} size="100" />
        </>
      ) : (
        <>
          {uploadUnavailable && (
            <UploadCardError>
              <Text
                size="T200"
                data-oysterun-media-upload-guard="disabled_compact_upload_card_no_upload"
                data-oysterun-media-upload-disabled-reason={mediaUploadAvailability.reason}
              >
                {mediaUploadAvailability.message ?? 'File uploads are unavailable in this chat.'}
              </Text>
            </UploadCardError>
          )}
          {!uploadUnavailable && upload.status === UploadStatus.Idle && !fileSizeExceeded && (
            <CompactUploadCardProgress sentBytes={0} totalBytes={file.size} />
          )}
          {!uploadUnavailable && upload.status === UploadStatus.Loading && (
            <CompactUploadCardProgress sentBytes={upload.progress.loaded} totalBytes={file.size} />
          )}
          {!uploadUnavailable && upload.status === UploadStatus.Error && (
            <UploadCardError>
              <Text size="T200">{upload.error.message}</Text>
            </UploadCardError>
          )}
          {!uploadUnavailable && upload.status === UploadStatus.Idle && fileSizeExceeded && (
            <UploadCardError>
              <Text size="T200">
                The file size exceeds the limit. Maximum allowed size is{' '}
                <b>{bytesToSize(allowSize)}</b>, but the uploaded file is{' '}
                <b>{bytesToSize(file.size)}</b>.
              </Text>
            </UploadCardError>
          )}
        </>
      )}
    </UploadCard>
  );
}
