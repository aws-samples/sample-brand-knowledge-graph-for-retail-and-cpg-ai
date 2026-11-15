# Example images for the fashion ontology

Eight synthetic full-body model photos used by the **Ontology explorer** to demonstrate
image classification against the ontology. Each shows several garments, garment parts
(collar, lapel, pocket, zipper, buckle, strap) and visible attributes (silhouette, neckline,
length, pattern, opening type, material).

| File | Outfit |
|------|--------|
| `01-trench-coat-sweater-dress.jpg` | double-breasted trench coat worn open, turtleneck sweater dress, pointed mules, top-handle bag, hoop earrings |
| `02-sheath-dress-knee-high-boots.jpg` | sleeveless sheath dress, knee-high boots, suede foldover clutch, chunky gold chains |
| `03-navy-blazer-pleated-skirt.jpg` | oversized double-breasted navy blazer, grey shirt, pleated midi skirt, studded slides, woven tote |
| `04-biker-jacket-jeans-sneakers.jpg` | leather biker jacket, denim shirt, wide-leg cropped jeans, white sneakers, bangles, tote |
| `05-turtleneck-denim-skirt.jpg` | ribbed turtleneck sweater, denim midi skirt, pointed ankle boots, small top-handle bag |
| `06-cardigan-wide-leg-trousers.jpg` | chunky-knit cardigan over a rib-knit top, wide-leg trousers, flats, layered necklaces |
| `07-wool-coat-ankle-boots.jpg` | long wool coat, white shirt, pleated wide-leg trousers, cap-toe ankle boots, chain-strap bag |
| `08-pinstripe-suit.jpg` | pinstripe suit, silk blouse, flat slides, tote with a pearl strap |

Tab 2 (Hydrate the graph) starts with a first batch when the domain has no new shoot: the
photos and texts whose manifest entry says `"batch": "first"`. Here that is `01`, `04` and `08`
with the texts about them, so one of the looks wears white sneakers, the garment the sample's
example question is about; its title says so ("biker jacket, jeans, white sneakers"), which tab
2's step 1 counts.

## Provenance and license

All images are **synthetic**: lookbook photos of the fictional brand Whimsikora, generated with
Amazon Nova Canvas on Amazon Bedrock and taken from the data set of the IND416 workshop built on
this sample (the original file name of each photo is in `manifest.json`). The sample's own
Whimsikora data set holds one more photo of the same lookbook
([`../../datasets/whimsikora/`](../../datasets/whimsikora/)). The photos depict no real person and
contain no third-party photography, so they can be redistributed with this sample under its
license. Amazon Nova Canvas reached the end of its life on Amazon Bedrock in September 2026 and the
sample has no script that generates them, so the photos cannot be generated again; to try other
outfits, add your own photos (below).

No Fashionpedia dataset image is included: Fashionpedia does not own its photos (Flickr /
Unsplash / Pexels terms); only its CC BY 4.0 ontology is reused (see
[`../../README.md`](../../README.md)). The texts in [`../articles/`](../articles/) describe the
same outfits.

## Add examples

Any `*.jpg` / `*.png` / `*.webp` dropped into this folder is listed automatically by the
API (`GET /api/ontologies/examples?id=fashion`) and appears in the explorer; no manifest
entry is required. Keep files under 4 MB so they can be sent to the vision models as-is (Amazon
Bedrock caps the image size per model). Use only photos you have the rights to, with no person
who can be identified.
