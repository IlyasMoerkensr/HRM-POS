'use client';

/**
 * Verkleint een foto in de browser tot max. `max` px (lange zijde) vóór het
 * uploaden. Een telefoonfoto van 4 MB wordt zo ±40 kB: snel, en de database blijft klein.
 */
export async function resizeImage(file: File, max = 512): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Deze foto kan de browser niet openen. Gebruik JPG of PNG.'));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Verkleinen mislukt');
    ctx.drawImage(img, 0, 0, w, h);

    const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    const webp = await toBlob('image/webp');
    if (webp && webp.type === 'image/webp') return webp;
    // Browsers zonder WebP: JPEG op witte achtergrond
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const jpeg = await toBlob('image/jpeg');
    if (!jpeg) throw new Error('Verkleinen mislukt');
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
  }
}
