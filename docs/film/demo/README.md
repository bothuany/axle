# The film's demo change

The film shows Axle on Harbor Goods, the playground's demo project (`playground/demo/base`: orders
and shipping in Java, billing in Python). `changed/` is the agent's change for the film, laid over
`base` the same way `playground/demo/changed` is: "add discount codes to orders", 14 files across
the three services. The hook's number, the diff stat and the green and red lines in the film come
from this change.

`tools/film-data.mjs` builds the playground's data from `base` plus this folder instead of
`playground/demo/changed`, so the captures show this change on Axle's real canvas.
