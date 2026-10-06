/**
 * Camera/library proof capture using the Action Network's existing private
 * media bucket. No proof file is made public by this helper; verification and
 * optional feed sharing remain separate server-side decisions.
 */
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  useMcc,
} from './mcc';

function storagePath(path: string) {
  return String(path || '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

function guessedName(asset: ImagePicker.ImagePickerAsset, mime: string) {
  if (asset.fileName) return asset.fileName;
  const ext =
    mime === 'image/png'
      ? 'png'
      : mime === 'image/heic'
        ? 'heic'
        : mime.startsWith('image/')
          ? 'jpg'
          : mime === 'video/quicktime'
            ? 'mov'
            : 'mp4';
  return `mission-proof-${Date.now()}.${ext}`;
}

export async function takeMissionProof(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera permission is required to record proof.');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images', 'videos'],
    allowsEditing: false,
    quality: 0.9,
    videoMaxDuration: 90,
  });
  return result.canceled ? null : result.assets?.[0] || null;
}

export async function recoverPendingMissionProof(): Promise<ImagePicker.ImagePickerAsset | null> {
  const pending = await ImagePicker.getPendingResultAsync();
  if (!pending || !('canceled' in pending) || pending.canceled) return null;
  return pending.assets?.[0] || null;
}

export async function chooseMissionProof(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photo library permission is required to choose proof.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsEditing: false,
    quality: 0.9,
    selectionLimit: 1,
  });
  return result.canceled ? null : result.assets?.[0] || null;
}

export function useProofMedia() {
  const { api, accessToken } = useMcc();

  async function upload(asset: ImagePicker.ImagePickerAsset) {
    let mime =
      asset.mimeType ||
      (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
    let uri = asset.uri;
    let width = asset.width || null;
    let height = asset.height || null;
    let fileName = guessedName(asset, mime);

    const looksHeic =
      asset.type === 'image' &&
      (/^image\/hei[cf]$/i.test(mime) || /\.(hei[cf])$/i.test(asset.fileName || ''));
    if (looksHeic) {
      const converted = await ImageManipulator.manipulateAsync(
        asset.uri,
        [],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      uri = converted.uri;
      width = converted.width || width;
      height = converted.height || height;
      mime = 'image/jpeg';
      fileName = (asset.fileName || `mission-proof-${Date.now()}`)
        .replace(/\.(hei[cf])$/i, '') + '.jpg';
    }

    const blob = await fetch(uri).then((r) => {
      if (!r.ok) throw new Error('The selected proof file could not be opened.');
      return r.blob();
    });
    const byteSize = Number(looksHeic ? blob.size : asset.fileSize || blob.size || 0);
    if (!byteSize) throw new Error('The selected proof file has no readable size.');

    const grant: any = await api('/v1/mnet/media/upload-url', {
      method: 'POST',
      body: {
        file_name: fileName,
        mime_type: mime,
        byte_size: byteSize,
      },
    });

    const path = grant?.upload?.path;
    const uploadToken = grant?.upload?.token;
    const reserved = grant?.asset;
    if (!path || !reserved?.id) throw new Error('The upload slot was not created.');

    const token = await accessToken();
    const url = uploadToken
      ? `${SUPABASE_URL}/storage/v1/object/upload/sign/mnet-media/${storagePath(path)}?token=${encodeURIComponent(uploadToken)}`
      : `${SUPABASE_URL}/storage/v1/object/mnet-media/${storagePath(path)}`;

    const response = await fetch(url, {
      method: uploadToken ? 'PUT' : 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${token}`,
        'content-type': mime,
        'x-upsert': 'false',
      },
      body: blob,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      await api('/v1/mnet/media/discard', {
        method: 'POST',
        body: { asset_id: reserved.id },
      }).catch(() => null);
      throw new Error(`Upload rejected (${response.status})${detail ? `: ${detail}` : ''}`);
    }

    try {
      const finalized: any = await api('/v1/mnet/media/finalize', {
        method: 'POST',
        body: {
          asset_id: reserved.id,
          width,
          height,
          duration_ms: asset.duration || null,
        },
      });
      return {
        asset: finalized?.asset || reserved,
        proofType: asset.type === 'video' ? 'video' : 'photo',
      };
    } catch (error) {
      await api('/v1/mnet/media/discard', {
        method: 'POST',
        body: { asset_id: reserved.id },
      }).catch(() => null);
      throw error;
    }
  }

  async function discard(assetId: string) {
    if (!assetId) return;
    await api('/v1/mnet/media/discard', { method: 'POST', body: { asset_id: assetId } });
  }

  return { upload, discard };
}
