## SleekCMS Template Architecture & Compilation

### Overview

SleekCMS compiles **content + EJS templates** to **static HTML**. There is no build server, no CI pipeline, no `package.json`, and no Git repository involved.

---

### The Three Layers
```
Content (Models + Records)
        ↓
Templates (EJS bound to models)
        ↓
Static Site (HTML + CSS + JS + Assets)
        ↓
Preview / Deploy
```

**Content** — Structured records created from Page Models, Entry Models, and Block Models. The full site content is available as a single JSON payload during compilation.

**Templates** — EJS files bound to each model. Every model type (page, entry, block) has its own template. Pages also share an optional Layout template for the outer HTML shell (`<html>`, `<head>`, nav, footer).

**Output** — One HTML file per page record. Static pages produce a single file (`about/index.html`). Page collections produce one file per slug (`blog/hello-world/index.html`).

---

### Template Hierarchy
```
Layout Template          ← shared outer shell (html, head, nav, footer)
└── Page Template        ← renders fixed page fields + dynamic sections
    └── render(item.sections)
        ├── hero.ejs     ← item = hero block's field data
        ├── features.ejs ← item = features block's field data
        └── cta.ejs      ← item = cta block's field data
```

- **Layout template** — Wraps every page. One layout can serve the whole site.
- **Page template** — Renders the page's own fields. Calls `render(item.sections)` to delegate dynamic block sections.
- **Block templates** — Each block model has its own EJS template. The `render()` function iterates the sections array, matches each block instance to its template, and injects the HTML output.
- **Entry templates** — Optional. Used when an entry renders as a reusable fragment (e.g., an author bio component).

---

### Key Template Variables

| Variable | Available in | Contains |
|---|---|---|
| `item` | All templates | The current record's field data |
| `pages` | All templates | All page records in the site |
| `entries` | All templates | All entry records, keyed by model |
| `images` | All templates | All media library images |
| `options` | All templates | All option set values |

`item` is always the current record — the page being rendered, the block instance being rendered, or the entry being rendered. Global variables (`pages`, `entries`, etc.) give any template access to the full site content without additional API calls.

---

### The `render()` Function
```ejs
<%- render(item.sections) %>
```

This is the only line needed in a page template to output all dynamic block sections. It:

1. Iterates over every block instance in `item.sections`
2. Looks up each block's EJS template by block model type
3. Renders the template with that block's field data as `item`
4. Concatenates and returns the full HTML output

The page template never needs to know which block types are present.

---

### Build Output

- One HTML file per page record
- Assets (CSS, JS) included as-is
- Tailwind CSS processed automatically — no config required
- Output is a self-contained static site, compatible with any host
 

## Workspace Information

This is a **synced SleekCMS workspace**. Files are automatically synced with the SleekCMS server.

### Important Notes:
- **File edits are auto-synced** - changes are automatically saved to the server
- **DO NOT create new files** - new templates must be created via the SleekCMS dashboard
- **Deleting files** will also delete them from the server

---

Templates use [EJS](https://ejs.co/) syntax. The template receives a context object with site content and helper functions.

## Directory structure
- css/tailwind.css - tailwind config v4
- css/*.css - other styles css
- js/*.js - script files
- views/blocks/*.ejs - ejs templates for each block. Blocks are groups of fields, used as a field type in entries or pages
- views/entries/*.ejs - ejs template corresponding to each entry. Entries are regular records and can be referenced by other models
- views/pages/*.ejs - ejs template corresponding to each page or page collections (path/[slug])
- All _index.ejs are for collection of pages and created for each [slug]
- .sleekcms/types.ts - TypeScript type definitions for all available data models

**Note:** Do not create any new files. You can suggest creating new models or ask for model schema but don't add any new files.

## TypeScript Types

The `.sleekcms/types.ts` file contains TypeScript type definitions for all content models in this workspace. **Always read this file first** to understand the exact structure of:
- Page types and their fields
- Entry types and their fields  
- Block types and their fields
- Available images, options, and other data

Use these types to ensure you're accessing the correct field names and understanding the data structure when creating or editing templates.

## Available Data

- `item` — The current page, entry, or block being rendered. Fields depend on the schema (e.g. `item.title`, `item.body`, `item.image`).
- `pages` — Array of all pages. Each page has `_path`, `_slug`, and its own fields.
- `entries` — Object of entries keyed by handle (e.g. `entries.header`, `entries.footer`).
- `images` — Object of images keyed by name. Each has `{ url, raw, alt }`.
- `options` — Object of option sets keyed by name. Each is an array of `{ label, value }`.
- `main` — The rendered HTML from the previous template in the chain (used in base/layout templates).

Note: Although all data can be accessed directly, best to use Helper function instead of accessing it directly.

## Helper Functions

### Content Querying

| Function | Description |
|---|---|
| `render(blocks:any)` | Render a block or section (array of blocks) to HTML |
| `getEntry(handle:string)` | Get an entry by handle |
| `getPage(path:string)` | Get a page with the exact path |
| `getPages(path:string, {collection?: boolean})` | Get all pages where path begins with the string. |
| `getSlugs(path:string)` | Get slugs of pages under a path |
| `getImage(name:string)` | Get an image object by name |
| `getOptions(name:string)` | Get an option set by name |
| `getContent(query?)` | Get all content, or filter with a [JMESPath](https://jmespath.org/) query |
| `path(page)` | Get the URL path of a page |

### Images

| Function | Description |
|---|---|
| `src(image:{url: string}, "WxH")` | Get a resized image URL. e.g. `src(item.image, "800x600")` |
| `img(image:{url: string}, "WxH")` | Get a full `<img>` tag |
| `picture(image:{url: string}, "WxH")` | Get a `<picture>` tag (supports dark/light variants) |
| `svg(image:{url: string})` | Render an SVG reference |

Size can be a string `"WxH"` or an object `{ w, h, fit, class, style }`.

### Head Injection

Call these to add elements to `<head>`. Deduplicated automatically.

| Function | Description |
|---|---|
| `meta(attrs)` | Add a `<meta>` tag. e.g. `meta({ name: "description", content: "..." })` |
| `link(attrs)` | Add a `<link>` tag |
| `style(css)` | Add a `<style>` block |
| `script(js)` | Add a `<script>` block |
| `title(text)` | Set the page `<title>` |
| `seo()` | Auto-generate SEO meta tags from `item.seo` or `item.title`/`item.description`/`item.image` |

## Template Types

- **main** — Renders the content for the current item.
- **base** — Layout wrapper. Use `<%- main %>` to output the rendered main content.

## Examples

### Simple page template (main)
```ejs
<h1><%= item.title %></h1>
<div><%- item.body %></div>
```

### Render blocks
```ejs
<%- render(item.blocks) %>
```

### List pages
```ejs
<% for (let page of getPages('/blog', {collection: true})) { %>
  <a href="<%= path(page) %>"><%= page.title %></a>
<% } %>
```

### Image
```ejs
<%- img(item.image, "600x400") %>
```

### Base layout
```ejs
<!DOCTYPE html>
<html>
<head>
  <title><%= item.title %></title>
</head>
<body>
  <%- render(entries.header) %>
  <%- main %>
  <%- render(entries.footer) %>
</body>
</html>
```

### SEO
```ejs
<% seo() %>
```

## EJS Syntax Quick Reference

- `<%= expr %>` — Output escaped HTML
- `<%- expr %>` — Output raw/unescaped HTML (use for rendered blocks, images, HTML fields)
- `<% code %>` — Execute JS (loops, conditionals)
