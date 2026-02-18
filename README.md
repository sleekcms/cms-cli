# SleekCMS CLI

**Locally edit your SleekCMS site's source files** — templates, styles, and scripts — using your favorite code editor, with live sync back to the CMS.

## Overview

The SleekCMS CLI (`@sleekcms/cli`) downloads your site's template source code to a local workspace, watches for file changes, and automatically syncs edits back to your SleekCMS site in real time. When you're done, the CLI cleans up the local workspace on exit.

## Prerequisites

- **Node.js** (v16 or later recommended)
- **npm**
- A **SleekCMS account** with a CLI auth token (generated from your SleekCMS dashboard)

## Installation

### Option 1: Run directly with npx (no install needed)

```bash
npx @sleekcms/cli --token <YOUR_AUTH_TOKEN>
```

This command:
- Downloads the CLI
- Installs dependencies
- Runs immediately
- No local installation required

### Option 2: Install globally

```bash
npm install -g @sleekcms/cli
sleekcms --token <YOUR_AUTH_TOKEN>
```

## Usage

```bash
npx @sleekcms/cli --token <YOUR_AUTH_TOKEN> [OPTIONS]
```

Or, if installed globally:

```bash
sleekcms --token <YOUR_AUTH_TOKEN> [OPTIONS]
```

### Options

| Option             | Alias | Description                                         | Default                |
|--------------------|-------|-----------------------------------------------------|------------------------|
| `--token <token>`  | `-t`  | Your SleekCMS CLI auth token (required)             | -                      |
| `--env <env>`      | `-e`  | Environment: `production`, `development`, `localhost` | `production`          |
| `--path <path>`    | `-p`  | Local directory for the downloaded files            | `<token-prefix>-views` |
| `--version`        | `-v`  | Output the version number                           | -                      |
| `--help`           | `-h`  | Display help                                        | -                      |

### Examples

```bash
# Basic usage (production environment)
npx @sleekcms/cli --token abc123-xxxx

# Use a custom environment
npx @sleekcms/cli -t abc123-xxxx -e development

# Specify a custom local directory
npx @sleekcms/cli -t abc123-xxxx -p ./my-templates

# All options together
npx @sleekcms/cli --token abc123-xxxx --env development --path ./custom-workspace
```

## How It Works

1. **Authenticates** with SleekCMS using your auth token
2. **Downloads** all your site's template files to a local directory
3. **Watches** for changes in the local files
4. **Syncs** any local edits back to SleekCMS automatically
5. **Cleans up** the local workspace when you press Ctrl+C to exit

## Features

- **Live File Watching:** Edit `.html` and `.md` template files locally; changes sync automatically.
- **Automatic Cleanup:** The CLI removes local files on exit to keep your workspace tidy.
- **Debounced Syncing:** File changes are debounced to avoid excessive API calls during rapid edits.
- **Flexible Environments:** Point to `localhost`, `development`, or `production` SleekCMS instances.
- **Agentic Auto-Coding:** A special `.github/agents/cms-cli-dev.md` file can be generated in your workspace. This file can be used with AI coding agents (e.g., GitHub Copilot) to help the agent understand and edit your SleekCMS template code.

## Template File Structure

The CLI downloads your SleekCMS templates into a local directory. A typical structure looks like:

```
<token-prefix>-views/
├── layouts/
│   ├── main-layout.html
│   └── ...
├── partials/
│   ├── header.html
│   ├── footer.html
│   └── ...
└── pages/
    ├── home.html
    ├── about.html
    └── ...
```

- **layouts/**: Reusable layout templates
- **partials/**: Reusable template components (header, footer, etc.)
- **pages/**: Individual page templates

## Template Syntax Reference

SleekCMS templates support [EJS (Embedded JavaScript)](https://ejs.co/) syntax and special helper functions. The following is a quick reference for the most common use cases.

### EJS Basics

| Syntax     | Purpose                                                                 |
|------------|-------------------------------------------------------------------------|
| `<% %>`    | Execute JavaScript code (control flow, loops, etc.) without output     |
| `<%= %>`   | Output the value of an expression (escaped for HTML safety)            |
| `<%- %>`   | Output the value of an expression (raw, unescaped HTML)                |
| `<%# %>`   | Comment (not rendered in output)                                       |

### Common Patterns

#### Conditionals

```ejs
<% if (item.featured) { %>
  <div class="badge">Featured</div>
<% } %>
```

#### Loops

```ejs
<ul>
  <% items.forEach(function(item) { %>
    <li><%= item.title %></li>
  <% }); %>
</ul>
```

#### Including Partials

```ejs
<%- render(getEntry('header')) %>
```

### SleekCMS Helper Functions

These functions are available in your templates to access content and metadata.

#### `getEntry(slug)`

Fetches a single entry by slug.

```ejs
<%- render(getEntry('header')) %>
```

#### `getEntries(contentTypeName)`

Fetches all entries of a specific content type.

```ejs
<% const posts = getEntries('blog-post'); %>
<% posts.forEach(function(post) { %>
  <h2><%= post.title %></h2>
<% }); %>
```

#### `render(entry)`

Renders an entry using its associated template.

```ejs
<%- render(getEntry('footer')) %>
```

#### `seo()`

Outputs SEO meta tags for the current page.

```ejs
<head>
  <title><%= item.title %></title>
  <% seo() %>
</head>
```

#### `main`

A special variable that holds the main content for the current page (used in layouts).

```ejs
<body>
  <%- render(getEntry('header')) %>
  <%- main %>
  <%- render(getEntry('footer')) %>
</body>
```

### Example Layout

```ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= item.title %></title>
  <% seo() %>
</head>
<body>
  <%- render(getEntry('header')) %>
  <%- main %>
  <%- render(getEntry('footer')) %>
</body>
</html>
```

### Example Partial (Header)

```ejs
<header>
  <nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
    <a href="/blog">Blog</a>
  </nav>
</header>
```

### Example Page Template

```ejs
<main>
  <h1><%= item.title %></h1>
  <p><%= item.description %></p>
  
  <% if (item.featured) { %>
    <span class="badge">Featured</span>
  <% } %>
  
  <div>
    <%- item.body %>
  </div>
  
  <% if (item.relatedPosts && item.relatedPosts.length > 0) { %>
    <h2>Related Posts</h2>
    <ul>
      <% item.relatedPosts.forEach(function(post) { %>
        <li>
          <a href="<%= post.url %>"><%= post.title %></a>
        </li>
      <% }); %>
    </ul>
  <% } %>
</main>
```

## Workflow Tips

1. **Start the CLI** in your project directory:
   ```bash
   npx @sleekcms/cli --token <YOUR_AUTH_TOKEN>
   ```
2. **Edit** any `.html` or `.md` file in the generated directory using your editor of choice.
3. **Save** your changes. The CLI automatically syncs them to SleekCMS.
4. **Exit** the CLI (Ctrl+C) when finished. The local files are cleaned up automatically.

## Troubleshooting

- **Authentication errors?** Make sure your `--token` is valid and active in your SleekCMS dashboard.
- **No files downloaded?** Verify your token and environment settings.
- **Changes not syncing?** Check the terminal output for error messages. File changes are debounced by 1 second.
- **Want to keep files after exit?** The CLI is designed to clean up automatically, but you can copy files elsewhere if needed.

## License

ISC

## Author

Yusuf Bhabhrawala

---

For more information, visit [SleekCMS](https://sleekcms.com) or check out the [documentation](https://docs.sleekcms.com).
