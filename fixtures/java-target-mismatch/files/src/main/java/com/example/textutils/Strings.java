package com.example.textutils;

import java.util.ArrayList;
import java.util.List;

/** Small string helpers extracted from an internal codebase. */
public final class Strings {

    private Strings() {
    }

    public static String join(List<String> parts, String separator) {
        if (parts == null || parts.isEmpty()) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0) {
                builder.append(separator);
            }
            builder.append(parts.get(i));
        }
        return builder.toString();
    }

    public static List<String> split(String value, char separator) {
        List<String> result = new ArrayList<String>();
        if (value == null || value.length() == 0) {
            return result;
        }
        int start = 0;
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) == separator) {
                result.add(value.substring(start, i));
                start = i + 1;
            }
        }
        result.add(value.substring(start));
        return result;
    }

    public static String reverse(String value) {
        if (value == null) {
            return null;
        }
        return new StringBuilder(value).reverse().toString();
    }

    public static boolean isBlank(String value) {
        return value == null || value.trim().length() == 0;
    }
}
