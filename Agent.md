# SleekCMS — Site Builder Reference

Cloud headless CMS with an integrated static site builder. Save any file → site rebuilds and redeploys.

---

## How a site is assembled

A site is a set of **pages**. Each page is built by combining:

1. A **layout** — the outer HTML shell (`<html>`, header, footer). The page renders into its `main` slot.
2. A **page** — content unique to one URL.
3. **Entries** — reusable standalone records (e.g. `header`, `footer`, `authors`). Pages pull them in by handle or via reference field type.
4. **Blocks** — reusable field groups *embedded inside* a page or entry (e.g. `seo`, `contact`).

A model defines the shape of the content. A view is the html template (EJS). A view combines with content to create a rendered html for a page.

| Layer | Path | What it holds |
|---|---|---|
| model | `models/<type>/<key>.model` | the shape (fields and types) |
| content | `content/<type>/<key>.json` | the values |
| view | `<type>/<key>.ejs` | the EJS template |

Where `<type>` is `pages`, `entries`, or `blocks`, and `<key>` is shared across the three files. The path skeleton `<kind>/<type>/<key>` is the whole filesystem convention.

> **Blocks** are special: they have no `content/blocks/...` file. A block's values live inside whatever page or entry embeds it. Models and views still live at the usual paths.

---

## Keys and collections

The key uniquely connects the model with its content and view template (EJS). The key prefix denotes of the content is a collection or record objects or directly the one record object.

- **Entry key** = the handle. e.g. `header`, `authors`.
- **Page key** = URL path with `/` replaced by `_`. e.g. `/` → `_index`, `/about` → `about`, `/docs/getting-started` → `docs_getting-started`.
- **Append `[]`** to make a collection (many records). Without `[]` the key is a single record. The `[]` is part of the key — it must appear on **every** related file.

| Key | Meaning |
|---|---|
| `about` | single page at `/about` |
| `blog` | single page at `/blog` (e.g. an index that lists posts) |
| `blog[]` | collection — one page per item at `/blog/<slug>` |
| `header` | single entry |
| `authors[]` | collection of entry records |

For collection **content**:
- pages → `content/pages/<key>[]/<slug>.json` (one file per item; filename is the slug)
- entries → `content/entries/<key>[].json` (one file, an array of objects)

---

## Other top-level paths

```
layouts/<name>.ejs    Layout wrappers
css/<name>.css        Stylesheets (include via link())
css/tailwind.css      Auto-compiled, auto-injected — do NOT link()
js/<name>.js          Scripts (include via script())
images.json           Site-level reusable images (handle → shortcut)
```

---

## Rendering

- A **page** is rendered into the variable `main`. The layout outputs it with `<%- main %>`.
- An **entry** or **block** is rendered with `render(obj)`.

---

## Models — field shapes

A `.model` file is JSON-shaped *without quotes*. Scalar values are field type names.

```
{ title: text, image: image, content: markdown }
```

- **Many of a type** — wrap in `[]`: `images: [image]`
- **Grouped fields** — nest in `{}`: `hero: { heading: text, background: image }`
- **Repeatable group** — wrap a group in `[]`: `features: [{ title: text, icon: image }]`
- **Block reference** (values embedded): `cta: block(cta)`
- **Entry reference** (by handle): `author: entry(authors)` or `tags: [entry(tags)]`

### Scalar types

| Type | Value |
|---|---|
| `text`, `paragraph` | String |
| `richtext` | HTML string |
| `markdown` | Markdown string (render with `marked()`) |
| `number`, `boolean` | self |
| `date`, `datetime`, `time` | string (`YYYY-MM-DD`, ISO 8601, `HH:mm`) |
| `color`, `link`, `code` | String |
| `image` | `{ url, alt }` |
| `video` | `{ url, embed }` |
| `json` | Object or array |
| `sheet` | Array of arrays |
| `location` | `{ latitude, longitude }` |

---

## Content — JSON values

Content JSON mirrors the model: scalars become strings/numbers, groups become objects, repeatable types become arrays. `block(k)` is an embedded object; `entry(k)` is a slug string (or array of slug strings).

### Image shortcuts

For `image` fields, prefer a shortcut over a full object — the sync engine resolves it to `{ url, alt }` on save.

```
"image": "pexels:doctor"
"image": "url:https://picsum.photos/200.jpg"
"image": "cms:logo"
```

Sources: `unsplash`, `pexels`, `pixabay`, `iconify`, `url`, `cms`. Append `|<alt>` to set alt: `"pexels:doctor|Smiling doctor"`.

### Reusable images (`images.json`)

Declare once, reference everywhere:

```json
{
    "logo": "url:https://cdn.example.com/logo.svg",
    "hero": "pexels:mountain sunrise"
}
```

Reference from any `image` field with `"cms:<handle>"`, or fetch from a template with `getImage('<handle>')`.

### Markdown images

Inside `markdown` fields, embed images with the same shortcut: `![alt](pexels:doctor)`. Append `|<alt>` for alt text and `<W>x<H>` to size: `![doctor](pexels:doctor|Friendly doctor 800x600)` (default `600x400`).

### Example

Model:
```
{ title: text, image: image, hero: block(hero), tags: [entry(tags)] }
```

`content/pages/about.json`:
```json
{
    "title": "About us",
    "image": "pexels:team meeting",
    "hero": { "heading": "Hello", "subheading": "Welcome" },
    "tags": ["engineering", "design"]
}
```

---

## Views — EJS templates

| Tag | Purpose |
|---|---|
| `<%= expr %>` | Output, HTML-escaped |
| `<%- expr %>` | Output raw HTML (blocks, images, helpers) |
| `<% code %>` | Execute JS |

### Variables in scope

- `item` — the record being rendered (page, entry, or block).
- `pages` — all page records.
- `entries` — all entries keyed by handle.
- `main` — rendered page output (layouts only).

Page records also have `_path`, `_slug` (collections), and `_meta.updated_at`.

### Helper functions

**Content access**

```
getPage(path)               page by exact path
getPages(path, opts?)       pages with prefix; { collection: true } for collection items only
getEntry(handle)            entry by handle (object for single, array for collection)
getSlugs(path)              slugs under a collection path
getImage(name)              site-level image
getOptions(name)            option set as [{ label, value }]
getContent(query?)          full content payload, optional JMESPath
path(page)                  URL path of a page
url(pathOrPage?)            site origin or full URL
```

**Rendering**

```
render(val, separator?)     render a block/entry (or array) through its view
marked(md)                  markdown → HTML
```

**Images** — `attr` is `"WxH"` or `{ w, h, size, fit, type, class, style }`

```
src(image, attr)            optimized URL
img(image, attr)            <img>
picture(image, attr)        <picture> with dark/light variants
svg(image, attr?)           inline SVG
```

**Head injection** — call from any template, deduplicated automatically

```
title(text)
meta(attrs)
link(value, order?)         <link> (string URL auto-detects type)
style(css, order?)          <style>
script(value, order?)       <script> (.js URL → external, else inline)
```

---

## Recipes

### Layout

```ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <header><%- render(getEntry('header')) %></header>
  <main><%- main %></main>
  <footer><%- render(getEntry('footer')) %></footer>
</body>
</html>
```

### Page

```ejs
<% title(item.title + ' | My Site') %>
<% link('/css/styles.css') %>
<% script('/js/app.js') %>

<h1><%= item.title %></h1>
<%- img(item.image, '1200x600') %>
<div><%- item.content %></div>
```

### List a collection

```ejs
<% for (const post of getPages('/blog', { collection: true })) { %>
  <a href="<%- path(post) %>">
    <%- img(post.image, '400x250') %>
    <h3><%= post.title %></h3>
  </a>
<% } %>
```

### Render blocks and entry references

Model: `{ hero: block(hero), team: [entry(people)] }`

```ejs
<%- render(item.hero) %>

<% for (const person of item.team) { %>
  <%- render(person) %>
<% } %>
```

### SEO

`models/blocks/seo.model`:
```
{ title: text, description: paragraph, image: image }
```

`blocks/seo.ejs`:
```ejs
<% if (item.title) title(item.title) %>
<% if (item.description) meta({ name: 'description', content: item.description }) %>
<% if (item.image) meta({ property: 'og:image', content: src(item.image, '1200x630') }) %>
```

In a page model: `seo: block(seo)`. In its template: `<%- render(item.seo) %>`.

### RSS feed

Use the page key `rss.xml` — the `.xml` extension makes the static server set the right content type. Do **not** use a layout.

`pages/rss.xml.ejs`:
```ejs
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title><%= item.title %></title>
    <link><%= url() %></link>
    <description><%= item.description %></description>
    <% for (const post of getPages('/blog', { collection: true })) { %>
    <item>
      <title><%= post.title %></title>
      <link><%= url(post) %></link>
      <description><%= post.description %></description>
      <pubDate><%= new Date(post._meta.updated_at).toUTCString() %></pubDate>
      <guid><%= url(post) %></guid>
    </item>
    <% } %>
  </channel>
</rss>
```

For autodiscovery, add to the layout:
```ejs
<% link({ rel: 'alternate', type: 'application/rss+xml', title: 'RSS', href: '/rss.xml' }) %>
```

### Forms

Any `<form>` with `data-sleekcms="<name>"` is captured automatically — submissions are stored and viewable in the dashboard.

```html
<form data-sleekcms="contact">
  <input name="name" type="text" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
```

Each input's `name` becomes a stored field.

---

## Rules for AI

1. Include CSS/JS via `link()` and `script()` — never raw `<link>` or `<script>` tags.
2. Exception: `/css/tailwind.css` is auto-injected — do **not** add it via `link()`.
3. `richtext` is HTML (use `<%- %>`); `markdown` is raw markdown (convert with `marked()` first).
4. Use modern Tailwind design unless told otherwise.
5. Edit JSON under `content/` to change content — never hard-code values into `.ejs`.
6. Adding a field requires updating the `.model` first; content keys must match model keys.
7. The `[]` suffix is part of the key and must appear on **every** related file (model, view, content). Without it the file is treated as a single.
8. For `image` fields, prefer the shortcut form `"<source>:<search>"`. Reuse images via `images.json` and `"cms:<handle>"`.
9. Inside markdown, embed images with `![alt](<source>:<search>|<alt> <W>x<H>)` (default `600x400`).
10. Always create an RSS feed for blogs (key `rss.xml`) and link it from the layout.
11. Make sites SEO- and sharing-friendly.
