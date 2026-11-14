// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useRef, useState } from 'react';
import { fileToDataUrl } from '../api';

/** Image picker returning a data URL (base64); the API accepts data URLs directly. `label` says what to drop, in the domain's words. */
export function ImageDrop({ onImage, label }: { onImage: (dataUrl: string, file: File) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState('');

  async function handle(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const url = await fileToDataUrl(file);
    setPreview(url);
    onImage(url, file);
  }

  return (
    <div
      className="dropzone"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        handle(e.dataTransfer.files?.[0]);
      }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
      aria-label="choose an image"
    >
      {preview ? <img src={preview} alt="the selected photo" /> : <span>{label}</span>}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => handle(e.target.files?.[0])} />
    </div>
  );
}
