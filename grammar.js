/**
 * @file EPP (Embedded Puppet) grammar for tree-sitter
 * @license MIT
 *
 * Reference: https://help.puppet.com/core/8/Content/PuppetCore/epp_structure_syntax.htm
 *            https://github.com/puppetlabs/puppet-specifications/blob/master/language/templates.md
 *
 * Naming follows tree-sitter conventions established by tree-sitter-embedded-template:
 *   - Top-level rule:        `template`
 *   - Tag node names:        `directive`, `output_directive`, `comment_directive`,
 *                            `parameter_directive`
 *   - Tag body:              `code` (single named node per tag wrapping all items)
 *   - Tag delimiters:        anonymous string literals captured in queries via [list]
 *
 * Design notes:
 *   - The grammar is intentionally "thin": code inside <% %> tags is captured as
 *     a `code` node containing finer-grained `variable`/`class_variable`/
 *     `function_call` children plus opaque text. Real Puppet syntax highlighting
 *     is delegated to tree-sitter-puppet via language injection on `code`.
 *   - The parameter directive `<%- | ... | -%>` is an exception: its parameter
 *     list IS structured (type, name, default) so bare type names like `String`
 *     get highlighted without relying on the Puppet injection (which sees an
 *     invalid fragment).
 *   - Whitespace is significant inside `content`, so `extras` is empty.
 *   - EPP tags do not nest, so the grammar is a flat sequence of tags + text.
 *   - The parameter directive is allowed only as the first item via the
 *     `template` rule. The spec says it must be the very first content of the
 *     file; we do not enforce strict "no leading whitespace" in the grammar
 *     (that is a linter concern). The grammar accepts the parameter directive
 *     in its conventional first position and gracefully falls back to a regular
 *     `directive` if a `|` is missing.
 *   - Mixed trim markers (`<% ... -%>`, `<%- ... %>`) are supported per spec —
 *     opening and closing trim flags are independent.
 *   - `_code_text` and the directive close markers (`%>` / `-%>`) inside
 *     `directive` / `output_directive` are produced by the external scanner
 *     in `src/scanner.c`. The scanner skips Puppet single/double-quoted
 *     strings (with `${...}` interpolation) and `#` line comments, so a `%>`
 *     appearing inside such constructs does NOT terminate the surrounding
 *     EPP directive. `parameter_directive` and `comment_directive` keep
 *     literal close markers because their bodies cannot contain Puppet
 *     strings or comments.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
    name: 'epuppet',

    // No implicit whitespace skipping — text outside tags is significant.
    // Inside structured rules we re-enable whitespace skipping via `_ws`.
    extras: (_) => [],

    // External tokens implemented in `src/scanner.c`. Order MUST match the
    // `TokenType` enum in the scanner.
    externals: ($) => [$._code_text, $._close_directive, $._trim_close_directive, $._parameter_pipe],

    // Token used for keyword/identifier disambiguation. Reserved for future
    // Puppet-keyword rules; harmless placeholder today.
    word: ($) => $._identifier_word,

    // Trailing whitespace inside `parameter` (before an optional `= default`)
    // overlaps with the trailing whitespace of `parameter_list` /
    // `parameter_directive`, AND the optional `_ws` around `=` is itself
    // ambiguous (it can appear before, after, both, or neither). We resolve
    // both ambiguities by declaring the conflict; the parser then prefers the
    // longest match, so `= default` is attached to `parameter` whenever
    // present.
    conflicts: ($) => [[$.parameter]],

    rules: {
        // ------------------------------------------------------------------
        // Top level
        // ------------------------------------------------------------------
        template: ($) => seq(optional($.parameter_directive), repeat($._template_item)),

        _template_item: ($) => choice($.directive, $.output_directive, $.comment_directive, $.content),

        // ------------------------------------------------------------------
        // Parameter directive — STRUCTURED
        // ------------------------------------------------------------------
        //
        //   <%- | Type $name = default, ... | -%>
        //
        // The opening/closing trim flags are independent (`<%` / `<%-` and
        // `%>` / `-%>`). Whitespace between `<%`/`<%-` and `|` (and between
        // `|` and `%>`/`-%>`) is optional, matching the canonical EPP form
        // shown in the official docs as `<%- | ... | -%>`.
        parameter_directive: ($) => seq(choice('<%', '<%-'), optional($._ws), $._parameter_pipe, optional($.parameter_list), $._parameter_pipe, optional($._ws), choice('%>', '-%>')),

        // List of parameters separated by mandatory commas (per spec).
        // A trailing comma is permitted (liberal interpretation; the spec is
        // silent on this, several modern parsers allow it).
        parameter_list: ($) => seq(optional($._ws), $.parameter, repeat(seq(optional($._ws), ',', optional($._ws), $.parameter)), optional(seq(optional($._ws), ',')), optional($._ws)),

        // A single parameter: optional type, name, optional default.
        // Per EPP spec the type annotation is OPTIONAL (defaults to `Any`).
        parameter: ($) =>
            seq(
                optional(seq(field('type', alias($._parameter_type, $.parameter_type)), $._ws)),
                field('name', alias($.variable, $.parameter_name)),
                optional(seq(optional($._ws), '=', optional($._ws), field('default', alias($._default_code, $.parameter_default)))),
            ),

        // Puppet type reference:
        //   String, Stdlib::Host, Optional[String], Variant[String, Integer]
        _parameter_type: ($) => seq($._parameter_type_name, optional($._parameter_type_args)),

        _parameter_type_name: (_) => token(/[A-Z][A-Za-z0-9_]*(::[A-Z][A-Za-z0-9_]*)*/),

        // Balanced [...] block. Contents are not introspected.
        _parameter_type_args: ($) => seq('[', repeat(choice($._parameter_type_arg_text, $._parameter_type_args)), ']'),

        _parameter_type_arg_text: (_) => token(/([^\[\]"']|"(\\.|[^"\\])*"|'(\\.|[^'\\])*')+/),

        // ------------------------------------------------------------------
        // Directives (non-printing and printing)
        // ------------------------------------------------------------------

        // Non-printing: `<% ... %>` / `<%- ... -%>` / mixed trim.
        // Close markers come from the external scanner so `%>` inside Puppet
        // strings/comments does not end the directive prematurely.
        directive: ($) => seq(choice('<%', '<%-'), optional($.code), choice($._close_directive, $._trim_close_directive)),

        // Printing: `<%= ... %>` / `<%-= ... -%>` / mixed trim.
        output_directive: ($) => seq(choice('<%=', '<%-='), optional($.code), choice($._close_directive, $._trim_close_directive)),

        // Tag body: a single named node wrapping all items. `_code_text` is
        // produced by the external scanner (string/comment-aware). `_ws` is
        // kept so that pure-whitespace runs are matched (the scanner refuses
        // to start `_code_text` on whitespace, leaving `_ws` to win).
        code: ($) => repeat1(choice($.function_call, $.class_variable, $.variable, $._ws, $._code_text)),

        // ------------------------------------------------------------------
        // Comment directive: `<%# ... %>` or `<%-# ... -%>`
        // ------------------------------------------------------------------
        comment_directive: ($) => seq(choice('<%#', '<%-#'), optional(alias($._comment_text, $.comment)), choice('%>', '-%>')),

        // Comment body — anything up to `%>`. Allow `%` not followed by `>`.
        _comment_text: (_) => token(/([^%]|%[^>])+/),

        // ------------------------------------------------------------------
        // Content (text outside tags)
        // ------------------------------------------------------------------
        // Must:
        //   * stop at `<` (the start of a possible tag)
        //   * but allow `<` followed by anything that is NOT `%`
        //   * recognise the `<%%` escape and treat it as content
        // `prec.right` resolves the ambiguity between extending the current
        // `content` repetition vs starting a new one when adjacent text chunks
        // can be combined.
        content: (_) => prec.right(repeat1(choice(/[^<]+/, '<%%', '<'))),

        // ------------------------------------------------------------------
        // Variables and function calls (lexical, used inside `code`)
        // ------------------------------------------------------------------
        // Lexical precedence: variable < class_variable < function_call so the
        // longest applicable form wins. Without these precedences the generic
        // `_code_text` token would also match these inputs and win by length,
        // hiding the structured nodes from the parser.

        // $name
        variable: (_) => token(prec(1, /\$[A-Za-z_][A-Za-z0-9_]*/)),

        // $foo::bar or $foo::bar::baz
        class_variable: (_) => token(prec(2, /\$[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z0-9_]+)+/)),

        // $foo.bar() or $foo::bar.baz(args)
        // NOTE: Argument list cannot contain nested parens. Complex calls fall
        //       back to opaque `_code_text` and rely on Puppet injection.
        function_call: (_) => token(prec(3, /\$[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z0-9_]+)*\.[A-Za-z_]*\([^)]*\)/)),

        // ------------------------------------------------------------------
        // Parameter default expression (balanced, opaque)
        // ------------------------------------------------------------------
        // Any Puppet expression up to the next top-level `,` or `|`. Balances
        // (), [], {} and skips over quoted strings so commas inside them
        // don't terminate the expression. `-` and `|` (lambda pipes) inside a
        // balanced group are accepted via `_balanced_text`.
        _default_code: ($) => repeat1(choice($._default_atom, $._balanced_parens, $._balanced_brackets, $._balanced_braces)),

        // At the top level of a default we cannot consume `,` (next param) or
        // `|` (closing pipe) or `-` (which might begin `-%>` boundary issues
        // when stuck against the closing pipe). `-` is permitted inside
        // balanced groups via `_balanced_text`.
        _default_atom: (_) => token(/([^,|()\[\]{}"'\-]|"(\\.|[^"\\])*"|'(\\.|[^'\\])*')+/),

        _balanced_parens: ($) => seq('(', repeat(choice($._balanced_text, $._balanced_parens, $._balanced_brackets, $._balanced_braces)), ')'),
        _balanced_brackets: ($) => seq('[', repeat(choice($._balanced_text, $._balanced_parens, $._balanced_brackets, $._balanced_braces)), ']'),
        _balanced_braces: ($) => seq('{', repeat(choice($._balanced_text, $._balanced_parens, $._balanced_brackets, $._balanced_braces)), '}'),

        _balanced_text: (_) => token(/([^()\[\]{}"']|"(\\.|[^"\\])*"|'(\\.|[^'\\])*')+/),

        // Internal whitespace token used inside structured rules. Cannot use
        // `extras` because content whitespace is significant.
        _ws: (_) => token(/[ \t\r\n]+/),

        // Reserved for future keyword disambiguation; only referenced by
        // `word`. Never produced because `variable`/`_code_text` always
        // consume identifier-like input first.
        _identifier_word: (_) => token(/[A-Za-z_][A-Za-z0-9_]*/),
    },
})
