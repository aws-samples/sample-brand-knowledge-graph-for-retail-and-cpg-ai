# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""Deterministic synthetic catalog for a fictional brand.

Everything here is invented: the brand "Velloway", its lines, products, looks and
editorial copy. No real brand, customer or dataset is represented. The generator is
deterministic so the data set ``ontologies/fashion/datasets/velloway`` (``ontology-rag synth``)
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

SET_ID = "velloway"  # the data set folder synth writes: ontologies/<domain>/datasets/<SET_ID>/

BRAND = Brand(
    id="brand:velloway",
    name="Velloway",
    description=(
        "Velloway is a contemporary label built on three lines: Atlas, utility heritage in waxed "
        "cotton and corduroy; Solstice, warm-weather resort in linen; Meridian, evening tailoring "
        "in wool, satin and velvet. Every piece is cut to pair across the lines."
    ),
)

LINES = [
    Line(
        "line:atlas",
        "Atlas",
        BRAND.id,
        "Utility and workwear heritage: waxed cotton, corduroy, brass hardware.",
        "AW",
    ),
    Line(
        "line:solstice",
        "Solstice",
        BRAND.id,
        "Warm-weather resort: linen, airy silhouettes, sun-faded color.",
        "SS",
    ),
    Line(
        "line:meridian",
        "Meridian",
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
    # ---------------------------------------------------------------- Atlas (utility)
    (
        "item:atlas-field-jacket",
        "Waxed field jacket",
        "jacket",
        "atlas",
        "olive",
        "waxed cotton",
        {
            "silhouette": "regular",
            "opening-type": "zip-up",
            "length": "hip",
            "textile-pattern": "plain",
            "nickname": "nickname:safari-jacket",
        },
        "Four-pocket waxed cotton field jacket with corduroy collar and brass zip; the Atlas anchor piece.",
    ),
    (
        "item:atlas-trench",
        "Cotton gabardine trench coat",
        "coat",
        "atlas",
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
        "item:atlas-chore-coat",
        "Corduroy chore coat",
        "coat",
        "atlas",
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
        "item:atlas-quilted-vest",
        "Quilted liner vest",
        "vest",
        "atlas",
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
        "item:atlas-flannel-shirt",
        "Brushed flannel overshirt",
        "shirt",
        "atlas",
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
        "item:atlas-henley",
        "Thermal henley",
        "top",
        "atlas",
        "ecru",
        "waffle cotton",
        {
            "silhouette": "regular",
            "neckline-type": "round",
            "length": "hip",
            "textile-pattern": "plain",
            "nickname": "nickname:henley-shirt",
        },
        "Waffle-knit henley with a three-button placket; the base layer of the Atlas line.",
    ),
    (
        "item:atlas-fisherman-sweater",
        "Fisherman rib sweater",
        "sweater",
        "atlas",
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
        "item:atlas-shawl-cardigan",
        "Shawl-collar cardigan",
        "cardigan",
        "atlas",
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
        "item:atlas-cargo-pants",
        "Ripstop cargo pants",
        "pants",
        "atlas",
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
        "item:atlas-carpenter-pants",
        "Duck canvas carpenter pants",
        "pants",
        "atlas",
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
        "item:atlas-selvedge-jeans",
        "Selvedge denim jeans",
        "pants",
        "atlas",
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
        "item:atlas-work-shorts",
        "Canvas work shorts",
        "shorts",
        "atlas",
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
        "item:atlas-work-boot",
        "Moc-toe work boot",
        "shoe",
        "atlas",
        "brown",
        "full-grain leather",
        {"opening-type": "lace up", "non-textile-material-type": "rubber"},
        "Goodyear-welted moc-toe boot on a rubber lug sole; the Atlas footwear staple.",
    ),
    (
        "item:atlas-suede-chukka",
        "Suede chukka boot",
        "shoe",
        "atlas",
        "sand",
        "suede",
        {"opening-type": "lace up", "leather": "suede"},
        "Two-eyelet suede chukka on a crepe sole; dresses the cargo pants up.",
    ),
    (
        "item:atlas-beanie",
        "Rib-knit watch cap",
        "hat",
        "atlas",
        "charcoal",
        "merino wool",
        {"textile-pattern": "plain"},
        "Close-fitting ribbed watch cap in merino.",
    ),
    (
        "item:atlas-tote",
        "Waxed canvas tote",
        "bag",
        "atlas",
        "olive",
        "waxed canvas",
        {"non-textile-material-type": "metal"},
        "Structured waxed canvas tote with brass rivets and leather handles.",
    ),
    (
        "item:atlas-belt",
        "Bridle leather belt",
        "belt",
        "atlas",
        "brown",
        "bridle leather",
        {"non-textile-material-type": "metal"},
        "Thick bridle leather belt with a solid brass buckle.",
    ),
    (
        "item:atlas-wool-scarf",
        "Herringbone wool scarf",
        "scarf",
        "atlas",
        "gray",
        "lambswool",
        {},
        "Long lambswool scarf woven in a herringbone twill.",
    ),
    (
        "item:atlas-boot-sock",
        "Boot sock",
        "sock",
        "atlas",
        "oatmeal",
        "wool blend",
        {"textile-pattern": "plain"},
        "Cushioned wool-blend boot sock.",
    ),
    # ---------------------------------------------------------------- Solstice (resort)
    (
        "item:solstice-linen-shirt",
        "Camp-collar linen shirt",
        "shirt",
        "solstice",
        "white",
        "linen",
        {
            "silhouette": "loose",
            "nickname": "nickname:shirt-collar",
            "opening-type": "single breasted",
            "length": "hip",
            "textile-pattern": "plain",
        },
        "Boxy camp-collar shirt in washed linen; the Solstice signature.",
    ),
    (
        "item:solstice-stripe-shirt",
        "Striped linen shirt",
        "shirt",
        "solstice",
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
        "item:solstice-knit-polo",
        "Open-knit polo",
        "top",
        "solstice",
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
        "item:solstice-tank",
        "Ribbed tank",
        "top",
        "solstice",
        "ivory",
        "organic cotton",
        {
            "silhouette": "tight",
            "neckline-type": "scoop",
            "length": "hip",
            "nickname": "nickname:tank-top",
        },
        "Fine ribbed scoop-neck tank; the layer under every Solstice shirt.",
    ),
    (
        "item:solstice-linen-blazer",
        "Unlined linen blazer",
        "jacket",
        "solstice",
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
        "item:solstice-drawstring-pants",
        "Drawstring linen pants",
        "pants",
        "solstice",
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
        "item:solstice-pleated-shorts",
        "Pleated linen shorts",
        "shorts",
        "solstice",
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
        "item:solstice-wrap-skirt",
        "Linen wrap skirt",
        "skirt",
        "solstice",
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
        "item:solstice-shirt-dress",
        "Linen shirt dress",
        "dress",
        "solstice",
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
        "item:solstice-slip-dress",
        "Bias-cut slip dress",
        "dress",
        "solstice",
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
        "item:solstice-jumpsuit",
        "Utility linen jumpsuit",
        "jumpsuit",
        "solstice",
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
        "item:solstice-espadrille",
        "Canvas espadrille",
        "shoe",
        "solstice",
        "natural",
        "canvas",
        {"opening-type": "no opening", "non-textile-material-type": "rubber"},
        "Slip-on canvas espadrille on a jute-wrapped sole.",
    ),
    (
        "item:solstice-leather-sandal",
        "Leather slide sandal",
        "shoe",
        "solstice",
        "tan",
        "leather",
        {"opening-type": "buckled", "non-textile-material-type": "metal"},
        "Minimal leather slide with a brass buckle.",
    ),
    (
        "item:solstice-straw-hat",
        "Wide-brim straw hat",
        "hat",
        "solstice",
        "natural",
        "raffia",
        {"textile-pattern": "plain"},
        "Wide-brim raffia hat with a cotton band.",
    ),
    (
        "item:solstice-sunglasses",
        "Round acetate sunglasses",
        "glasses",
        "solstice",
        "tortoise",
        "acetate",
        {"non-textile-material-type": "plastic"},
        "Round tortoiseshell acetate frames.",
    ),
    (
        "item:solstice-basket-bag",
        "Woven basket bag",
        "bag",
        "solstice",
        "natural",
        "palm leaf",
        {"non-textile-material-type": "wood"},
        "Hand-woven palm basket bag with leather handles.",
    ),
    (
        "item:solstice-woven-belt",
        "Braided leather belt",
        "belt",
        "solstice",
        "tan",
        "leather",
        {"non-textile-material-type": "metal"},
        "Braided tan leather belt with a matte buckle.",
    ),
    (
        "item:solstice-silk-scarf",
        "Printed silk scarf",
        "scarf",
        "solstice",
        "coral",
        "silk",
        {},
        "Square silk scarf with a sun-faded botanical print; wear at the neck or on a bag.",
    ),
    # ---------------------------------------------------------------- Meridian (evening)
    (
        "item:meridian-tux-jacket",
        "Satin-lapel tuxedo jacket",
        "jacket",
        "meridian",
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
        "Slim single-breasted tuxedo jacket with satin lapels; the Meridian centerpiece.",
    ),
    (
        "item:meridian-db-blazer",
        "Double-breasted blazer",
        "jacket",
        "meridian",
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
        "item:meridian-silk-blouse",
        "Silk tie-neck blouse",
        "shirt",
        "meridian",
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
        "item:meridian-cashmere-turtleneck",
        "Fine cashmere turtleneck",
        "sweater",
        "meridian",
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
        "item:meridian-cami",
        "Satin camisole",
        "top",
        "meridian",
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
        "item:meridian-tux-trousers",
        "Satin-stripe tuxedo trousers",
        "pants",
        "meridian",
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
        "item:meridian-wide-trousers",
        "Fluid wide-leg trousers",
        "pants",
        "meridian",
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
        "item:meridian-pencil-skirt",
        "Satin pencil skirt",
        "skirt",
        "meridian",
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
        "item:meridian-column-dress",
        "Column gown",
        "dress",
        "meridian",
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
        "item:meridian-velvet-cape",
        "Velvet evening cape",
        "cape",
        "meridian",
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
        "item:meridian-overcoat",
        "Tailored wool overcoat",
        "coat",
        "meridian",
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
        "item:meridian-patent-loafer",
        "Patent leather loafer",
        "shoe",
        "meridian",
        "black",
        "patent leather",
        {"opening-type": "no opening"},
        "Slim patent loafer with a low stacked heel.",
    ),
    (
        "item:meridian-strappy-heel",
        "Strappy satin heel",
        "shoe",
        "meridian",
        "black",
        "satin",
        {"opening-type": "buckled", "non-textile-material-type": "metal"},
        "Strappy satin sandal on a slender heel.",
    ),
    (
        "item:meridian-clutch",
        "Box clutch",
        "bag",
        "meridian",
        "gold",
        "metal",
        {"non-textile-material-type": "metal"},
        "Rigid box clutch in brushed gold metal.",
    ),
    (
        "item:meridian-silk-tie",
        "Slim silk tie",
        "tie",
        "meridian",
        "black",
        "silk",
        {},
        "Slim black silk tie with a subtle sheen.",
    ),
    (
        "item:meridian-dress-watch",
        "Slim dress watch",
        "watch",
        "meridian",
        "gold",
        "steel",
        {"non-textile-material-type": "metal"},
        "Thin gold-tone dress watch on a black leather strap.",
    ),
    (
        "item:meridian-sheer-tights",
        "Sheer tights",
        "tights",
        "meridian",
        "black",
        "nylon",
        {"textile-pattern": "plain"},
        "Sheer black tights.",
    ),
    (
        "item:meridian-evening-gloves",
        "Opera gloves",
        "glove",
        "meridian",
        "black",
        "satin",
        {},
        "Elbow-length satin opera gloves.",
    ),
]

# id, name, occasion, description, item ids (ids without the "item:" prefix)
LOOK_SEEDS: list[tuple] = [
    (
        "look:atlas-site-day",
        "Site day",
        "work / outdoors",
        "The working uniform: waxed field jacket over a thermal henley, cargo pants, moc-toe boots.",
        [
            "atlas-field-jacket",
            "atlas-henley",
            "atlas-cargo-pants",
            "atlas-work-boot",
            "atlas-boot-sock",
        ],
    ),
    (
        "look:atlas-weekend-layers",
        "Weekend layers",
        "casual weekend",
        "Flannel overshirt under the corduroy chore coat with selvedge jeans and suede chukkas.",
        [
            "atlas-chore-coat",
            "atlas-flannel-shirt",
            "atlas-selvedge-jeans",
            "atlas-suede-chukka",
            "atlas-beanie",
        ],
    ),
    (
        "look:atlas-cold-snap",
        "Cold snap",
        "cold weather",
        "Fisherman sweater over the henley, quilted vest on top, carpenter pants and boots; herringbone scarf.",
        [
            "atlas-fisherman-sweater",
            "atlas-henley",
            "atlas-quilted-vest",
            "atlas-carpenter-pants",
            "atlas-work-boot",
            "atlas-wool-scarf",
        ],
    ),
    (
        "look:atlas-soft-shell",
        "Soft shell",
        "casual",
        "Shawl-collar cardigan as the outer layer with a flannel shirt, jeans and a bridle belt.",
        [
            "atlas-shawl-cardigan",
            "atlas-flannel-shirt",
            "atlas-selvedge-jeans",
            "atlas-belt",
            "atlas-suede-chukka",
        ],
    ),
    (
        "look:atlas-summer-utility",
        "Summer utility",
        "warm weather / outdoors",
        "Work shorts with the thermal henley, boots and the waxed tote.",
        ["atlas-work-shorts", "atlas-henley", "atlas-work-boot", "atlas-tote"],
    ),
    (
        "look:solstice-harbour",
        "Harbour walk",
        "resort / daytime",
        "Camp-collar linen shirt open over the ribbed tank, drawstring pants, espadrilles and the straw hat.",
        [
            "solstice-linen-shirt",
            "solstice-tank",
            "solstice-drawstring-pants",
            "solstice-espadrille",
            "solstice-straw-hat",
        ],
    ),
    (
        "look:solstice-terrace-lunch",
        "Terrace lunch",
        "resort / daytime",
        "Striped linen shirt with pleated linen shorts, leather slides and round sunglasses.",
        [
            "solstice-stripe-shirt",
            "solstice-pleated-shorts",
            "solstice-leather-sandal",
            "solstice-sunglasses",
            "solstice-basket-bag",
        ],
    ),
    (
        "look:solstice-golden-hour",
        "Golden hour",
        "resort / evening",
        "The slip dress under the unlined linen blazer with leather slides and a silk scarf at the neck.",
        [
            "solstice-slip-dress",
            "solstice-linen-blazer",
            "solstice-leather-sandal",
            "solstice-silk-scarf",
        ],
    ),
    (
        "look:solstice-market",
        "Market morning",
        "resort / daytime",
        "Linen wrap skirt with the ribbed tank and open-knit polo over it, espadrilles, basket bag.",
        [
            "solstice-wrap-skirt",
            "solstice-tank",
            "solstice-knit-polo",
            "solstice-espadrille",
            "solstice-basket-bag",
        ],
    ),
    (
        "look:solstice-shirt-dress-day",
        "Shirt dress day",
        "resort / daytime",
        "Linen shirt dress belted with the braided belt, sandals and the straw hat.",
        [
            "solstice-shirt-dress",
            "solstice-woven-belt",
            "solstice-leather-sandal",
            "solstice-straw-hat",
        ],
    ),
    (
        "look:solstice-jumpsuit-city",
        "Jumpsuit in the city",
        "casual / city",
        "Utility jumpsuit with espadrilles and round sunglasses; the linen blazer over the shoulders.",
        [
            "solstice-jumpsuit",
            "solstice-espadrille",
            "solstice-sunglasses",
            "solstice-linen-blazer",
        ],
    ),
    (
        "look:meridian-black-tie",
        "Black tie",
        "evening / formal",
        "Satin-lapel tuxedo jacket, tuxedo trousers, cashmere turtleneck instead of a shirt, patent loafers.",
        [
            "meridian-tux-jacket",
            "meridian-tux-trousers",
            "meridian-cashmere-turtleneck",
            "meridian-patent-loafer",
            "meridian-dress-watch",
        ],
    ),
    (
        "look:meridian-gala",
        "Gala",
        "evening / formal",
        "Column gown under the velvet cape with strappy heels, the box clutch and opera gloves.",
        [
            "meridian-column-dress",
            "meridian-velvet-cape",
            "meridian-strappy-heel",
            "meridian-clutch",
            "meridian-evening-gloves",
        ],
    ),
    (
        "look:meridian-dinner",
        "Dinner",
        "evening / smart",
        "Silk tie-neck blouse tucked into the satin pencil skirt, sheer tights and patent loafers.",
        [
            "meridian-silk-blouse",
            "meridian-pencil-skirt",
            "meridian-sheer-tights",
            "meridian-patent-loafer",
            "meridian-clutch",
        ],
    ),
    (
        "look:meridian-boardroom",
        "Boardroom",
        "business / smart",
        "Double-breasted blazer over the cashmere turtleneck with fluid wide-leg trousers and loafers.",
        [
            "meridian-db-blazer",
            "meridian-cashmere-turtleneck",
            "meridian-wide-trousers",
            "meridian-patent-loafer",
            "meridian-dress-watch",
        ],
    ),
    (
        "look:meridian-cocktail",
        "Cocktail hour",
        "evening / smart",
        "Satin camisole under the double-breasted blazer, tuxedo trousers, strappy heels.",
        [
            "meridian-cami",
            "meridian-db-blazer",
            "meridian-tux-trousers",
            "meridian-strappy-heel",
            "meridian-clutch",
        ],
    ),
    (
        "look:meridian-winter-evening",
        "Winter evening",
        "evening / cold weather",
        "Camel overcoat over the black-tie look; slim silk tie with the tuxedo jacket.",
        [
            "meridian-overcoat",
            "meridian-tux-jacket",
            "meridian-tux-trousers",
            "meridian-silk-tie",
            "meridian-patent-loafer",
        ],
    ),
    # Cross-line looks: the brand's "high-low" styling rule made concrete.
    (
        "look:cross-tux-and-denim",
        "Tuxedo and denim",
        "evening / relaxed",
        "The Meridian tuxedo jacket worn with Atlas selvedge jeans and suede chukkas; a Velloway signature mix.",
        [
            "meridian-tux-jacket",
            "atlas-selvedge-jeans",
            "atlas-suede-chukka",
            "meridian-cashmere-turtleneck",
        ],
    ),
    (
        "look:cross-linen-and-tailoring",
        "Linen and tailoring",
        "smart casual",
        "Solstice camp shirt under the Meridian double-breasted blazer with drawstring linen pants and loafers.",
        [
            "solstice-linen-shirt",
            "meridian-db-blazer",
            "solstice-drawstring-pants",
            "meridian-patent-loafer",
        ],
    ),
]

# Category-level curatorial rules: (source category, target category, occasion, rationale)
CATEGORY_RULES: list[tuple] = [
    (
        "jacket",
        "pants",
        "any",
        "Every Velloway jacket is cut to sit over a high-rise trouser; the proportion is the brand's core silhouette.",
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
        "atlas-field-jacket",
        "atlas-henley",
        "The jacket's short body wants a plain base layer, not a shirt collar.",
    ),
    (
        "atlas-field-jacket",
        "atlas-cargo-pants",
        "Waxed cotton and ripstop share the utility register.",
    ),
    (
        "atlas-field-jacket",
        "atlas-work-boot",
        "Field jacket and work boot are sold as a set in-store.",
    ),
    (
        "atlas-trench",
        "atlas-selvedge-jeans",
        "The trench over straight high-rise jeans, rolled once so the boot shows, is the Atlas autumn opener.",
    ),
    (
        "atlas-chore-coat",
        "atlas-flannel-shirt",
        "Corduroy over brushed flannel: two textures, one palette.",
    ),
    (
        "atlas-chore-coat",
        "atlas-selvedge-jeans",
        "Rust corduroy against indigo is the Atlas color story.",
    ),
    (
        "atlas-quilted-vest",
        "atlas-fisherman-sweater",
        "The vest is cut wide enough to sit over the chunky rib.",
    ),
    (
        "atlas-fisherman-sweater",
        "atlas-carpenter-pants",
        "Oversized knit balances a wide canvas leg.",
    ),
    ("atlas-shawl-cardigan", "atlas-flannel-shirt", "Soft outer layer over a check shirt."),
    (
        "atlas-selvedge-jeans",
        "atlas-suede-chukka",
        "Straight rinse denim breaks cleanly on a crepe-soled chukka.",
    ),
    ("atlas-cargo-pants", "atlas-work-boot", "Straight leg over a lug sole."),
    (
        "solstice-linen-shirt",
        "solstice-tank",
        "The camp shirt is always worn open over the ribbed tank.",
    ),
    ("solstice-linen-shirt", "solstice-drawstring-pants", "Tonal linen on linen."),
    (
        "solstice-stripe-shirt",
        "solstice-pleated-shorts",
        "Navy stripe with white pleated shorts is the terrace uniform.",
    ),
    ("solstice-linen-blazer", "solstice-slip-dress", "Unstructured tailoring over a fluid slip."),
    (
        "solstice-linen-blazer",
        "solstice-drawstring-pants",
        "The unlined blazer works as a linen suit with the drawstring pant.",
    ),
    (
        "solstice-wrap-skirt",
        "solstice-tank",
        "Wrap skirt with a fitted tank keeps the waist visible.",
    ),
    (
        "solstice-shirt-dress",
        "solstice-woven-belt",
        "The shirt dress is belted at the natural waist.",
    ),
    ("solstice-straw-hat", "solstice-sunglasses", "Wide brim and round frames."),
    ("solstice-drawstring-pants", "solstice-espadrille", "Wide linen leg over a flat canvas shoe."),
    ("meridian-tux-jacket", "meridian-tux-trousers", "The tuxedo is one piece in two parts."),
    (
        "meridian-tux-jacket",
        "meridian-cashmere-turtleneck",
        "Turtleneck instead of a dress shirt is the Meridian black-tie signature.",
    ),
    (
        "meridian-tux-jacket",
        "meridian-patent-loafer",
        "Patent loafer, never a lace-up, with the tuxedo.",
    ),
    (
        "meridian-db-blazer",
        "meridian-wide-trousers",
        "Double-breasted volume above, fluid volume below.",
    ),
    (
        "meridian-db-blazer",
        "meridian-cami",
        "A satin camisole softens the double-breasted blazer for evening.",
    ),
    ("meridian-silk-blouse", "meridian-pencil-skirt", "High neck above, pencil line below."),
    (
        "meridian-pencil-skirt",
        "meridian-sheer-tights",
        "Satin skirt with sheer black tights for winter dinners.",
    ),
    (
        "meridian-column-dress",
        "meridian-velvet-cape",
        "The cape covers the shoulders without breaking the column.",
    ),
    (
        "meridian-column-dress",
        "meridian-strappy-heel",
        "A slender heel keeps the floor-length line.",
    ),
    (
        "meridian-overcoat",
        "meridian-tux-jacket",
        "The camel overcoat is cut to clear the tuxedo jacket.",
    ),
    # Cross-line signatures
    (
        "meridian-tux-jacket",
        "atlas-selvedge-jeans",
        "High-low: the tuxedo jacket over raw denim is a Velloway signature.",
    ),
    ("meridian-db-blazer", "solstice-linen-shirt", "Sharp tailoring over a relaxed camp collar."),
]

ARTICLE_SEEDS: list[tuple] = [
    (
        "article:velloway-journal-01",
        "Notes on layering: the Atlas method",
        "Velloway Journal",
        "2026-09-01",
        [
            (
                "st:layering-1",
                "Start with a plain base layer: the thermal henley under everything, so collars never compete.",
                ["look:atlas-site-day", "item:atlas-henley"],
            ),
            (
                "st:layering-2",
                "The waxed field jacket is cut short on purpose; it should end where a high-rise trouser begins.",
                ["item:atlas-field-jacket", "look:atlas-site-day"],
            ),
            (
                "st:layering-3",
                "Corduroy over brushed flannel gives two textures in one palette; keep both in the earth range.",
                ["look:atlas-weekend-layers"],
            ),
            (
                "st:layering-4",
                "When it turns cold, the quilted vest goes over the fisherman sweater, not under it.",
                ["look:atlas-cold-snap"],
            ),
            (
                "st:layering-5",
                "Rinse denim breaks cleanly on a crepe sole; save the lug boot for canvas.",
                ["item:atlas-suede-chukka", "item:atlas-work-boot"],
            ),
        ],
    ),
    (
        "article:velloway-journal-02",
        "Linen, worn properly",
        "Velloway Journal",
        "2026-06-15",
        [
            (
                "st:linen-1",
                "Linen is meant to crease. The unlined blazer looks best after a day, not before.",
                ["item:solstice-linen-blazer"],
            ),
            (
                "st:linen-2",
                "The camp-collar shirt is always worn open over the ribbed tank; buttoned up it loses the point.",
                ["look:solstice-harbour", "item:solstice-linen-shirt"],
            ),
            (
                "st:linen-3",
                "Pair tonal linen on linen for daytime; add one color, the terracotta wrap skirt or the coral scarf, for evening.",
                ["look:solstice-market", "look:solstice-golden-hour"],
            ),
            (
                "st:linen-4",
                "Pleated shorts sit at the natural waist and finish above the knee; the striped linen shirt stays untucked.",
                ["look:solstice-terrace-lunch"],
            ),
            (
                "st:linen-5",
                "A wide linen leg needs a flat shoe: espadrille or slide, never a heel.",
                ["item:solstice-drawstring-pants", "item:solstice-espadrille"],
            ),
        ],
    ),
    (
        "article:velloway-journal-03",
        "Black tie, the Meridian way",
        "Velloway Journal",
        "2026-11-20",
        [
            (
                "st:blacktie-1",
                "Meridian black tie replaces the dress shirt with a fine cashmere turtleneck under the satin-lapel jacket.",
                ["look:meridian-black-tie", "item:meridian-cashmere-turtleneck"],
            ),
            (
                "st:blacktie-2",
                "Patent loafers, never lace-ups, with the tuxedo trouser.",
                ["item:meridian-patent-loafer", "look:meridian-black-tie"],
            ),
            (
                "st:blacktie-3",
                "For gala dressing the column gown takes the velvet cape rather than a jacket; nothing should break the vertical line.",
                ["look:meridian-gala"],
            ),
            (
                "st:blacktie-4",
                "The double-breasted blazer over a satin camisole is the house cocktail look.",
                ["look:meridian-cocktail"],
            ),
            (
                "st:blacktie-5",
                "A slim silk tie appears only with the tuxedo jacket and only in winter, under the camel overcoat.",
                ["look:meridian-winter-evening"],
            ),
        ],
    ),
    (
        "article:velloway-journal-04",
        "High-low: mixing the lines",
        "Velloway Journal",
        "2026-10-05",
        [
            (
                "st:highlow-1",
                "The tuxedo jacket over raw selvedge denim and suede chukkas is the most Velloway outfit there is.",
                ["look:cross-tux-and-denim"],
            ),
            (
                "st:highlow-2",
                "Sharp Meridian tailoring over a relaxed Solstice camp collar reads as effortless rather than undone.",
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
        "article:velloway-fit-guide",
        "Fit and proportion guide",
        "Velloway Fit Guide",
        "2026-08-01",
        [
            (
                "st:fit-1",
                "Every Velloway jacket is cut to sit over a high-rise trouser; the proportion is the brand's core silhouette.",
                [
                    "item:atlas-field-jacket",
                    "item:meridian-tux-jacket",
                    "item:solstice-linen-blazer",
                ],
            ),
            (
                "st:fit-2",
                "Oversized knitwear balances a wide leg; slim knitwear balances a straight leg.",
                ["look:atlas-cold-snap", "look:meridian-boardroom"],
            ),
            (
                "st:fit-3",
                "Trouser hems break on the shoe: wide legs take a slim shoe, straight legs take a boot.",
                ["item:meridian-wide-trousers", "item:atlas-cargo-pants"],
            ),
            (
                "st:fit-4",
                "Loose shirt dresses are belted at the natural waist; fitted dresses never are.",
                ["look:solstice-shirt-dress-day", "item:solstice-slip-dress"],
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


SAMPLE_README = """# Velloway: a data set of the fashion domain (synthetic)

Generated by `ontology-rag synth` from `backend/src/ontology_rag/synth.py`, in the catalog format
of [`../README.md`](../README.md). When fashion is the graph's domain (the default), the stack's
graph loader loads it into the graph at deploy, together with every other data set of the domain.

**All content is fictional.** "Velloway", its lines (Atlas, Solstice, Meridian), products, looks
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
| `domain.json` | Written by hand, not by `synth`: Velloway's example questions and the worked examples of tab 3's query agent, added to the domain's lists |
"""
