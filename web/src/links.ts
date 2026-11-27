// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Whether a value that came from data (an ontology's `dcterms:source`, for instance) may be
 * rendered as a link: only http(s) URLs are. Anything else (a `javascript:` or `data:` URL, a bare
 * name, a file path) is shown as text, so a crafted ontology cannot plant a link that runs code.
 */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
