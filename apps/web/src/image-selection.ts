export const IMAGE_FILE_LIMIT = 5 * 1024 * 1024;
export function imageFileError(file: File): string | undefined {
  if (!file.size) return 'Choose a non-empty image file.';
  if (file.size > IMAGE_FILE_LIMIT)
    return 'Choose an image no larger than 5 MiB.';
  if (
    file.type &&
    ![
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/octet-stream',
    ].includes(file.type)
  )
    return 'Choose a JPEG, PNG, or WebP image.';
}
/** A view owns one local URL. Never persist the file or its URL. */
export class ImagePreview {
  private url: string | undefined;
  constructor(private readonly urls = URL) {}
  replace(file: File) {
    this.clear();
    this.url = this.urls.createObjectURL(file);
    return this.url;
  }
  clear() {
    if (this.url) this.urls.revokeObjectURL(this.url);
    this.url = undefined;
  }
}
