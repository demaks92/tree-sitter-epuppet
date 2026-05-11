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
 *     a `code` node containing high-value lexical children (comments, strings,
 *     identifiers, numbers, operators, variables, class variables, function
 *     calls) plus opaque text. Full Puppet syntax highlighting is still
 *     delegated to tree-sitter-puppet via language injection on `code`.
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
 *     in `src/scanner.c`. The scanner yields to host lexical tokens at
 *     comments, strings, identifiers, numbers, operators, and variables, so
 *     these constructs remain visible even when injected Puppet parsing sees
 *     an invalid split fragment. `parameter_directive` and `comment_directive`
 *     keep literal close markers because their bodies cannot contain Puppet
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
    externals: ($) => [
        $._code_text,
        $._close_directive,
        $._trim_close_directive,
        $._parameter_pipe
    ],

    // Token used for keyword/identifier disambiguation.
    word: ($) => $.identifier,

    // Trailing whitespace inside `parameter` (before an optional `= default`)
    // overlaps with the trailing whitespace of `parameter_list` /
    // `parameter_directive`, AND the optional `_ws` around `=` is itself
    // ambiguous (it can appear before, after, both, or neither). We resolve
    // both ambiguities by declaring the conflict; the parser then prefers the
    // longest match, so `= default` is attached to `parameter` whenever
    // present.
    conflicts: ($) => [
        [$.parameter],
        [$.type_hash_entry]
    ],

    supertypes: $ => [$.expression,],

    rules: {
        // ------------------------------------------------------------------
        // Top level
        // ------------------------------------------------------------------
        template: ($) => seq(
            optional($.parameter_directive),
            repeat($._template_item)
        ),

        _template_item: ($) => choice(
            $.directive,
            $.output_directive,
            $.comment_directive,
            $.content
        ),

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
        parameter_directive: ($) => seq(
            choice('<%', '<%-'),
            optional($._ws),
            $._parameter_pipe,
            optional($.parameter_list),
            $._parameter_pipe,
            optional($._ws),
            choice('%>', '-%>')
        ),

        // List of parameters separated by mandatory commas (per spec).
        // A trailing comma is permitted (liberal interpretation; the spec is
        // silent on this, several modern parsers allow it).
        parameter_list: ($) => seq(
            optional($._ws),
            $.parameter,
            repeat(seq(
                optional($._ws),
                ',',
                optional($._ws),
                $.parameter
            )),
            optional(seq(
                optional($._ws),
                ','
            )),
            optional($._ws)
        ),

        // A single parameter: optional type, name, optional default.
        // Per EPP spec the type annotation is OPTIONAL (defaults to `Any`).
        parameter: ($) => seq(
            optional(seq(
                field('type', $.parameter_type),
                $._ws
            )),
            field('name', alias($.variable, $.parameter_name)),
            optional(seq(
                optional($._ws),
                '=',
                optional($._ws),
                field('default', alias($._default_code, $.parameter_default))
            )),
        ),

        // Puppet type reference:
        //   String
        //   Test::IP::v4
        //   Optional[String]
        //   Array[Hash[String, Integer]]
        //   Hash[String, Optional[Test::IP::v4]]
        //   Struct[{address => Stdlib::IP::Address::V4, ports => Array[Integer]}]
        parameter_type: ($) => choice(
            prec(3, seq(
                field('type', alias(token(prec(2, choice(
                    'Hash',
                    'Struct',
                    'ArrayHash',
                    'BinaryArgsHash',
                    'NamedArgs',
                    'SemVerHash',
                    'SemVerRangeHash',
                    'StringHash',
                    'TypeMap')
                )), $.hash_type),),
                field('arguments', $.hash_type_arguments),
            ),),
            prec(3, seq(
                field('type', alias(token(prec(2, choice(
                    'Array',
                    'Tuple',
                    'IntegerTree'
                ))), $.array_type)),
                field('arguments', $.array_type_arguments)
            )),
            seq(
                $._qualified_parameter_type_name,
                optional(field('arguments', $.type_arguments))
            ),
            seq(
                field('type', alias($._parameter_type_identifier, $.type_name)),
                optional(field('arguments', $.type_arguments))
            ),
        ),

        _qualified_parameter_type_name: ($) => seq(
            field('class', alias($._parameter_type_identifier, $.class_name)),
            field('delimiter', alias($._parameter_type_namespace_delimiter, $.parameter_type_delimiter)),
            repeat(seq(
                field('subclass', alias($._parameter_type_identifier, $.subclass_name)),
                field('delimiter', alias($._parameter_type_namespace_delimiter, $.parameter_type_delimiter)))
            ),
            field('subtype', alias($._parameter_type_identifier, $.subtype_name)),
        ),

        type_arguments: ($) => seq(
            '[',
            optional($._ws),
            optional(seq(
                field('value', $.type_argument),
                repeat(seq(
                    optional($._ws),
                    ',',
                    optional($._ws),
                    field('value', $.type_argument)
                )),
                optional($._ws)
            )),
            ']'
        ),

        hash_type_arguments: ($) => seq(
            '[',
            optional($._ws),
            optional(seq(
                field('key', $.type_argument),
                optional(seq(
                    optional($._ws),
                    ',',
                    optional($._ws),
                    field('value', $.type_argument)
                )),
                optional($._ws)
            )),
            ']'
        ),

        array_type_arguments: ($) => seq(
            '[',
            optional($._ws),
            optional(seq(
                field('value', $.type_argument),
                repeat(seq(
                    optional($._ws),
                    ',',
                    optional($._ws),
                    field('value', $.type_argument)
                )),
                optional($._ws)
            )),
            ']'
        ),

        type_argument: ($) => choice(
            $.parameter_type,
            $.type_hash,
            $.type_array,
            $.string,
            $.number
        ),

        type_hash: ($) => seq(
            '{',
            optional($._ws),
            optional(seq(
                $.type_hash_entry,
                repeat(seq(
                    optional($._ws),
                    ',',
                    optional($._ws),
                    $.type_hash_entry
                )),
                optional($._ws)
            )),
            '}'
        ),

        type_hash_entry: ($) => seq(
            field('key', choice(
                $.string,
                $.identifier,
                $.parameter_type
            )),
            optional(seq(
                optional($._ws),
                choice(
                    '=>',
                    '='
                ),
                optional($._ws),
                field('value', $.type_argument)
            ))
        ),

        type_array: ($) => seq(
            '[',
            optional($._ws),
            optional(seq(
                field('value', $.type_argument),
                repeat(seq(
                    optional($._ws),
                    ',',
                    optional($._ws),
                    field('value', $.type_argument)
                )),
                optional($._ws)
            )),
            ']'
        ),

        _parameter_type_namespace_delimiter: (_) => token('::'),

        _parameter_type_identifier: (_) => token(prec(-1, /[A-Za-z_][A-Za-z0-9_]*/)),

        // ------------------------------------------------------------------
        // Directives (non-printing and printing)
        // ------------------------------------------------------------------
        // Non-printing: `<% ... %>` / `<%- ... -%>` / mixed trim.
        // Close markers come from the external scanner so `%>` inside Puppet
        // strings/comments does not end the directive prematurely. They are
        // aliased back to their literal forms so query consumers can match
        // them as anonymous `"%>"` / `"-%>"` tokens (matching the convention
        // used by tree-sitter-embedded-template).
        directive: ($) => seq(
            choice(
                '<%',
                '<%-'
            ),
            optional($.code), choice(
                alias($._close_directive, '%>'),
                alias($._trim_close_directive, '-%>')
            )
        ),

        // Printing: `<%= ... %>` / `<%-= ... -%>` / mixed trim.
        output_directive: ($) => seq(
            choice(
                '<%=',
                '<%-='
            ),
            optional($.code),
            choice(
                alias($._close_directive, '%>'),
                alias($._trim_close_directive, '-%>')
            )
        ),

        // Tag body: a single named node wrapping all items. `_code_text` is
        // produced by the external scanner (string/comment-aware). `_ws` is
        // kept so that pure-whitespace runs are matched (the scanner refuses
        // to start `_code_text` on whitespace, leaving `_ws` to win).
        code: ($) => repeat1(choice(
            $.function_call,
            $.class_variable,
            $.variable,
            $.comment,
            $.string,
            $.number,
            $.identifier,
            $.operator,
            $._ws,
            $._code_text
        )),

        // ------------------------------------------------------------------
        // Comment directive: `<%# ... %>` or `<%-# ... -%>`
        // ------------------------------------------------------------------
        comment_directive: ($) => seq(
            choice(
                '<%#',
                '<%-#'
            ),
            optional(alias($._comment_text, $.comment)),
            choice('%>', '-%>')
        ),

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
        content: (_) => prec.right(repeat1(choice(
            /[^<]+/,
            '<%%',
            '<'
        ))),
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

        // High-value Puppet lexical tokens surfaced by the host grammar so
        // simple or split control-flow fragments still highlight even when the
        // injected Puppet parser reports ERROR nodes.
        comment: (_) => token(prec(1, /#[^\n]*/)),

        // String literals are surfaced as host nodes so `%>` inside quotes does
        // not split the directive while still giving fallback highlighting.
        string: (_) => token(prec(1, choice(
            /'(\\.|[^'\\])*'/,
            /"(\\.|[^"\\])*"/
        ))),

        number: (_) => token(prec(1, /0[xX][0-9A-Fa-f]+|\d+(\.\d+)?/)),

        identifier: (_) => token(prec(0, /[A-Za-z_][A-Za-z0-9_]*/)),

        operator: (_) => token(prec(1,choice(
            '==',
            '!=',
            '<=',
            '>=',
            '=~',
            '!~',
            '=>',
            '->',
            '~>',
            '<-',
            '<~',
            '+=',
            '-=',
            '<<',
            '>>',
            '::',
            '+',
            '-',
            '*',
            '/',
            '%',
            '<',
            '>',
            '=',
            '!',
            '~',
            '|',
            '&'
        ))),

        // ------------------------------------------------------------------
        // Parameter default expression (balanced, opaque)
        // ------------------------------------------------------------------
        // Any Puppet expression up to the next top-level `,` or `|`. Balances
        // (), [], {} and skips over quoted strings so commas inside them
        // don't terminate the expression. `-` and `|` (lambda pipes) inside a
        // balanced group are accepted via `_balanced_text`.
        _default_code: ($) => repeat1(choice(
            $._default_atom,
            $._balanced_parens,
            $._balanced_brackets,
            $._balanced_braces
        )),

        // At the top level of a default we cannot consume `,` (next param) or
        // `|` (closing pipe). `-` is permitted because unary and binary
        // minus are common in Puppet default expressions (e.g. `-1`, `1 - 2`).
        // `-%>` boundary concerns are handled by the external scanner in the
        // code-text state, not by the parameter default lexer.
        _default_atom: (_) => token(/([^,|()\[\]{}"']|"(\\.|[^"\\])*"|'(\\.|[^'\\])*')+/),

        _balanced_parens: ($) => seq(
            '(',
            repeat(choice(
                $._balanced_text,
                $._balanced_parens,
                $._balanced_brackets,
                $._balanced_braces
            )),
            ')'
        ),

        _balanced_brackets: ($) => seq(
            '[',
            repeat(choice(
                $._balanced_text,
                $._balanced_parens,
                $._balanced_brackets,
                $._balanced_braces
            )),
            ']'
        ),

        _balanced_braces: ($) => seq(
            '{',
            repeat(choice(
                $._balanced_text,
                $._balanced_parens,
                $._balanced_brackets,
                $._balanced_braces
            )),
            '}'
        ),

        _balanced_text: (_) => token(/([^()\[\]{}"']|"(\\.|[^"\\])*"|'(\\.|[^'\\])*')+/),

        // Internal whitespace token used inside structured rules. Cannot use
        // `extras` because content whitespace is significant.
        _ws: (_) => token(/[ \t\r\n]+/),
    },
})
