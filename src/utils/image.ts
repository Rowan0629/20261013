import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '../limits';
import { ChatError } from '../errors';

/** 看檔案開頭的幾個位元組，判斷它「真的是」哪種圖片（不只看副檔名） */
async function sniffType(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** 選圖或貼上圖片時的檢查。不合格會丟出 ChatError */
export async function checkImage(file: File): Promise<void> {
  if (file.size > MAX_IMAGE_BYTES) throw new ChatError('image_too_large');
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) throw new ChatError('image_type_not_allowed');
  const real = await sniffType(file);
  if (!real || !ALLOWED_IMAGE_TYPES.includes(real)) throw new ChatError('image_type_not_allowed');
}

/** 2.1 MB */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
