; Inject Puppet into:
;   * `code` — body of <% %> / <%= %> directives. Common lexical children
;     (variables, comments, strings, identifiers, numbers, operators) are
;     highlighted directly by epuppet queries as a fallback; the injection covers
;     complete Puppet fragments and complex syntax when it can parse them.
;   * `parameter_default` — default-value expressions in the parameter directive.
;
; `combined` merges all chunks of the same buffer into a single Puppet parse,
; so cross-tag scope is preserved.
((code) @injection.content
  (#set! injection.language "puppet")
  (#set! injection.combined))

((parameter_default) @injection.content
  (#set! injection.language "puppet")
  (#set! injection.combined))
