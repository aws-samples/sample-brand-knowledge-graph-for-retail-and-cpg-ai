// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/** The form the API sends photos in (previews.py `_photo`): a base64 data URL of a raster image. */
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/** `url` if it is a base64 PNG, JPEG, WebP or GIF data URL, else undefined (no links, no SVG, no script). */
export function safeImageUrl(url: string | undefined): string | undefined {
  return url !== undefined && DATA_IMAGE.test(url) ? url : undefined;
}
