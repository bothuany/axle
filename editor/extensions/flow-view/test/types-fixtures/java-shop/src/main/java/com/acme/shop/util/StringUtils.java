package com.acme.shop.util;

public class StringUtils {
    public static String clean(String s) {
        return s.trim();
    }

    public static boolean blank(String s) {
        return s == null || s.isEmpty();
    }
}
