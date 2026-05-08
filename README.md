# tree-sitter-epuppet

A [tree-sitter](https://tree-sitter.github.io) grammar for **EPP** (Embedded Puppet) templates.

EPP is Puppet's templating language that interleaves arbitrary text with Puppet code blocks
(`<% ... %>`, `<%= ... %>`, `<%# ... %>`, and the parameter directive `<%- | ... | -%>`)

This grammar produces a thin AST that captures EPP delimiters, structures the parameter list,
and exposes Puppet code inside non-parameter tags as opaque `code` nodes designed for
**language injection** into [tree-sitter-puppet](https://github.com/amaanq/tree-sitter-puppet).

## Installation

Until upstreamed, install as a custom parser
The external scanner must be included in the `files` list

### Automatic NeoVim Installation (via [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter))

1. Add the following snippet in a User TSUpdate autocommand:

```lua
vim.api.nvim_create_autocmd('User', { pattern = 'TSUpdate',
    callback = function()
        local parser_config = require('nvim-treesitter.parsers').get_parser_configs()
        parser_config.epuppet = {
            install_info = {
                url = 'https://github.com/demaks92/tree-sitter-epuppet',
                -- commit hash for revision to check out; HEAD if missing
                files = { "src/parser.c", "src/scanner.c" },
                -- optional entries:
                -- only needed if different from default branch
                branch = 'main',
                -- only needed if repo does not contain pre-generated `src/parser.c`
                generate = false,
                -- only needed if repo does not contain `src/grammar.json` either
                generate_from_json = false,
                -- also install queries from given directory
                queries = 'queries',
            },
        }
    end}
)
```

2. Register the parser via vim.treesitter:

```lua
vim.treesitter.language.register('epuppet', { 'epp' })
```

3. If Neovim does not detect your language's filetype by default, you can use Neovim's vim.filetype.add() to add a custom detection rule:

```lua
vim.filetype.add({
  extension = { epp = 'epuppet' },
})
```

4. Start nvim and `:TSInstall epuppet`:

```vim
:TSInstall epuppet
:TSInstall puppet
```

### Manual NeoVim Installation

1. Install the [tree-sitter-cli](https://github.com/tree-sitter/tree-sitter):

```shell
# Via Cargo
cargo install tree-sitter-cli

# Via NPM
npm install tree-sitter-cli
```

2. Clone github repository:

```shell
git clone https://github.com/demaks92/tree-sitter-epuppet.git
cd tree-sitter-epuppet
```

3. Copy queries into your runtime path (or symlink them):

```shell
mkdir -p ~/.config/nvim/queries/epuppet
cp queries/*.scm ~/.config/nvim/queries/epuppet/
```

4. Build and copy parser.so:

```shell
tree-sitter generate
cc -o ~/.local/share/nvim/site/parser/epuppet.so -shared -Os -fPIC -I src src/parser.c
```

## Development

1. Install the dependencies:

```shell
npm install
```

2. Build:

```shell
npx tree-sitter generate
npx tree-sitter build
```

3. Run tests:

```shell
npx tree-sitter test
npx tree-sitter parse path/to/file.epp
npx tree-sitter highlight path/to/file.epp
```

The corpus (`test/corpus/*.txt`) covers basic tags, comments, escapes,
parameter directives, real-world fixtures, and string/comment-aware scanner
edge cases.
