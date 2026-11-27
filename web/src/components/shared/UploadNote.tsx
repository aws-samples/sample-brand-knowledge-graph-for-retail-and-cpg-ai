// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The line next to every upload control: what may be uploaded. An upload goes to the model you pick
 * and, in tab 2, into the graph (docs/security.md, "Models and the text they read"). `hidden`
 * keeps the line for screen readers only (tab 1, where the upload tile's title carries it) and `id`
 * lets the control point at it with aria-describedby.
 */
export function UploadNote({ texts = false, hidden = false, id }: { texts?: boolean; hidden?: boolean; id?: string }) {
  return (
    <p className={`muted small upload-note${hidden ? ' sr-only' : ''}`} id={id}>
      {texts ? 'Use only photos and texts about clothing' : 'Use only photos of clothing'}, with no people you can identify and no personal, customer or confidential information.
    </p>
  );
}
