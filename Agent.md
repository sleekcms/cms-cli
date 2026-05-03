# SleekCMS Site Builder Reference for AI Agents

## Purpose

This file tells AI agents how to create and edit SleekCMS site files correctly.

All editable site artifacts live under `src/`. Do not create root-level `models/`, `content/`, `views/`, `pages/`, `entries/`, `blocks/`, `css/`, or `js/` folders.

## Non-Negotiable Rules

1. Use the pre-created folders under `src/`.
2. Use `src/models`, never `src/model`.
3. Put templates under `src/views`, not root-level `pages/`, `entries/`, or `blocks/`.
4. Keep structure in `.model` files, content in JSON files, and markup in `.ejs` files.
5. A record collection key ends in `[]`; keep that suffix on the matching model, content, and view paths.
6. A repeatable field such as `[image]` is an array-valued field inside one record. It is not a record collection.
7. Include CSS and JS with `link()` and `script()` helpers. Do not write raw stylesheet or script tags in templates.
8. `src/public/css/tailwind.css` is auto-compiled and auto-injected. Do not add it with `link()`.
9. Do not hard-code page or shared content into templates when it belongs in `src/content`.
10. Add fields to the matching `.model` before using those fields in content JSON.

## Core Concepts

SleekCMS has three model kinds:

| Kind | What it is | Identifier | Routable |
|---|---|---|---|
| Page | Content that renders to a URL | Path | Yes |
| Entry | Reusable shared content, such as header, footer, people, authors, or nav | Handle | No |
| Block | Embedded reusable field group inside a page or entry | Block key | No |

Models can be either:

| Cardinality | Meaning | Key format |
|---|---|---|
| Single record | One object | `key` |
| Record collection | Many records | `key[]` |

Page collections and entry collections are record collections. Array-valued fields, such as `[image]` or `[entry(testimonials)]`, are repeatable fields inside one record.

## Workspace Structure

Use this as the canonical file tree:

```text
src/
  models/
    pages/
    entries/
    blocks/
  content/
    pages/
    entries/
    images.json
  views/
    pages/
    entries/
    blocks/
    layouts/
  public/
    css/
    js/

```

Files under `src/public/css` are served from `/css/...`. Files under `src/public/js` are served from `/js/...`.

## Key Naming Rules

### Entry keys

Entries are handle-based.

| Entry type | Key format | Example |
|---|---|---|
| Single entry | `handle` | `header` |
| Entry collection | `handle[]` | `people[]` |

Entry references use entry handles. They do not use page paths or page slugs.

### Page keys

Pages are path-based. To make a page key:

1. Start from the URL path.
2. Remove the leading `/`.
3. Use `_index` for the home page `/`.
4. Replace remaining `/` characters with `_`.
5. Append `[]` for a page collection.

| URL path | Page kind | Key |
|---|---|---|
| `/` | Single page | `_index` |
| `/about` | Single page | `about` |
| `/docs/getting-started` | Single page | `docs_getting-started` |
| `/blog/<slug>` | Page collection | `blog[]` |

The key connects the model, content, and view files.

## Page Files

Pages are routable. A page model defines the shape of one page record.

### Single page

```text
src/models/pages/about.model
src/content/pages/about.json
src/views/pages/about.ejs
```

`src/content/pages/about.json` is one JSON object matching `about.model`. `src/views/pages/about.ejs` renders that object.

### Page collection

```text
src/models/pages/blog[].model
src/content/pages/blog[]/<slug>.json
src/views/pages/blog[].ejs
```

`src/models/pages/blog[].model` defines the shape of one blog post. Each JSON file under `src/content/pages/blog[]/` is one blog post record. The `<slug>` filename is the URL segment for that record.

The page view renders one page record at a time. The rendered page HTML is available inside layouts as `main`.

## Entry Files

Entries are reusable shared data. An entry model defines the shape of one entry record.

### Single entry

```text
src/models/entries/header.model
src/content/entries/header.json
src/views/entries/header.ejs
```

`src/content/entries/header.json` is one object matching `header.model`.

### Entry collection

```text
src/models/entries/people[].model
src/content/entries/people[].json
src/views/entries/people[].ejs
```

`src/models/entries/people[].model` defines the shape of one person. `src/content/entries/people[].json` is an array of person objects.

Entry collection records are identified by handle. When another record uses `entry(people)` or `[entry(people)]`, the content stores the target entry handle or handles.

Entry views are used when an entry is rendered through `render(obj)`, either because the entry is referenced from a page/block/entry or because a template manually loops through entries and renders them.

## Block Files

Blocks are embedded content structures. They do not have top-level content JSON files.

```text
src/models/blocks/card.model
src/views/blocks/card.ejs
```

`src/models/blocks/card.model` defines the shape of one card block. Card content is embedded inside a page or entry content JSON file. `render(obj)` renders the block with its matching block view.

## Model Syntax

`.model` files are JSON-like:

- Do not quote keys.
- Do not quote scalar field types.
- Scalar values are always field type names.
- Use objects for groups.
- Use arrays for repeatable fields.

Example blog model:

```js
{
  title: text,
  content: markdown,
  image: image
}
```

### Groups

```js
{
  hero: {
    heading: text,
    background: image
  }
}
```

### Array-valued fields

Use `[type]` when one record has many values for a field:

```js
{
  title: text,
  content: markdown,
  images: [image]
}
```

This means one blog post has multiple images. It does not make the blog model a record collection.

## Field Shapes

### Scalar field

```js
{
  image: image
}
```

### Array-valued field

```js
{
  images: [image]
}
```

### Block field

```js
{
  seo: block(seo)
}
```

`block(seo)` embeds content matching `src/models/blocks/seo.model`.

### Entry reference fields

```js
{
  author: entry(people),
  highlights: [entry(testimonials)]
}
```

`entry(people)` references one entry from the `people` entry model. `[entry(testimonials)]` references many entries from the `testimonials` entry model.

In content JSON, entry references are stored as entry handles, or arrays of entry handles. They are not page paths or slugs. In templates, referenced entries are resolved to objects that can be passed to `render(obj)`.

## Field Types

| Type | Content value |
|---|---|
| `text` | String |
| `paragraph` | Multiline string |
| `richtext` | HTML string |
| `markdown` | Markdown string |
| `number` | Number |
| `boolean` | `true` or `false` |
| `date` | `"YYYY-MM-DD"` string |
| `datetime` | ISO 8601 string |
| `time` | `"HH:mm"` string |
| `color` | Hex color or color name string |
| `link` | URL string or relative path |
| `image` | Image object or image shortcut string |
| `video` | `{ "url": "...", "embed": "..." }` |
| `code` | String |
| `json` | Object or array |
| `sheet` | Array of arrays |
| `location` | `{ "latitude": n, "longitude": n }` |
| `block(key)` | Embedded object matching the block model |
| `entry(key)` | Entry handle in content, resolved entry object in templates |
| `[type]` | Array of values of that type |

## Content JSON Rules

Content JSON must match the shape declared by the corresponding `.model`.

| Model kind | Content path | JSON shape |
|---|---|---|
| Single page | `src/content/pages/about.json` | One object |
| Page collection | `src/content/pages/blog[]/<slug>.json` | One object per slug file |
| Single entry | `src/content/entries/header.json` | One object |
| Entry collection | `src/content/entries/people[].json` | Array of objects |
| Block | Embedded inside page or entry content | One embedded object |

Example model:

```js
{
  seo: block(seo),
  title: text,
  content: markdown,
  image: image,
  gallery: [image],
  author: entry(people),
  highlights: [entry(testimonials)]
}
```

Example page content:

```json
{
  "seo": {
    "title": "My Blog Post",
    "description": "A useful summary"
  },
  "title": "My Blog Post",
  "content": "Markdown content goes here.",
  "image": "pexels:writer at desk|Writer working at a desk",
  "gallery": [
    "pexels:notebook",
    "pexels:laptop"
  ],
  "author": "jane-doe",
  "highlights": ["client-a", "client-b"]
}
```

The sync engine may resolve shortcuts and references into richer objects for templates.

## Rendering Model

Page rendering is automatic:

```text
page content + page view -> rendered page HTML
```

Layouts receive the rendered page HTML as `main`:

```ejs
<main><%- main %></main>
```

Use `render(obj)` for entries and blocks:

```ejs
<%- render(item.seo) %>
<%- render(item.author) %>
```

For arrays, loop explicitly unless you know `render(array)` is supported for the current helper:

```ejs
<% for (const testimonial of item.highlights) { %>
  <%- render(testimonial) %>
<% } %>
```

## EJS Templates

### Syntax

| Tag | Purpose |
|---|---|
| `<%= expr %>` | Output with HTML escaping |
| `<%- expr %>` | Output raw HTML |
| `<% code %>` | Execute JavaScript |

Use `<%- %>` for trusted HTML from helpers, rendered blocks, rendered entries, `richtext`, and `marked(markdown)`.

### Template context

Every template receives:

| Variable | Description |
|---|---|
| `item` | Current page, entry, or block record |
| `pages` | All page records |
| `entries` | All entries keyed by handle |
| `main` | Rendered page HTML, available in layouts |

`item` is always the current record. In a page view, `item` is the page record. In an entry view, `item` is the entry record. In a block view, `item` is the embedded block object.

Page records include `_path`, `_slug` for collection pages, and `_meta.updated_at`.

## Helper Functions

### Content access

| Function | Returns | Description |
|---|---|---|
| `getPage(path)` | Object or undefined | Page by exact path |
| `getPages(path, opts?)` | Array | Pages where path starts with prefix. Use `{ collection: true }` for collection pages only |
| `getEntry(handle)` | Object or array | Entry by handle. Single entry returns an object; entry collection returns an array |
| `getSlugs(path)` | string[] | Slugs under a page collection path |
| `getImage(name)` | Object or undefined | Site-level image by handle |
| `getOptions(name)` | Array or undefined | Option set as `[{ label, value }]` |
| `getContent(query?)` | Any | Full content payload, or filtered with JMESPath |
| `path(page)` | String | URL path of a page object |
| `url(pathOrPage?)` | String | Site origin, or absolute URL for a path/page |

### Rendering

| Function | Returns | Description |
|---|---|---|
| `render(val, separator?)` | HTML string | Render a block or entry through its matching view |
| `marked(md)` | HTML string | Convert markdown to HTML |

### Images

| Function | Returns | Description |
|---|---|---|
| `src(image, attr)` | URL string | Optimized image URL |
| `img(image, attr)` | HTML string | `<img>` element |
| `picture(image, attr)` | HTML string | `<picture>` with dark/light variants |
| `svg(image, attr?)` | HTML string | Inline SVG with optional attributes |

`attr` can be a `"WxH"` string or an object such as `{ w, h, size, fit, type, class, style }`.

### Head injection

Call these from any page, entry, block, or layout view. Calls are deduplicated automatically.

| Function | Description |
|---|---|
| `title(text)` | Set page `<title>` |
| `meta(attrs)` | Add a `<meta>` tag |
| `link(value, order?)` | Add a `<link>` tag |
| `style(css, order?)` | Add a `<style>` block |
| `script(value, order?)` | Add a `<script>` tag |

For a regular stylesheet at `src/public/css/styles.css`, call:

```ejs
<% link('/css/styles.css') %>
```

For a regular script at `src/public/js/app.js`, call:

```ejs
<% script('/js/app.js') %>
```

## Images

Image fields can be written as resolved objects or shortcut strings.

Supported shortcut sources:

| Source | Example |
|---|---|
| `unsplash` | `"unsplash:mountain sunrise"` |
| `pexels` | `"pexels:doctor"` |
| `pixabay` | `"pixabay:forest"` |
| `iconify` | `"iconify:mdi:home"` |
| `url` | `"url:https://example.com/image.jpg"` |
| `cms` | `"cms:logo"` |

Append alt text with `|`:

```json
{
  "image": "pexels:doctor|Smiling doctor with stethoscope"
}
```

Use `src/content/images.json` for reusable site images:

```json
{
  "logo": "url:https://cdn.example.com/logo.svg",
  "hero": "pexels:mountain sunrise",
  "apple-icon": "iconify:mdi:apple"
}
```

Then reference them in content:

```json
{
  "logo": "cms:logo"
}
```

Markdown fields can embed image shortcuts with standard markdown image syntax:

```markdown
![Doctor](pexels:doctor|Friendly family doctor 800x600)
```

The optional `WIDTHxHEIGHT` token sets image dimensions for the rendered URL. If omitted, the default is `600x400`.

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
  <%- render(getEntry('header')) %>
  <main><%- main %></main>
  <%- render(getEntry('footer')) %>
</body>
</html>
```

### Page view

```ejs
<% title(item.title + ' | My Site') %>
<% link('/css/styles.css') %>
<% script('/js/app.js') %>

<h1><%= item.title %></h1>
<%- img(item.image, '1200x600') %>
<%- marked(item.content) %>
```

### Block view

```ejs
<section class="hero" style="background-image: url('<%- src(item.background, '1920x800') %>')">
  <h2><%= item.heading %></h2>
  <p><%= item.subheading %></p>
  <a href="<%= item.cta_link %>" class="btn"><%= item.cta_label %></a>
</section>
```

### Blog listing

```ejs
<% for (const post of getPages('/blog', { collection: true })) { %>
  <a href="<%- path(post) %>">
    <%- img(post.image, '400x250') %>
    <h3><%= post.title %></h3>
  </a>
<% } %>
```

### SEO block

Create a block model:

```text
src/models/blocks/seo.model
```

```js
{
  title: text,
  description: paragraph,
  image: image
}
```

Create its view:

```text
src/views/blocks/seo.ejs
```

```ejs
<% if (item.title) title(item.title) %>
<% if (item.description) meta({ name: 'description', content: item.description }) %>
<% if (item.image) { %>
  <% meta({ property: 'og:image', content: src(item.image, '1200x630') }) %>
<% } %>
```

Add it to a page model:

```js
{
  seo: block(seo),
  title: text
}
```

Render it from the page view:

```ejs
<%- render(item.seo) %>
```

### Forms

Any form with `data-sleekcms="<name>"` is captured automatically. No backend setup, action URL, or JavaScript is required.

```html
<form data-sleekcms="contact">
  <input name="name" type="text" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
```

Use standard `name` attributes. Each submitted field is stored as-is.

### RSS feed

Create an RSS feed as a page whose key is `rss.xml`. This maps to `/rss.xml`. The template outputs raw XML and should not use a layout.

```text
src/models/pages/rss.xml.model
src/content/pages/rss.xml.json
src/views/pages/rss.xml.ejs
```

Model:

```js
{
  title: text,
  description: paragraph
}
```

Content:

```json
{
  "title": "My Blog",
  "description": "Latest posts from My Blog"
}
```

View:

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

Add feed autodiscovery from a layout or page view:

```ejs
<% link({ rel: 'alternate', type: 'application/rss+xml', title: 'RSS', href: '/rss.xml' }) %>
```

Always create an RSS feed for blogs and make pages SEO- and sharing-friendly.
