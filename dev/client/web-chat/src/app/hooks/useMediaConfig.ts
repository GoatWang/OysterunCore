import { createContext, useContext } from 'react';

export interface MediaConfig {
  [key: string]: unknown;
  'm.upload.size'?: number;
  media_config_loaded?: boolean;
  media_upload_enabled?: boolean;
  media_upload_unavailable_reason?: string;
}

export type MediaUploadAvailability = {
  enabled: boolean;
  maxUploadSize: number;
  reason?: 'media_config_unavailable' | 'media_upload_disabled' | 'upload_size_zero';
  message?: string;
};

const MEDIA_CONFIG_UNAVAILABLE_MESSAGE =
  'File uploads are unavailable while media configuration is loading.';
const MEDIA_UPLOAD_DISABLED_MESSAGE = 'File uploads are unavailable in this chat.';
const MEDIA_UPLOAD_SIZE_ZERO_MESSAGE = 'File uploads are disabled by this server.';

export function getMediaUploadAvailability(mediaConfig: MediaConfig): MediaUploadAvailability {
  if (mediaConfig.media_config_loaded === false) {
    return {
      enabled: false,
      maxUploadSize: 0,
      reason: 'media_config_unavailable',
      message:
        typeof mediaConfig.media_upload_unavailable_reason === 'string'
          ? mediaConfig.media_upload_unavailable_reason
          : MEDIA_CONFIG_UNAVAILABLE_MESSAGE,
    };
  }

  if (mediaConfig.media_upload_enabled === false) {
    return {
      enabled: false,
      maxUploadSize: 0,
      reason: 'media_upload_disabled',
      message: MEDIA_UPLOAD_DISABLED_MESSAGE,
    };
  }

  const uploadSize = mediaConfig['m.upload.size'];
  if (typeof uploadSize === 'number' && Number.isFinite(uploadSize) && uploadSize <= 0) {
    return {
      enabled: false,
      maxUploadSize: 0,
      reason: 'upload_size_zero',
      message: MEDIA_UPLOAD_SIZE_ZERO_MESSAGE,
    };
  }

  return {
    enabled: true,
    maxUploadSize:
      typeof uploadSize === 'number' && Number.isFinite(uploadSize) ? uploadSize : Infinity,
  };
}

const MediaConfigContext = createContext<MediaConfig | null>(null);

export const MediaConfigProvider = MediaConfigContext.Provider;

export function useMediaConfig(): MediaConfig {
  const mediaConfig = useContext(MediaConfigContext);
  if (!mediaConfig) throw new Error('Media configs are not provided!');
  return mediaConfig;
}

export function useMediaUploadAvailability(): MediaUploadAvailability {
  return getMediaUploadAvailability(useMediaConfig());
}
