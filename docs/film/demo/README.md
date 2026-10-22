# The film's demo change

The film shows Insilode on Harbor Goods, the site's demo project (`site/demo/base`: orders
and shipping in Java, billing in Python). `changed/` is the agent's change for the film, laid over
`base` the same way `site/demo/changed` is: "add discount codes to orders", 14 files across
the three services. The hook's number, the diff stat and the green and red lines in the film come
from this change.

`DEMO_CHANGED=$PWD/docs/film/demo/changed node scripts/site-data.mjs` builds the site's demo data from `base` plus
this folder instead of `site/demo/changed`, so the captures show this change on the app's real canvas.
