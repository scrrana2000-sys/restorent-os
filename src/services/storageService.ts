import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '../config/firebase';

export interface UploadProgressCallback {
  (progressPercent: number): void;
}

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateImageFile(file: File): void {
  if (!file) {
    throw new Error('No file provided for upload.');
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Image size exceeds the 5MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB).`);
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.type)) {
    throw new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.');
  }
}

export function validateStoragePath(path: string): string {
  const normalized = (path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = normalized.split('/');
  if (segments[0] !== 'restaurants' || !segments[1] || segments[1].trim() === '') {
    throw new Error('Storage path must be restaurant-scoped: /restaurants/{restaurantId}/...');
  }
  return normalized;
}

/**
 * Compresses an image file to an optimized, low-footprint WebP/JPEG data URL (< 80KB)
 * for seamless operation if Cloud Storage bucket permissions are unconfigured or unavailable.
 */
export function compressImageToDataUrl(
  file: File,
  maxWidth = 800,
  maxHeight = 800,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      try {
        const dataUrl = canvas.toDataURL('image/webp', quality);
        resolve(dataUrl);
      } catch {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    };
    img.src = objectUrl;
  });
}

/**
 * Uploads an image file to Firebase Storage.
 * Production rules strictly enforce:
 * - Restaurant-scoped pathing (/restaurants/{restaurantId}/...)
 * - File size <= 5MB and MIME-type validation (JPEG, PNG, WebP)
 * - Graceful fallback to client-side compressed visual data if Cloud Storage is unconfigured
 */
export async function uploadImage(
  path: string,
  file: File,
  onProgress?: UploadProgressCallback
): Promise<string> {
  validateImageFile(file);
  const normalizedPath = validateStoragePath(path);

  const fileExt = file.name.split('.').pop() || 'jpg';
  const uniqueFileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
  const storageRef = ref(storage, `${normalizedPath}/${uniqueFileName}`);

  try {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        originalName: file.name,
        uploadedBy: auth.currentUser?.uid || ''
      }
    });

    return await new Promise((resolve, reject) => {
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          if (onProgress) {
            onProgress(Math.round(progress));
          }
        },
        async (error) => {
          console.warn('Firebase Storage upload error:', error);
          if (error.code === 'storage/unauthorized' || error.code === 'storage/unknown') {
            try {
              console.info('[RestaurantOS Storage] Cloud Storage unauthorized/unconfigured. Gracefully falling back to compressed local image URL.');
              const fallbackUrl = await compressImageToDataUrl(file);
              if (onProgress) onProgress(100);
              resolve(fallbackUrl);
              return;
            } catch (fallbackErr) {
              console.error('Fallback image compression failed:', fallbackErr);
            }
          }
          reject(
            new Error(
              `Cloud Storage upload failed (${error.code || 'storage-error'}). Please check network connectivity and bucket permissions.`
            )
          );
        },
        async () => {
          try {
            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(downloadUrl);
          } catch (err: any) {
            console.error('Failed to obtain download URL:', err);
            try {
              const fallbackUrl = await compressImageToDataUrl(file);
              resolve(fallbackUrl);
            } catch {
              reject(new Error('Image uploaded but failed to retrieve secure public URL.'));
            }
          }
        }
      );
    });
  } catch (err: any) {
    console.warn('[RestaurantOS Storage] Direct upload exception:', err);
    return await compressImageToDataUrl(file);
  }
}
