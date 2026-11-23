// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * What to take away, as the techniques a participant learns: tab 0 lists it up front, and tab 6
 * closes the hands-on with it.
 */
export function Takeaways() {
  return (
    <ul className="start-takeaways">
      <li>
        <b>An ontology breaks outfits down into consistent, countable terms.</b> A vision model describes every photo with the ontology&apos;s terms only, so the same garment gets the
        same name in every look, and you can count it.
      </li>
      <li>
        <b>Graph data is what makes GraphRAG work.</b> The retriever walks from a garment to the looks it is in, and every suggestion comes with the look it came from as its source.
      </li>
      <li>
        <b>The same graph answers the business&apos;s own questions.</b> The buyer asks what the stylists use that the brand does not sell, the merchandiser asks which pairings are
        the brand&apos;s signature, and the creative director asks whether a new photo is on-brand.
      </li>
    </ul>
  );
}
