# Bring your own data

The graph's data comes in **data sets**: one folder per brand under
`ontologies/<domain>/datasets/<set>/`. To bring your own catalog and photos, add a folder there and
deploy again. The stack's graph loader loads every data set of the graph's domain at deploy, into
the graph and the catalog index (the products), and combines the brands in one graph. The
repository ships synthetic sets only, AnyCompany Apparel and one look of AnyCompany Fashion House, so it can be published
anywhere.

A domain folder holds two kinds of input, and they go to different places:

| You have | Put it in | What happens |
|----------|-----------|--------------|
| A catalog: products, looks, rules, texts | `<domain>/datasets/<set>/` (data files) | the deploy loads it into the graph and the catalog index |
| Photos of that catalog's looks or products | `<domain>/datasets/<set>/media/<sub>/` | the app shows each next to the node whose `image_key` names it |
| Photos, single pieces or texts to try in the app | `<domain>/examples/<kind>/` or `<domain>/datasets/<set>/examples/<kind>/` | the tabs offer them; the deploy does not load them into the graph |

[`ontologies/fashion/datasets/README.md`](../ontologies/fashion/datasets/README.md) describes the
layout of a set, its two formats and who reads what. A set in the catalog format is the one to
write by hand.

## Layout

![The ontologies folder: one folder per domain with its ontology, examples to try and data sets, one per brand. Callouts mark what the deploy loads into the graph (the ontology and each set's data files), what the app only offers (the examples folders) and what the API serves by key (a set's media folder).](../assets/data-layout.png)

A set's folder name is its id: lower-case letters, digits, `-` and `_`. The files of a set in the
catalog format:

| File | Required | Contents |
|---|---|---|
| `README.md` | yes | What the set holds and its license; the app lists a set by this file |
| `brand.json` | yes | `{"id": "brand:<id>", "name", "description"}`; tab 0 shows the description |
| `lines.json` | yes | The product lines: `[{"id": "line:<id>", "name", "brand_id", "description", "season"}]`, or `[]` |
| `items.json` | yes | The products (below) |
| `looks.json` | yes | Outfits: `[{"id": "look:<id>", "name", "occasion", "description", "item_ids", "props"}]` |
| `pairing_rules.json` | no | The brand's rules (below) |
| `articles.json` | no | Editorial texts, as statements that illustrate looks and items |
| `domain.json` | no | Example questions, photo questions and worked query examples, added to the domain's lists |
| `media/<sub>/` | no | The set's own photos (`looks/`, `products/`), named by `image_key` |
| `examples/` | no | Inputs to try, in the same shape as the domain's `examples/` (`images/`, `items/`, `articles/`) |

[`ontologies/fashion/datasets/README.md`](../ontologies/fashion/datasets/README.md) has the same
layout as a text tree.

`ontologies/fashion/datasets/anycompany-apparel/` has every file and `ontology-rag synth` writes its shape
(`backend/src/ontology_rag/synth.py`).

An `items.json` entry:

```json
{
  "id": "item:my-coat-01",
  "name": "Camel duffle coat",
  "category_id": "coat",
  "line_id": "line:utility",
  "description": "Knee-length duffle coat with horn toggles.",
  "color": "camel",
  "material": "wool",
  "attributes": {"opening-type": "opening-type:toggled", "length": "length:knee"},
  "image_key": "<set>/products/coat-01.jpg"
}
```

* `category_id` is a category id of the graph's ontology (`ontologies/fashion/fashion.ttl` by
  default: the `fo:conceptId` values), and `attributes` maps a family id to a value id of that
  family (`length:knee`). The loader links an item to these ontology nodes and never creates one,
  so an id the ontology does not have gets no edge: the graph only ever contains known vocabulary.
* An item is embedded into the graph from its text (name, category, line, color, material,
  description, attributes), and into the catalog index as a product from its color, material,
  category and description (`payoff.catalog_text`). `image_key` names a photo
  of the set (`<set>/<sub>/<file>` for `media/<sub>/<file>`), which the app shows next to the
  item.
* A look's `occasion` is the data's own words (`"evening / formal"`). The loader matches it against
  the ontology's occasions, facet by facet, by label and by the words each occasion lists for
  matching (`gala` is Formal), and links the look to the first that matches with `FOR`. A look that
  matches none keeps its text, gets no edge and is listed as unresolved in the load's result.
* A look's photo is `"props": {"image_key": "<set>/looks/<file>"}` (`props` are extra node
  properties), the file `media/looks/<file>` of the set; tab 3 shows it with the look.
* A pairing rule is `{"source_id", "target_id", "level", "rationale", "occasion", "source"}`:
  `level` `category` joins two category ids (`PAIRS_WITH`), `item` two item ids (`LAYERED_WITH`).
  The rules are edges in the graph only; the catalog index holds no rules.

Photos without a catalog do not need a data set: upload them in tab 2, or add them as examples
(`examples/images/` of the domain or of a set, with an optional `manifest.json`) for tab 2 to
list. Tab 2's ingest pipeline classifies each one against the ontology and writes it into the
graph as a look with its garments.

## Load it

```bash
cd infra && npx cdk deploy
```

A deploy runs the graph loader again when a `.ttl` or `.json` file of the graph's domain folder
changed, so a new set (its `.json` files) is loaded on the next deploy. The loader embeds the set's
items, looks and statements with Amazon Nova Multimodal Embeddings and writes its products into the
catalog index. It never empties the graph on its own: what the graph already holds stays next to
the new brand. After you rename or remove a set, deploy once with `-c resetGraph=true`, which empties
the graph and the catalog index before the load (see [deploy.md](deploy.md#configuration)); the next
deploy without the flag loads again and changes nothing. The set's photos (`media/<sub>/`) are
uploaded with the `ontologies/` folder to the data bucket, where the API reads one when the app
shows it.

A different domain (another ontology and its sets) is a folder `ontologies/<domain>/` with
`-c defaultDomain=<domain>`; [`ontologies/README.md`](../ontologies/README.md) has what its ontology
needs.

## Publishing your adaptation

If you fork this sample, keep the rule that made it publishable: commit only data you may
publish, give any third-party content you commit a license entry in `THIRD-PARTY-LICENSES`, and
keep a real catalog in a fork or account of your own. The examples of a domain live next to its
ontology (`ontologies/<domain>/examples/`) and are committed, and so are its data sets
(`ontologies/<domain>/datasets/`), the catalogs the stack loads into the graph at deploy.
