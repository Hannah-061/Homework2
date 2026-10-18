import { AppError, LIMITS } from '../services/ChatService';

export interface ImageSize {
  width: number;
  height: number;
}

/** 讀出圖片寬高；解不開就當作不是合法圖片 */
export async function readImageSize(file: Blob): Promise<ImageSize> {
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    throw new AppError('IMAGE_TYPE_NOT_ALLOWED');
  }
}

/** 檔案類型與大小的基本檢查（在前端擋一次；真後台會再擋一次） */
export function checkImageFile(file: File): void {
  if (!LIMITS.imageTypes.includes(file.type)) throw new AppError('IMAGE_TYPE_NOT_ALLOWED');
  if (file.size > LIMITS.imageMaxBytes) throw new AppError('IMAGE_TOO_LARGE');
}

const OUT_MAX_SIDE = 1600;

/**
 * 送出前先在使用者的裝置上處理圖片：
 * 1. 檢查類型、大小、尺寸（避免「檔案很小但解開來是上億像素」的圖片炸彈）
 * 2. JPG／PNG／WebP 重新繪製再輸出：照片裡的 GPS 等 EXIF 資訊會跟著消失，檔案也會變小
 * 3. GIF 為了保留動畫，不重新繪製，原檔送出
 */
export async function prepareImage(file: File): Promise<File> {
  checkImageFile(file);
  const size = await readImageSize(file);
  if (size.width > LIMITS.imageMaxSide || size.height > LIMITS.imageMaxSide) {
    throw new AppError('IMAGE_TOO_LARGE');
  }
  if (file.type === 'image/gif') return file;

  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, OUT_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close();
    throw new AppError('IMAGE_TYPE_NOT_ALLOWED');
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const outType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, 0.85));
  if (!blob) throw new AppError('IMAGE_TYPE_NOT_ALLOWED');
  if (blob.size > LIMITS.imageMaxBytes) throw new AppError('IMAGE_TOO_LARGE');
  const ext = outType === 'image/png' ? 'png' : outType === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], `image.${ext}`, { type: outType });
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
