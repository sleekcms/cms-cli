# SleekCMS — Site Builder Reference

Cloud-based headless CMS with an integrated static site builder. Files sync automatically — every save triggers a rebuild and deploy. No Git, no servers, no manual builds.

---

## How It Works

Each page = **model** (schema) + **template** (EJS) + optional **layout** (EJS wrapper).

The **file name** (key) links a model to its template and determines the URL path.

---

## File Naming Convention

Keys are lowercase, dash-separated. For pages, `_` in the key maps to `/` in the URL. A `+` suffix marks a collection.

| File key | URL |
|---|---|
| `_index` | `/` (home) |
| `about` | `/about` |
| `blog+` | `/blog/<slug>` (one page per entry) |
| `docs_getting-started` | `/docs/getting-started` |

The keys for model, template, and content file are the same — if the model is a **collection**, the `+` suffix is part of the key and must appear on **every** related file.

Examples:
- Collection page `blog`: `models/pages/blog+.model`, `pages/blog+.ejs`, `content/pages/blog+/<slug>.json`
- Collection entry `testimonials`: `models/entries/testimonials+.model`, `entries/testimonials+.ejs`, `content/entries/testimonials+.json`
- Single page `about`: `models/pages/about.model`, `pages/about.ejs`, `content/pages/about.json` (no `+`)

---

## Folder Structure within src/

```
/models/pages/<key>.model      Page content models
/models/entries/<key>.model    Entry content models
/models/blocks/<key>.model     Block content models

/pages/<key>.ejs               Page templates
/entries/<key>.ejs             Entry templates
/blocks/<key>.ejs              Block templates
/layouts/<name>.ejs            Layout wrappers

/css/<name>.css                Stylesheets (require head injection)
/css/tailwind.css              Tailwind CSS (auto-compiled, auto-injected)
/js/<name>.js                  Scripts (require head injection)

/content/pages/<key>.json          Content for a single (non-list) page
/content/pages/<key>/<slug>.json   Content for one item of a collection page (<key> ends with +)
/content/entries/<key>.json        Content for a single entry (object)
/content/entries/<key+>.json       Content for a collection entry (array of objects; <key>+ matches the model filename)

/content/images.json                       Site-level reusable images (handle → shortcut)
```

> **Tailwind**: Creating `/css/tailwind.css` enables Tailwind. It is compiled and injected automatically — do NOT add it via `link()`.
> All other CSS/JS files must be included via `link()` or `script()`.

---

## Content Models

### Model Types

| Type | Purpose | Has URL | File path |
|---|---|---|---|
| **Page** | Routable content | Yes | `models/pages/<key>.model` |
| **Entry** | Shared/reusable data (nav, footer, authors) | No | `models/entries/<key>.model` |
| **Block** | Reusable field group embedded in pages/entries | No | `models/blocks/<key>.model` |

All three can be **single** (one record) or **collection** (many records, key ends with `+`).

### .model File Format

JSON structure without quotes on keys or string values. Scalar values are the field type name.

```
{
    title: text,
    image: image,
    content: markdown
}
```

**Groups** — Nest fields in an object:
```
{
    hero: {
        heading: text,
        background: image
    }
}
```

**Collections** (repeatable lists) — Wrap a group in `[]`:
```
{
    features: [
        {
            title: text,
            icon: image
        }
    ]
}
```

**Block reference** — Use `block(key)`:
```
{
    cta: block(cta)
}
```

**Entry reference** — Use `entry(key)` for one, `[entry(key)]` for many:
```
{
    author: entry(authors),
    tags: [entry(tags)]
}
```

### Field Types and Serialization

Model fields declare both the editor type and the shape expected in content JSON. Templates receive those same values, except image shortcuts are resolved to full image objects and entry references are resolved to entry object(s).

| Model type | Content JSON value / template value |
|---|---|
| `text`, `paragraph`, `richtext`, `markdown`, `code`, `color`, `link` | String |
| `number` | Number |
| `boolean` | `true` / `false` |
| `date` | `"YYYY-MM-DD"` string |
| `datetime` | ISO 8601 string |
| `time` | `"HH:mm"` string |
| `image` | Either a resolved `{ "url": "...", "alt": "..." }` object, **or** a shortcut string `"<source>:<search>"` (e.g., `"pexels:doctor"`, `"url:https://picsum.photos/200.jpg"`, `"cms:logo"`). Supported sources: `unsplash`, `pexels`, `pixabay`, `iconify`, `url`, `cms` (reuses an image declared in `/images.json` by handle). Append `\|<alt text>` to set the image's alt, e.g. `"pexels:doctor\|Smiling doctor with stethoscope"`. On save, the sync engine resolves the shortcut/link to a full image object automatically. |
| `video` | `{ "url": "...", "embed": "..." }` |
| `json` | Object or array |
| `sheet` | Array of arrays |
| `location` | `{ "latitude": n, "longitude": n }` |
| `block(key)` | Object matching that block's model (embedded, not a reference) |
| `entry(key)` / `[entry(key)]` | Slug string / array of slug strings in content JSON; entry object / array of entry objects in templates |
| Group `{ ... }` | Nested object |
| Collection `[{ ... }]` | Array of nested objects |

`richtext` returns HTML; output it with `<%- %>`. `markdown` returns raw markdown; convert it with `marked()` before output. Inside markdown, use the same image shortcut convention in standard image syntax: `![alt](pexels:doctor)`. Append `\|<alt>` to set alt text, and include a `<width>x<height>` token to set URL `w`/`h` params (defaults to `600x400`), e.g. `![doctor](pexels:doctor\|Smiling doctor 800x600)`.

---

## Content Records

Content files are JSON records under `/content/` that hold the actual values for the fields declared in each `.model`. Editing a content file and saving it triggers the same sync-build-deploy loop as editing a template — you can view and edit content directly from this workspace.

**Blocks have no top-level content files.** Block data is embedded inside the page or entry that references the block.

### File layout

| Model shape | File path | JSON top-level |
|---|---|---|
| Single page (e.g., `about`) | `content/pages/about.json` | Object |
| Collection page (e.g., `blog+`) | `content/pages/blog+/<slug>.json` (the `+` is part of the key, not an extra suffix) | Object; one file per slug |
| Single entry (e.g., `header`) | `content/entries/header.json` | Object |
| Collection entry (e.g., `authors`) | `content/entries/authors+.json` (the `+` is part of the key — same as the model filename) | Array of objects |

### Example

Given a model:

```
{ title: text, image: image, hero: block(hero), tags: [entry(tags)] }
```

The content file at `content/pages/about.json`:

```json
{
    "title": "About us",
    "image": "pexels:team meeting",
    "hero": { "heading": "Hello", "subheading": "Welcome" },
    "tags": ["engineering", "design"]
}
```

Here `image` uses the shortcut form — on save, the sync engine replaces it with a real image object (`{ "url": "...", "alt": "..." }`). Write the object form directly when you have a specific asset URL.

### Reusable images (`/images.json`)

For images used in more than one place (logos, recurring icons, hero art), declare them once in `/images.json` as a flat map of `handle → shortcut` using the same shortcut convention as `image` fields:

```json
{
    "logo": "url:https://cdn.example.com/logo.svg",
    "hero": "pexels:mountain sunrise",
    "apple-icon": "iconify:mdi:apple"
}
```

Then reference any of them from any content `image` field with `"cms:<handle>"` (e.g., `"cms:logo"`). The sync engine resolves it to the full image object on save. Templates can also fetch the resolved object directly via `getImage('<handle>')`.

---

## EJS Templates

### Syntax

| Tag | Purpose |
|---|---|
| `<%= expr %>` | Output with HTML escaping (text content) |
| `<%- expr %>` | Output raw HTML (blocks, images, rich text, helpers) |
| `<% code %>` | Execute JS (loops, conditionals, variables) |

### Template Context

Every template receives these variables:

| Variable | Type | Description |
|---|---|---|
| `item` | Object | Current page, block, or entry being rendered |
| `pages` | Array | All page records (each has `_path`, `_slug`, fields) |
| `entries` | Object | All entries keyed by model handle |
| `main` | String | Rendered page template output (**layout only**) |

`item` always refers to the current record. In a page template, `item` is the page. In a block template, `item` is the block instance. In an entry template, `item` is the entry.

Page records include: `item._path`, `item._slug` (collections), `item._meta.updated_at`.

---

## Helper Functions

### Content Access

| Function | Returns | Description |
|---|---|---|
| `getPage(path)` | Object \| undefined | Page by exact path |
| `getPages(path, opts?)` | Array | Pages where path starts with prefix. `{ collection: true }` for collection pages only |
| `getEntry(handle)` | Object \| Array | Entry by handle. Single → object, collection → array |
| `getSlugs(path)` | string[] | Slugs under a collection path |
| `getImage(name)` | Object \| undefined | Site-level image by handle |
| `getOptions(name)` | Array \| undefined | Option set as `[{ label, value }]` |
| `getContent(query?)` | Any | Full content payload, or filter with JMESPath |
| `path(page)` | String | URL path of a page object |
| `url(pathOrPage?)` | String | Site origin (e.g. `https://example.com`). Pass a path string to get a full URL (`url('/blog')` → `https://example.com/blog`), or pass a page object to resolve its path into a full URL. |

### Rendering

| Function | Returns | Description |
|---|---|---|
| `render(val, separator?)` | HTML string | Render a block/entry (or array of them) through its template |
| `marked(md)` | HTML string | Convert a markdown string to HTML |

### Images

| Function | Returns | Description |
|---|---|---|
| `src(image, attr)` | URL string | Optimized image URL |
| `img(image, attr)` | HTML string | `<img>` element |
| `picture(image, attr)` | HTML string | `<picture>` with dark/light variants |
| `svg(image, attr?)` | HTML string | Inline SVG with optional attributes |

`attr` can be `"WxH"` string or `{ w, h, size, fit, type, class, style }` object.

### Head Injection

Call from **any template** (page, block, entry, or layout). Deduplicated automatically.

| Function | Description |
|---|---|
| `title(text)` | Set page `<title>` |
| `meta(attrs)` | Add `<meta>` tag |
| `link(value, order?)` | Add `<link>` tag (string URL auto-detects type, or pass object) |
| `style(css, order?)` | Add `<style>` block |
| `script(value, order?)` | Add `<script>` (`.js` URL → external, otherwise inline) |

---

## SEO

Create a **block model** (e.g., `seo.model`) and add SEO tags manually in its template:

**`models/blocks/seo.model`**
```
{
    title: text,
    description: paragraph,
    image: image
}
```

**`blocks/seo.ejs`**
```ejs
<% if (item.title) title(item.title) %>
<% if (item.description) meta({ name: 'description', content: item.description }) %>
<% if (item.image) { %>
  <% meta({ property: 'og:image', content: src(item.image, '1200x630') }) %>
<% } %>
```

Then include `seo: block(seo)` in any page model and render it: `<%- render(item.seo) %>`

---

## Forms

Any `<form>` with a `data-sleekcms="<name>"` attribute works automatically — submissions are captured, stored, and viewable in the CMS dashboard. No backend setup, no action URL, no JS required.

```html
<form data-sleekcms="contact">
  <input name="name" type="text" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
```

The `<name>` value (e.g., `contact`, `newsletter`, `quote-request`) groups submissions by form. Use standard `name` attributes on inputs — each field is stored as-is.

---

## RSS Feeds

Create an RSS feed by adding a page with the key `rss.xml` — this maps to the URL `/rss.xml`. Because the extension is `.xml`, the static server serves it with the correct content type automatically. The template outputs raw XML and must **not** use a layout.

**`models/pages/rss.xml.model`**
```
{
    title: text,
    description: paragraph
}
```

**`content/pages/rss.xml.json`**
```json
{
    "title": "My Blog",
    "description": "Latest posts from My Blog"
}
```

**`pages/rss.xml.ejs`**
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

Notes:
- The key `rss.xml` follows the standard naming convention — the dot is part of the key as-is.
- `getPages('/blog', { collection: true })` fetches all blog collection pages; adjust the path to match your collection key.
- `url(post)` resolves the page object to a full absolute URL (e.g. `https://example.com/blog/my-post`) — no need to store the site URL in content.
- `post._meta.updated_at` is an ISO 8601 timestamp; `.toUTCString()` converts it to RFC 822 format required by RSS.
- Use a dedicated `description` or `summary` field in your blog model for feed excerpts; fall back to any short-text field if one doesn't exist.
- To autodiscover the feed, add `<% link({ rel: 'alternate', type: 'application/rss+xml', title: 'RSS', href: '/rss.xml' }) %>` in your layout or page templates.

---

## Examples

### Layout

```ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <% const header = getEntry('header'); %>
  <header>
    <%- render(header) %>
  </header>

  <main><%- main %></main>

  <% const footer = getEntry('footer'); %>
  <footer>
    <%- render(footer) %>
  </footer>
</body>
</html>
```

### Page template

```ejs
<% title(item.title + ' | My Site') %>
<% link('/css/styles.css') %>
<% script('/js/app.js') %>

<h1><%= item.title %></h1>
<%- img(item.image, '1200x600') %>
<div><%- item.content %></div>
```

### Block template

```ejs
<section class="hero" style="background-image: url('<%- src(item.background, '1920x800') %>')">
  <h2><%= item.heading %></h2>
  <p><%= item.subheading %></p>
  <a href="<%= item.cta_link %>" class="btn"><%= item.cta_label %></a>
</section>
```

### List collection pages

```ejs
<% for (const post of getPages('/blog', { collection: true })) { %>
  <a href="<%- path(post) %>">
    <%- img(post.image, '400x250') %>
    <h3><%= post.title %></h3>
  </a>
<% } %>
```

### Render blocks and entry references

Given a model:
```
{
    hero: block(hero),
    team: [entry(people)]
}
```

Template:
```ejs
<%- render(item.hero) %>

<% for (const person of item.team) { %>
  <%- render(person) %>
<% } %>
```

---

## Rules for AI

1. Include CSS/JS files via **`link()`** and **`script()`** — never raw `<link>` or `<script>` tags in templates.
2. Exception: `/css/tailwind.css` is auto-injected — do **not** add it via `link()`.
3. `richtext` returns **HTML** — use `<%- %>` (unescaped) to output it. `markdown` returns **raw markdown** — convert with `marked()` first: `<%- marked(item.content) %>`.
4. Use modern design with tailwind unless design details are specified.
5. To change what appears on a page or in shared data, edit the matching JSON under `/content/` — do **not** hard-code content into `.ejs` templates. Templates define structure; content files hold the values.
6. Fields in a content JSON file must match the keys defined in the corresponding `.model`. Adding a new field requires updating the `.model` first.
7. Collection page items each live in their own file under `content/pages/<key>/<slug>.json` — the collection key already includes `+` (e.g., `content/pages/blog+/my-post.json`). The `<slug>` filename is the URL segment; renaming the file renames the URL.
8. **Collection key suffix `+` is mandatory and must appear on every related file.** For a collection model (pages or entries — e.g., `blog`, `testimonials`, `authors`), the key `<name>+` is part of the filename on the model, template, **and** content JSON: `models/entries/testimonials+.model`, `entries/testimonials+.ejs`, `content/entries/testimonials+.json` (array). Same rule for collection pages: `models/pages/blog+.model`, `pages/blog+.ejs`, and one file per slug under `content/pages/blog+/<slug>.json`. Never drop the `+` — files without it are treated as singles and will not resolve.
9. For `image` fields in content JSON, prefer the shortcut form `"<source>:<search>"` (sources: `unsplash`, `pexels`, `pixabay`, `iconify`) — e.g., `"pexels:doctor"`. Add alt text by appending `|<alt>` to the shortcut: `"pexels:doctor|Smiling doctor with stethoscope"`. The sync engine resolves it to a full `{ url, alt }` object on save. When the same image is reused across pages (logos, shared icons, recurring art), declare it once in `/images.json` and reference it via `"cms:<handle>"`.
12. Inside `markdown` fields, embed images with `![alt](<source>:<search>)` — same sources as image fields. Append `|<alt>` to store alt on the image record (e.g. `![doctor](pexels:doctor|Friendly family doctor)`). Including a `<W>x<H>` token in the description (e.g. `|hero shot 1200x600`) sets the rendered URL's `w` and `h` query params; otherwise the default is `600x400`. On save, refs are rewritten to actual CDN URLs and the underlying image record is created automatically.
10. Always create RSS feed for blogs and link them in meta so it is discoverable. Use "rss.xml" as the key.
11. Make the sites extremely SEO friendly and sharing friendly
