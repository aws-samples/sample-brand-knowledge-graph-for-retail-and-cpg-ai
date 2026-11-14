# Data set "tiny" (test fixture)

A data set of the fashion domain in the style DNA format, small enough to read in full: the
fictional brand Tiny, one occasion, two looks and three garments (`graph.json`, vectors of
dimension 8 in `vectors.json`), one catalog row (`catalog.json`), two example photos
(`examples/images/h1.jpg` from the new shoot, `examples/images/nw1.jpg` marked as new work), one
look photo (`media/looks/l1.jpg`; `l2.jpg` is left out on purpose) and one example text
(`examples/articles/a1.md`).

`backend/tests/test_data_sets.py` copies it to `ontologies/fashion/datasets/tiny/` of a temporary
copy of the `ontologies/` folder. The photos are 8 by 8 pixels of one color.
