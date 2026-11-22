# Graph model

The graph has two halves that share one vector index:

1. **The ontology** (structure only): `Group`, `Category`, `AttributeFamily`, `Attribute`, and
   `Occasion`. Loaded once from the ontology `ONTOLOGY_PATH` points at
   (`ontologies/fashion/fashion.ttl` by default; `ontology.load_ontology()` maps the OWL onto these
   nodes via `fo:conceptId`). Every attribute and occasion a catalog or the ingest pipeline writes
   must resolve to one of these nodes, so a model cannot add vocabulary to the graph by answering.
2. **The brand's knowledge** (structure + vectors): `Brand`, `Line`, `Item`, `Look`, `Article`,
   `Statement`, plus the two *curatorial* relationship types `LAYERED_WITH` and `PAIRS_WITH`.

![The graph model: the ontology's node types (AttributeFamily, Group, Category, Attribute, Occasion) on the left and the brand's (Line, Brand, Item, Look, Statement, Article) on the right. Item links to Category by IS_CATEGORY and HAS_PART and to Attribute by HAS_ATTRIBUTE; Look links to Item by CONTAINS and to Occasion by FOR; Statement ILLUSTRATES a Look or an Item. Item, Look and Statement carry vectors. PAIRS_WITH joins categories and LAYERED_WITH joins items.](../assets/graph-model.png)

The block below is the text version of the figure.

```
(:Brand {name, description})
(:Line {name, description, season})-[:OF_BRAND]->(:Brand)

(:Group {name, label, kind})                              # upperbody, lowerbody, wholebody, legs-and-feet, ...
(:Category {name, short, taxonomy_id, kind})-[:IN_GROUP]->(:Group)
(:AttributeFamily {name})-[:APPLIES_TO]->(:Group)          # e.g. neckline-type applies to upperbody + wholebody
(:Attribute {name, taxonomy_id})-[:IN_FAMILY]->(:AttributeFamily)
(:Occasion {name})                                          # casual, evening, professional, ... (9, from fo:Occasion)

(:Item {name, description, color, material, category, line, image_key, embedding})
(:Item)-[:IS_CATEGORY]->(:Category)
(:Item)-[:FROM_LINE]->(:Line)
(:Item)-[:HAS_ATTRIBUTE {family}]->(:Attribute)
(:Item)-[:HAS_PART]->(:Category)                                            # a component seen on the item (collar, pocket, zipper)
(:Item)-[:LAYERED_WITH {rationale, occasion, source}]->(:Item)              # item-level rule
(:Category)-[:PAIRS_WITH {rationale, occasion, source}]->(:Category)       # category-level rule

(:Look {name, occasion, description, embedding})-[:CONTAINS]->(:Item)
(:Look)-[:FOR]->(:Occasion)                                                 # from fo:for, one per look at most
(:Article {title, source, published})-[:HAS_STATEMENT]->(:Statement {text, embedding})
(:Statement)-[:ILLUSTRATES]->(:Look | :Item)
```

Items written by the ingest pipeline carry four more properties, `confidence` (the model's, or
-1), `model`, `run` and `source` (the photo or text they were seen in), and `HAS_PART` edges to the
component categories the model identified (garment parts, closures and decorations are `kind: part`
categories that never become items themselves). A photo the pipeline ingests becomes a `Look`
(`image_key`, `run`) that `CONTAINS` its items; a text becomes an `Article` with one `Statement` that
`ILLUSTRATES` them. Because the items of a photo and of a text about the same outfit resolve to the
same `Category` and `Attribute` nodes, "what do these sources share" is one query over the shared
vocabulary nodes, with no string matching involved.

## Occasions

`fo:Occasion` is a closed vocabulary the sample adds to the fashion ontology: nine named
individuals (Casual, Smart casual, Business casual, Professional, Evening, Formal, Resort, Outdoor,
Dress) and the object property `fo:for` from `fo:Look` to `fo:Occasion`
([`ontologies/fashion/README.md`](../ontologies/fashion/README.md) has the table). The loader and
the pipeline take the class, the property and the values from the ontology (`owl.vocabulary`): a
property whose domain is the image class of the knowledge-graph schema (`Look`) and whose range is
a value class is a *photo property*, and its range is a *vocabulary class*. What they read by name
is the data's own field, named like the class's concept id (`occasion`).

* **The deploy** writes every value of a vocabulary class as a node labeled with the class's local
  name, id = its concept id (`occasion:professional`), `name` = its pref label, so the nine
  `Occasion` nodes exist on every deploy.
* **A catalog data set** names a look's occasion in its own words (`"evening / formal"`). The loader
  reads the look field named like the vocabulary class (`occasion`), splits it on "/" and takes
  the first facet that resolves: equal to a value's pref label, label, alt label or hidden label
  (`gala` is Formal), else one of those labels as whole words in it, the longest first. It writes
  `Look -FOR-> Occasion` and keeps the text as the look's `occasion` property. A look that resolves
  to nothing gets no edge, and the load lists it under `unresolved`. On the sample's deploy,
  AnyCompany Apparel's looks and AnyCompany Fashion House's one resolve to Evening 6, Resort 5, Casual 3, Outdoor 2,
  Professional 2 and Smart casual 1, and AnyCompany Apparel's "cold weather" look to none.
* **A style DNA export** carries its own `Occasion` nodes and `FOR` edges, with the same ids
  (`dna.py`).
* **Tab 2** asks the model for the photo as a whole: the classification prompt lists the photo
  properties with their allowed values, the answer's `photo_properties` is checked against the
  property's range (an unknown value is an issue and is dropped), and `kg.add_look` writes the
  triple `look fo:for fo:occasion_x`, which becomes the `FOR` edge. The occasion of an example
  photo's manifest comes first, then the model's answer, then none; the look's `occasion` property
  is the name of the occasion it got.

Tab 3's web and the `thin` lens of tab 6 start from occasions that have a look, so the occasions no
look is for do not show as empty rows.

## Ids

Node ids are caller-assigned (`~id`, a Neptune openCypher extension) and namespaced by type:
`item:utility-field-jacket`, `look:evening-black-tie`, `category:jacket`, `attribute:neckline-type:crew`,
`occasion:evening`, `st:layering-2`. This makes every load idempotent (`MERGE` on `~id`) and every
path readable.
Neptune Analytics does not support custom ids on edges; edges are identified by
`(source, type, target)` and `MERGE`d on that pattern.

Ids the ingest pipeline assigns derive from the **content** of the source (the first 8 hex digits
of its SHA-256), so the same photo or text always produces the same ids: `item:<digest>-e2-shoe`,
`look:<digest>`, `article:<digest>`, `st:<digest>-1`. Re-running a batch `MERGE`s onto the same
look, article and statement nodes; an item's id also carries the model's entity number (`e2`) and
class, so an entity the model names the same way is updated in place (its `model`, `confidence` and
`run` overwritten) while one it reads differently is added as a new item. Nothing is deleted.

## Vectors

Neptune Analytics has one vector index per graph, fixed at creation time (here 1024 dimensions,
matching Amazon Nova Multimodal Embeddings with `embeddingDimension: 1024`). `Item`, `Look` and
`Statement` nodes carry a vector; ontology nodes do not.

* Items embedded from **text** (`Item.embedding_text()`: name, category, line, color, material,
  description, attributes) or from an **image** when one is available. Both land in the same space
  because Nova is multimodal, which is what lets a photo query retrieve text-described items.
* Statements embedded individually: a statement is one styling claim, a much sharper retrieval
  target than an article-level vector.

Vector writes on Neptune Analytics are durable immediately and not atomic, so the loader writes
vectors in separate, idempotent `neptune.algo.vectors.upsert` statements after the structure.

## Why two rule levels

* `LAYERED_WITH` between two items is the precise, merchandised pairing ("this jacket with this
  henley"). It is what a stylist writes down for a hero product.
* `PAIRS_WITH` between two categories is the brand's *general* rule ("jackets sit over high-rise
  trousers"). It is written once and resolved at query time to concrete items, preferring items
  from the same line, so it covers every current and future product without curation.

The query agent's worked examples (AnyCompany Apparel's `domain.json`) walk both, for example
`Item(jacket) -IS_CATEGORY-> Category(jacket) -PAIRS_WITH-> Category(pants) <-IS_CATEGORY- Item(cargo pants)`.
GraphRAG in tabs 4 and 5 counts what the brand's looks wear instead (`CONTAINS`, `FOR`), and the
catalog index holds no rules: a product is embedded from its own text only.

## Queries

The loader's and the store's openCypher statements are in `backend/src/ontology_rag/graph/cypher.py`;
the traversal of tabs 4 and 5 is `payoff.TRAVERSAL` and tab 6's are in `lenses.py`, and the app
shows each one where it runs. The catalog's rules carry `source: brand-stylist`.
