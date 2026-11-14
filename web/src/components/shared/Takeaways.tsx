// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/** What to take away: tab 0 lists it up front, and tab 6 closes the hands-on with it. */
export function Takeaways() {
  return (
    <ul className="start-takeaways">
      <li>
        <b>A similarity search finds what sounds alike.</b> Search the catalog for white sneakers and you get more white sneakers. What the stylists wear with them is a relationship
        between looks, and you follow it in the graph.
      </li>
      <li>
        <b>Every GraphRAG suggestion has a source.</b> Each one links to the brand&apos;s own looks: the receipts.
      </li>
      <li>
        <b>The photos already hold the stylists&apos; taste.</b> A vision model and an ontology turn photos and texts into a graph you can count and query.
      </li>
      <li>
        <b>Questions and photos take the same path, in any aisle.</b> You can start from either. Beauty, home or food use the same shape with another ontology.
      </li>
      <li>
        <b>The graph is a new data source.</b> Buyers, merchandisers and creative directors ask it their own questions too.
      </li>
    </ul>
  );
}
