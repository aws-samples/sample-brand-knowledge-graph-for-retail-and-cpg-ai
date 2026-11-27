# Food and beverage ontology

`food.ttl` is a small OWL 2 ontology (Turtle) of food and drink, written by hand for this sample in
the same shape as the fashion ontology. It is sample code under the repository's license (MIT-0,
see [`LICENSE`](../../LICENSE)), not a standard: extend it for a real catalog.

| | |
|---|---|
| IRI | `http://example.org/multimodal-ai-knowledge-graph/food` (prefix `fb:`) |
| Size | 81 classes, 66 named individuals, 16 object properties, about 690 triples (version 0.1.0) |
| Domain | [`domain.json`](domain.json): the name and description, `"browse_only": true`, and the three words tab 1 step 4 starts with (`start_with`) |

## What it holds

- **Kinds**: `FoodAndDrink`, with beverages (coffee, tea, wine, ...), dairy and alternatives,
  bakery, snacks, pantry staples, produce, proteins and desserts under it.
- **Parts**: `PackagingComponent`: containers (bottle, can, jar, box, pouch), closures (cap,
  cork, lid) and markings (front label, seal).
- **Details and their allowed values**: one family per detail (flavor, sweetness, body, texture,
  cuisine, diet, allergen, serving, meal occasion), each value a named individual, each family
  with its `has<Family>` property.
- **The brand graph's schema** (`fo:visual false`, never shown to the vision model): `Spread`
  (food's look: a styled table, a recipe or a serving photo), `Item`, `Brand`, `Article`,
  `Statement`, and the brand's rule `servedWith` (these are served together), with a few example
  rules.

## In the app

`domain.json` marks the folder `"browse_only": true`. `GET /api/ontologies` lists it, tab 0 does
not offer it as the domain the tabs work with, and tab 2 refuses to ingest against it: it has no
data, and its schema has no `Look` to write a photo into. Tab 1 step 4 (*Other aisles*) reads it
with `GET /api/ontologies/detail?id=food` and shows its counts (the kinds a model could name, the
families of detail, the allowed values, its size as a prompt), its map and its details, starting
from Cheese, hasFlavor and Cork.

## Making it a full domain

1. Add the terms of the knowledge-graph schema the pipeline writes with (`KG_SCHEMA` in
   `backend/src/ontology_rag/kg.py`; `../fashion/fashion.ttl` has them all): a `Look` class (the
   individual of one photo; `Spread` plays that part here), a `Line` class with the object
   property `fromLine` (from `Item` to `Line`), and the datatype property `description` (on
   `Item`), each marked `fo:visual false`.
2. Add data sets under `datasets/<set>/` (see [`../fashion/datasets/README.md`](../fashion/datasets/README.md))
   and, if you like, examples to try: photos in `examples/images/` and texts in `examples/articles/`.
3. Drop `"browse_only": true` from `domain.json` and add the wording keys described in
   [`../README.md`](../README.md) (`subject`, `scene`, `persona`, `noun`, `labels`, the questions).
4. The graph holds one domain's vocabulary and data sets: deploy with `-c defaultDomain=food` to
   load this one.
