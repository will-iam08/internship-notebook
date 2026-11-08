package com.coopcompass;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

final class Json {
    private static final Pattern NUMBER = Pattern.compile("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?");

    private Json() { }

    static Optional<String> string(String json, String field) {
        String raw = fields(json).get(field);
        if (raw == null) return Optional.empty();
        if (!raw.startsWith("\"")) throw new IllegalArgumentException(field + " must be a string.");
        return Optional.of(unescape(raw.substring(1, raw.length() - 1)));
    }

    static Optional<Boolean> bool(String json, String field) {
        String raw = fields(json).get(field);
        if (raw == null) return Optional.empty();
        if (raw.startsWith("\"")) raw = unescape(raw.substring(1, raw.length() - 1));
        if (!raw.equals("true") && !raw.equals("false")) throw new IllegalArgumentException(field + " must be a boolean.");
        return Optional.of(Boolean.parseBoolean(raw));
    }

    static List<Long> longArray(String json, String field) {
        String raw = fields(json).get(field);
        if (raw == null) throw new IllegalArgumentException(field + " is required.");
        List<Long> values = new ArrayList<>();
        for (String value : array(raw)) {
            try {
                values.add(Long.parseLong(value));
            } catch (NumberFormatException exception) {
                throw new IllegalArgumentException(field + " must contain whole-number application IDs.");
            }
        }
        return List.copyOf(values);
    }

    static List<String> objectArray(String json, String field) {
        String raw = fields(json).get(field);
        if (raw == null) return List.of();
        List<String> values = array(raw);
        for (String value : values) {
            if (fields(value).values().stream().anyMatch(item -> item.startsWith("{") || item.startsWith("["))) {
                throw new IllegalArgumentException(field + " must contain flat application objects.");
            }
        }
        return values;
    }

    private static Map<String, String> fields(String json) {
        Map<String, String> values = new LinkedHashMap<>();
        int index = skipWhitespace(json, 0);
        if (index >= json.length() || json.charAt(index++) != '{') throw invalid();
        index = skipWhitespace(json, index);
        if (index < json.length() && json.charAt(index) == '}') {
            if (skipWhitespace(json, index + 1) != json.length()) throw invalid();
            return values;
        }
        while (true) {
            index = skipWhitespace(json, index);
            int end = stringEnd(json, index);
            String key = unescape(json.substring(index + 1, end - 1));
            index = skipWhitespace(json, end);
            if (index >= json.length() || json.charAt(index++) != ':') throw invalid();
            index = skipWhitespace(json, index);
            end = valueEnd(json, index);
            if (values.putIfAbsent(key, json.substring(index, end)) != null) throw invalid();
            index = skipWhitespace(json, end);
            if (index >= json.length()) throw invalid();
            char separator = json.charAt(index++);
            if (separator == '}') {
                if (skipWhitespace(json, index) != json.length()) throw invalid();
                return values;
            }
            if (separator != ',') throw invalid();
        }
    }

    private static List<String> array(String json) {
        List<String> values = new ArrayList<>();
        int index = skipWhitespace(json, 0);
        if (index >= json.length() || json.charAt(index++) != '[') throw invalid();
        index = skipWhitespace(json, index);
        if (index < json.length() && json.charAt(index) == ']') {
            if (skipWhitespace(json, index + 1) != json.length()) throw invalid();
            return List.of();
        }
        while (true) {
            index = skipWhitespace(json, index);
            int end = valueEnd(json, index);
            values.add(json.substring(index, end));
            index = skipWhitespace(json, end);
            if (index >= json.length()) throw invalid();
            char separator = json.charAt(index++);
            if (separator == ']') {
                if (skipWhitespace(json, index) != json.length()) throw invalid();
                return List.copyOf(values);
            }
            if (separator != ',') throw invalid();
        }
    }

    private static int valueEnd(String json, int index) {
        if (index >= json.length()) throw invalid();
        char first = json.charAt(index);
        if (first == '"') return stringEnd(json, index);
        if (first == '{' || first == '[') {
            List<Character> endings = new ArrayList<>();
            for (int position = index; position < json.length(); position++) {
                char character = json.charAt(position);
                if (character == '"') position = stringEnd(json, position) - 1;
                else if (character == '{') endings.add('}');
                else if (character == '[') endings.add(']');
                else if (character == '}' || character == ']') {
                    if (endings.isEmpty() || endings.removeLast() != character) throw invalid();
                    if (endings.isEmpty()) return position + 1;
                }
            }
            throw invalid();
        }
        int end = index;
        while (end < json.length() && ",]} \t\r\n".indexOf(json.charAt(end)) < 0) end++;
        String raw = json.substring(index, end);
        if (!raw.equals("true") && !raw.equals("false") && !raw.equals("null") && !NUMBER.matcher(raw).matches()) throw invalid();
        return end;
    }

    private static int stringEnd(String json, int index) {
        if (index >= json.length() || json.charAt(index) != '"') throw invalid();
        for (int position = index + 1; position < json.length(); position++) {
            char character = json.charAt(position);
            if (character == '\\') position++;
            else if (character == '"') {
                unescape(json.substring(index + 1, position));
                return position + 1;
            }
        }
        throw invalid();
    }

    private static int skipWhitespace(String value, int index) {
        while (index < value.length() && " \t\r\n".indexOf(value.charAt(index)) >= 0) index++;
        return index;
    }

    static String escape(String value) {
        if (value == null) return "";
        StringBuilder result = new StringBuilder();
        for (char character : value.toCharArray()) {
            result.append(switch (character) {
                case '"' -> "\\\"";
                case '\\' -> "\\\\";
                case '\b' -> "\\b";
                case '\f' -> "\\f";
                case '\n' -> "\\n";
                case '\r' -> "\\r";
                case '\t' -> "\\t";
                default -> character < 0x20 || Character.isSurrogate(character)
                        ? String.format("\\u%04x", (int) character) : String.valueOf(character);
            });
        }
        return result.toString();
    }

    private static String unescape(String value) {
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character < 0x20) throw invalid();
            if (character != '\\') {
                result.append(character);
                continue;
            }
            if (++index >= value.length()) throw invalid();
            char escaped = value.charAt(index);
            if (escaped == 'u') {
                if (index + 4 >= value.length()) throw invalid();
                String hexadecimal = value.substring(index + 1, index + 5);
                if (!hexadecimal.matches("[0-9a-fA-F]{4}")) throw invalid();
                result.append((char) Integer.parseInt(hexadecimal, 16));
                index += 4;
            } else {
                result.append(switch (escaped) {
                    case '"', '\\', '/' -> escaped;
                    case 'b' -> '\b';
                    case 'f' -> '\f';
                    case 'n' -> '\n';
                    case 'r' -> '\r';
                    case 't' -> '\t';
                    default -> throw invalid();
                });
            }
        }
        return result.toString();
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Request body must contain valid JSON.");
    }
}
