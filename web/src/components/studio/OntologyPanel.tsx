// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useMemo, type ReactNode } from 'react';
import type { OntoNode, OntologyDetail } from '../../api';
import type { Box } from './ImageCanvas';
import { localName } from './OntologyGraph';

/**
 * Everything the ontology says about the element selected (in the graph, a search hit, a box in
 * the image): hierarchy, properties with their ranges, the classes it is connected to, allowed
 * values. Every name is a chip that selects that element in turn, so the panel doubles as a way
 * to walk the ontology. Tab 1's step 1 shows it inline.
 */
export function OntologyDetails({
  detail,
  node,
  hitCount,
  onNavigate,
  id = 'ontology-panel',
  hint = 'Search a word above, or click a name in the map. Its definition, details and allowed values show here.',
}: {
  detail: OntologyDetail | null;
  node: OntoNode | null;
  /** Boxes on the photo that use the element; null where there is no photo (the other retail domains of step 4). */
  hitCount: number | null;
  onNavigate: (node: OntoNode | null) => void;
  id?: string;
  hint?: string;
}) {
  const index = useMemo(() => (detail ? buildIndex(detail) : null), [detail]);
  if (!detail || !index) return null;
  const selected = node && index.byId.get(node.id) ? index.byId.get(node.id)! : null;
  return (
    <div className="element-details" id={id}>
      {!selected ? (
        <p className="hint">{hint}</p>
      ) : selected.kind === 'class' ? (
        <ClassDetails node={selected} index={index} hitCount={hitCount} onNavigate={onNavigate} />
      ) : selected.kind === 'individual' ? (
        <ValueDetails node={selected} index={index} hitCount={hitCount} onNavigate={onNavigate} />
      ) : (
        <PropertyDetails node={selected} index={index} hitCount={hitCount} onNavigate={onNavigate} />
      )}
    </div>
  );
}

/**
 * One box of the photo, named with the ontology's terms, as the same flow as step 1: the kind the model
 * chose (and what it is a kind of), then one arrow per detail to the value it picked, and the parts
 * it found. A part box shows its garment ─ relation → the part. Anything the model said that has no
 * ontology term is listed apart. Every name opens its details in step 1.
 */
export function BoxInOntology({ detail, box, onNavigate }: { detail: OntologyDetail | null; box: Box; onNavigate: (node: OntoNode | null) => void }) {
  const index = useMemo(() => (detail ? buildIndex(detail) : null), [detail]);
  if (!detail || !index) return null;
  const e = box.entity;
  const kind = e.class_iri ? index.byId.get(e.class_iri) : undefined;
  const kindBox = (label: string, iri: string | null | undefined, text: string) => (
    <FlowBox label={label}>
      {iri && index.byId.get(iri) ? <Chips ids={[iri]} index={index} onNavigate={onNavigate} /> : <span className="badge warn">{text}: not in the ontology</span>}
      {iri && ancestors(iri, index).length > 0 && (
        <div className="muted small">
          a kind of <Chips ids={ancestors(iri, index)} index={index} onNavigate={onNavigate} separator=" → " />
        </div>
      )}
    </FlowBox>
  );

  if (box.kind === 'part' && box.part) {
    const rel = box.part.relation_iri ? index.byId.get(box.part.relation_iri) : undefined;
    return (
      <div className="box-onto">
        <p className="small" style={{ marginTop: 0 }}>
          <b>{box.part.label || box.part.class}</b>, a part of the {e.label || e.class}:
        </p>
        {rel ? (
          <Flow prop={rel} onNavigate={onNavigate} left={kindBox('the garment', e.class_iri, e.class)} right={kindBox('the part', box.part.class_iri, box.part.class)} />
        ) : (
          <div className="connects">
            {kindBox('the garment', e.class_iri, e.class)}
            <div className="arrow">─ {box.part.relation} →</div>
            {kindBox('the part', box.part.class_iri, box.part.class)}
          </div>
        )}
      </div>
    );
  }

  const details = Object.entries(e.attribute_iris)
    .map(([p, v]) => ({ prop: index.byId.get(p), value: v }))
    .filter((d): d is { prop: OntoNode; value: string } => !!d.prop);
  const named = new Set(details.map((d) => localName(d.prop.id).toLowerCase()));
  const loose = Object.entries(e.attributes).filter(([k]) => !named.has(k.toLowerCase()) && !named.has(`has${k}`.toLowerCase()));
  const hasPart = index.props.find((p) => localName(p.id) === 'hasPart');
  return (
    <div className="box-onto">
      <p className="small" style={{ marginTop: 0 }}>
        <b>{e.label || e.class}</b>, as the model named it:
      </p>
      <div className="connects-hub">
        <div className="connects-hub-self">{kindBox('the kind', kind?.id ?? e.class_iri, e.class)}</div>
        <div className="connects-hub-rows">
          {details.map(({ prop, value }) => (
            <Flow
              key={prop.id}
              prop={prop}
              onNavigate={onNavigate}
              left={null}
              right={
                <FlowBox label="the value">
                  {index.byId.get(value) ? <Chips ids={[value]} index={index} onNavigate={onNavigate} plain /> : <code>{value}</code>}
                </FlowBox>
              }
            />
          ))}
          {e.parts.length > 0 && hasPart && (
            <Flow
              prop={hasPart}
              onNavigate={onNavigate}
              left={null}
              right={
                <FlowBox label={`parts (${e.parts.length})`}>
                  <Chips ids={Array.from(new Set(e.parts.map((p) => p.class_iri).filter(Boolean)))} index={index} onNavigate={onNavigate} />
                </FlowBox>
              }
            />
          )}
          {!details.length && !e.parts.length && <p className="muted small">The model gave no details for this one.</p>}
        </div>
      </div>
      {loose.length > 0 && (
        <p className="muted small" style={{ margin: '0.5rem 0 0' }}>
          Also said, with no ontology term:{' '}
          {loose.map(([k, v]) => (
            <span key={k}>
              <code>{k}</code> = {v}{' '}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ index over the view
type Index = {
  byId: Map<string, OntoNode>;
  parents: Map<string, string[]>; // class -> direct superclasses
  children: Map<string, string[]>; // class -> direct subclasses
  members: Map<string, string[]>; // class -> individuals
  types: Map<string, string[]>; // individual -> classes
  props: OntoNode[];
  subProps: Map<string, string[]>; // property -> sub-properties
};

function buildIndex(detail: OntologyDetail): Index {
  const byId = new Map(detail.view.nodes.map((n) => [n.id, n]));
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const members = new Map<string, string[]>();
  const types = new Map<string, string[]>();
  const subProps = new Map<string, string[]>();
  for (const e of detail.view.edges) {
    if (e.type === 'subClassOf') {
      push(parents, e.source, e.target);
      push(children, e.target, e.source);
    } else if (e.type === 'type') {
      push(members, e.target, e.source);
      push(types, e.source, e.target);
    } else if (e.type === 'subPropertyOf') {
      push(subProps, e.target, e.source);
    }
  }
  const props = detail.view.nodes.filter((n) => n.kind === 'objectProperty' || n.kind === 'dataProperty');
  return { byId, parents, children, members, types, props, subProps };
}

function ancestors(id: string, index: Index): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur: string | undefined = index.parents.get(id)?.[0];
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = index.parents.get(cur)?.[0];
  }
  return out;
}

function kindLabel(n: OntoNode): string {
  return n.kind === 'individual' ? 'value' : n.kind === 'objectProperty' ? 'object property' : n.kind === 'dataProperty' ? 'data property' : 'class';
}

// ------------------------------------------------------------------ details per kind
type DetailProps = { node: OntoNode; index: Index; hitCount: number | null; onNavigate: (n: OntoNode | null) => void };

/** One box of a "how it connects" flow: a small label, then names. */
function FlowBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="connects-box">
      <div className="connects-label">{label}</div>
      {children}
    </div>
  );
}

/** `left ─ property → right`: how the ontology links two things, the same picture for every element. */
function Flow({ prop, left, right, onNavigate }: { prop: OntoNode; left: ReactNode; right: ReactNode; onNavigate: (n: OntoNode | null) => void }) {
  return (
    <div className="connects">
      {left}
      <div className="arrow">
        ─{' '}
        <button type="button" className="linklike arrow-prop" onClick={() => onNavigate(prop)} title={prop.id}>
          {localName(prop.id)}
        </button>{' '}
        →
      </div>
      {right}
    </div>
  );
}

/** The values a property allows, as plain words: those that name `kind` first (a coat's nicknames: pea coat, trench…), then a few more. */
function sampleValues(index: Index, prop: OntoNode, kind: string, max = 6) {
  const vals = (prop.range ?? []).flatMap((r) => index.members.get(r) ?? []);
  const own = vals.filter((v) => localName(v).toLowerCase().includes(kind));
  return { all: vals, shown: [...own, ...vals.filter((v) => !own.includes(v))].slice(0, max) };
}

function ClassDetails({ node, index, hitCount, onNavigate }: DetailProps) {
  const lineage = ancestors(node.id, index);
  const self = new Set([node.id, ...lineage]);
  // The details of this kind: properties whose domain is it or a kind it inherits from. The model
  // is asked the visual ones; the graph's own (pairsWith, isCategory…) are listed apart.
  // hasAttribute is the parent of every detail, not a detail itself.
  const props = index.props.filter((p) => (p.domain ?? []).some((d) => self.has(d)) && !index.subProps.get(p.id)?.length);
  const asked = props.filter((p) => p.visual !== false);
  const graphOnly = props.filter((p) => p.visual === false);
  // what points at this class (a part: hasPart; a value class: hasLength…), the model's side only
  const pointedBy = index.props.filter((p) => p.visual !== false && !index.subProps.get(p.id)?.length && (p.range ?? []).some((r) => self.has(r)));
  const subs = index.children.get(node.id) ?? [];
  const values = index.members.get(node.id) ?? [];
  const isValueClass = values.length > 0;
  const name = (node.label || localName(node.id)).toLowerCase();
  const me = (
    <FlowBox label={isValueClass ? 'a family of detail' : 'this kind'}>
      <span className={`chip kind-${node.kind} chip-self`}>{localName(node.id)}</span>
      {isValueClass && <div className="muted small">{values.length} values, below</div>}
    </FlowBox>
  );

  return (
    <>
      <Header node={node} kind={isValueClass ? 'value class' : node.visual === false ? 'class (KG schema, hidden from the vision prompt)' : 'entity class'} />
      <p className="small" style={{ margin: '0.3rem 0 0.6rem' }}>
        {lineage.length ? (
          <>
            A kind of <Chips ids={lineage} index={index} onNavigate={onNavigate} separator=" → " />.{' '}
          </>
        ) : (
          <>A top-level class. </>
        )}
        {subs.length ? (
          <>
            More specific kinds ({subs.length}): <Chips ids={subs} index={index} onNavigate={onNavigate} />
          </>
        ) : (
          !isValueClass && <span className="muted">It has no more specific kinds, so the model can answer with it.</span>
        )}
      </p>

      <div className="detail-grid">
        {pointedBy.length > 0 && (
          <Section title="How it connects" wide>
            {pointedBy.map((p) => (
              <Flow
                key={p.id}
                prop={p}
                onNavigate={onNavigate}
                left={
                  <FlowBox label="applies to">
                    <Chips ids={p.domain ?? []} index={index} onNavigate={onNavigate} />
                  </FlowBox>
                }
                right={me}
              />
            ))}
          </Section>
        )}

        {asked.length > 0 && (
          <Section title={`What the model can say about a ${name} (${asked.length})`} wide>
            <div className="connects-hub">
              <div className="connects-hub-self">{me}</div>
              <div className="connects-hub-rows">
                {asked.map((p) => {
                  const { all, shown } = sampleValues(index, p, name);
                  return (
                    <Flow
                      key={p.id}
                      prop={p}
                      onNavigate={onNavigate}
                      left={null}
                      right={
                        <FlowBox label={all.length ? `${all.length} values` : 'answers with'}>
                          {all.length ? (
                            <>
                              <Chips ids={shown} index={index} onNavigate={onNavigate} plain />
                              {all.length > shown.length && <span className="muted"> …</span>}
                            </>
                          ) : (p.range ?? []).length ? (
                            <Chips ids={p.range!} index={index} onNavigate={onNavigate} />
                          ) : (
                            <span className="muted">free text</span>
                          )}
                        </FlowBox>
                      }
                    />
                  );
                })}
              </div>
            </div>
            <p className="muted small" style={{ margin: '0.3rem 0 0' }}>
              Click a detail to see all its values.
            </p>
          </Section>
        )}

        {isValueClass && (
          <Section title={`Allowed values (${values.length})`} wide>
            <Chips ids={values} index={index} onNavigate={onNavigate} max={60} plain />
          </Section>
        )}
      </div>

      {graphOnly.length > 0 && (
        <p className="muted small" style={{ margin: '0.6rem 0 0' }}>
          In the graph, not asked of the model: <Chips ids={graphOnly.map((p) => p.id)} index={index} onNavigate={onNavigate} />
        </p>
      )}
      <Usage hitCount={hitCount} />
    </>
  );
}

function PropertyDetails({ node, index, hitCount, onNavigate }: DetailProps) {
  const subs = index.subProps.get(node.id) ?? [];
  const rangeValues = (node.range ?? []).flatMap((r) => index.members.get(r) ?? []);
  const domain = node.domain ?? [];
  const range = node.range ?? [];
  const literal = node.kind === 'dataProperty';
  return (
    <>
      <Header
        node={node}
        kind={`${kindLabel(node)}${node.symmetric ? ' · symmetric' : ''}${node.visual === false ? ' · KG schema (not offered to the vision model)' : ''}`}
      />
      <div className="detail-grid">
        <Section title="How it connects" wide>
          <Flow
            prop={node}
            onNavigate={onNavigate}
            left={<FlowBox label="applies to">{domain.length ? <Chips ids={domain} index={index} onNavigate={onNavigate} /> : <span className="muted">any kind</span>}</FlowBox>}
            right={
              <FlowBox label="answers with">
                {range.length ? <Chips ids={range} index={index} onNavigate={onNavigate} /> : <span className="muted">{literal ? 'free text or a number' : 'any kind'}</span>}
                {rangeValues.length > 0 && <div className="muted small">one of {rangeValues.length} values, below</div>}
              </FlowBox>
            }
          />
          {((node.super ?? []).length > 0 || subs.length > 0) && (
            <p className="muted small" style={{ margin: '0.5rem 0 0' }}>
              {(node.super ?? []).length > 0 && (
                <>
                  A more specific kind of <Chips ids={node.super!} index={index} onNavigate={onNavigate} />.{' '}
                </>
              )}
              {subs.length > 0 && (
                <>
                  More specific properties: <Chips ids={subs} index={index} onNavigate={onNavigate} />.
                </>
              )}
            </p>
          )}
        </Section>
        {rangeValues.length > 0 && (
          <Section title={`Allowed values (${rangeValues.length})`} wide>
            <p className="muted small" style={{ marginTop: 0 }}>
              For <b>{localName(node.id)}</b> the model must answer with one of these. Any other answer fails the check in step 3.
            </p>
            <Chips ids={rangeValues} index={index} onNavigate={onNavigate} max={48} plain />
          </Section>
        )}
      </div>
      <Usage hitCount={hitCount} />
    </>
  );
}

function ValueDetails({ node, index, hitCount, onNavigate }: DetailProps) {
  const classes = node.types ?? index.types.get(node.id) ?? [];
  const acceptedBy = index.props.filter((p) => (p.range ?? []).some((r) => classes.includes(r)));
  const siblings = classes.flatMap((c) => index.members.get(c) ?? []).filter((v) => v !== node.id);
  return (
    <>
      <Header node={node} kind="value (named individual)" />
      <div className="detail-grid">
        <Section title="How it connects" wide>
          {acceptedBy.length ? (
            acceptedBy.map((p) => (
              <Flow
                key={p.id}
                prop={p}
                onNavigate={onNavigate}
                left={<FlowBox label="applies to">{(p.domain ?? []).length ? <Chips ids={p.domain!} index={index} onNavigate={onNavigate} /> : <span className="muted">any kind</span>}</FlowBox>}
                right={
                  <FlowBox label="answers with">
                    <Chips ids={classes} index={index} onNavigate={onNavigate} />
                    <div>
                      <span className={`chip kind-${node.kind} chip-self`}>{node.label || localName(node.id)}</span> <span className="muted small">one of {siblings.length + 1} values</span>
                    </div>
                  </FlowBox>
                }
              />
            ))
          ) : (
            <p className="muted">No property answers with this value.</p>
          )}
        </Section>
        {siblings.length > 0 && (
          <Section title={`The other values (${siblings.length})`} wide>
            <Chips ids={siblings} index={index} onNavigate={onNavigate} max={48} plain />
          </Section>
        )}
      </div>
      <Usage hitCount={hitCount} />
    </>
  );
}

// ------------------------------------------------------------------ building blocks
function Header({ node, kind }: { node: OntoNode; kind: string }) {
  return (
    <div className="element-head">
      <h4>
        <span className={`pill kind-${node.kind}`}>{kind}</span> {localName(node.id)}
        {node.pref_label && node.pref_label.toLowerCase() !== localName(node.id).toLowerCase() && <span className="muted"> ({node.pref_label})</span>}
      </h4>
      <code className="muted iri">{node.id}</code>
      {node.comment && <p>{node.comment}</p>}
      {(node.alt_labels?.length || node.concept_id) && (
        <p className="muted">
          {node.alt_labels && node.alt_labels.length > 0 && <>also called {node.alt_labels.join(', ')}</>}
          {node.alt_labels?.length && node.concept_id ? ' · ' : ''}
          {node.concept_id && <>concept id {node.concept_id}</>}
        </p>
      )}
    </div>
  );
}

function Section({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`detail-section${wide ? ' wide' : ''}`}>
      <h5>{title}</h5>
      {children}
    </section>
  );
}

function Usage({ hitCount }: { hitCount: number | null }) {
  if (hitCount === null) return null;
  return (
    <p className="muted usage">
      In the current image: {hitCount ? `${hitCount} box${hitCount > 1 ? 'es' : ''} highlighted` : 'not used by the result shown. Run a model or pick another element'}.
    </p>
  );
}

/** A name that selects its element. `plain`: a value shows its own word ("maxi"), not its id ("length_maxi"). */
function Chip({ node, onNavigate, plain = false }: { node: OntoNode; onNavigate: (n: OntoNode | null) => void; plain?: boolean }) {
  return (
    <button type="button" className={`chip kind-${node.kind}`} onClick={() => onNavigate(node)} title={node.comment || node.id}>
      {plain && node.kind === 'individual' && node.label ? node.label : localName(node.id)}
    </button>
  );
}

function Chips({ ids, index, onNavigate, max = 24, separator, plain = false }: { ids: string[]; index: Index; onNavigate: (n: OntoNode | null) => void; max?: number; separator?: string; plain?: boolean }) {
  const nodes = ids.map((id) => index.byId.get(id)).filter((n): n is OntoNode => !!n);
  const shown = nodes.slice(0, max);
  return (
    <span className="chips">
      {shown.map((n, i) => (
        <span key={n.id}>
          {separator && i > 0 ? <span className="muted">{separator}</span> : null}
          <Chip node={n} onNavigate={onNavigate} plain={plain} />
        </span>
      ))}
      {nodes.length > max && <span className="muted"> +{nodes.length - max} more</span>}
    </span>
  );
}
