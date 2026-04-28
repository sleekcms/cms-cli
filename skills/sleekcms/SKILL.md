---
name: sleekcms
description: Build, edit, and sync SleekCMS websites. Use whenever the user wants to create or modify a SleekCMS site - generating pages, templates (EJS), content models, content records (JSON), CSS, or JS - or when SLEEKCMS_TOKEN is present in the environment. The skill bundles a two-step sync utility (setup-site + sync-site) that pulls the site to a local workspace and pushes local edits back to the SleekCMS cloud, plus the full SleekCMS site-building reference inline.
---

# SleekCMS site builder

[SleekCMS](https://sleekcms.com) is a cloud headless CMS with an integrated static site builder. This skill lets you build and maintain a SleekCMS site from a local workspace: every saved file syncs to the cloud and the site rebuilds and redeploys automatically — no Git, no servers, no manual builds.

The skill bundles two scripts under `scripts/`:

- `setup-site.js` — one-time bootstrap. Takes the auth token, creates the workspace, pulls all server files, and persists the token at `<workspace>/.cache/token`.
- `sync-site.js` — incremental push/pull for an already-initialized workspace. Reads the token from `.cache/token`; no token argument needed.

Both are safe to re-run.

## When to use this skill

Use it whenever the user asks you to:

- Create a new SleekCMS site (pages, models, templates, content, styling).
- Edit an existing SleekCMS site (any file under `models/`, `pages/`, `entries/`, `blocks/`, `layouts/`, `css/`, `js/`, or `content/`).
- Pull the latest server state, push local edits, or re-sync after manual changes.

If the user provides a SleekCMS auth token (or `SLEEKCMS_TOKEN` is in the environment), assume they want this skill.

---

# Operational workflow

## 1. Install script dependencies (once per session)

```bash
cd <skill-dir>/scripts && npm install --silent
```

The scripts depend on `commander`, `fs-extra`, `json5`. Node v16+ is required.

## 2. Resolve the auth token

`setup-site` needs a SleekCMS CLI auth token. Resolve it in this order:

1. Whatever the user provided in the conversation.
2. Environment variable `SLEEKCMS_TOKEN`.
3. Otherwise, ask the user (they get one from <https://app.sleekcms.com>).

The token's third dash-separated segment encodes the environment (`production`, `development`, `localhost`); the script auto-detects it. Pass `--env` only to override. Never echo the token in chat.

## 3. Initialize the workspace — `setup-site`

Pulls every template, model, and content record from the server into a slug-named workspace folder under the parent path you give (or the current directory). Persists the token to `<workspace>/.cache/token` for later syncs.

```bash
node <skill-dir>/scripts/setup-site.js --token "$SLEEKCMS_TOKEN" --path .
```

Capture the workspace path from the output line `✅ Workspace initialized for "<site>" at <viewsDir> ...` and `cd` into it for all subsequent file edits. Re-running on an already-initialized workspace is safe — it falls through to an incremental sync.

## 4. Edit / generate files

Create or modify files in the workspace per the **Authoring reference** below. Push order is enforced by the sync engine: **models → templates → content**. Always create or update a model before its template or content record — `sync-site` will skip a template whose model is missing.

## 5. Push edits — `sync-site`

After edits, run from inside the workspace. No arguments:

```bash
node <skill-dir>/scripts/sync-site.js
```

The script:

- Skips files whose mtime matches the cache (cheap no-op).
- Pushes changed models, then templates, then content records.
- Writes the server's normalized response back to disk (e.g. `"pexels:..."` image shortcuts expand to full image objects).
- Prints one `✅` line per file pushed.

## 6. Force a full re-pull

If the user needs to discard the local cache and re-download from the server (e.g. after server-side changes):

```bash
node <skill-dir>/scripts/sync-site.js --flush
```

This deletes `.cache/state.json` and treats the next run as a first run. The token cache is preserved.

---

# Authoring reference

Each page = **model** (schema) + **template** (EJS) + optional **layout** (EJS wrapper). The **file name** (key) links a model to its template and determines the URL path.

## File naming

Keys are lowercase, dash-separated. For pages, `_` in the key maps to `/` in the URL. A `[]` suffix marks a collection.

| File key | URL |
|---|---|
| `_index` | `/` (home) |
| `about` | `/about` |
| `blog[]` | `/blog/<slug>` (one page per entry) |
| `docs_getting-started` | `/docs/getting-started` |

The keys for model, template, and content file are the same. If the model is a **collection**, the `[]` suffix is part of the key and must appear on **every** related file.

Examples:

- Collection page `blog`: `models/pages/blog[].model`, `pages/blog[].ejs`, `content/pages/blog[]/<slug>.json`
- Collection entry `testimonials`: `models/entries/testimonials[].model`, `entries/testimonials[].ejs`, `content/entries/testimonials[].json`
- Single page `about`: `models/pages/about.model`, `pages/about.ejs`, `content/pages/about.json` (no `[]`)

## Folder structure

```
<workspace>/
├── models/pages/<key>.model      Page content models
├── models/entries/<key>.model    Entry content models
├── models/blocks/<key>.model     Block content models
│
├── pages/<key>.ejs               Page templates
├── entries/<key>.ejs             Entry templates
├── blocks/<key>.ejs              Block templates
├── layouts/<name>.ejs            Layout wrappers
│
├── css/<name>.css                Stylesheets (require head injection)
├── css/tailwind.css              Tailwind CSS (auto-compiled, auto-injected)
├── js/<name>.js                  Scripts (require head injection)
│
└── content/
    ├── pages/<key>.json          Single page content (object)
    ├── pages/<key>[]/<slug>.json One file per item of a collection page
    ├── entries/<key>.json        Single entry content (object)
    └── entries/<key>[].json      Collection entry content (array)
```

> **Tailwind**: Creating `/css/tailwind.css` enables Tailwind. It is compiled and injected automatically — do NOT add it via `link()`.
> All other CSS/JS files must be included via `link()` or `script()`.

## Content models

### Model types

| Type | Purpose | Has URL | File path |
|---|---|---|---|
| **Page** | Routable content | Yes | `models/pages/<key>.model` |
| **Entry** | Shared/reusable data (nav, footer, authors) | No | `models/entries/<key>.model` |
| **Block** | Reusable field group embedded in pages/entries | No | `models/blocks/<key>.model` |

All three can be **single** (one record) or **collection** (many records, key ends with `[]`).

### .model file format

JSON-like structure without quotes on keys or string values. Scalar values are the field type name.

```
{
    title: text,
    image: image,
    content: markdown
}
```

**Groups** — nest fields in an object:

```
{
    hero: {
        heading: text,
        background: image
    }
}
```

**Collections** (repeatable lists) — wrap a group in `[]`:

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

**Block reference** — `block(key)`:

```
{
    cta: block(cta)
}
```

**Entry reference** — `entry(key)` for one, `[entry(key)]` for many:

```
{
    author: entry(authors),
    tags: [entry(tags)]
}
```

### Field types

| Type | Returns |
|---|---|
| `text` | String |
| `paragraph` | String (multiline) |
| `richtext` | HTML string |
| `markdown` | Markdown string (use `marked()` to convert to HTML) |
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

## Content records

Content files are JSON records under `/content/` that hold the actual values for the fields declared in each `.model`. Editing a content file and saving it triggers the same sync-build-deploy loop as editing a template.

**Blocks have no top-level content files.** Block data is embedded inside the page or entry that references the block.

### File layout

| Model shape | File path | JSON top-level |
|---|---|---|
| Single page (e.g., `about`) | `content/pages/about.json` | Object |
| Collection page (e.g., `blog[]`) | `content/pages/blog[]/<slug>.json` | Object; one file per slug |
| Single entry (e.g., `header`) | `content/entries/header.json` | Object |
| Collection entry (e.g., `authors`) | `content/entries/authors[].json` | Array of objects |

### Field serialization

| Model type | JSON value |
|---|---|
| `text`, `paragraph`, `richtext`, `markdown`, `code`, `color`, `link` | String |
| `number` | Number |
| `boolean` | `true` / `false` |
| `date` | `"YYYY-MM-DD"` string |
| `datetime` | ISO 8601 string |
| `time` | `"HH:mm"` string |
| `image` | Resolved `{ "url": "...", "alt": "..." }` object, **or** shortcut `"<source>:<search>"` (e.g. `"pexels:doctor"`, `"url:https://picsum.photos/200.jpg"`). Sources: `unsplash`, `pexels`, `pixabay`, `iconify`, `url`. The sync engine resolves the shortcut to a full image object on save. |
| `video` | `{ "url": "...", "embed": "..." }` |
| `json` | Object or array |
| `sheet` | Array of arrays |
| `location` | `{ "latitude": n, "longitude": n }` |
| `block(key)` | Object matching that block's model (embedded, not a reference) |
| `entry(key)` / `[entry(key)]` | Slug string / array of slug strings referencing entries by handle |
| Group `{ ... }` | Nested object |
| Collection `[{ ... }]` | Array of nested objects |

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

`image` uses the shortcut form — on save, the sync engine replaces it with a real `{ url, alt }` object. Write the object form directly when you have a specific asset URL.

## EJS templates

### Syntax

| Tag | Purpose |
|---|---|
| `<%= expr %>` | Output with HTML escaping (text content) |
| `<%- expr %>` | Output raw HTML (blocks, images, rich text, helpers) |
| `<% code %>` | Execute JS (loops, conditionals, variables) |

### Template context

Every template receives:

| Variable | Type | Description |
|---|---|---|
| `item` | Object | Current page, block, or entry being rendered |
| `pages` | Array | All page records (each has `_path`, `_slug`, fields) |
| `entries` | Object | All entries keyed by model handle |
| `main` | String | Rendered page template output (**layout only**) |

`item` always refers to the current record. Page records include: `item._path`, `item._slug` (collections), `item._meta.updated_at`.

## Helper functions

### Content access

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
| `url(pathOrPage?)` | String | Site origin (e.g. `https://example.com`). Pass a path or page object to resolve into a full URL. |

### Rendering

| Function | Returns | Description |
|---|---|---|
| `render(val, separator?)` | HTML string | Render a block/entry (or array) through its template |
| `marked(md)` | HTML string | Convert markdown to HTML |

### Images

| Function | Returns | Description |
|---|---|---|
| `src(image, attr)` | URL string | Optimized image URL |
| `img(image, attr)` | HTML string | `<img>` element |
| `picture(image, attr)` | HTML string | `<picture>` with dark/light variants |
| `svg(image, attr?)` | HTML string | Inline SVG |

`attr` can be `"WxH"` string or `{ w, h, size, fit, type, class, style }` object.

### Head injection

Call from **any template** (page, block, entry, layout). Deduplicated automatically.

| Function | Description |
|---|---|
| `title(text)` | Set page `<title>` |
| `meta(attrs)` | Add `<meta>` tag |
| `link(value, order?)` | Add `<link>` tag (string URL auto-detects type, or pass object) |
| `style(css, order?)` | Add `<style>` block |
| `script(value, order?)` | Add `<script>` (`.js` URL → external, otherwise inline) |

## Patterns

### SEO

Create a block model and add SEO tags in its template:

`models/blocks/seo.model`:

```
{
    title: text,
    description: paragraph,
    image: image
}
```

`blocks/seo.ejs`:

```ejs
<% if (item.title) title(item.title) %>
<% if (item.description) meta({ name: 'description', content: item.description }) %>
<% if (item.image) { %>
  <% meta({ property: 'og:image', content: src(item.image, '1200x630') }) %>
<% } %>
```

Include `seo: block(seo)` in any page model and render: `<%- render(item.seo) %>`.

### Forms

Any `<form>` with a `data-sleekcms="<name>"` attribute works automatically — submissions are captured, stored, and viewable in the CMS dashboard. No backend, no action URL, no JS required.

```html
<form data-sleekcms="contact">
  <input name="name" type="text" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
```

The `<name>` value (e.g. `contact`, `newsletter`) groups submissions by form. Use standard `name` attributes on inputs.

### RSS feeds

Add a page with the key `rss.xml` — maps to `/rss.xml`. The static server serves it with the correct content type because of the `.xml` extension. The template outputs raw XML and must **not** use a layout.

`models/pages/rss.xml.model`:

```
{
    title: text,
    description: paragraph
}
```

`content/pages/rss.xml.json`:

```json
{
    "title": "My Blog",
    "description": "Latest posts from My Blog"
}
```

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

To autodiscover the feed, add this in your layout:

```ejs
<% link({ rel: 'alternate', type: 'application/rss+xml', title: 'RSS', href: '/rss.xml' }) %>
```

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
  <header><%- render(header) %></header>

  <main><%- main %></main>

  <% const footer = getEntry('footer'); %>
  <footer><%- render(footer) %></footer>
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

Model:

```
{ hero: block(hero), team: [entry(people)] }
```

Template:

```ejs
<%- render(item.hero) %>

<% for (const person of item.team) { %>
  <%- render(person) %>
<% } %>
```

---

# Rules for AI

1. Include CSS/JS files via **`link()`** and **`script()`** — never raw `<link>` or `<script>` tags in templates.
2. Exception: `/css/tailwind.css` is auto-injected — do **not** add it via `link()`.
3. `richtext` returns **HTML** — use `<%- %>` (unescaped). `markdown` returns **raw markdown** — convert with `marked()` first: `<%- marked(item.content) %>`.
4. Use modern design with Tailwind unless design details are specified.
5. To change what appears on a page or in shared data, edit the matching JSON under `/content/` — do **not** hard-code content into `.ejs` templates. Templates define structure; content files hold the values.
6. Fields in a content JSON file must match the keys defined in the corresponding `.model`. Adding a new field requires updating the `.model` first.
7. Collection page items each live in their own file under `content/pages/<key>/<slug>.json` — the collection key already includes `[]` (e.g., `content/pages/blog[]/my-post.json`). The `<slug>` filename is the URL segment; renaming the file renames the URL.
8. **Collection key suffix `[]` is mandatory and must appear on every related file** — model, template, and content. Never drop it.
9. For `image` fields in content JSON, prefer the shortcut form `"<source>:<search>"` (sources: `unsplash`, `pexels`, `pixabay`, `iconify`) — e.g., `"pexels:doctor"`. The sync engine resolves it to a full `{ url, alt }` object on save. Only write the object form when you have a specific asset URL.
10. Always create an RSS feed for blogs and link it in the layout `<head>` so it is discoverable. Use `rss.xml` as the key.
11. Make sites SEO-friendly and sharing-friendly (titles, descriptions, OG images on every page).
12. Don't hand-create `AGENT.md`, `CLAUDE.md`, or `.vscode/` inside the workspace — `setup-site` writes them on first run.
13. `.cache/` is the script's state, not part of the site. Don't edit or commit it.
14. Re-running `setup-site` or `sync-site` is safe and idempotent — if nothing changed, nothing is pushed.
15. One token = one workspace. The token cached in a workspace can't be swapped — point a different token at a different `--path` instead.

---

# CLI reference

## `setup-site.js`

| Flag | Description |
|---|---|
| `-t, --token <token>` | **Required.** SleekCMS CLI auth token. Persisted to `<workspace>/.cache/token`. |
| `-p, --path <path>` | Parent directory for the workspace (default: current directory). |
| `-e, --env <env>` | `localhost`, `development`, or `production`. Defaults to the token's third segment, then `production`. |

## `sync-site.js`

Run from inside the workspace directory (created by `setup-site`). No arguments required for normal use.

| Flag | Description |
|---|---|
| `--flush` | Discard the local cache and re-pull all files from the server. |

Both exit `0` on success, `1` on error.
