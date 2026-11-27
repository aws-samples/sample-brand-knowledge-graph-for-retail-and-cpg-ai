# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Deterministic synthetic catalog for a fictional brand.

Everything here is invented: the brand "AnyCompany Apparel", its lines, products, looks and
editorial copy. No real brand, customer or dataset is represented. The generator is
deterministic so the data set ``ontologies/fashion/datasets/anycompany-apparel`` (``ontology-rag synth``)
can be regenerated and diffed.

Every attribute value is resolved against the ontology at generation time, so a typo in
a seed fails loudly instead of producing an item the graph cannot ground.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from ontology_rag.models import Article, Brand, Item, Line, Look, PairingRule, Statement
from ontology_rag.ontology import Ontology

# The data set folder synth writes: ontologies/<domain>/datasets/<SET_ID>/
SET_ID = "anycompany-apparel"

BRAND = Brand(
    id="brand:anycompany-apparel",
    name="AnyCompany Apparel",
    description=(
        "AnyCompany Apparel is a contemporary label built on three lines: Utility, workwear heritage "
        "in waxed cotton and corduroy; Resort, warm-weather pieces in linen; Evening, tailoring in "
        "wool, satin and velvet. Every piece is cut to pair across the lines."
    ),
)

LINES = [
    Line(
        "line:utility",
        "Utility",
        BRAND.id,
        "Utility and workwear heritage: waxed cotton, corduroy, brass hardware.",
        "AW",
    ),
    Line(
        "line:resort",
        "Resort",
        BRAND.id,
        "Warm-weather resort: linen, airy silhouettes, sun-faded color.",
        "SS",
    ),
    Line(
        "line:evening",
        "Evening",
        BRAND.id,
        "Evening tailoring and occasion wear: sharp lines, satin, deep tones.",
        "AW",
    ),
]

# id, name, category, line, color, material, {family: value}, description
# Values are spelled as the ontology names them (``single breasted``, ``hip``); the ``nickname``
# family (the garment or collar type, ``nickname:shirt-collar``) by its concept id, because
# several of its names share the same stem ("shirt (collar)", "shirt (dress)").
ITEM_SEEDS: list[tuple] = [
    # ---------------------------------------------------------------- Utility (utility)
    (
        "item:utility-field-jacket",
        "Waxed field jacket",
        "jacket",
        "utility",
        "olive",
        "waxed cotton",
        {
            "silhouette": "regular",
            "opening-type": "zip-up",
            "length": "hip",
            "textile-pattern": "plain",
            "nickname": "nickname:safari-jacket",
        },
        "Four-pocket waxed cotton field jacket with corduroy collar and brass zip; the Utility line's anchor piece.",
    ),
    (
        "item:utility-trench",
        "Cotton gabardine trench coat",
        "coat",
        "utility",
        "stone",
        "cotton gabardine",
        {
            "silhouette": "regular",
            "opening-type": "double breasted",
            "length": "knee",
            "textile-pattern": "plain",
            "nickname": "nickname:trench-coat",
        },
        "Double-breasted trench with a storm flap and a belt meant to be tied; the piece that survives every edit of the line.",
    ),
    (
        "item:utility-chore-coat",
        "Corduroy chore coat",
        "coat",
        "utility",
        "rust",
        "corduroy",
        {
            "silhouette": "loose",
            "opening-type": "single breasted",
            "length": "hip",
            "textile-pattern": "plain",
        },
        "Relaxed chore coat in wide-wale corduroy with patch pockets; layers over knitwear.",
    ),
    (
        "item:utility-quilted-vest",
        "Quilted liner vest",
        "vest",
        "utility",
        "navy",
        "recycled nylon",
        {
            "silhouette": "regular",
            "opening-type": "zip-up",
            "length": "hip",
            "textile-finishing-manufacturing-techniques": "quilted",
        },
        "Lightweight quilted vest designed to sit under the field jacket or over a flannel shirt.",
    ),
    (
        "item:utility-flannel-shirt",
        "Brushed flannel overshirt",
        "shirt",
        "utility",
        "forest green",
        "brushed cotton",
        {
            "silhouette": "loose",
            "nickname": "nickname:shirt-collar",
            "opening-type": "single breasted",
            "textile-pattern": "check",
            "length": "hip",
        },
        "Heavyweight brushed flannel in a forest-green check; worn open as an overshirt or buttoned as a layer.",
    ),
    (
        "item:utility-henley",
        "Thermal henley",
        "top",
        "utility",
        "ecru",
        "waffle cotton",
        {
            "silhouette": "regular",
            "neckline-type": "round",
            "length": "hip",
            "textile-pattern": "plain",
            "nickname": "nickname:henley-shirt",
        },
        "Waffle-knit henley with a three-button placket; the base layer of the Utility line.",
    ),
    (
        "item:utility-fisherman-sweater",
        "Fisherman rib sweater",
        "sweater",
        "utility",
        "oatmeal",
        "wool",
        {
            "silhouette": "oversized",
            "neckline-type": "crew",
            "length": "hip",
            "textile-pattern": "plain",
        },
        "Chunky rib-knit crew neck in undyed wool; sized to sit over shirts.",
    ),
    (
        "item:utility-shawl-cardigan",
        "Shawl-collar cardigan",
        "cardigan",
        "utility",
        "charcoal",
        "wool blend",
        {
            "silhouette": "loose",
            "nickname": "nickname:shawl-lapel",
            "opening-type": "single breasted",
            "length": "hip",
        },
        "Heavy shawl-collar cardigan with horn buttons; a soft alternative to the chore coat.",
    ),
    (
        "item:utility-cargo-pants",
        "Ripstop cargo pants",
        "pants",
        "utility",
        "khaki",
        "cotton ripstop",
        {
            "silhouette": "straight",
            "waistline": "normal waist",
            "length": "floor",
            "opening-type": "fly",
            "textile-pattern": "plain",
            "nickname": "nickname:cargo-pants",
        },
        "Straight-leg cargo pants in tear-resistant ripstop with bellows pockets.",
    ),
    (
        "item:utility-carpenter-pants",
        "Duck canvas carpenter pants",
        "pants",
        "utility",
        "tan",
        "cotton duck canvas",
        {
            "silhouette": "wide leg",
            "waistline": "normal waist",
            "length": "floor",
            "opening-type": "fly",
        },
        "Wide-leg carpenter pants in stiff duck canvas with hammer loop; softens with wear.",
    ),
    (
        "item:utility-selvedge-jeans",
        "Selvedge denim jeans",
        "pants",
        "utility",
        "indigo",
        "selvedge denim",
        {
            "silhouette": "straight",
            "waistline": "high waist",
            "length": "floor",
            "opening-type": "fly",
            "textile-finishing-manufacturing-techniques": "washed",
            "nickname": "nickname:jeans",
        },
        "Rinse-washed selvedge jeans with a high rise and straight leg.",
    ),
    (
        "item:utility-work-shorts",
        "Canvas work shorts",
        "shorts",
        "utility",
        "stone",
        "cotton canvas",
        {
            "silhouette": "loose",
            "waistline": "normal waist",
            "length": "knee",
            "opening-type": "fly",
        },
        "Knee-length canvas shorts with utility pockets for warm-weather site days.",
    ),
    (
        "item:utility-work-boot",
        "Moc-toe work boot",
        "shoe",
        "utility",
        "brown",
        "full-grain leather",
        {"opening-type": "lace up", "non-textile-material-type": "rubber"},
        "Goodyear-welted moc-toe boot on a rubber lug sole; the Utility line's footwear staple.",
    ),
    (
        "item:utility-suede-chukka",
        "Suede chukka boot",
        "shoe",
        "utility",
        "sand",
        "suede",
        {"opening-type": "lace up", "leather": "suede"},
        "Two-eyelet suede chukka on a crepe sole; dresses the cargo pants up.",
    ),
    (
        "item:utility-beanie",
        "Rib-knit watch cap",
        "hat",
        "utility",
        "charcoal",
        "merino wool",
        {"textile-pattern": "plain"},
        "Close-fitting ribbed watch cap in merino.",
    ),
    (
        "item:utility-tote",
        "Waxed canvas tote",
        "bag",
        "utility",
        "olive",
        "waxed canvas",
        {"non-textile-material-type": "metal"},
        "Structured waxed canvas tote with brass rivets and leather handles.",
    ),
    (
        "item:utility-belt",
        "Bridle leather belt",
        "belt",
        "utility",
        "brown",
        "bridle leather",
        {"non-textile-material-type": "metal"},
        "Thick bridle leather belt with a solid brass buckle.",
    ),
    (
        "item:utility-wool-scarf",
        "Herringbone wool scarf",
        "scarf",
        "utility",
        "gray",
        "lambswool",
        {},
        "Long lambswool scarf woven in a herringbone twill.",
    ),
    (
        "item:utility-boot-sock",
        "Boot sock",
        "sock",
        "utility",
        "oatmeal",
        "wool blend",
        {"textile-pattern": "plain"},
        "Cushioned wool-blend boot sock.",
    ),
    # ---------------------------------------------------------------- Resort (resort)
    (
        "item:resort-linen-shirt",
        "Camp-collar linen shirt",
        "shirt",
        "resort",
        "white",
        "linen",
        {
            "silhouette": "loose",
            "nickname": "nickname:shirt-collar",
            "opening-type": "single breasted",
            "length": "hip",
            "textile-pattern": "plain",
        },
        "Boxy camp-collar shirt in washed linen; the Resort line's signature.",
    ),
    (
        "item:resort-stripe-shirt",
        "Striped linen shirt",
        "shirt",
        "resort",
        "navy",
        "linen cotton",
        {
            "silhouette": "regular",
            "nickname": "nickname:shirt-collar",
            "opening-type": "single breasted",
            "length": "hip",
            "textile-pattern": "stripe",
        },
        "Relaxed button-front shirt in a navy stripe on linen-cotton.",
    ),
    (
        "item:resort-knit-polo",
        "Open-knit polo",
        "top",
        "resort",
        "sage",
        "cotton",
        {
            "silhouette": "regular",
            "nickname": "nickname:polo-shirt",
            "length": "hip",
            "textile-pattern": "plain",
        },
        "Airy open-knit polo with a soft collar; wears like a t-shirt.",
    ),
    (
        "item:resort-tank",
        "Ribbed tank",
        "top",
        "resort",
        "ivory",
        "organic cotton",
        {
            "silhouette": "tight",
            "neckline-type": "scoop",
            "length": "hip",
            "nickname": "nickname:tank-top",
        },
        "Fine ribbed scoop-neck tank; the layer under every Resort shirt.",
    ),
    (
        "item:resort-linen-blazer",
        "Unlined linen blazer",
        "jacket",
        "resort",
        "sand",
        "linen",
        {
            "silhouette": "loose",
            "opening-type": "single breasted",
            "length": "hip",
            "textile-pattern": "plain",
            "nickname": "nickname:blazer",
        },
        "Unstructured single-breasted blazer in slubby linen; creases are part of the look.",
    ),
    (
        "item:resort-drawstring-pants",
        "Drawstring linen pants",
        "pants",
        "resort",
        "stone",
        "linen",
        {
            "silhouette": "wide leg",
            "waistline": "normal waist",
            "length": "floor",
            "opening-type": "no opening",
        },
        "Wide-leg linen pants with an elasticated drawstring waist.",
    ),
    (
        "item:resort-pleated-shorts",
        "Pleated linen shorts",
        "shorts",
        "resort",
        "white",
        "linen",
        {
            "silhouette": "loose",
            "waistline": "high waist",
            "length": "above-the-knee",
            "opening-type": "fly",
            "textile-finishing-manufacturing-techniques": "pleat",
        },
        "High-waisted pleated shorts that pair with knit polos and camp shirts.",
    ),
    (
        "item:resort-wrap-skirt",
        "Linen wrap skirt",
        "skirt",
        "resort",
        "terracotta",
        "linen",
        {
            "silhouette": "a-line",
            "waistline": "high waist",
            "length": "midi",
            "opening-type": "wrapping",
            "nickname": "nickname:wrap-skirt",
        },
        "Midi wrap skirt with a self-tie waist in sun-faded terracotta.",
    ),
    (
        "item:resort-shirt-dress",
        "Linen shirt dress",
        "dress",
        "resort",
        "white",
        "linen",
        {
            "silhouette": "loose",
            "nickname": "nickname:shirt-dress",
            "length": "midi",
            "opening-type": "single breasted",
            "waistline": "dropped waistline",
        },
        "Relaxed shirt dress in washed linen; belt it or wear it open over the tank.",
    ),
    (
        "item:resort-slip-dress",
        "Bias-cut slip dress",
        "dress",
        "resort",
        "sage",
        "cupro",
        {
            "silhouette": "straight",
            "neckline-type": "cowl",
            "length": "midi",
            "opening-type": "no opening",
            "waistline": "no waistline",
            "nickname": "nickname:slip-dress",
        },
        "Fluid bias-cut slip dress with a cowl neck; day to evening.",
    ),
    (
        "item:resort-jumpsuit",
        "Utility linen jumpsuit",
        "jumpsuit",
        "resort",
        "olive",
        "linen",
        {
            "silhouette": "loose",
            "neckline-type": "v-neck",
            "length": "floor",
            "opening-type": "zip-up",
            "waistline": "normal waist",
        },
        "One-piece linen jumpsuit with a belted waist and zip front.",
    ),
    (
        "item:resort-espadrille",
        "Canvas espadrille",
        "shoe",
        "resort",
        "natural",
        "canvas",
        {"opening-type": "no opening", "non-textile-material-type": "rubber"},
        "Slip-on canvas espadrille on a jute-wrapped sole.",
    ),
    (
        "item:resort-leather-sandal",
        "Leather slide sandal",
        "shoe",
        "resort",
        "tan",
        "leather",
        {"opening-type": "buckled", "non-textile-material-type": "metal"},
        "Minimal leather slide with a brass buckle.",
    ),
    (
        "item:resort-straw-hat",
        "Wide-brim straw hat",
        "hat",
        "resort",
        "natural",
        "raffia",
        {"textile-pattern": "plain"},
        "Wide-brim raffia hat with a cotton band.",
    ),
    (
        "item:resort-sunglasses",
        "Round acetate sunglasses",
        "glasses",
        "resort",
        "tortoise",
        "acetate",
        {"non-textile-material-type": "plastic"},
        "Round tortoiseshell acetate frames.",
    ),
    (
        "item:resort-basket-bag",
        "Woven basket bag",
        "bag",
        "resort",
        "natural",
        "palm leaf",
        {"non-textile-material-type": "wood"},
        "Hand-woven palm basket bag with leather handles.",
    ),
    (
        "item:resort-woven-belt",
        "Braided leather belt",
        "belt",
        "resort",
        "tan",
        "leather",
        {"non-textile-material-type": "metal"},
        "Braided tan leather belt with a matte buckle.",
    ),
    (
        "item:resort-silk-scarf",
        "Printed silk scarf",
        "scarf",
        "resort",
        "coral",
        "silk",
        {},
        "Square silk scarf with a sun-faded botanical print; wear at the neck or on a bag.",
    ),
    # ---------------------------------------------------------------- Evening (evening)
    (
        "item:evening-tux-jacket",
        "Satin-lapel tuxedo jacket",
        "jacket",
        "evening",
        "black",
        "wool",
        {
            "silhouette": "tight",
            "opening-type": "single breasted",
            "length": "hip",
            "textile-pattern": "plain",
            "textile-finishing-manufacturing-techniques": "lining",
            "nickname": "nickname:tuxedo-jacket",
        },
        "Slim single-breasted tuxedo jacket with satin lapels; the Evening line's centerpiece.",
    ),
    (
        "item:evening-db-blazer",
        "Double-breasted blazer",
        "jacket",
        "evening",
        "midnight",
        "wool",
        {
            "silhouette": "regular",
            "opening-type": "double breasted",
            "length": "hip",
            "textile-pattern": "plain",
            "nickname": "nickname:peak-lapel",
        },
        "Sharp double-breasted blazer in midnight wool with peak lapels.",
    ),
    (
        "item:evening-silk-blouse",
        "Silk tie-neck blouse",
        "shirt",
        "evening",
        "ivory",
        "silk",
        {
            "silhouette": "loose",
            "neckline-type": "high",
            "opening-type": "single breasted",
            "length": "hip",
            "textile-pattern": "plain",
            "nickname": "nickname:bow-collar",
        },
        "Fluid silk blouse with a high neck and a self-tie bow.",
    ),
    (
        "item:evening-cashmere-turtleneck",
        "Fine cashmere turtleneck",
        "sweater",
        "evening",
        "black",
        "cashmere",
        {
            "silhouette": "tight",
            "neckline-type": "turtle",
            "length": "hip",
            "textile-pattern": "plain",
        },
        "Fine-gauge cashmere turtleneck; the understated base under tailoring.",
    ),
    (
        "item:evening-cami",
        "Satin camisole",
        "top",
        "evening",
        "champagne",
        "satin",
        {
            "silhouette": "tight",
            "neckline-type": "v-neck",
            "length": "hip",
            "nickname": "nickname:camisole",
        },
        "Bias-cut satin camisole with fine straps.",
    ),
    (
        "item:evening-tux-trousers",
        "Satin-stripe tuxedo trousers",
        "pants",
        "evening",
        "black",
        "wool",
        {
            "silhouette": "straight",
            "waistline": "high waist",
            "length": "floor",
            "opening-type": "fly",
            "textile-pattern": "plain",
        },
        "High-waisted straight tuxedo trousers with a satin side stripe.",
    ),
    (
        "item:evening-wide-trousers",
        "Fluid wide-leg trousers",
        "pants",
        "evening",
        "midnight",
        "crepe",
        {
            "silhouette": "wide leg",
            "waistline": "high waist",
            "length": "floor",
            "opening-type": "fly",
        },
        "Fluid wide-leg crepe trousers that move like a skirt.",
    ),
    (
        "item:evening-pencil-skirt",
        "Satin pencil skirt",
        "skirt",
        "evening",
        "burgundy",
        "satin",
        {
            "silhouette": "pencil",
            "waistline": "high waist",
            "length": "midi",
            "opening-type": "zip-up",
            "textile-finishing-manufacturing-techniques": "slit",
        },
        "High-waisted satin pencil skirt with a back slit.",
    ),
    (
        "item:evening-column-dress",
        "Column gown",
        "dress",
        "evening",
        "black",
        "crepe",
        {
            "silhouette": "straight",
            "neckline-type": "boat",
            "length": "floor",
            "opening-type": "zip-up",
            "waistline": "no waistline",
            "nickname": "nickname:gown",
        },
        "Floor-length column dress with a boat neck and clean back.",
    ),
    (
        "item:evening-velvet-cape",
        "Velvet evening cape",
        "cape",
        "evening",
        "oxblood",
        "velvet",
        {
            "silhouette": "loose",
            "neckline-type": "high",
            "length": "hip",
            "opening-type": "no opening",
        },
        "Short velvet cape with a stand collar; worn over the column gown or tuxedo.",
    ),
    (
        "item:evening-overcoat",
        "Tailored wool overcoat",
        "coat",
        "evening",
        "camel",
        "wool cashmere",
        {
            "silhouette": "regular",
            "opening-type": "single breasted",
            "length": "knee",
            "textile-pattern": "plain",
            "textile-finishing-manufacturing-techniques": "lining",
        },
        "Knee-length single-breasted overcoat in camel wool-cashmere.",
    ),
    (
        "item:evening-patent-loafer",
        "Patent leather loafer",
        "shoe",
        "evening",
        "black",
        "patent leather",
        {"opening-type": "no opening"},
        "Slim patent loafer with a low stacked heel.",
    ),
    (
        "item:evening-strappy-heel",
        "Strappy satin heel",
        "shoe",
        "evening",
        "black",
        "satin",
        {"opening-type": "buckled", "non-textile-material-type": "metal"},
        "Strappy satin sandal on a slender heel.",
    ),
    (
        "item:evening-clutch",
        "Box clutch",
        "bag",
        "evening",
        "gold",
        "metal",
        {"non-textile-material-type": "metal"},
        "Rigid box clutch in brushed gold metal.",
    ),
    (
        "item:evening-silk-tie",
        "Slim silk tie",
        "tie",
        "evening",
        "black",
        "silk",
        {},
        "Slim black silk tie with a subtle sheen.",
    ),
    (
        "item:evening-dress-watch",
        "Slim dress watch",
        "watch",
        "evening",
        "gold",
        "steel",
        {"non-textile-material-type": "metal"},
        "Thin gold-tone dress watch on a black leather strap.",
    ),
    (
        "item:evening-sheer-tights",
        "Sheer tights",
        "tights",
        "evening",
        "black",
        "nylon",
        {"textile-pattern": "plain"},
        "Sheer black tights.",
    ),
    (
        "item:evening-evening-gloves",
        "Opera gloves",
        "glove",
        "evening",
        "black",
        "satin",
        {},
        "Elbow-length satin opera gloves.",
    ),
]

# id, name, occasion, description, item ids (ids without the "item:" prefix)
LOOK_SEEDS: list[tuple] = [
    (
        "look:utility-site-day",
        "Site day",
        "work / outdoors",
        "The working uniform: waxed field jacket over a thermal henley, cargo pants, moc-toe boots.",
        [
            "utility-field-jacket",
            "utility-henley",
            "utility-cargo-pants",
            "utility-work-boot",
            "utility-boot-sock",
        ],
    ),
    (
        "look:utility-weekend-layers",
        "Weekend layers",
        "casual weekend",
        "Flannel overshirt under the corduroy chore coat with selvedge jeans and suede chukkas.",
        [
            "utility-chore-coat",
            "utility-flannel-shirt",
            "utility-selvedge-jeans",
            "utility-suede-chukka",
            "utility-beanie",
        ],
    ),
    (
        "look:utility-cold-snap",
        "Cold snap",
        "cold weather",
        "Fisherman sweater over the henley, quilted vest on top, carpenter pants and boots; herringbone scarf.",
        [
            "utility-fisherman-sweater",
            "utility-henley",
            "utility-quilted-vest",
            "utility-carpenter-pants",
            "utility-work-boot",
            "utility-wool-scarf",
        ],
    ),
    (
        "look:utility-soft-shell",
        "Soft shell",
        "casual",
        "Shawl-collar cardigan as the outer layer with a flannel shirt, jeans and a bridle belt.",
        [
            "utility-shawl-cardigan",
            "utility-flannel-shirt",
            "utility-selvedge-jeans",
            "utility-belt",
            "utility-suede-chukka",
        ],
    ),
    (
        "look:utility-summer-utility",
        "Summer utility",
        "warm weather / outdoors",
        "Work shorts with the thermal henley, boots and the waxed tote.",
        ["utility-work-shorts", "utility-henley", "utility-work-boot", "utility-tote"],
    ),
    (
        "look:resort-harbour",
        "Harbour walk",
        "resort / daytime",
        "Camp-collar linen shirt open over the ribbed tank, drawstring pants, espadrilles and the straw hat.",
        [
            "resort-linen-shirt",
            "resort-tank",
            "resort-drawstring-pants",
            "resort-espadrille",
            "resort-straw-hat",
        ],
    ),
    (
        "look:resort-terrace-lunch",
        "Terrace lunch",
        "resort / daytime",
        "Striped linen shirt with pleated linen shorts, leather slides and round sunglasses.",
        [
            "resort-stripe-shirt",
            "resort-pleated-shorts",
            "resort-leather-sandal",
            "resort-sunglasses",
            "resort-basket-bag",
        ],
    ),
    (
        "look:resort-golden-hour",
        "Golden hour",
        "resort / evening",
        "The slip dress under the unlined linen blazer with leather slides and a silk scarf at the neck.",
        [
            "resort-slip-dress",
            "resort-linen-blazer",
            "resort-leather-sandal",
            "resort-silk-scarf",
        ],
    ),
    (
        "look:resort-market",
        "Market morning",
        "resort / daytime",
        "Linen wrap skirt with the ribbed tank and open-knit polo over it, espadrilles, basket bag.",
        [
            "resort-wrap-skirt",
            "resort-tank",
            "resort-knit-polo",
            "resort-espadrille",
            "resort-basket-bag",
        ],
    ),
    (
        "look:resort-shirt-dress-day",
        "Shirt dress day",
        "resort / daytime",
        "Linen shirt dress belted with the braided belt, sandals and the straw hat.",
        [
            "resort-shirt-dress",
            "resort-woven-belt",
            "resort-leather-sandal",
            "resort-straw-hat",
        ],
    ),
    (
        "look:resort-jumpsuit-city",
        "Jumpsuit in the city",
        "casual / city",
        "Utility jumpsuit with espadrilles and round sunglasses; the linen blazer over the shoulders.",
        [
            "resort-jumpsuit",
            "resort-espadrille",
            "resort-sunglasses",
            "resort-linen-blazer",
        ],
    ),
    (
        "look:evening-black-tie",
        "Black tie",
        "evening / formal",
        "Satin-lapel tuxedo jacket, tuxedo trousers, cashmere turtleneck instead of a shirt, patent loafers.",
        [
            "evening-tux-jacket",
            "evening-tux-trousers",
            "evening-cashmere-turtleneck",
            "evening-patent-loafer",
            "evening-dress-watch",
        ],
    ),
    (
        "look:evening-gala",
        "Gala",
        "evening / formal",
        "Column gown under the velvet cape with strappy heels, the box clutch and opera gloves.",
        [
            "evening-column-dress",
            "evening-velvet-cape",
            "evening-strappy-heel",
            "evening-clutch",
            "evening-evening-gloves",
        ],
    ),
    (
        "look:evening-dinner",
        "Dinner",
        "evening / smart",
        "Silk tie-neck blouse tucked into the satin pencil skirt, sheer tights and patent loafers.",
        [
            "evening-silk-blouse",
            "evening-pencil-skirt",
            "evening-sheer-tights",
            "evening-patent-loafer",
            "evening-clutch",
        ],
    ),
    (
        "look:evening-boardroom",
        "Boardroom",
        "business / smart",
        "Double-breasted blazer over the cashmere turtleneck with fluid wide-leg trousers and loafers.",
        [
            "evening-db-blazer",
            "evening-cashmere-turtleneck",
            "evening-wide-trousers",
            "evening-patent-loafer",
            "evening-dress-watch",
        ],
    ),
    (
        "look:evening-cocktail",
        "Cocktail hour",
        "evening / smart",
        "Satin camisole under the double-breasted blazer, tuxedo trousers, strappy heels.",
        [
            "evening-cami",
            "evening-db-blazer",
            "evening-tux-trousers",
            "evening-strappy-heel",
            "evening-clutch",
        ],
    ),
    (
        "look:evening-winter-evening",
        "Winter evening",
        "evening / cold weather",
        "Camel overcoat over the black-tie look; slim silk tie with the tuxedo jacket.",
        [
            "evening-overcoat",
            "evening-tux-jacket",
            "evening-tux-trousers",
            "evening-silk-tie",
            "evening-patent-loafer",
        ],
    ),
    # Cross-line looks: the brand's "high-low" styling rule made concrete.
    (
        "look:cross-tux-and-denim",
        "Tuxedo and denim",
        "evening / relaxed",
        "The Evening line's tuxedo jacket worn with the Utility line's selvedge jeans and suede chukkas; an AnyCompany Apparel signature mix.",
        [
            "evening-tux-jacket",
            "utility-selvedge-jeans",
            "utility-suede-chukka",
            "evening-cashmere-turtleneck",
        ],
    ),
    (
        "look:cross-linen-and-tailoring",
        "Linen and tailoring",
        "smart casual",
        "The Resort camp shirt under the Evening line's double-breasted blazer, with drawstring linen pants and loafers.",
        [
            "resort-linen-shirt",
            "evening-db-blazer",
            "resort-drawstring-pants",
            "evening-patent-loafer",
        ],
    ),
]

# Category-level curatorial rules: (source category, target category, occasion, rationale)
CATEGORY_RULES: list[tuple] = [
    (
        "jacket",
        "pants",
        "any",
        "Every AnyCompany Apparel jacket is cut to sit over a high-rise trouser; the proportion is the brand's core silhouette.",
    ),
    (
        "jacket",
        "skirt",
        "smart",
        "Tailored jackets pair with midi skirts; the hem should clear the jacket by a hand's width.",
    ),
    (
        "jacket",
        "top",
        "any",
        "Jackets layer over knit tops and camisoles rather than shirts when the look is relaxed.",
    ),
    ("coat", "sweater", "cold weather", "Outerwear is sized to layer over chunky knitwear."),
    (
        "shirt",
        "pants",
        "any",
        "Shirts are worn tucked into high-rise trousers or open over a tank.",
    ),
    (
        "shirt",
        "shorts",
        "warm weather",
        "Camp and stripe shirts pair with pleated or utility shorts.",
    ),
    (
        "dress",
        "cape",
        "evening",
        "Evening dresses take a short cape instead of a jacket to keep the line clean.",
    ),
    ("dress", "belt", "daytime", "Loose shirt dresses are belted; fitted dresses never are."),
    ("sweater", "pants", "any", "Knitwear tucks into or sits just over high-rise trousers."),
    (
        "pants",
        "shoe",
        "any",
        "Trouser hems break on the shoe; wide legs take a slim shoe, straight legs a boot.",
    ),
    (
        "skirt",
        "tights",
        "cold weather",
        "Midi skirts take sheer tights in winter, bare legs in summer.",
    ),
    ("hat", "glasses", "resort", "Straw hats pair with round acetate frames."),
]

# Item-level pairings (LAYERED_WITH): (source item, target item, rationale)
ITEM_RULES: list[tuple] = [
    (
        "utility-field-jacket",
        "utility-henley",
        "The jacket's short body wants a plain base layer, not a shirt collar.",
    ),
    (
        "utility-field-jacket",
        "utility-cargo-pants",
        "Waxed cotton and ripstop share the utility register.",
    ),
    (
        "utility-field-jacket",
        "utility-work-boot",
        "Field jacket and work boot are sold as a set in-store.",
    ),
    (
        "utility-trench",
        "utility-selvedge-jeans",
        "The trench over straight high-rise jeans, rolled once so the boot shows, is the Utility line's autumn opener.",
    ),
    (
        "utility-chore-coat",
        "utility-flannel-shirt",
        "Corduroy over brushed flannel: two textures, one palette.",
    ),
    (
        "utility-chore-coat",
        "utility-selvedge-jeans",
        "Rust corduroy against indigo is the Utility line's color story.",
    ),
    (
        "utility-quilted-vest",
        "utility-fisherman-sweater",
        "The vest is cut wide enough to sit over the chunky rib.",
    ),
    (
        "utility-fisherman-sweater",
        "utility-carpenter-pants",
        "Oversized knit balances a wide canvas leg.",
    ),
    ("utility-shawl-cardigan", "utility-flannel-shirt", "Soft outer layer over a check shirt."),
    (
        "utility-selvedge-jeans",
        "utility-suede-chukka",
        "Straight rinse denim breaks cleanly on a crepe-soled chukka.",
    ),
    ("utility-cargo-pants", "utility-work-boot", "Straight leg over a lug sole."),
    (
        "resort-linen-shirt",
        "resort-tank",
        "The camp shirt is always worn open over the ribbed tank.",
    ),
    ("resort-linen-shirt", "resort-drawstring-pants", "Tonal linen on linen."),
    (
        "resort-stripe-shirt",
        "resort-pleated-shorts",
        "Navy stripe with white pleated shorts is the terrace uniform.",
    ),
    ("resort-linen-blazer", "resort-slip-dress", "Unstructured tailoring over a fluid slip."),
    (
        "resort-linen-blazer",
        "resort-drawstring-pants",
        "The unlined blazer works as a linen suit with the drawstring pant.",
    ),
    (
        "resort-wrap-skirt",
        "resort-tank",
        "Wrap skirt with a fitted tank keeps the waist visible.",
    ),
    (
        "resort-shirt-dress",
        "resort-woven-belt",
        "The shirt dress is belted at the natural waist.",
    ),
    ("resort-straw-hat", "resort-sunglasses", "Wide brim and round frames."),
    ("resort-drawstring-pants", "resort-espadrille", "Wide linen leg over a flat canvas shoe."),
    ("evening-tux-jacket", "evening-tux-trousers", "The tuxedo is one piece in two parts."),
    (
        "evening-tux-jacket",
        "evening-cashmere-turtleneck",
        "Turtleneck instead of a dress shirt is the Evening line's black-tie signature.",
    ),
    (
        "evening-tux-jacket",
        "evening-patent-loafer",
        "Patent loafer, never a lace-up, with the tuxedo.",
    ),
    (
        "evening-db-blazer",
        "evening-wide-trousers",
        "Double-breasted volume above, fluid volume below.",
    ),
    (
        "evening-db-blazer",
        "evening-cami",
        "A satin camisole softens the double-breasted blazer for evening.",
    ),
    ("evening-silk-blouse", "evening-pencil-skirt", "High neck above, pencil line below."),
    (
        "evening-pencil-skirt",
        "evening-sheer-tights",
        "Satin skirt with sheer black tights for winter dinners.",
    ),
    (
        "evening-column-dress",
        "evening-velvet-cape",
        "The cape covers the shoulders without breaking the column.",
    ),
    (
        "evening-column-dress",
        "evening-strappy-heel",
        "A slender heel keeps the floor-length line.",
    ),
    (
        "evening-overcoat",
        "evening-tux-jacket",
        "The camel overcoat is cut to clear the tuxedo jacket.",
    ),
    # Cross-line signatures
    (
        "evening-tux-jacket",
        "utility-selvedge-jeans",
        "High-low: the tuxedo jacket over raw denim is an AnyCompany Apparel signature.",
    ),
    ("evening-db-blazer", "resort-linen-shirt", "Sharp tailoring over a relaxed camp collar."),
]

ARTICLE_SEEDS: list[tuple] = [
    (
        "article:anycompany-apparel-journal-01",
        "Notes on layering: how the Utility line does it",
        "AnyCompany Apparel Journal",
        "2026-09-01",
        [
            (
                "st:layering-1",
                "Start with a plain base layer: the thermal henley under everything, so collars never compete.",
                ["look:utility-site-day", "item:utility-henley"],
            ),
            (
                "st:layering-2",
                "The waxed field jacket is cut short on purpose; it should end where a high-rise trouser begins.",
                ["item:utility-field-jacket", "look:utility-site-day"],
            ),
            (
                "st:layering-3",
                "Corduroy over brushed flannel gives two textures in one palette; keep both in the earth range.",
                ["look:utility-weekend-layers"],
            ),
            (
                "st:layering-4",
                "When it turns cold, the quilted vest goes over the fisherman sweater, not under it.",
                ["look:utility-cold-snap"],
            ),
            (
                "st:layering-5",
                "Rinse denim breaks cleanly on a crepe sole; save the lug boot for canvas.",
                ["item:utility-suede-chukka", "item:utility-work-boot"],
            ),
        ],
    ),
    (
        "article:anycompany-apparel-journal-02",
        "Linen, worn properly",
        "AnyCompany Apparel Journal",
        "2026-06-15",
        [
            (
                "st:linen-1",
                "Linen is meant to crease. The unlined blazer looks best after a day, not before.",
                ["item:resort-linen-blazer"],
            ),
            (
                "st:linen-2",
                "The camp-collar shirt is always worn open over the ribbed tank; buttoned up it loses the point.",
                ["look:resort-harbour", "item:resort-linen-shirt"],
            ),
            (
                "st:linen-3",
                "Pair tonal linen on linen for daytime; add one color, the terracotta wrap skirt or the coral scarf, for evening.",
                ["look:resort-market", "look:resort-golden-hour"],
            ),
            (
                "st:linen-4",
                "Pleated shorts sit at the natural waist and finish above the knee; the striped linen shirt stays untucked.",
                ["look:resort-terrace-lunch"],
            ),
            (
                "st:linen-5",
                "A wide linen leg needs a flat shoe: espadrille or slide, never a heel.",
                ["item:resort-drawstring-pants", "item:resort-espadrille"],
            ),
        ],
    ),
    (
        "article:anycompany-apparel-journal-03",
        "Black tie, the Evening line's way",
        "AnyCompany Apparel Journal",
        "2026-11-20",
        [
            (
                "st:blacktie-1",
                "The Evening line's black tie replaces the dress shirt with a fine cashmere turtleneck under the satin-lapel jacket.",
                ["look:evening-black-tie", "item:evening-cashmere-turtleneck"],
            ),
            (
                "st:blacktie-2",
                "Patent loafers, never lace-ups, with the tuxedo trouser.",
                ["item:evening-patent-loafer", "look:evening-black-tie"],
            ),
            (
                "st:blacktie-3",
                "For gala dressing the column gown takes the velvet cape rather than a jacket; nothing should break the vertical line.",
                ["look:evening-gala"],
            ),
            (
                "st:blacktie-4",
                "The double-breasted blazer over a satin camisole is the house cocktail look.",
                ["look:evening-cocktail"],
            ),
            (
                "st:blacktie-5",
                "A slim silk tie appears only with the tuxedo jacket and only in winter, under the camel overcoat.",
                ["look:evening-winter-evening"],
            ),
        ],
    ),
    (
        "article:anycompany-apparel-journal-04",
        "High-low: mixing the lines",
        "AnyCompany Apparel Journal",
        "2026-10-05",
        [
            (
                "st:highlow-1",
                "The tuxedo jacket over raw selvedge denim and suede chukkas is the most AnyCompany Apparel outfit there is.",
                ["look:cross-tux-and-denim"],
            ),
            (
                "st:highlow-2",
                "Sharp Evening tailoring over a relaxed Resort camp collar reads as effortless rather than undone.",
                ["look:cross-linen-and-tailoring"],
            ),
            (
                "st:highlow-3",
                "Cross the lines by texture, not by color: keep one palette and change the fabric weight.",
                ["look:cross-tux-and-denim", "look:cross-linen-and-tailoring"],
            ),
        ],
    ),
    (
        "article:anycompany-apparel-fit-guide",
        "Fit and proportion guide",
        "AnyCompany Apparel Fit Guide",
        "2026-08-01",
        [
            (
                "st:fit-1",
                "Every AnyCompany Apparel jacket is cut to sit over a high-rise trouser; the proportion is the brand's core silhouette.",
                [
                    "item:utility-field-jacket",
                    "item:evening-tux-jacket",
                    "item:resort-linen-blazer",
                ],
            ),
            (
                "st:fit-2",
                "Oversized knitwear balances a wide leg; slim knitwear balances a straight leg.",
                ["look:utility-cold-snap", "look:evening-boardroom"],
            ),
            (
                "st:fit-3",
                "Trouser hems break on the shoe: wide legs take a slim shoe, straight legs take a boot.",
                ["item:evening-wide-trousers", "item:utility-cargo-pants"],
            ),
            (
                "st:fit-4",
                "Loose shirt dresses are belted at the natural waist; fitted dresses never are.",
                ["look:resort-shirt-dress-day", "item:resort-slip-dress"],
            ),
        ],
    ),
]


def build_catalog(ontology: Ontology) -> dict:
    """Return the catalog as JSON-ready dicts, validating every attribute against the ontology."""
    lines_by_id = {l.id: l for l in LINES}
    items: list[Item] = []
    for iid, name, cat_id, line, color, material, attrs, desc in ITEM_SEEDS:
        cat = ontology.categories.get(cat_id)
        if cat is None:
            raise ValueError(f"{iid}: unknown category {cat_id}")
        valid, rejected = ontology.validate_attributes(cat_id, attrs)
        if rejected:
            raise ValueError(f"{iid}: attributes not in ontology: {rejected}")
        line_id = f"line:{line}"
        if line_id not in lines_by_id:
            raise ValueError(f"{iid}: unknown line {line}")
        items.append(Item(iid, name, cat_id, line_id, desc, color, material, valid))
    item_ids = {i.id for i in items}

    looks: list[Look] = []
    for lid, name, occasion, desc, ids in LOOK_SEEDS:
        full = [f"item:{i}" for i in ids]
        missing = [i for i in full if i not in item_ids]
        if missing:
            raise ValueError(f"{lid}: unknown items {missing}")
        looks.append(Look(lid, name, occasion, desc, full))
    look_ids = {l.id for l in looks}

    rules: list[PairingRule] = []
    for src, dst, occasion, rationale in CATEGORY_RULES:
        for c in (src, dst):
            if c not in ontology.categories:
                raise ValueError(f"category rule: unknown category {c}")
        rules.append(PairingRule(src, dst, "category", rationale, occasion))
    for src, dst, rationale in ITEM_RULES:
        s, d = f"item:{src}", f"item:{dst}"
        if s not in item_ids or d not in item_ids:
            raise ValueError(f"item rule: unknown items {s} / {d}")
        rules.append(PairingRule(s, d, "item", rationale))

    articles: list[Article] = []
    for aid, title, source, published, sts in ARTICLE_SEEDS:
        statements = []
        for sid, text, targets in sts:
            for t in targets:
                if t not in item_ids and t not in look_ids:
                    raise ValueError(f"{sid}: unknown target {t}")
            statements.append(Statement(sid, text, targets))
        articles.append(Article(aid, title, source, published, statements))

    def record(obj) -> dict:  # the sample carries no extra node properties: keep the files lean
        return {k: v for k, v in asdict(obj).items() if k != "props"}

    return {
        "brand": asdict(BRAND),
        "lines": [asdict(l) for l in LINES],
        "items": [record(i) for i in items],
        "looks": [record(l) for l in looks],
        "pairing_rules": [asdict(r) for r in rules],
        "articles": [asdict(a) for a in articles],
    }


def write_catalog(ontology: Ontology, out_dir: str | Path) -> dict[str, int]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    catalog = build_catalog(ontology)
    counts = {}
    for key, value in catalog.items():
        (out / f"{key}.json").write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
        counts[key] = len(value) if isinstance(value, list) else 1
    (out / "README.md").write_text(SAMPLE_README)
    return counts


SAMPLE_README = """# AnyCompany Apparel: a data set of the fashion domain (synthetic)

Generated by `ontology-rag synth` from `backend/src/ontology_rag/synth.py`, in the catalog format
of [`../README.md`](../README.md). When fashion is the graph's domain (the default), the stack's
graph loader loads it into the graph at deploy, together with every other data set of the domain.

**All content is fictional.** "AnyCompany Apparel", its lines (Utility, Resort, Evening), products, looks
and editorial copy were written for this sample and do not describe any real brand, customer or
dataset. No product images are included. To bring your own catalog and images, add a data set
folder next to this one and redeploy; see
[`docs/bring-your-own-data.md`](../../../../docs/bring-your-own-data.md).

| File | Contents |
|------|----------|
| `brand.json`, `lines.json` | Brand and its three lines |
| `items.json` | Products with ontology-grounded attributes (category ids and attribute ids resolve to `ontologies/fashion/fashion.ttl`) |
| `looks.json` | Curated outfits (Look -[CONTAINS]-> Item) |
| `pairing_rules.json` | Curatorial rules: category-level `PAIRS_WITH` and item-level `LAYERED_WITH` edges |
| `articles.json` | Editorial articles decomposed into statements that illustrate looks/items |
| `domain.json` | Written by hand, not by `synth`: AnyCompany Apparel's example questions and the worked examples of tab 3's query agent, added to the domain's lists |
"""
