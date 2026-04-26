# SleekCMS CLI

**Build complete websites with AI. Edit them locally. Deploy instantly.**

The SleekCMS CLI brings your CMS to your code editor — with full AI-agent support baked in. Spin up an entirely new site by describing it in plain English, or drop into any existing site and edit templates, content, and styles the way you'd expect: locally, with real files, in your editor of choice.

Every save auto-syncs. Every change goes live. No build steps. No Git hooks. No infrastructure to manage.

---

## Why developers love it

- **AI generates your entire site from a description** — models, templates, layouts, styles, and content, all wired up and ready to go.
- **AI-generated sites are plain files** — EJS templates, JSON content, CSS, JS. You own every line. Open in VS Code, Cursor, or any editor.
- **Any AI can maintain it** — the CLI injects `AGENT.md`, `CLAUDE.md`, and `.vscode/copilot-instructions.md` into your workspace. GitHub Copilot, Claude, Cursor — they all read the same site reference and understand your structure from day one.
- **Live sync, always** — save a file, it syncs. Open the SleekCMS dashboard and your preview updates in real time.
- **One command to start** — no installs required.

---

## Quickstart

```bash
npx @sleekcms/cli --token <YOUR_AUTH_TOKEN>
```

That's it. The CLI fetches your site, opens an editor prompt, and starts watching for changes. Grab a token from your [SleekCMS dashboard](https://app.sleekcms.com).

---

## Installation

### Run without installing (recommended)

```bash
npx @sleekcms/cli --token <YOUR_AUTH_TOKEN>
```

### Install globally

```bash
npm install -g @sleekcms/cli
sleekcms --token <YOUR_AUTH_TOKEN>
```

---

## Usage

```bash
npx @sleekcms/cli [OPTIONS]
```

| Option             | Alias | Description                                                    | Default     |
|--------------------|-------|----------------------------------------------------------------|-------------|
| `--token <token>`  | `-t`  | Your SleekCMS CLI auth token (required)                        | —           |
| `--path <path>`    | `-p`  | Parent directory for the local workspace                       | current dir |
| `--env <env>`      | `-e`  | Target environment: `production`, `development`, `localhost`   | `production`|
| `--version`        | `-v`  | Print version number                                           | —           |
| `--help`           | `-h`  | Show help                                                      | —           |

```bash
# Basic — connects to production
npx @sleekcms/cli --token abc123-xxxx

# Custom workspace folder
npx @sleekcms/cli -t abc123-xxxx -p ~/Sites

# Target a dev environment
npx @sleekcms/cli -t abc123-xxxx -e development
```

Once running, press `r` to re-fetch all files or `x` / `Ctrl+C` to exit.

---

## Building a site with AI

This is where SleekCMS CLI becomes something different. Instead of hand-crafting every template, you describe the site you want and let an AI agent build it.

### How it works

When the CLI starts for the first time, it writes three files into your local workspace:

| File | Picked up by |
|---|---|
| `AGENT.md` | Copilot (agent mode), any generic agent |
| `CLAUDE.md` | Claude / Claude Code |
| `.vscode/copilot-instructions.md` | GitHub Copilot in VS Code |

These files contain the complete SleekCMS site-building reference — file naming conventions, model syntax, template helpers, content format, and all the rules an AI needs to produce valid, working code.

### Generate a complete site

Open the workspace in Cursor, VS Code with GitHub Copilot, or Claude Code, then describe your site:

```
Build a portfolio site with:
- A home page with a hero section, featured projects, and a contact form
- A blog with individual post pages
- A shared header and footer
- Tailwind CSS styling
- SEO meta tags on every page
```

The AI creates the right files in the right places:

```
models/pages/home.model
models/pages/blog[].model
models/entries/header.model
models/entries/footer.model
models/blocks/hero.model
pages/home.ejs
pages/blog[].ejs
entries/header.ejs
entries/footer.ejs
blocks/hero.ejs
layouts/main.ejs
css/tailwind.css
content/pages/home.json
content/pages/blog[]/my-first-post.json
content/entries/header.json
content/entries/footer.json
```

As soon as those files hit disk, the watcher picks them up and syncs each one to SleekCMS. Your site is live before the AI finishes explaining what it built.

### AI-generated sites are fully editable and maintainable — automatically

There's no lock-in, no proprietary format, no "AI black box". Every file the AI writes is the same real file you'd write by hand:

- **Templates** are standard EJS — open them in any editor, tweak any line.
- **Models** are plain JSON-like schema files — add a field, save, done.
- **Content** is readable JSON — edit values directly without touching the CMS dashboard.

And because `AGENT.md` / `CLAUDE.md` live in the workspace, any AI session — today or months from now — picks up the same full site context. Ask it to add a dark mode toggle, refactor the blog layout, or generate ten more blog posts. It already knows your site.

---

## How sync works

The CLI runs a local watcher after the initial fetch. Every time you save a file:

1. The watcher detects the change (debounced to batch rapid edits).
2. The changed file is classified — template, model, content record, CSS, or JS.
3. It's pushed to the SleekCMS API in the correct order: models first, then templates, then content.
4. The SleekCMS server rebuilds and redeploys the affected pages.

On first run, the CLI pulls the full site state from the server. After that, a local `.cache/` folder tracks server-known state so only real diffs are pushed — no redundant API calls.

```
Your editor → file save → watcher → SleekCMS API → rebuild → live site
```

### Watch mode commands

| Key | Action |
|---|---|
| `r` | Re-fetch all files from server |
| `x` or `Ctrl+C` | Exit and clean up local workspace |

---

## Previewing your site

Every change you sync is immediately reflected in SleekCMS. To preview:

1. Open the [SleekCMS dashboard](https://app.sleekcms.com).
2. Navigate to your site.
3. Click **Preview** — you'll see the live build with your latest changes.

No manual deploy. No waiting. SleekCMS rebuilds on every sync and the preview reflects the current state of your local workspace in real time.

---

## Local workspace structure

```
<site-name>/
├── AGENT.md                         # AI agent reference (auto-generated)
├── CLAUDE.md                        # Claude reference (auto-generated)
├── .vscode/
│   ├── copilot-instructions.md      # GitHub Copilot context (auto-generated)
│   └── settings.json                # Editor settings
│
├── models/
│   ├── pages/<key>.model            # Page content schema
│   ├── entries/<key>.model          # Entry content schema
│   └── blocks/<key>.model           # Block content schema
│
├── pages/<key>.ejs                  # Page templates
├── entries/<key>.ejs                # Entry templates
├── blocks/<key>.ejs                 # Block templates
├── layouts/<name>.ejs               # Layout wrappers
│
├── css/<name>.css                   # Stylesheets
├── js/<name>.js                     # Scripts
│
└── content/
    ├── pages/<key>.json             # Single page content
    ├── pages/<key>/<slug>.json      # Collection page content (one file per item)
    ├── entries/<key>.json           # Single entry content
    └── entries/<key>[].json         # Collection entry content (array)
```

### File naming

Keys are lowercase, dash-separated. For pages, `_` in the key maps to `/` in the URL. A `[]` suffix marks a collection.

| Key | URL |
|---|---|
| `_index` | `/` |
| `about` | `/about` |
| `blog[]` | `/blog/<slug>` |
| `docs_getting-started` | `/docs/getting-started` |

---

## Content models

Models describe the shape of your content. They're JSON-like files with unquoted keys and type names as values.

```
{
    title: text,
    image: image,
    body: richtext,
    published: boolean
}
```

**Nested groups:**
```
{
    hero: {
        heading: text,
        background: image
    }
}
```

**Repeatable lists:**
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

**Block and entry references:**
```
{
    cta: block(cta),
    author: entry(authors),
    tags: [entry(tags)]
}
```

### Field types

| Type | Value |
|---|---|
| `text` | String |
| `paragraph` | Multiline string |
| `richtext` | HTML string |
| `markdown` | Markdown string |
| `number` | Number |
| `boolean` | `true` / `false` |
| `date` | `YYYY-MM-DD` |
| `image` | `{ url, alt }` |
| `video` | `{ url, embed }` |
| `link` | URL string |
| `json` | Object or array |
| `block(key)` | Embedded block object |
| `entry(key)` | Entry object or slug reference |

---

## EJS template syntax

| Tag | Purpose |
|---|---|
| `<%= expr %>` | Output with HTML escaping |
| `<%- expr %>` | Output raw HTML |
| `<% code %>` | Execute JS (loops, conditionals) |

### Template context

| Variable | Description |
|---|---|
| `item` | The current page, entry, or block record |
| `pages` | All page records |
| `entries` | All entries keyed by handle |
| `main` | Rendered page output (layouts only) |

### Helper functions

**Content access**

| Function | Description |
|---|---|
| `getPage(path)` | Page by exact path |
| `getPages(path, opts?)` | Pages where path starts with prefix |
| `getEntry(handle)` | Entry by handle |
| `getSlugs(path)` | Slugs under a collection path |
| `url(pathOrPage?)` | Full URL for the site or a specific page |

**Rendering**

| Function | Description |
|---|---|
| `render(val)` | Render a block or entry through its template |
| `marked(md)` | Convert markdown to HTML |

**Images**

| Function | Description |
|---|---|
| `img(image, attr)` | `<img>` element |
| `src(image, attr)` | Optimized image URL |
| `picture(image, attr)` | `<picture>` with dark/light variants |
| `svg(image, attr?)` | Inline SVG |

`attr` can be a `"WxH"` string or `{ w, h, class, style, fit }` object.

**Head injection** (deduplicated automatically)

| Function | Description |
|---|---|
| `title(text)` | Set `<title>` |
| `meta(attrs)` | Add `<meta>` tag |
| `link(value)` | Add `<link>` (CSS URL, font, etc.) |
| `style(css)` | Inline `<style>` block |
| `script(value)` | External or inline `<script>` |

> **Tailwind:** Creating `/css/tailwind.css` enables Tailwind automatically — it's compiled and injected for you. Do **not** add it via `link()`.

---

## Example templates

**Layout (`layouts/main.ejs`)**

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

**Page (`pages/blog[].ejs`)**

```ejs
<% title(item.title + ' | My Blog') %>
<% link('/css/styles.css') %>

<article>
  <h1><%= item.title %></h1>
  <%- img(item.cover, '1200x600') %>
  <%- marked(item.body) %>
</article>
```

**Blog index listing**

```ejs
<% for (const post of getPages('/blog', { collection: true })) { %>
  <a href="<%- path(post) %>">
    <%- img(post.cover, '400x250') %>
    <h3><%= post.title %></h3>
  </a>
<% } %>
```

**Forms** (no backend needed)

```html
<form data-sleekcms="contact">
  <input name="name" type="text" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
```

Any form with `data-sleekcms="<name>"` captures and stores submissions in the CMS dashboard automatically.

---

## Content files

Content lives in `/content/` as plain JSON. Edit any content file and save — it syncs like any other file.

For `image` fields, use the shortcut `"<source>:<search>"` form in content JSON. The sync engine resolves it to a full image object on save:

```json
{
  "title": "About Us",
  "image": "pexels:team meeting",
  "hero": {
    "heading": "Hello",
    "subheading": "Welcome to our site"
  }
}
```

Supported image sources: `unsplash`, `pexels`, `pixabay`, `iconify`, `url`.

---

## Prerequisites

- **Node.js** v16 or later
- A **SleekCMS account** with a CLI auth token ([get one here](https://app.sleekcms.com))

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Authentication error | Verify your token in the SleekCMS dashboard |
| No files downloaded | Check your token and `--env` setting |
| Changes not syncing | Check terminal output; changes are debounced by 5 seconds |
| Wrong workspace opened | Each token maps to a specific workspace folder |

---

## License

ISC — [Yusuf Bhabhrawala](https://sleekcms.com)

---

[SleekCMS](https://sleekcms.com) · [Documentation](https://docs.sleekcms.com) · [Dashboard](https://app.sleekcms.com)
