// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Fragment, useMemo, useState } from 'react';
import { KIND_META } from './CodeViewer';
import { parsePrompt, prettyShape, type AttributeItem, type ClassItem, type PromptSection } from './promptText';

/**
 * The system prompt, laid out for reading. `owl.classification_prompt()` renders an ontology as
 * plain text for the model; this component turns that text back into what a person wants to see:
 * the instruction, the class hierarchy as a tree, relations as domain → range, each attribute
 * property with its allowed values as chips, the ontology-feedback ask and the output contract
 * with its JSON shape indented. Nothing is added or reworded (every string comes from the prompt),
 * and a switch shows the raw text underneath so nobody has to take the layout on trust.
 */
export function PromptView({ system, user, tokens, defaultRaw = false }: { system: string; user?: string; tokens?: number; defaultRaw?: boolean }) {
  const [raw, setRaw] = useState(defaultRaw);
  const doc = useMemo(() => parsePrompt(system), [system]);
  const feedbackColor = KIND_META.feedback.color;
  return (
    <div className="prompt-view">
      <div className="prompt-summary">
        <span>
          <b>{system.length.toLocaleString()}</b> chars{tokens ? <> ≈ <b>{tokens.toLocaleString()}</b> tokens</> : null}
        </span>
        {doc.counts.classes > 0 && (
          <span>
            <b>{doc.counts.classes}</b> classes
          </span>
        )}
        {doc.counts.relations > 0 && (
          <span>
            <b>{doc.counts.relations}</b> relation{doc.counts.relations === 1 ? '' : 's'}
          </span>
        )}
        {doc.counts.attributes > 0 && (
          <span>
            <b>{doc.counts.attributes}</b> attribute properties · <b>{doc.counts.values}</b> values
          </span>
        )}
        <span className="muted">identical for every image, so it is the cacheable prefix</span>
        <label className="check" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> raw text
        </label>
      </div>
      {raw ? (
        <pre className="code-block prompt-raw">{system}</pre>
      ) : (
        <div className="prompt-doc">
          {doc.intro.length > 0 && (
            <div className="prompt-intro" style={{ borderColor: KIND_META.prompt.color }}>
              <span className="prompt-tag" style={{ background: KIND_META.prompt.color }}>
                instruction
              </span>
              {doc.intro.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}
          {doc.sections.map((s, i) => (
            <Section key={i} section={s} feedbackColor={feedbackColor} />
          ))}
        </div>
      )}
      {user && (
        <div className="prompt-user">
          <span className="prompt-tag" style={{ background: KIND_META.image.color }}>
            user turn
          </span>
          <span className="muted">the image as bytes, then:</span> <i>{user}</i>
        </div>
      )}
    </div>
  );
}

function Section({ section: s, feedbackColor }: { section: PromptSection; feedbackColor: string }) {
  const isFeedback = s.title.toLowerCase().includes('feedback');
  const color = s.kind === 'output' ? KIND_META.output.color : isFeedback ? feedbackColor : KIND_META.ontology.color;
  return (
    <section className={`prompt-section kind-${s.kind}${isFeedback ? ' feedback' : ''}`} style={{ ['--section' as string]: color }}>
      <h4>
        {s.title}
        {s.hint && <span className="muted"> ({s.hint})</span>}
      </h4>
      {s.kind === 'classes' && (
        <>
          {s.caption && <p className="muted caption">{s.caption.replace(/^Format:\s*/i, 'Format: ')}</p>}
          <ClassTree items={s.roots} depth={0} />
        </>
      )}
      {s.kind === 'relations' && (
        <table className="metrics compact prompt-relations">
          <thead>
            <tr>
              <th>relation</th>
              <th>domain</th>
              <th />
              <th>range</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((r) => (
              <tr key={r.name} className="static">
                <td>
                  <code>{r.name}</code>
                </td>
                <td>
                  <Chips items={r.domain} className="kind-class" />
                </td>
                <td className="arrow">→</td>
                <td>
                  <Chips items={r.range} className="kind-class" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.kind === 'attributes' && (
        <dl className="prompt-attributes">
          {s.items.map((a) => (
            <Attribute key={a.name} item={a} />
          ))}
        </dl>
      )}
      {s.kind === 'photo' && (
        <>
          {s.caption && <p className="muted caption">{s.caption}</p>}
          <dl className="prompt-attributes">
            {s.items.map((p) => (
              <Fragment key={p.name}>
                <dt>
                  <code>{p.name}</code>
                </dt>
                <dd>
                  <Chips items={p.values.map((v) => (v.definition ? `${v.name} (${v.definition})` : v.name))} className="kind-individual" />
                </dd>
              </Fragment>
            ))}
          </dl>
        </>
      )}
      {s.kind === 'output' && (
        <>
          {s.lead.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <pre className="code-block prompt-shape">{prettyShape(s.shape)}</pre>
          {s.rules.length > 0 && (
            <ol className="prompt-rules">
              {s.rules.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>
          )}
        </>
      )}
      {s.kind === 'list' && (
        <>
          {s.caption && <p className="muted caption">{s.caption}</p>}
          <ul className="prompt-tree">
            {s.items.map((it, i) => (
              <li key={i} style={{ marginLeft: `${it.depth * 1.1}rem` }}>
                {it.text}
              </li>
            ))}
          </ul>
        </>
      )}
      {s.kind === 'text' && s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    </section>
  );
}

function ClassTree({ items, depth }: { items: ClassItem[]; depth: number }) {
  return (
    <ul className={`prompt-tree${depth === 0 ? ' root' : ''}`}>
      {items.map((c) => (
        <li key={c.name}>
          <span className="class-name">{c.name}</span>
          {c.label && <span className="muted class-label">: {c.label}</span>}
          {c.synonyms.length > 0 && (
            <span className="muted class-alt">
              {' '}
              also: <Chips items={c.synonyms} />
            </span>
          )}
          {c.children.length > 0 && <ClassTree items={c.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

const VALUES_SHOWN = 20;

function Attribute({ item: a }: { item: AttributeItem }) {
  const [all, setAll] = useState(false);
  const hidden = a.values.length - VALUES_SHOWN;
  const values = all || hidden <= 2 ? a.values : a.values.slice(0, VALUES_SHOWN);
  return (
    <>
      <dt>
        <code>{a.name}</code>
        <span className="muted applies">
          {' '}
          applies to <Chips items={a.appliesTo} className="kind-class" />
        </span>
      </dt>
      <dd>
        <Chips items={values} className="kind-individual" />
        {hidden > 2 && (
          <button type="button" className="chip more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? 'show fewer' : `+${hidden} more`}
          </button>
        )}
      </dd>
    </>
  );
}

function Chips({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <span className="chips">
      {items.map((v, i) => (
        <span key={`${v}-${i}`} className={`chip static ${className}`.trim()}>
          {v}
        </span>
      ))}
    </span>
  );
}
