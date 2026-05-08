/*
 * MIT License
 *
 * Copyright (c) 2026 tree-sitter-epuppet contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>

enum TokenType {
    CODE_TEXT,
    CLOSE_DIRECTIVE,
    TRIM_CLOSE_DIRECTIVE,
    PARAMETER_PIPE,
};

static inline void advance(TSLexer *lexer) {
    lexer->advance(lexer, false);
}

static inline void mark_end(TSLexer *lexer) {
    lexer->mark_end(lexer);
}

static inline bool is_eof(TSLexer *lexer) {
    return lexer->eof(lexer);
}

static inline bool is_whitespace(int32_t character) {
    return character == ' ' || character == '\t' || character == '\r' || character == '\n';
}

static void scan_single_quoted_string(TSLexer *lexer);
static void scan_double_quoted_string(TSLexer *lexer);
static void scan_line_comment(TSLexer *lexer);
static void scan_interpolation(TSLexer *lexer);

static bool emit_token(TSLexer *lexer, enum TokenType token_type) {
    lexer->result_symbol = token_type;
    return true;
}

static bool emit_code_text(TSLexer *lexer, const bool *valid_symbols) {
    if (!valid_symbols[CODE_TEXT]) {
        return false;
    }

    lexer->result_symbol = CODE_TEXT;
    return true;
}

static void consume_escape(TSLexer *lexer) {
    advance(lexer);
    mark_end(lexer);

    if (!is_eof(lexer)) {
        advance(lexer);
        mark_end(lexer);
    }
}

static void scan_single_quoted_string(TSLexer *lexer) {
    advance(lexer);
    mark_end(lexer);

    while (!is_eof(lexer)) {
        int32_t character = lexer->lookahead;

        if (character == '\\') {
            consume_escape(lexer);
            continue;
        }

        advance(lexer);
        mark_end(lexer);

        if (character == '\'') {
            break;
        }
    }
}

static void scan_line_comment(TSLexer *lexer) {
    advance(lexer);
    mark_end(lexer);

    while (!is_eof(lexer)) {
        int32_t character = lexer->lookahead;

        advance(lexer);
        mark_end(lexer);

        if (character == '\n') {
            break;
        }
    }
}

static void scan_interpolation(TSLexer *lexer) {
    unsigned brace_depth = 1;

    while (!is_eof(lexer) && brace_depth > 0) {
        int32_t character = lexer->lookahead;

        if (character == '\'') {
            scan_single_quoted_string(lexer);
            continue;
        }

        if (character == '"') {
            scan_double_quoted_string(lexer);
            continue;
        }

        if (character == '#') {
            scan_line_comment(lexer);
            continue;
        }

        if (character == '{') {
            advance(lexer);
            mark_end(lexer);
            brace_depth++;
            continue;
        }

        if (character == '}') {
            advance(lexer);
            mark_end(lexer);
            brace_depth--;
            continue;
        }

        advance(lexer);
        mark_end(lexer);
    }
}

static void scan_double_quoted_string(TSLexer *lexer) {
    advance(lexer);
    mark_end(lexer);

    while (!is_eof(lexer)) {
        int32_t character = lexer->lookahead;

        if (character == '\\') {
            consume_escape(lexer);
            continue;
        }

        if (character == '"') {
            advance(lexer);
            mark_end(lexer);
            break;
        }

        if (character == '$') {
            advance(lexer);
            mark_end(lexer);

            if (lexer->lookahead == '{') {
                advance(lexer);
                mark_end(lexer);
                scan_interpolation(lexer);
            }

            continue;
        }

        advance(lexer);
        mark_end(lexer);
    }
}

static bool scan_code_or_close(TSLexer *lexer, const bool *valid_symbols) {
    bool saw_code_text = false;

    if (is_whitespace(lexer->lookahead)) {
        return false;
    }

    mark_end(lexer);

    while (!is_eof(lexer)) {
        int32_t character = lexer->lookahead;

        if (character == '$') {
            return saw_code_text && emit_code_text(lexer, valid_symbols);
        }

        if (character == '%') {
            advance(lexer);

            if (lexer->lookahead == '>') {
                if (saw_code_text) {
                    return emit_code_text(lexer, valid_symbols);
                }

                if (!valid_symbols[CLOSE_DIRECTIVE]) {
                    return false;
                }

                advance(lexer);
                mark_end(lexer);
                return emit_token(lexer, CLOSE_DIRECTIVE);
            }

            if (lexer->lookahead == '%') {
                advance(lexer);

                if (lexer->lookahead == '>') {
                    advance(lexer);
                    saw_code_text = true;
                    mark_end(lexer);
                    continue;
                }
            }

            saw_code_text = true;
            mark_end(lexer);
            continue;
        }

        if (character == '-') {
            advance(lexer);

            if (lexer->lookahead == '%') {
                advance(lexer);

                if (lexer->lookahead == '>') {
                    if (saw_code_text) {
                        return emit_code_text(lexer, valid_symbols);
                    }

                    if (!valid_symbols[TRIM_CLOSE_DIRECTIVE]) {
                        return false;
                    }

                    advance(lexer);
                    mark_end(lexer);
                    return emit_token(lexer, TRIM_CLOSE_DIRECTIVE);
                }

                saw_code_text = true;
                mark_end(lexer);
                continue;
            }

            saw_code_text = true;
            mark_end(lexer);
            continue;
        }

        if (character == '\'') {
            scan_single_quoted_string(lexer);
            saw_code_text = true;
            continue;
        }

        if (character == '"') {
            scan_double_quoted_string(lexer);
            saw_code_text = true;
            continue;
        }

        if (character == '#') {
            scan_line_comment(lexer);
            saw_code_text = true;
            continue;
        }

        advance(lexer);
        saw_code_text = true;
        mark_end(lexer);
    }

    return saw_code_text && emit_code_text(lexer, valid_symbols);
}

void *tree_sitter_epuppet_external_scanner_create(void) {
    return NULL;
}

void tree_sitter_epuppet_external_scanner_destroy(void *payload) {
    (void)payload;
}

unsigned tree_sitter_epuppet_external_scanner_serialize(void *payload, char *buffer) {
    (void)payload;
    (void)buffer;
    return 0;
}

void tree_sitter_epuppet_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    (void)payload;
    (void)buffer;
    (void)length;
}

bool tree_sitter_epuppet_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    (void)payload;

    if (valid_symbols[PARAMETER_PIPE] && lexer->lookahead == '|') {
        advance(lexer);
        mark_end(lexer);
        return emit_token(lexer, PARAMETER_PIPE);
    }

    if (
        valid_symbols[CODE_TEXT] ||
        valid_symbols[CLOSE_DIRECTIVE] ||
        valid_symbols[TRIM_CLOSE_DIRECTIVE]
    ) {
        return scan_code_or_close(lexer, valid_symbols);
    }

    return false;
}
