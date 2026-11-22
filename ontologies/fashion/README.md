# Fashion ontology

`fashion.ttl` is an OWL 2 ontology (Turtle) of apparel categories, garment parts and fine-grained
attributes, plus the brand knowledge-graph schema used by the rest of this sample.

| | |
|---|---|
| IRI | `http://example.org/multimodal-ai-knowledge-graph/fashion` (prefix `fo:`) |
| Size | 83 classes, 303 named individuals, 22 object properties, 3 datatype properties, ~2,600 triples (version 1.2.0) |
| Built by | [`build_fashion_ontology.py`](build_fashion_ontology.py) (rdflib) from the Fashionpedia category/attribute catalog |
| Domain | [`domain.json`](domain.json): the name shown in tab 0, the words of the classification instruction ("garment, accessory and garment component", "an outfit"), the wording of the prompts and the worked examples of tab 3's agent |
| Examples | Inputs to try in the app; the deploy does not load them. [`examples/images/`](examples/images/): 8 synthetic model photos to classify against it (lookbook photos of the fictional brand AnyCompany Fashion House, made with Amazon Nova Canvas); [`examples/items/`](examples/items/): 12 product photos of single garments like those in them, for tab 5's Style recommendation; [`examples/articles/`](examples/articles/): 6 synthetic texts about the same outfits for the ingest pipeline |
| Data sets | Data loaded into the graph at deploy, one folder per brand ([`datasets/README.md`](datasets/README.md)): [`datasets/anycompany-apparel/`](datasets/anycompany-apparel/) (synthetic catalog) and [`datasets/anycompany-fashion-house/`](datasets/anycompany-fashion-house/) (one look) |

## Attribution

The category and attribute **vocabulary** comes from the **Fashionpedia ontology** (Menglin Jia,
Mengyun Shi, Mikhail Sirotenko, Yin Cui, Claire Cardie, Bharath Hariharan, Hartwig Adam, Serge
Belongie: *Fashionpedia: Ontology, Segmentation, and an Attribute Localization Dataset*, ECCV 2020;
https://fashionpedia.github.io/home/index.html), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) per the
[Fashionpedia terms of use](https://fashionpedia.github.io/home/data_license.html). The catalog file
it is built from is `data/demo/category_attributes_descriptions.json` in the
[Fashionpedia API](https://github.com/KMnP/fashionpedia-api) (BSD-2-Clause).

**License of `fashion.ttl`:** CC BY 4.0, not the MIT-0 license of the rest of the repository. The
file says so in its first lines and in `dcterms:rights`. The Fashionpedia authors do not endorse
this sample.

**Definitions:** the Fashionpedia catalog has names, supercategories, levels and taxonomy ids, but
no description text. Every definition in `fashion.ttl` (`rdfs:comment`, `skos:definition`) was
written for this sample by its authors.

**Changes made here** (CC BY 4.0 asks that modifications are indicated): the flat catalog is
expressed in OWL 2. Fashionpedia supercategories and categories become classes, attribute
families become classes whose values are named individuals, and each family gets a `has<Family>`
object property. Fashionpedia's family and supercategory names are rendered as class and property
names (for example "textile finishing, manufacturing techniques" becomes `TextileFinishing` and
`hasTextileFinishing`, "animal" becomes `AnimalMaterial`); parenthesized qualifiers of value names
are kept as `skos:prefLabel` and dropped from `rdfs:label`. An **applicability matrix** (which
families make sense for which category groups; Fashionpedia annotates attributes per mask without
stating one) is added as property domains. `hasPart` links garments to parts, closures and
decorations, and the **brand knowledge-graph schema** (`Look`, `Item`, `Statement`, `Article`,
`Line`, `Brand` and their relations) is added, with the `fo:visual` and `fo:conceptId` annotations.
Four **jewelry categories** that Fashionpedia does not have are added, and a closed list of
**occasions** with the property `fo:for` from a look to its occasion (both below). No Fashionpedia
image or annotation is included; Fashionpedia does not own its photos, so the example photos in
`examples/images/` are synthetic (see [`examples/images/README.md`](examples/images/README.md)).

## Jewelry: categories this sample adds

Fashionpedia has no jewelry, so the earrings, necklaces, bracelets and rings in a photo or a
catalog had no class to go to (the vision models said so in their ontology feedback). Version
1.1.0 adds four categories to `fo:OtherAccessory` (Fashionpedia's "others" group, where the
non-textile material, animal and leather families already apply, so a gold hoop can be
`hasNonTextileMaterial metal`). They are defined in `SAMPLE_CATEGORIES` in the builder and written
like a Fashionpedia category: the name with its synonyms as `skos:prefLabel`, the synonyms as
`skos:altLabel`. Unlike a Fashionpedia category they have no `fo:taxonomyId`; they carry a
definition (`rdfs:comment`) and `skos:editorialNote "Added by this sample; not part of the
Fashionpedia ontology."`.

| Class | `fo:conceptId` | Synonyms (`skos:altLabel`) |
|---|---|---|
| `fo:Earring` | `earring` | ear stud, hoop |
| `fo:Necklace` | `necklace` | pendant, choker |
| `fo:Bracelet` | `bracelet` | bangle, cuff bracelet |
| `fo:Ring` | `ring` | |

A bare "cuff" or "chain" is not a synonym: sleeves have cuffs, and belts and bag straps are
chains too, so either word would send them to the wrong class.

## Occasions: a vocabulary this sample adds

Fashionpedia says what a garment is, not what a look is worn for. Version 1.2.0 adds the class
`fo:Occasion` with nine named individuals and the object property `fo:for` (domain `fo:Look`,
range `fo:Occasion`). Every new term carries the same `skos:editorialNote` as the jewelry; each
occasion has an `rdfs:label`, a `skos:prefLabel`, a `skos:definition` and a `fo:conceptId`. The
ids use underscores (`occasion:business_casual`), as the style DNA format does.
They are defined in `OCCASIONS` in the builder.

| Individual | `fo:conceptId` | `skos:hiddenLabel` | Definition |
|---|---|---|---|
| `fo:occasion_casual` | `occasion:casual` | weekend, everyday, city, relaxed | Relaxed everyday wear. |
| `fo:occasion_smart_casual` | `occasion:smart_casual` | | Casual pieces dressed up a step. |
| `fo:occasion_business_casual` | `occasion:business_casual` | | An office without a suit. |
| `fo:occasion_professional` | `occasion:professional` | business, office, corporate | Tailored office wear. |
| `fo:occasion_evening` | `occasion:evening` | dinner, night out | An evening out: dinner, drinks, a show. |
| `fo:occasion_formal` | `occasion:formal` | black tie, gala | Black tie and formal events. |
| `fo:occasion_resort` | `occasion:resort` | vacation, holiday, beach | Warm-weather travel and resort days. |
| `fo:occasion_outdoor` | `occasion:outdoor` | outdoors, hiking | Outdoor work and weather. |
| `fo:occasion_dress` | `occasion:dress` | | A day look built around a dress. |

The list is closed: a model or a data set picks one of these or none, and never adds one. Hidden
labels are other words a data set may use for an occasion (SKOS: labels for matching, not for
display). `fo:Look` stays schema-only (`fo:visual false`), but `fo:Occasion` and `fo:for` are
`fo:visual true`, because the occasion is judged from a photo as a whole.

## Structure

```
fo:Apparel                              fo:GarmentComponent            fo:Attribute
├─ fo:UpperBodyGarment                  ├─ fo:GarmentPart              ├─ fo:Silhouette        (25 values)
│  ├─ fo:Shirt  fo:Top  fo:Sweater      │  ├─ fo:Collar  fo:Lapel      ├─ fo:NecklineType      (25)
│  ├─ fo:Cardigan  fo:Jacket  fo:Vest   │  ├─ fo:Sleeve  fo:Pocket     ├─ fo:Length            (15)
├─ fo:LowerBodyGarment                  │  ├─ fo:Hood  fo:Epaulette    ├─ fo:TextilePattern    (18)
│  ├─ fo:Pants  fo:Shorts  fo:Skirt     │  └─ fo:Neckline              ├─ fo:OpeningType       (10)
├─ fo:WholeBodyGarment                  ├─ fo:Closure                  ├─ fo:Waistline         (7)
│  ├─ fo:Coat  fo:Dress                 │  ├─ fo:Zipper  fo:Buckle     ├─ fo:TextileFinishing  (21)
│  ├─ fo:Jumpsuit  fo:Cape              └─ fo:Decoration               ├─ fo:NonTextileMaterial(10)
├─ fo:Headwear  fo:Neckwear                ├─ fo:Bow  fo:Ruffle …      ├─ fo:Nickname          (153)
├─ fo:ArmsAndHandsAccessory                                            ├─ fo:AnimalMaterial    (6)
├─ fo:WaistAccessory  fo:LegsAndFeetwear                               └─ fo:LeatherType       (4)
└─ fo:OtherAccessory
   ├─ fo:Bag  fo:Scarf  fo:Umbrella
   └─ fo:Earring  fo:Necklace  fo:Bracelet  fo:Ring   (added by this sample)
```

Object properties:

| Property | Domain → range | Meaning |
|----------|----------------|---------|
| `fo:hasSilhouette`, `fo:hasNecklineType`, `fo:hasLength`, `fo:hasTextilePattern`, `fo:hasOpeningType`, `fo:hasWaistline`, `fo:hasTextileFinishing`, `fo:hasNonTextileMaterial`, `fo:hasNickname`, `fo:hasAnimalMaterial`, `fo:hasLeatherType` | `owl:unionOf` the applicable groups → the family class | attribute values (sub-properties of `fo:hasAttribute`); the domain is the applicability rule, e.g. neckline type applies to upper- and whole-body garments only |
| `fo:hasPart` | `fo:Apparel` → `fo:GarmentComponent` | visible parts, closures, decorations |
| `fo:for` | `fo:Look` → `fo:Occasion` | the occasion a look is worn for (added by this sample); the model answers it for a photo as a whole |
| `fo:contains`, `fo:layeredWith`, `fo:isCategory`, `fo:fromLine`, `fo:ofBrand`, `fo:hasStatement`, `fo:illustrates`, `fo:pairsWith` | knowledge-graph schema | annotated `fo:visual false`: drawn with "KG schema" ticked, never offered to vision models |

Annotation properties: `fo:conceptId` (the stable id the pipeline uses: `coat`, `silhouette:a-line`,
`nickname:polo-shirt`), `fo:taxonomyId` (Fashionpedia id; absent on the sample's own categories),
`fo:visual`.

## How the backend uses it

* **Classification (tabs 1 and 2)**: `owl.classification_prompt()` renders the ontology as
  the system prompt; `vision.validate()` maps every class, property and value in a model answer back
  onto it and reports anything that is not there (never invents). A property from `fo:Look` to a
  class with named individuals (`fo:for`) is a *photo property*: the prompt lists its values with
  their definitions in a section of its own, and the model answers it for the photo as a whole.
* **Graph loader**: `ontology.load_ontology()` maps the OWL onto the flat model the graph uses
  (`Group` / `Category` / `AttributeFamily` / `Attribute` nodes with `IN_GROUP`, `IN_FAMILY`,
  `APPLIES_TO` edges), keyed by `fo:conceptId`, so the domain's data sets in [`datasets/`](datasets/)
  (the sample ships [`datasets/anycompany-apparel/`](datasets/anycompany-apparel/) and
  [`datasets/anycompany-fashion-house/`](datasets/anycompany-fashion-house/)) join on it; a catalog's attributes are
  validated against the applicability matrix. The individuals of a photo property's range become
  shared nodes labeled with their class (`(:Occasion {id: "occasion:evening"})`), and a look's
  occasion text (`"evening / formal"`) is matched against their labels: `Look -FOR-> Occasion`.
* **Ingest (tab 2)**: `kg.py` turns a validated answer into individuals of the ontology's KG
  schema (`fo:Item`, `fo:isCategory`, `fo:hasPart`, `fo:for`, ...) and from there into graph nodes
  and edges.

## Rebuild

```bash
uv pip install rdflib==7.6.0   # or: pip install rdflib==7.6.0
python3 ontologies/fashion/build_fashion_ontology.py   # downloads the Fashionpedia catalog and writes fashion.ttl
```

The build is deterministic: rerunning it yields the same file unless the catalog or the script changed.
