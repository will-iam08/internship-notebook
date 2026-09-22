package com.coopcompass;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class Json {
    private Json() { }

    static Optional<String> string(String json, String field) {
        Pattern pattern = Pattern.compile("\\\"" + Pattern.quote(field) + "\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"");
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? Optional.of(unescape(matcher.group(1))) : Optional.empty();
    }

    static Optional<Boolean> bool(String json, String field) {
        Pattern pattern = Pattern.compile("\\\"" + Pattern.quote(field) + "\\\"\\s*:\\s*\\\"?(true|false)\\\"?");
        Matcher matcher = pattern.matcher(json);
        return matcher.find() ? Optional.of(Boolean.parseBoolean(matcher.group(1))) : Optional.empty();
    }

    static List<Long> longArray(String json, String field) {
        Pattern property = Pattern.compile("\\\"" + Pattern.quote(field) + "\\\"\\s*:\\s*");
        Matcher matcher = property.matcher(json);
        if (!matcher.find()) throw new IllegalArgumentException(field + " is required.");

        int index = matcher.end();
        if (index >= json.length() || json.charAt(index) != '[') {
            throw new IllegalArgumentException(field + " must be an array of application IDs.");
        }
        index++;

        List<Long> values = new ArrayList<>();
        boolean expectingValue = true;
        while (true) {
            index = skipWhitespace(json, index);
            if (index >= json.length()) throw new IllegalArgumentException(field + " must be a complete array of application IDs.");

            if (json.charAt(index) == ']') {
                if (expectingValue && !values.isEmpty()) {
                    throw new IllegalArgumentException(field + " must be an array of application IDs.");
                }
                return List.copyOf(values);
            }
            if (!expectingValue) throw new IllegalArgumentException(field + " must be an array of application IDs.");

            int start = index;
            if (json.charAt(index) == '-') index++;
            int digitsStart = index;
            while (index < json.length() && Character.isDigit(json.charAt(index))) index++;
            if (digitsStart == index) throw new IllegalArgumentException(field + " must contain whole-number application IDs.");
            try {
                values.add(Long.parseLong(json.substring(start, index)));
            } catch (NumberFormatException exception) {
                throw new IllegalArgumentException(field + " must contain valid application IDs.");
            }

            index = skipWhitespace(json, index);
            if (index >= json.length()) throw new IllegalArgumentException(field + " must be a complete array of application IDs.");
            char separator = json.charAt(index++);
            if (separator == ']') return List.copyOf(values);
            if (separator != ',') throw new IllegalArgumentException(field + " must be an array of application IDs.");
            expectingValue = true;
        }
    }

    private static int skipWhitespace(String value, int index) {
        while (index < value.length() && Character.isWhitespace(value.charAt(index))) index++;
        return index;
    }

    static String escape(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }

    private static String unescape(String value) {
        StringBuilder result = new StringBuilder();
        boolean escaping = false;
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (escaping) {
                result.append(switch (character) {
                    case 'n' -> '\n';
                    case 'r' -> '\r';
                    case 't' -> '\t';
                    default -> character;
                });
                escaping = false;
            } else if (character == '\\') {
                escaping = true;
            } else {
                result.append(character);
            }
        }
        if (escaping) result.append('\\');
        return result.toString();
    }
}
