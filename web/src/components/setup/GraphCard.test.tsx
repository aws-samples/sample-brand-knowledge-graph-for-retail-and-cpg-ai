// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SetupStatus } from '../../api';
import { GraphCard } from './GraphCard';
import { visibleText } from '../../visibleText';

/** Tab 0's graph card: the line that says the graph is private and names its VPC and endpoint (`graph.network` of `GET /api/setup`). */
const status = (network: SetupStatus['graph']['network']) =>
  ({
    region: 'us-east-1',
    identity: { account: null, arn: null, source: "the stack's execution role" },
    catalog: { dimension: 1024 },
    graph: {
      active: 'neptune',
      graph_id: 'g-abc123',
      neptune: { graph_id: 'g-abc123', status: 'AVAILABLE', nodes: 1000, edges: 2000 },
      network,
    },
  }) as unknown as SetupStatus;

const network = { vpc_id: 'vpc-0123456789abcdef0', endpoint_id: 'vpce-0fedcba9876543210' };
const render = (s: SetupStatus) => renderToStaticMarkup(<GraphCard s={s} />);
/** The card as a reader sees it: tags dropped, the escaped characters back. */
const text = (html: string) => visibleText(html);

describe('GraphCard', () => {
  it('says the graph is private and names the VPC and the endpoint', () => {
    const html = render(status(network));
    expect(text(html)).toContain(
      'Private: reachable only from VPC vpc-0123456789abcdef0, through endpoint vpce-0fedcba9876543210; the counts above came through it. The stack reaches the other AWS services through a regional NAT gateway.',
    );
    expect(html).toContain('<code>vpc-0123456789abcdef0</code>');
    expect(html).toContain('<code>vpce-0fedcba9876543210</code>');
    // the line comes after the counts it speaks of
    expect(html.indexOf('2,000 edges')).toBeLessThan(html.indexOf('Private: reachable'));
  });

  it('has no private line on a stack without a VPC', () => {
    const html = render(status(null));
    expect(html).toContain('g-abc123');
    expect(html).not.toContain('Private:');
    expect(html).not.toContain('NAT gateway');
  });
});
