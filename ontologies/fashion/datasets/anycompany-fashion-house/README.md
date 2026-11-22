# AnyCompany Fashion House: one look of a second brand (synthetic)

One look of the fictional brand AnyCompany Fashion House, in the catalog format of [`../README.md`](../README.md).
It is here for one reason: the sample's example question is "What should I wear with white
sneakers?", and AnyCompany Apparel sells no sneakers. With this look the graph holds one look that wears
white sneakers, so tabs 2, 4 and 5 have something to find, count and cite.

**All content is fictional.** AnyCompany Fashion House, the look and its photo are synthetic: the photo was
generated with Amazon Nova Canvas and the pieces were read from it by the sample's own classify
step (Claude Sonnet 5.5 against the fashion ontology). No real brand, product or person is shown.
The fashion domain's example photos and single pieces
([`../../examples/images/`](../../examples/images/), [`../../examples/items/`](../../examples/items/))
are more photos of the same lookbook and catalog; the deploy does not load them.

| File | Contents |
|------|----------|
| `brand.json`, `lines.json` | The brand; it has no product lines |
| `items.json` | The look's seven pieces, each a product of the catalog |
| `looks.json` | The look: Professional, a beige trench coat over a black double-breasted blazer, black tailored trousers, a black leather tote, a gold chain necklace, cat-eye sunglasses and white lace-up sneakers |
| `media/looks/` | The look's photo, which the look and its pieces name as `image_key` (`anycompany-fashion-house/looks/<file>`) |

## Where it comes from

This look is `look:58f0a33d` of a larger synthetic AnyCompany Fashion House set in the graph-export format,
converted to the catalog format so the deploy embeds it with the stack's own embedding model and
dimension. Ids, names, categories, attributes and the photo key are the export's. Three things
changed:

- The photo's left and right sneaker (`item:58f0a33d-e7-shoe` and `-e8-`) are one product here,
  under e7's id and the name "white lace-up sneakers", because a catalog item is a product. The
  look's description still names both shoes, as the photo shows them.
- A piece's color is the first word of its name when that word is a color. Its material is set only
  when the name states it.
- The pieces' parts (collar, lapel, sleeve) are not part of the catalog format, and neither is the
  look's `Occasion` node. The look keeps its occasion as a text ("Professional"), and the loader
  matches that text against the ontology's occasions and writes `Look -FOR-> Occasion`.
