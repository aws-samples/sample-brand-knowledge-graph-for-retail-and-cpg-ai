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
 * A product shot or a look photo by its stable key (`<set>/<sub>/<file>`), loaded lazily. Renders nothing
 * for a key that is not a stored photo, and a quiet placeholder while it loads or when it is missing.
 */
export function StoredPhoto({ photoKey, alt, className = 'stored-photo' }: { photoKey?: string; alt: string; className?: string }) {
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
  if (!isStoredPhotoKey(photoKey)) return null;
  if (!src) return <span className={`${className} placeholder`} role="img" aria-label={src === null ? `${alt}: no photo stored` : `${alt}: loading`} />;
  return <img className={className} src={src} alt={alt} loading="lazy" />;
}
