# Single garments for Style recommendation (tab 5)

Twelve synthetic product photos, one garment per file, each like a garment worn in one of the
example photos in [`../images/`](../images/), so a question in tab 5 can start from one piece (a
coat, a blazer, a pair of sneakers) instead of a whole outfit. Tabs 1 and 2 keep classifying the
full photos.

| File | Category | Like the one in |
|------|----------|-----------------|
| `01-trench-coat.jpg` | coat | `01-trench-coat-sweater-dress.jpg` |
| `01-turtleneck-dress.jpg` | dress | `01-trench-coat-sweater-dress.jpg` |
| `03-navy-blazer.jpg` | jacket | `03-navy-blazer-pleated-skirt.jpg` |
| `04-biker-jacket.jpg` | jacket | `04-biker-jacket-jeans-sneakers.jpg` |
| `04-white-sneakers.jpg` | shoe | `04-biker-jacket-jeans-sneakers.jpg` |
| `05-denim-midi-skirt.jpg` | skirt | `05-turtleneck-denim-skirt.jpg` |
| `05-turtleneck-sweater.jpg` | sweater | `05-turtleneck-denim-skirt.jpg` |
| `06-chunky-knit-cardigan.jpg` | cardigan | `06-cardigan-wide-leg-trousers.jpg` |
| `06-wide-leg-trousers.jpg` | pants | `06-cardigan-wide-leg-trousers.jpg` |
| `07-ankle-boots.jpg` | shoe | `07-wool-coat-ankle-boots.jpg` |
| `07-wool-coat.jpg` | coat | `07-wool-coat-ankle-boots.jpg` |
| `08-pinstripe-trousers.jpg` | pants | `08-pinstripe-suit.jpg` |

## How they were chosen

Each piece is a product shot of the Whimsikora catalog of the IND416 workshop, picked because it
is close to a garment in one of the example photos. Each photo is a 512 x 512 px JPEG. Before it
was committed, it was checked twice with the default vision model:

- through the sample's own classification path (the prompt, the Converse call with prompt caching
  and the validation): it must show one main garment of the expected class, covering at least 15%
  of the photo, and no garment of another class may cover 30% of the photo or more;
- asked whether it shows lettering, a logo, a person or an obvious generation defect.

Product shots that failed either check (a neck label with lettering, a hand holding a clutch, a
boot with a strap that ends nowhere) were left out. [`manifest.json`](manifest.json) records per
file the title, class, category, the example photo it is like, the product shot it is, the image
model, and the result of both checks.

## Provenance and license

Synthetic images generated with Amazon Nova Canvas on Amazon Bedrock for the Whimsikora catalog
(the product shot of each file is named in `manifest.json`), redistributed under the same license
as the sample. They show no real person and contain no third-party photography (see
[`../images/README.md`](../images/README.md)). Like the example photos, they cannot be generated
again: Amazon Nova Canvas reached the end of its life on Amazon Bedrock in September 2026, and the
sample has no script that generates them.

Any image dropped into this folder is listed by `GET /api/ontologies/examples?id=fashion&set=items`
and offered in tab 5; the manifest only adds titles and categories.
