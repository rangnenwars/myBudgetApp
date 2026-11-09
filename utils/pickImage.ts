import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { base64ByteLength } from './issues';

export interface PickedImage {
  /** For showing a preview. */
  uri: string;
  /** Base64 (or a data: URL on web), ready to send. */
  data: string;
  mimeType: string;
  bytes: number;
}

export type PickResult = { ok: true; image: PickedImage } | { ok: false; error: string } | { ok: false; cancelled: true };

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const mimeFromAsset = (asset: ImagePicker.ImagePickerAsset): string | undefined => {
  if (asset.mimeType) return asset.mimeType;
  const dataUrl = /^data:([^;,]+)/.exec(asset.uri)?.[1];
  if (dataUrl) return dataUrl;
  const ext = (asset.fileName ?? asset.uri).split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : undefined;
};

/** Lets the user pick one image from their photos, checking its type and size. `what` names it in messages. */
export const pickImage = async (opts: { allowed: readonly string[]; maxBytes: number; what: string; quality?: number }): Promise<PickResult> => {
  try {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return { ok: false, error: `Photo access is needed to add the ${opts.what}. You can allow it in Settings.` };
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: opts.quality ?? 0.8, allowsEditing: false });
    if (result.canceled || !result.assets?.[0]) return { ok: false, cancelled: true };
    const asset = result.assets[0];

    const mimeType = mimeFromAsset(asset);
    if (!mimeType || !opts.allowed.includes(mimeType)) {
      const names = opts.allowed.map((m) => m.replace('image/', '').toUpperCase()).join(', ');
      return { ok: false, error: `The ${opts.what} must be a ${names} image.` };
    }
    // Web returns the image as a data: URL in uri; native returns base64 separately.
    const data = asset.base64 ?? (asset.uri.startsWith('data:') ? asset.uri : null);
    if (!data) return { ok: false, error: 'Could not read that image. Try another one.' };
    const bytes = base64ByteLength(data);
    if (bytes > opts.maxBytes) return { ok: false, error: `That image is ${formatBytes(bytes)}. The ${opts.what} can be at most ${formatBytes(opts.maxBytes)}. Crop it or pick a smaller one.` };
    return { ok: true, image: { uri: asset.uri, data, mimeType, bytes } };
  } catch {
    return { ok: false, error: 'Could not open your photos.' };
  }
};
