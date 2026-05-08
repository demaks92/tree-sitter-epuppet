; Tag delimiters — anonymous string literals (tree-sitter convention,
; cf. tree-sitter-embedded-template/queries/highlights.scm).
[
  "<%"
  "<%-"
  "<%="
  "<%-="
  "<%#"
  "<%-#"
  "%>"
  "-%>"
] @keyword

; Pipes around the parameter list are emitted by the external scanner as a
; hidden token (`_parameter_pipe`) and therefore cannot be matched directly.
; Highlight responsibility falls back to the surrounding `parameter_directive`
; scope (delimiter colour is already applied above via `<%`/`<%-`/`%>`/`-%>`).


; Structured parameters: highlight types and names ourselves so bare
; identifiers like `String` get coloured even when the puppet injection
; sees an invalid fragment (no surrounding `class () {}`).
(parameter
  ; type: (parameter_type) @type
  name: (parameter_name) @variable.parameter)

; Common Puppet built-in types — override the generic @type.
; ((parameter_type) @type.builtin
;   (#any-of? @type.builtin
;     "Boolean" "Integer" "Float" "Numeric" "String" "Array" "Hash"
;     "Regexp" "Variant" "Optional" "Data" "Undef" "Default" "Any"
;     "Pattern" "Enum" "Tuple" "Struct" "NotUndef" "Sensitive"
;     "Type" "Callable" "Iterator" "Iterable" "Collection" "Catalogentry"
;     "Resource" "Class" "Scalar" "Init" "Timestamp" "Timespan"
;     "Binary" "URI"))
;
; ; `=` between name and default value
(parameter
  "=" @operator)

; Comma between parameters
(parameter_list
  "," @punctuation.delimiter)

; Comment body
(comment_directive
  (comment) @comment)

; Variables, qualified names, and function calls inside directives.
; Highlighted directly by the epuppet grammar so they're visible even when
; the puppet injection isn't able to colour them (e.g. when the surrounding
; tag body isn't a valid puppet fragment).
(variable) @variable.parameter
(class_variable) @variable.parameter.builtin
(function_call) @function.call

; Plain text outside tags — keep default colour so embedded <% %> tags
; visually stand out against unstyled template text.
(content) @none
