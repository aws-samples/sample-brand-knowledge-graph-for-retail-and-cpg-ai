// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Prism } from 'prism-react-renderer';

/**
 * Two grammars the bundled Prism does not have, registered on its instance when this module is
 * imported (CodeViewer imports it): `turtle` for the ontology files (RDF Turtle, read in tab 1's
 * "Inspect: the ontology file") and `prompt` for the text `owl.classification_prompt()` renders
 * (tab 1's "Inspect: the prompt"). Token names are the ones the night-owl theme colours: comment,
 * string and url (green), number, builtin and function (blue), punctuation (purple), class-name
 * (orange), keyword and operator (teal), boolean, property (teal), namespace (grey-blue).
 */
export const TURTLE = 'turtle';
export const PROMPT = 'prompt';

type Grammar = NonNullable<(typeof Prism.languages)[string]>;

// A prefixed name (`fo:Coat`, `rdfs:label`, `:x`, or the bare `fo:` of a prefix declaration). The
// local part never ends in a dot, so the dot that ends a statement stays punctuation. The prefix is
// a namespace; a local part that starts with a capital letter is a class, any other a property.
const PREFIXED_NAME = {
  pattern: /[A-Za-z_][\w-]*(?:\.[\w-]+)*:(?:[\w-]+(?:\.[\w-]+)*)?|:[\w-]+(?:\.[\w-]+)*/,
  inside: {
    namespace: /^[^:]*:/,
    'class-name': /^[A-Z][\w.-]*$/,
    property: /^[\w.-]+$/,
  },
};

Prism.languages[TURTLE] = {
  // IRIs first, so the `#` of `<...#>` is never the start of a comment.
  iri: { pattern: /<[^<>"{}|^`\\\s]*>/, greedy: true, alias: 'url' },
  // A literal with its optional language tag or datatype: `"coat"@en`, `"1"^^xsd:integer`.
  string: {
    pattern: /(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')(?:@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*|\^\^(?:<[^<>"{}|^`\\\s]*>|[A-Za-z_][\w.-]*:[\w.-]*))?/,
    greedy: true,
    inside: {
      'language-tag': { pattern: /@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/, alias: 'builtin' },
      datatype: {
        pattern: /\^\^\S+$/,
        inside: {
          punctuation: /\^\^/,
          iri: { pattern: /<[^<>"{}|^`\\\s]*>/, alias: 'url' },
          'prefixed-name': PREFIXED_NAME,
        },
      },
    },
  },
  comment: { pattern: /#.*/, greedy: true },
  keyword: [/@(?:prefix|base)\b/, /\b(?:PREFIX|BASE)\b/, { pattern: /(^|\s)a(?=\s)/, lookbehind: true }],
  boolean: /\b(?:true|false)\b/,
  number: { pattern: /(^|[\s,(\[])[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[\s,;.)\]]|$)/, lookbehind: true },
  'prefixed-name': PREFIXED_NAME,
  punctuation: /[;,.()[\]]/,
} satisfies Grammar;

// The term a list item defines (`- Coat: label [also: ...]`, `- hasLength (applies to ...): ...`,
// `- pairsWith: Item -> Item`): the name right after the bullet, up to its colon, bracket or
// parenthesis. A capitalised name is a class, any other a property, as in the Turtle grammar.
Prism.languages[PROMPT] = {
  heading: { pattern: /^##.*$/m, alias: 'function' },
  // The one-line JSON shape under "## Output", tokenised as JSON.
  json: { pattern: /^\{.*\}$/m, inside: Prism.languages.json },
  'class-name': { pattern: /(^[ \t]*-[ \t]+)[A-Z][\w-]*(?=:|\s\(|\s\[|$)/m, lookbehind: true },
  property: { pattern: /(^[ \t]*-[ \t]+)[a-z_][\w-]*(?=:|\s\(|\s\[|$)/m, lookbehind: true },
  bullet: { pattern: /^[ \t]*-(?=[ \t])/m, alias: 'punctuation' },
  synonyms: { pattern: /\[also:[^\]\n]*\]/, alias: 'string' },
  'applies-to': { pattern: /\(applies to[^)\n]*\)/, alias: 'comment' },
  arrow: { pattern: /->/, alias: 'operator' },
  string: { pattern: /"[^"\n]*"/, greedy: true },
} satisfies Grammar;
