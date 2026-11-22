# Sneaker showcase hero

A 16:9 e-commerce hero: the library sneaker drops and spins onto a ceramic pedestal in front of a big sun disc on a coral backdrop (softbox light rig, studio IBL, contact shadow, `product` look). The left column holds a 3D title, tagline, price and a pill "Shop now" button — all bound to `scene.data`, so the page can personalise them without touching the scene.

Interactions: hovering the shoe lifts it, **clicking the shoe toggles the `detail` segment** (the shoe turns to show its other side while the camera glides in and the text slides away; click again to come back), the button links to `{data.url}`.

## What to tweak

| Change | Where |
|---|---|
| Texts | `data.title`, `data.tagline`, `data.price`, `data.cta` — or per embed: `<agent3d-scene data-title="AIR FLOW" data-price="$129">` |
| Button link | `data.url` (the `cta` group's `href`) |
| Product | `objects#shoe.src` (any `.glb`; keep `fit` ≈ 2.35) |
| Backdrop colours | `environment.background.radial` (centre, edge) and `objects#halo.material.color` (the disc) |
| Pedestal | `objects#pedestal.material` (ceramic preset), `objects#plinth` (base), `objects#pedestalRing` (gold rim) |
| Detail view | `camera.shots[0]` (where the camera goes) and the `rig.rotation.y` keys after 2.4 s |
| Intro | timeline keys before the `ready` marker (2.4 s) |

The intro plays once (`autoplay: "intro"`); reduced motion shows the poster frame at 2.4 s. Long titles wrap at `objects#title.maxWidth` (3.2 units).
