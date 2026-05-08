; Inject Puppet into:
;   * `code` — body of <% %> / <%= %> directives. Variable / class_variable /
;     function_call children are highlighted directly by epuppet queries; the
;     injection covers everything else (operators, keywords, strings, etc.).
;   * `parameter_default` — default-value expressions in the parameter directive.
;
; `combined` merges all chunks of the same buffer into a single Puppet parse,
; so cross-tag scope is preserved.
((code) @injection.content
  (#set! injection.language "puppet")
  (#set! injection.combined))

; ((parameter_type) @injection.content
;   (#set! injection.language "puppet")
;   (#set! injection.combined))

((parameter_default) @injection.content
  (#set! injection.language "puppet")
  (#set! injection.combined))
