/**
 * @file EPP (Embedded Puppet) grammar for tree-sitter
 * @license MIT
 *
 * Reference: https://github.com/puppetlabs/puppet-specifications/blob/master/language/templates.md
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
 *   - The parameter directive may appear only as the first non-whitespace
 *     element. We allow it only at the start of the file via the `template`
 *     rule.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
    name: 'epuppet',

    // No implicit whitespace skipping — text outside tags is significant.
    // Inside structured rules we re-enable whitespace skipping via `_ws`.
    extras: (_) => [],

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
        // Allowed only at the start of the file (via `template`).
        parameter_directive: ($) => prec(3, seq(choice('<% |', '<%- |', '<%|', '<%-|'), $.parameter_list, choice('| %>', '| -%>', '|%>', '|-%>'))),

        // List of parameters separated by commas, with optional trailing comma.
        parameter_list: ($) => seq(repeat1(seq(optional($._ws), $.parameter, optional(','), optional($._ws))), optional($._ws)),

        // A single parameter: optional type, name, optional default.
        parameter: ($) =>
            prec.right(
                seq(
                    field('type', alias($._parameter_type, $.parameter_type)),
                    $._ws,
                    field('name', alias($.variable, $.parameter_name)),
                    optional(seq(optional($._ws), '=', optional($._ws), field('default', alias($._default_code, $.parameter_default)))),
                ),
            ),

        // Puppet type reference:
        //   String, Stdlib::Host, Optional[String], Variant[String, Integer]
        _parameter_type: ($) => seq($._parameter_type_name, optional($._parameter_type_args)),

        _parameter_type_name: (_) => token(prec(2, /[A-Z][A-Za-z0-9_]*(::[A-Z][A-Za-z0-9_]*)*/)),

        // Balanced [...] block. Contents are not introspected.
        _parameter_type_args: ($) => seq('[', repeat(choice($._parameter_type_arg_text, $._parameter_type_args)), ']'),

        _parameter_type_arg_text: (_) => token(/([^\[\]"']|"(\\.|[^"\\])*"|'(\\.|[^'\\])*')+/),

        // ------------------------------------------------------------------
        // Directives (non-printing and printing)
        // ------------------------------------------------------------------

        // Non-printing: `<% ... %>` or `<%- ... -%>`
        directive: ($) => seq(choice('<%', '<%-'), optional($.code), choice('%>', '-%>')),

        // Printing: `<%= ... %>` or `<%-= ... -%>`
        output_directive: ($) => seq(choice('<%=', '<%-='), optional($.code), choice('%>', '-%>')),

        // Tag body: a single named node wrapping all items so the AST has
        // exactly one `code` parent per tag. Children are `variable`,
        // `class_variable`, `function_call`, whitespace, and opaque `_code_text`
        // chunks (everything else). Language injection targets `code` directly.
        code: ($) => repeat1(choice($.function_call, $.class_variable, $.variable, $._ws, $._code_text)),

        // Opaque text inside a directive. Must:
        //   * stop at `%>` or `-%>`
        //   * allow `%%>` as literal escape
        //   * allow `%` alone (when not followed by `>`)
        //   * NOT swallow `$` — that's the start of variable/class_variable/function_call,
        //     which the parser must see as separate tokens to highlight them
        //   * NOT swallow whitespace — `_ws` handles that, and keeping them
        //     separate avoids ambiguity at tag boundaries (` { -%>` etc.)
        //   * but allow a bare `$` followed by something that can't begin a
        //     Puppet identifier (digit, punctuation, end-of-tag) so we don't
        //     error on it
        _code_text: (_) => token(/([^%$ \t\r\n]|%%>|%[^>]|\$[^A-Za-z_])+/),

        // ------------------------------------------------------------------
        // Comment directive: `<%# ... %>` or `<%-# ... -%>`
        // ------------------------------------------------------------------
        comment_directive: ($) => seq(choice('<%#', '<%-#'), optional(alias($._comment_text, $.comment)), choice('%>', '-%>')),

        // Comment body — anything up to `%>`. Allow `%` not followed by `>`.
        _comment_text: (_) => token(prec(1, /([^%]|%[^>])+/)),

        // ------------------------------------------------------------------
        // Content (text outside tags)
        // ------------------------------------------------------------------
        // Must:
        //   * stop at `<` (the start of a possible tag)
        //   * but allow `<` followed by anything that is NOT `%`
        //   * recognise the `<%%` escape and treat it as content
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

        // $foo::bar or $foo::bar::baz (with optional trailing ::)
        class_variable: (_) => token(prec(2, /\$[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z0-9_]*)+/)),

        // $foo.bar() or $foo::bar.baz(args)
        function_call: (_) => token(prec(3, /\$[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z0-9_]+)*\.[A-Za-z_]*\([^)]*\)/)),

        // ------------------------------------------------------------------
        // Parameter default expression (balanced, opaque)
        // ------------------------------------------------------------------
        // Any Puppet expression up to the next top-level `,` or `|`. Balances
        // (), [], {} and skips over quoted strings so commas inside them
        // don't terminate the expression.
        _default_code: ($) => repeat1(choice($._default_atom, $._balanced_parens, $._balanced_brackets, $._balanced_braces)),

        _default_atom: (_) => token(/([^,|()\[\]{}"']|"(\\.|[^"\\])*"|'(\\.|[^'\\])*')+/),

        _balanced_parens: ($) => seq('(', repeat(choice($._balanced_text, $._balanced_parens, $._balanced_brackets, $._balanced_braces)), ')'),
        _balanced_brackets: ($) => seq('[', repeat(choice($._balanced_text, $._balanced_parens, $._balanced_brackets, $._balanced_braces)), ']'),
        _balanced_braces: ($) => seq('{', repeat(choice($._balanced_text, $._balanced_parens, $._balanced_brackets, $._balanced_braces)), '}'),

        _balanced_text: (_) => token(/([^()\[\]{}"']|"(\\.|[^"\\])*"|'(\\.|[^'\\])*')+/),

        // Internal whitespace token, used inside structured rules. Cannot use
        // `extras` because content whitespace is significant.
        _ws: (_) => token(prec(1, /[ \t\r\n]+/)),
    },
})
