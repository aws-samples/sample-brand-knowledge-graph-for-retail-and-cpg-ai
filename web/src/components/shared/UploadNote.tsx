// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The line next to every upload control: what may be uploaded. An upload goes to the model you pick
 * and, in tab 2, into the graph (docs/security.md, "Models and the text they read").
 */
export function UploadNote({ texts = false }: { texts?: boolean }) {
  return (
    <p className="muted small upload-note">
      {texts ? 'Use only photos and texts about clothing' : 'Use only photos of clothing'}, with no people you can identify and no personal, customer or confidential information.
    </p>
  );
}
