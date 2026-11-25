// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type OntoNode, type OntologyDetail, type OntologySummary } from '../../api';
import { Stage } from '../shared/Stage';
import { localName, OntologyGraph } from './OntologyGraph';
import { OntologyDetails } from './OntologyPanel';

/** The key of the first choice: the ontology of steps 1 to 3 (not a folder id, so it never clashes with one). */
const STEPS = ':steps';

// the browse-only domains and their details, read once for the page
let listing: Promise<OntologySummary[]> | null = null;
const details: Record<string, OntologyDetail> = {};

/** The domains `GET /api/ontologies` marks browse-only (`domain.browse_only`), in the API's order. */
function browseOnly(): Promise<OntologySummary[]> {
  listing ??= api.ontologies().then(
    (r) => r.ontologies.filter((o) => o.domain.browse_only),
    (e) => {
      listing = null; // a later visit asks again
      throw e;
    },
  );
  return listing;
}

/**
 * Step 4, "Explore possible ontologies for other retail domains": the same approach on other
 * catalogs, browse only (done once a word is looked up in one of them). The choices are the
 * ontology of steps 1 to 3 and the browse-only
 * domains of `GET /api/ontologies` (folders under ontologies/ whose domain.json says
 * `"browse_only": true`: beauty, home and food in the sample), each read with
 * `GET /api/ontologies/detail`; the words to start with are the domain's `start_with`. A picker,
 * the map and the details of step 1, with their own selection, so steps 1 to 3 and the classifier
 * never change. There are no photos for these.
 */
export function OtherAisles({ fashion }: { fashion: OntologyDetail | null }) {
  const [aisles, setAisles] = useState<OntologySummary[] | null>(null);
  const [aisle, setAisle] = useState('');
  const [loaded, setLoaded] = useState<OntologyDetail | null>(null);
  const [listError, setListError] = useState('');
  const [error, setError] = useState('');
  const [focus, setFocus] = useState<OntoNode | null>(null);
  // done once a word is looked up in an aisle other than the one of steps 1 to 3
  const [browsed, setBrowsed] = useState(false);
  useEffect(() => {
    if (focus && aisle && aisle !== STEPS) setBrowsed(true);
  }, [focus, aisle]);

  useEffect(() => {
    let live = true;
    browseOnly().then(
      (list) => {
        if (!live) return;
        setAisles(list);
        setAisle((a) => a || (list[0]?.id ?? STEPS));
      },
      (e) => {
        if (!live) return;
        setAisles([]);
        setAisle((a) => a || STEPS);
        setListError(e.message);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    setFocus(null);
    setError('');
    if (!aisle || aisle === STEPS) return;
    if (details[aisle]) return setLoaded(details[aisle]);
    let live = true;
    setLoaded(null);
    api
      .ontologyDetail(aisle)
      .then((d) => {
        details[aisle] = d;
        if (live) setLoaded(d);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [aisle]);

  const detail = aisle === STEPS ? fashion : loaded;
  const start = detail?.domain.start_with ?? [];
  const pick = (name: string) => setFocus(detail?.view.nodes.find((n) => localName(n.id) === name) ?? null);
  const choices = [{ id: STEPS, label: `${fashion?.domain.name ?? 'Fashion'} (steps 1 to 3)` }, ...(aisles ?? []).map((o) => ({ id: o.id, label: o.domain.name }))];

  return (
    <Stage n={4} title="Explore possible ontologies for other retail domains" sub="If you have time: beauty, home and food ontologies to browse." locked={null} done={browsed}>
      <p>
        The same approach works for any catalog. Pick an aisle to see its ontology. It has the same shape as fashion (kinds, families of detail with their allowed values, parts) with other words. The
        other aisles are folders under <code>ontologies/</code> that their <code>domain.json</code> marks browse-only. They come without data, so there are no photos to classify with them. The
        sample&apos;s three (beauty and skincare, home furnishings, food and beverage) are small ontologies written by hand for it.
      </p>
      <div className="model-buttons" role="radiogroup" aria-label="aisle">
        {choices.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={a.id === aisle} className={`small${a.id === aisle ? '' : ' secondary'}`} onClick={() => setAisle(a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {listError && <p className="error">{listError}</p>}
      {error && <p className="error">{error}</p>}
      {!detail && !error && (
        <p className="muted">
          <span className="spinner" aria-hidden="true" /> Reading the ontology…
        </p>
      )}
      {detail && (
        <>
          <dl className="counts">
            <div className="count">
              <dt>kinds the model could name</dt>
              <dd>
                <b>{detail.entity_classes}</b>
              </dd>
            </div>
            <div className="count">
              <dt>families of detail</dt>
              <dd>
                <b>{detail.value_classes}</b>
              </dd>
            </div>
            <div className="count">
              <dt>allowed values</dt>
              <dd>
                <b>{detail.stats.individuals}</b>
              </dd>
            </div>
            <div className="count">
              <dt>as a prompt</dt>
              <dd>
                <b>≈ {detail.prompt_tokens_estimate.toLocaleString()}</b> tokens
              </dd>
            </div>
          </dl>
          {start.length > 0 && (
            <div className="row explore-filter">
              <span className="small">Start with:</span>
              {start.map((name) => (
                <button key={name} className={`small secondary${focus && localName(focus.id) === name ? ' active' : ''}`} aria-pressed={!!focus && localName(focus.id) === name} onClick={() => pick(name)}>
                  {name}
                </button>
              ))}
            </div>
          )}
          <OntologyGraph view={detail.view} highlight={NO_HIGHLIGHT} focus={focus?.id ?? null} height={420} onNodeClick={(n) => setFocus(n)} />
          <OntologyDetails detail={detail} node={focus} hitCount={null} onNavigate={setFocus} id="aisle-details" hint="Click a name in the map, or a word above. Its details and allowed values show here." />
        </>
      )}
    </Stage>
  );
}

const NO_HIGHLIGHT = new Set<string>();
