// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { OntologyStudio } from './studio/OntologyStudio';

/** Tab 1, "What the model sees": the ontology studio, in steps, on the domain chosen in tab 0. */
export function Explorer({ domain }: { domain: string }) {
  return <OntologyStudio domain={domain} />;
}
