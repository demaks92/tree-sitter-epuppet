# tree-sitter-epuppet

A [tree-sitter](https://tree-sitter.github.io) grammar for **EPP** (Embedded Puppet) templates.

EPP is Puppet's templating language that interleaves arbitrary text with Puppet code blocks (`<% ... %>`, `<%= ... %>`, `<%# ... %>`). This grammar provides a thin AST that captures the EPP delimiters and exposes the Puppet code inside tags as opaque `code` nodes, designed for **language injection** into [tree-sitter-puppet](https://github.com/amaanq/tree-sitter-puppet).

## Features

- Full EPP tag coverage: parameter (`<%- | ... | -%>`), expression (`<%= ... %>`), code block (`<% ... %>`), comment (`<%# ... %>`)
- All trim-marker variants (`<%-`, `-%>`)
- Escape sequences (`<%%`, `%%>`)
- Puppet syntax injection inside every tag (combined across the file)
- No external scanner — pure regex tokens, easy to build everywhere

## Installation

### Neovim (nvim-treesitter)

Until upstreamed, install as a custom parser:

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
parser_config.epuppet = {
  install_info = {
    url = "https://github.com/demaks92/tree-sitter-epuppet",
    files = { "src/parser.c" },
    branch = "main",
  },
  filetype = "epuppet",
}

vim.filetype.add({
  extension = { epp = "epuppet" },
})
```

Then:

```vim
:TSInstall epuppet
:TSInstall puppet
```

Copy queries into your runtime path (or symlink them):

```bash
mkdir -p ~/.config/nvim/queries/epuppet
cp queries/*.scm ~/.config/nvim/queries/epuppet/
```

### From source

```bash
npm install
npx tree-sitter generate
npx tree-sitter test
```

## Grammar

The parser produces this top-level structure:

```text
source_file
├── parameter_tag?      # only at the start of the file
└── (comment_tag | expression_tag | code_tag | content)*
```

Inside every tag, Puppet code is captured as a `code` node (or `comment` for comment tags). The provided `queries/injections.scm` injects `tree-sitter-puppet` into all `code` nodes with `injection.combined`, so variables declared in one tag are visible to later tags during highlighting.

## Highlighting outer language

The `content` node (text outside tags) is intentionally left without an injection so users can layer their own — for example, to highlight EPP-templated bash, nginx, or YAML files. Add to `~/.config/nvim/queries/epuppet/injections.scm`:

```scm
((content) @injection.content
  (#set! injection.language "bash")
  (#set! injection.combined))
```

## Limitations

- The parameter tag is only recognised at the **start** of the source file (per the EPP spec).
- Whitespace-trim semantics (`-` markers) are exposed as token text, not as separate nodes — consumers can inspect the literal `open`/`close` fields.
- Escape sequences (`<%%`, `%%>`) are absorbed into surrounding `content`/`code` text without dedicated AST nodes.

## Testing

```bash
npx tree-sitter test                          # corpus tests
npx tree-sitter parse 'path/to/file.epp'      # parse a single file
npx tree-sitter highlight path/to/file.epp    # ANSI-coloured output
```

## License

[MIT](LICENSE)
