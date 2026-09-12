package com.example.textutils;

import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        System.out.println(Strings.join(Arrays.asList("a", "b", "c"), "-"));
        System.out.println(Strings.reverse("textutils"));
        System.out.println(Strings.split("1,2,3", ',').size());
    }
}
