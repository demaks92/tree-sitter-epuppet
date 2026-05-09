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

static inline bool is_digit(int32_t character) {
    return character >= '0' && character <= '9';
}

static inline bool is_identifier_start(int32_t character) {
    return (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') || character == '_';
}

static inline bool is_operator_start(int32_t character) {
    switch (character) {
        case '+':
        case '*':
        case '/':
        case '%':
        case '<':
        case '>':
        case '=':
        case '!':
        case '~':
        case '|':
        case '&':
            return true;
        default:
            return false;
    }
}

static inline bool should_yield_to_named_code_token(int32_t character) {
    return character == '\'' ||
        character == '"' ||
        character == '#' ||
        is_digit(character) ||
        is_identifier_start(character) ||
        is_operator_start(character);
}

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
                    advance(lexer);
                    saw_code_text = true;
                    mark_end(lexer);
                    continue;
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
                        advance(lexer);
                        saw_code_text = true;
                        mark_end(lexer);
                        continue;
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

        if (should_yield_to_named_code_token(character)) {
            if (saw_code_text) {
                return emit_code_text(lexer, valid_symbols);
            }

            return false;
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
