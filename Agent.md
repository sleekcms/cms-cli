# SleekCMS — Site Builder Reference

Cloud-based headless CMS with an integrated static site builder. Files sync automatically — every save triggers a rebuild and deploy. No Git, no servers, no manual builds.

---

## How It Works

Each page = **model** (schema) + **template** (EJS) + optional **layout** (EJS wrapper).

The **file name** (key) links a model to its template and determines the URL path.

---

## File Naming Convention

Keys are lowercase, dash-separated. For pages, `_` in the key maps to `/` in the URL. A `[]` suffix marks a collection.

| File key | URL |
|---|---|
| `_index` | `/` (home) |
| `about` | `/about` |
| `blog[]` | `/blog/<slug>` (one page per entry) |
| `docs_getting-started` | `/docs/getting-started` |

The keys for model and template are the same. 
Example. models/pages/blog[].model and pages/blog[].ejs

---

## Folder Structure

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

All three can be **single** (one record) or **collection** (many records, key ends with `[]`).

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

### Field Types

| Type | Returns |
|---|---|
| `text` | String |
| `paragraph` | String (multiline) |
| `richtext` | HTML string |
| `markdown` | HTML string (pre-rendered) |
| `number` | Number |
| `boolean` | `true` / `false` |
| `date` | `YYYY-MM-DD` |
| `datetime` | ISO 8601 string |
| `time` | `HH:mm` |
| `color` | String (hex or name) |
| `link` | URL string or relative path |
| `image` | `{ url, alt }` |
| `video` | `{ url, embed }` |
| `code` | String |
| `json` | Object or array |
| `sheet` | Array of arrays |
| `location` | `{ latitude, longitude }` |
| `block(key)` | Block object |
| `entry(key)` | Entry object(s) |

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

### Rendering

| Function | Returns | Description |
|---|---|---|
| `render(val, separator?)` | HTML string | Render a block/entry (or array of them) through its template |

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
3. Markdown and rich text fields return **HTML** — always use `<%- %>` (unescaped) to output them.
4. Use modern design with tailwind unless design details are specified
