'use client';

import { useEffect, useRef, useState } from 'react';
import type { CapturedPhoto } from './photo-input';

/** Preview URLs belong to the whole form, not to a single evidence step. */
export function useCapturedPhotos() {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const current = new Set(photos.map((photo) => photo.url));
    for (const url of urls.current) if (!current.has(url)) URL.revokeObjectURL(url);
    urls.current = current;
  }, [photos]);
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  return [photos, setPhotos] as const;
}
