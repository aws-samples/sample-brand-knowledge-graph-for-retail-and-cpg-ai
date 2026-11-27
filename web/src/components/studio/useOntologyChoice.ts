// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from 'react';
import { api, type ExampleInfo, type OntologyDetail } from '../../api';
import { withoutNewWork } from '../../domain';

/** The ontology select's value for an uploaded file. */
export const UPLOAD_ID = '__upload__';

export type OntologyUpload = { text: string; filename: string };

/**
 * Tab 1's ontology: the domain chosen in tab 0 (its detail, with view, prompt and examples, read from
 * the API) or an OWL/RDF file the user uploads, parsed by the API and never stored. The example
 * photos offered stay those of the last built-in ontology that had any (`examples.from`), without
 * the new work tab 6 checks.
 */
export function useOntologyChoice(domain: string) {
  const [ontologyId, setOntologyId] = useState(domain);
  const [domainLabel, setDomainLabel] = useState(domain); // the domain's name and size, once read
  const [detail, setDetail] = useState<OntologyDetail | null>(null);
  const [upload, setUpload] = useState<OntologyUpload | null>(null);
  const [examples, setExamples] = useState<{ from: string; list: ExampleInfo[] }>({ from: domain, list: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // the domain changed in tab 0: back to its ontology (an upload stays in the list)
  useEffect(() => setOntologyId(domain), [domain]);

  useEffect(() => {
    if (ontologyId === UPLOAD_ID) return;
    setLoading(true);
    api
      .ontologyDetail(ontologyId)
      .then((d) => {
        setDetail(d);
        const offered = withoutNewWork(d.examples_list);
        if (offered.length) setExamples({ from: ontologyId, list: offered });
        if (ontologyId === domain) setDomainLabel(`${d.name}: ${d.stats.classes} classes, ${d.stats.individuals} values`);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [ontologyId, domain]);

  async function onFile(file: File) {
    const text = await file.text();
    setLoading(true);
    try {
      const d = await api.parseOntology(text, file.name);
      setUpload({ text, filename: file.name });
      setDetail(d);
      setOntologyId(UPLOAD_ID);
      setError('');
    } catch (e: any) {
      setError(`Could not parse ${file.name}: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  const isUpload = ontologyId === UPLOAD_ID;
  /** What a run is keyed and requested by: the folder id, or the uploaded ontology's own id. */
  const key = isUpload ? detail?.id ?? 'upload' : ontologyId;
  return { ontologyId, setOntologyId, isUpload, key, domainLabel, detail, upload, examples, loading, error, onFile };
}

export type OntologyChoice = ReturnType<typeof useOntologyChoice>;
