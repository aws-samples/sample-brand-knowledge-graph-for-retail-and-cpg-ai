// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, isStoredPhotoKey } from '../../api';

// One request per photo for the whole session: a product appears in several stages and columns.
const cache = new Map<string, Promise<string | null>>();

/** The data URL of one of the brand's stored photos (`GET /api/photo`), or null when it is not stored. */
export function loadStoredPhoto(key: string): Promise<string | null> {
  let p = cache.get(key);
  if (!p) {
    p = api.photo(key).then(
      (r) => r.data_url,
      () => null,
    );
    cache.set(key, p);
  }
  return p;
}

/**
 * A product shot or a look photo by its stable key (`<set>/<sub>/<file>`), loaded lazily, and a quiet
 * placeholder while it loads or when it is missing. For a key that is not a stored photo (a product of
 * a catalog without photos) it renders nothing, or with `noPhoto="placeholder"` a square of the same
 * size that says so: a list that mixes products with and without photos keeps its rows aligned, and
 * the gap reads as "no photo", not as a photo that failed to load.
 */
export function StoredPhoto({ photoKey, alt, className = 'stored-photo', noPhoto = 'nothing' }: { photoKey?: string; alt: string; className?: string; noPhoto?: 'nothing' | 'placeholder' }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isStoredPhotoKey(photoKey)) return;
    let live = true;
    setSrc(undefined);
    loadStoredPhoto(photoKey).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [photoKey]);
  if (!isStoredPhotoKey(photoKey)) {
    if (noPhoto === 'nothing') return null;
    return <span className={`${className} placeholder no-photo`} role="img" aria-label={`${alt}: no photo in the catalog`} title="No photo in the catalog" />;
  }
  if (!src) return <span className={`${className} placeholder`} role="img" aria-label={src === null ? `${alt}: no photo stored` : `${alt}: loading`} />;
  return <img className={className} src={src} alt={alt} loading="lazy" />;
}
