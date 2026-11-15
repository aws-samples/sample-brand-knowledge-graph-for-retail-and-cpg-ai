# Example articles for the fashion ontology

Six short texts (editorial pieces, social posts and fitting-room notes) used by tab 2
(*Hydrate the graph*) next to the example images in [`../images/`](../images/). Each describes an outfit
with the same kind of detail a photo shows (garments, parts, silhouette, neckline, length,
opening type, pattern, material), so the same ontology-grounded classification works on a
text as on an image: identical system prompt, only the user turn differs.

| File | Kind | Outfit described | Pairs with image |
|------|------|------------------|------------------|
| `01-three-ways-trench.md` | editorial | double-breasted trench over a turtleneck sweater dress, mules, top-handle bag; jeans, t-shirt, ankle boots; turtleneck, pleated midi skirt, pumps | `01-trench-coat-sweater-dress.jpg` |
| `02-sheath-dress-post.md` | social post | sleeveless black sheath dress, knee-high boots, suede foldover clutch, gold chains | `02-sheath-dress-knee-high-boots.jpg` |
| `03-fitting-room-pinstripe-suit.md` | product notes | navy pinstripe suit, cream silk blouse, pocket square, slides, tote, stud earrings | `08-pinstripe-suit.jpg` |
| `04-biker-jacket-weekend-post.md` | social post | leather biker jacket, denim shirt, wide-leg jeans, white sneakers, bangles, tote | `04-biker-jacket-jeans-sneakers.jpg` |
| `05-layering-knits.md` | editorial | rib-knit top, chunky cardigan, wide-leg trousers, flats, bag, gold chains | `06-cardigan-wide-leg-trousers.jpg` |
| `06-wool-coat-cold-snap-post.md` | social post | long wool coat, white shirt, pleated wide-leg trousers, cap-toe ankle boots, chain bag | `07-wool-coat-ankle-boots.jpg` |

Tab 2 starts with the texts marked `"batch": "first"` in `manifest.json` (`01`, `03`, `04`) and
the photos they pair with; see [`../images/README.md`](../images/README.md).

Several texts deliberately mention things the ontology cannot express (knit gauge, button
material, a pocket square) so the model's `ontology_feedback` has something to say. That feedback
is the signal an ontology owner acts on.

## Provenance and license

All texts are **synthetic**: written for this sample about the fictional brand Whimsikora, whose
lookbook photos are the example photos (see
[`../../datasets/whimsikora/README.md`](../../datasets/whimsikora/README.md)). They describe no real
brand, product, person or dataset and are distributed under this sample's license (MIT-0).

## Add your own

Any `*.md` or `*.txt` file dropped into this folder is listed automatically by the API
(`GET /api/ontologies/articles?id=fashion`) and appears in tab 2's
source picker; a `manifest.json` entry only adds a title, kind, source and date. Keep files
under 20,000 characters; the first `# heading` becomes the title when there is no manifest
entry.
