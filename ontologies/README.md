# Ontologies

Every domain the sample can work with lives in its own folder here: the ontology, a short
description of the domain, examples to try in the app and the data sets the deploy loads into the
graph. Tab 0 (*Start here*) lists these folders as the domains to choose from; the choice drives
the other tabs. Tab 1 draws the ontology as a graph and classifies images against it with several
Amazon Bedrock vision models, tab 2 ingests its example images and texts into the graph, and tab 5
offers its single pieces for *Style recommendation*. A folder whose `domain.json` says
`"browse_only": true` is an ontology to read: tab 1 shows it in step 4 (*Other aisles*), tab 0 does
not offer it and tab 2 refuses to ingest against it.

## Bring your own data in three steps

What you bring goes into one of three places:

1. **A domain is an ontology.** `<domain>/<domain>.ttl` names the kinds of thing, their parts and
   the values their details may take. If your data is apparel, use `fashion/`; otherwise add a
   folder (see [Adding your own domain](#adding-your-own-domain)).
2. **An example is something to try.** A photo, a single piece or a text in
   `<domain>/examples/<kind>/` (or in a data set's own `examples/`). The tabs offer it; the deploy
   does not load it into the graph.
3. **A data set is data loaded at deploy.** One brand's catalog, looks and texts in
   `<domain>/datasets/<set>/`, with the brand's own photos under `media/<sub>/`. Deploy again;
   tabs 3 to 6 read it from the graph.

[`docs/bring-your-own-data.md`](../docs/bring-your-own-data.md) walks through a data set file by
file.

## Layout

```
ontologies/
├── README.md
└── <domain>/                       lower-case id shown in the UI
    ├── <domain>.ttl                the ontology
    ├── domain.json                 optional
    ├── README.md
    ├── build_*.py                  optional: the script that builds the ontology (never deployed)
    ├── examples/                   inputs to try in the app; the deploy never loads them into the graph
    │   ├── images/                 whole photos (tabs 1, 2; tab 6 for "batch": "new-work") + manifest.json, README.md
    │   ├── items/                  single pieces (tab 5's Style recommendation) + manifest.json, README.md
    │   └── articles/               texts (tab 2) + manifest.json, README.md
    └── datasets/                   loaded into the graph at deploy, one folder per brand
        ├── README.md               what a data set is, its two formats
        └── <set>/
            ├── README.md           required: the app lists a set by this file
            ├── brand.json          optional
            ├── domain.json         optional: lists added to the domain's
            ├── <data files>        catalog format (brand.json, lines.json, items.json, looks.json,
            │                       pairing_rules.json, articles.json) or style DNA format
            │                       (graph.json, vectors.json, catalog.json)
            ├── media/<sub>/        the data's own photos (looks/, products/), served by key
            └── examples/           optional, the same shape as the domain's examples/
                ├── images/  items/  articles/
```

The ontology file may be Turtle (preferred), RDF/XML (`.owl`, `.rdf`, `.xml`), N-Triples (`.nt`)
or JSON-LD (`.jsonld`). The domain's `README.md` holds attribution and modeling notes
(`GET /api/ontologies/detail` returns it as `readme`). In `examples/`, photos are JPEG, PNG, WebP
or GIF and texts are `.md` or `.txt`. Each `manifest.json` is optional and adds per file what the
file name cannot say (a photo's title and provenance; a piece's category and source photo;
a text's kind, source, date and the photo it pairs with), and a `README.md` is never listed as an
example.

[`fashion/datasets/README.md`](fashion/datasets/README.md) describes a data set: its layout, the
two formats and what the app lists from it.

| Folder | Domain | Source / license |
|--------|--------|------------------|
| [`fashion/`](fashion/) | Apparel: 12 category groups, 50 categories (Fashionpedia's 46 and 4 jewelry categories the sample adds), 11 attribute families, 294 attribute values, `hasPart`, the 9 occasions the sample adds (`Occasion`, `for`), plus the brand knowledge-graph schema; 8 example photos, 12 single pieces like those worn in them, 6 example texts | Derived from the [Fashionpedia](https://fashionpedia.github.io/home/index.html) ontology (CC BY 4.0, modified) |
| [`beauty/`](beauty/) | Beauty and skincare, browse-only: 83 classes, 92 named individuals, 20 object properties; no data, no examples | Written for this sample (MIT-0) |
| [`home/`](home/) | Home furnishings, browse-only: 80 classes, 69 named individuals, 15 object properties; no data, no examples | Written for this sample (MIT-0) |
| [`food/`](food/) | Food and beverage, browse-only: 81 classes, 66 named individuals, 16 object properties; no data, no examples | Written for this sample (MIT-0) |

The sample ships one domain, fashion, and three browse-only ontologies, beauty, home and food,
which show the same shape in other aisles (each folder's README says how to make it a full domain).
Another domain is one more folder next to them. The code names `fashion` only as
the default of `ONTOLOGY_PATH` (`config.DEFAULT_DOMAIN`, the stack's `-c defaultDomain=`).

## `domain.json`

Everything in the file is optional; a folder without it works with neutral wording.

```json
{
  "name": "Fashion",
  "description": "Apparel: garments, accessories and garment parts with their visible attributes.",
  "start_with": ["Coat", "hasLength", "Lapel"],
  "subject": "garment, accessory and garment component",
  "scene": "an outfit",
  "example_questions": ["What do I wear with the waxed field jacket?", "..."],
  "photo_questions": ["What goes with this piece? Style the rest of the outfit around it.", "..."],
  "persona": {
    "answer": "You are the in-house stylist for a fashion brand.",
    "role": "stylist"
  },
  "noun": { "singular": "garment", "plural": "garments" },
  "labels": {
    "qa_tab": "Style Q&A + Style recommendation",
    "rule": "brand rule",
    "rules": "brand rules"
  },
  "query_examples": [
    {
      "question": "How many catalog items does each line have?",
      "cypher": "MATCH (i:Item) WHERE i.run IS NULL\nRETURN i.line AS line, count(i) AS items ORDER BY items DESC"
    }
  ]
}
```

| Key | Used for | Without it |
|-----|----------|------------|
| `name`, `description` | the Domain card in tab 0, and tab 1 step 4 for a browse-only ontology | the ontology's `rdfs:label`, no description |
| `browse_only` | `true`: an ontology to read, with no data. Tab 1 lists it in step 4 (*Other aisles*), tab 0 does not offer it as the domain the tabs work with, and `POST /api/pipeline/runs` refuses it with a 400 ("&lt;id&gt; is a browse-only ontology: it has no data to ingest") | `false`: a full domain |
| `start_with` | the class, property and part names tab 1 step 4 starts the ontology's details with (`["Serum", "hasKeyIngredient", "Dropper"]`) | no "Start with" row |
| `subject` | the instruction sent with every image and text: "Classify every *subject* visible in this image using the ontology" | "entity and component" |
| `scene` | the instruction sent with a text: "The text inside &lt;source_text&gt; above describes *scene*" | "a scene" |
| `example_questions`, `photo_questions` | returned by `GET /api/ontologies`; no tab reads them (tabs 4 and 5 offer their own questions) | empty lists |
| `persona`, `labels` | returned by `GET /api/ontologies`; no prompt and no tab reads them (the answer prompt of tabs 4 and 5 names the graph's brands) | the neutral words of `DOMAIN_DEFAULTS` |
| `noun` | what the graph holds, `singular` and `plural` ("garment", "garments"): the words of tab 2's run tree and article step | "item", "items" |
| `query_examples` | worked examples for tab 3's query agent: `{question, cypher}` pairs, written into its system prompt after the rules (at most 10, each query at most 1,200 characters, read-only; others are dropped). Write queries that run on your graph, with patterns the model should copy: a case-insensitive name lookup, rules in both directions, the latest run | no examples: the agent works from the rules and the schema alone |

A nested block (`persona`, `noun`, `labels`) is merged key by key, so a file may
set one word and keep the defaults for the rest.

A data set may carry a `domain.json` of its own (`datasets/<set>/domain.json`) with the three lists
`example_questions`, `photo_questions` and `query_examples`. They are appended to the domain's
lists, set by set in name order, and an entry that is already listed is dropped; the other keys
come from the domain's file only.

A data set may also carry a `brand.json` (`{"id": "brand:velloway", "name": "Velloway",
"description": "..."}`). Whatever the set's format, the deploy gives the set's `Brand` node that
description, `GET /api/summary` returns every brand with its description (`brands`), and tab 0's
*Meet the brand* shows them.

The ontology itself is the system prompt of every classification; `domain.json` only words the
short instruction that follows the image or text, so the cached prefix is the same whatever the
domain says. `GET /api/ontologies` returns the file under `domain` for every folder, and
`default`: the domain whose ontology the graph is loaded with.

## How an ontology is read (any ontology, fashion or another)

The pipeline uses [rdflib](https://rdflib.readthedocs.io/) and needs no configuration beyond the
file. `backend/src/ontology_rag/owl.py` derives everything from standard OWL/RDFS vocabulary:

| In the ontology | In the explorer / prompt |
|-----------------|--------------------------|
| `owl:Class` + `rdfs:subClassOf` | class hierarchy (the tree the model may pick from) |
| a class that has `owl:NamedIndividual`s | a **value class**: its individuals are the allowed values of the properties whose `rdfs:range` it is |
| every other class | an **entity class**: something that can be located in an image |
| `owl:ObjectProperty` with a value-class range | an **attribute property** (`hasSilhouette (applies to …): a-line, …`); `rdfs:domain` (plain class or `owl:unionOf`) is the applicability rule |
| `owl:ObjectProperty` between entity classes | a **relation** the model may use for parts (`hasPart: Apparel -> GarmentComponent`) |
| `owl:ObjectProperty` from the image class of the knowledge-graph schema (`Look`) to a value class | a **photo property**: one value for the photo as a whole, in its own prompt section (`for: Business casual (An office without a suit.); ...`). Fashion's is `for`, the occasion; the ingest step writes it as `look fo:for fo:occasion_x`, a `FOR` edge in the graph |
| `rdfs:label` / `skos:prefLabel` / `skos:altLabel` | display names and synonyms (also accepted when validating model output) |
| `skos:hiddenLabel` / `skos:definition` | words used only to match a text to a value (a data set's look, an example manifest's occasion: `gala` is Formal), never displayed; a value's definition, printed next to a photo property's values |
| `fo:visual false` (annotation) | schema-only concept: drawn when "KG schema" is ticked, never offered to the vision model |

The rendered vocabulary is the **system prompt** for image classification. It is identical for
every image, which is what prompt caching needs: the ontology is the cached prefix, only
the image changes.

## Adding your own domain

1. Create `ontologies/<domain>/<domain>.ttl` following the conventions above (a plain class tree
   with `rdfs:label`s is enough to start; add value classes + properties when you want attributes).
2. Optionally add `domain.json` and examples to try: whole photos in `examples/images/`
   (JPEG/PNG/WebP/GIF, < 4 MB each) and texts in `examples/articles/` (`.md`/`.txt`, < 20,000
   characters). They appear as ready-made sources in tabs 1 and 2. Tab 5 offers the photos of
   `examples/items/` for *Style recommendation* (single pieces, each a product photo of one garment).
   A folder with an ontology but no data yet can say
   `"browse_only": true` in `domain.json`: tab 1 step 4 reads it, and nothing tries to ingest
   against it.
3. Upload the folder to the data bucket:
   `aws s3 sync ontologies/<domain>/ s3://<bucket>/ontologies/<domain>/` (the `OntologiesLocation`
   stack output). It appears in tab 0 within a minute, no redeploy needed. The copy bundled with
   the Lambda is only the fallback. Data sets (`datasets/<set>/`) are loaded into the graph only by
   a deploy, from the folder in the repository; a deploy also replaces the bucket's `ontologies/`
   with the repository's copy, so keep a new folder in the repository too.
4. Choose the domain in tab 0. Tabs 1 and 2 now classify against it and offer its example photos
   and texts.

To try an ontology without adding it to the repository, use *Upload your own OWL / RDF file* in
tab 1: it is parsed per request and never written to disk (no examples, neutral wording). Uploaded
JSON-LD must inline its `@context` (a context URL or `@import` is refused, so the parser never
fetches anything), RDF/XML must be UTF-8 and must not declare a DOCTYPE, and an upload is at most 1 MB.

## One graph, one vocabulary

The graph holds one vocabulary: the ontology `ONTOLOGY_PATH` points at (the fashion ontology),
loaded together with every data set of that domain (`fashion/datasets/<set>/`; the sample ships
`velloway/` and `whimsikora/`) when the stack is deployed. Another data set is one more folder
under `ontologies/<domain>/datasets/`; the loader combines them in one graph, and the
app lists each set's example photos and texts. Choosing another domain in tab 0 does not reload
the graph. What happens per tab:

* **Tab 1** classifies against the chosen ontology; nothing is written.
* **Tab 2** ingests the chosen domain's sources into the shared graph. The ingest step
  (`backend/src/ontology_rag/kg.py`) creates the vocabulary nodes it needs (`Category`,
  `Attribute`, `AttributeFamily`) as it goes, so a second domain's items land in the same graph
  next to the catalog. A photo property's values (fashion's occasions) are written by the deploy,
  from the graph's ontology.
* **Tabs 3 to 6** (the explorer, the retriever, the three answers, the lenses) read what is in the
  graph: the data sets' vocabulary plus whatever tab 2 added. Tab 0 shows a notice when the chosen
  domain is not the one the graph was loaded with.

For a second domain to be ingested into the shared graph, its ontology must provide, with
exactly these local names, the knowledge-graph schema `kg.py` writes with (the `KG_SCHEMA` table
there):

| Local name | Kind | Meaning |
|------------|------|---------|
| `Item` | class | every entity the model finds becomes an individual of it |
| `isCategory` | object property | the item to the ontology class the model chose |
| `hasPart` | object property | the item to the classes of its parts |
| `fromLine` | object property | the item to the product line of the batch |
| `description` | datatype property | one line of text per item |
| `Look`, `contains` | class, object property | a photo, and the items it shows |
| `Statement`, `illustrates` | class, object property | a text, and the items it describes |
| `Article`, `hasStatement` | class, object property | the text's article, and its statement |

Mark these schema classes and properties `visual false` with the annotation property
`<http://example.org/multimodal-ai-knowledge-graph/fashion#visual>` so the vision model is never offered
them, and give every class and named individual a stable id with
`<http://example.org/multimodal-ai-knowledge-graph/fashion#conceptId>` (`coat`, `silhouette:a-line`): node
ids in the graph derive from it (`category:coat`, `attribute:silhouette:a-line`), and two domains
that both declare a class `Coat` share the node `category:coat`. Without a concept id the
lower-cased local name is used. The two annotation IRIs are the sample's and live in the fashion
namespace; another domain reuses them as they are (declare the prefix in your file).

The graph's own vocabulary (what the deploy-time loader writes from the domain's data sets) goes
further: it needs the conventions in [`fashion/README.md`](fashion/README.md)
(groups under `fo:Apparel` / `fo:GarmentComponent`, families under `fo:Attribute`, `conceptId`
everywhere). Point `ONTOLOGY_PATH` (deployed: `-c defaultDomain=`) at such an ontology and put its
catalog in a data set folder `<domain>/datasets/<set>/` to load a different domain into the graph.
