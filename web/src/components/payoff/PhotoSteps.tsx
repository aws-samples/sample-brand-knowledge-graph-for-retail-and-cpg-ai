// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { GraphColumn } from '../../api';
import { Inspect } from './parts';

/**
 * How GraphRAG found the way in from a photo (payoff.photo_graphrag), in plain steps: the photo
 * embedded with the same model as a question, the same vector search on the graph's garments, the
 * same traversal, and the filter when the question asks for one kind of piece.
 */
export function PhotoSteps({ graph, photo }: { graph: GraphColumn; photo: string | null }) {
  const way = graph.photo_way_in;
  if (!way) return null;
  const target = graph.target;
  return (
    <>
      <ol className="small rt-under po-photo-steps">
        <li>
          {photo && <img className="po-photo-thumb" src={photo} alt="your photo" />}
          <b>Your photo, embedded</b> with the same model as a question: {way.vector.dimension.toLocaleString()} numbers.
        </li>
        <li>
          <b>The same vector search on the graph:</b> {way.garments} garments within {way.band} of the closest, “{way.label}”.
        </li>
        {way.find && (
          <li>
            <b>The model read the question.</b> Looking for: <b>{way.find}</b>
          </li>
        )}
        <li>
          {target ? (
            <>
              <b>The same traversal:</b> {target.looks_before} look{target.looks_before === 1 ? '' : 's'}. Keeping only the ones with {target.find}: <b>{target.looks_after}</b>.
            </>
          ) : (
            <>
              <b>The same traversal:</b> {way.looks} look{way.looks === 1 ? '' : 's'} with garments like it.
            </>
          )}
        </li>
        {(graph.notes ?? []).length > 0 && (
          <li>
            <b>Told the model:</b> {graph.notes!.join(' ')}
          </li>
        )}
      </ol>
      <Inspect
        title="Inspect: the photo's way in"
        parts={[
          ['the photo as a vector (first numbers)', `[${way.vector.first.join(', ')}, …]  (${way.vector.dimension} numbers)`],
          ['the vector search on Neptune (openCypher)', way.query],
          ...(way.find ? ([['reading the question: what is looked for', `${way.find_inspect.user}\n\nReply: ${way.find_inspect.reply}`]] as [string, string][]) : []),
        ]}
      />
    </>
  );
}
