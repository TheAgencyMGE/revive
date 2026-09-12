"""Generate the demo fixture repositories.

Each fixture is a realistic abandoned project that fails for a specific,
historically accurate reason. They are stored as plain files plus a
fixture.json manifest; scripts/build-fixtures.mjs turns them into real git
repositories with a backdated commit so the metadata reads like a genuinely
old project.

Run: python scripts/gen_fixtures.py
"""

import io
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")


def w(fixture, rel, content):
    path = os.path.join(ROOT, fixture, "files", rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(content)


def meta(fixture, data):
    path = os.path.join(ROOT, fixture, "fixture.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(json.dumps(data, indent=2) + "\n")


# ===========================================================================
# 2. python2-legacy — Python 2 syntax on a Python 3 interpreter (offline)
# ===========================================================================
F = "python2-legacy"
meta(F, {
    "id": F,
    "name": "logparse",
    "title": "Python 2 source on a Python 3 interpreter",
    "language": "python",
    "blurb": "A 2013 log-parsing CLI written for Python 2.7. Python 2 reached end of life in 2020 and its syntax no longer parses.",
    "expectedFailure": "Missing parentheses in call to 'print'",
    "expectedRepair": "Migrate Python 2 syntax to Python 3",
    "requiresNetwork": False,
    "lastCommit": "2013-11-02T09:15:00Z",
})

w(F, ".python-version", "2.7.6\n")

w(F, "setup.py", '''from setuptools import setup, find_packages

setup(
    name="logparse",
    version="0.3.1",
    description="Parse and summarise Apache access logs",
    packages=find_packages(),
    python_requires=">=2.6",
    classifiers=[
        "Programming Language :: Python :: 2",
        "Programming Language :: Python :: 2.7",
    ],
)
''')

w(F, "logparse/__init__.py", '__version__ = "0.3.1"\n')

w(F, "logparse/parser.py", '''import re

LINE_PATTERN = re.compile(
    r'(?P<ip>\\S+) \\S+ \\S+ \\[(?P<time>[^\\]]+)\\] '
    r'"(?P<method>\\S+) (?P<path>\\S+)[^"]*" (?P<status>\\d{3}) (?P<size>\\S+)'
)


def parse_line(line):
    match = LINE_PATTERN.match(line)
    if match is None:
        return None
    record = match.groupdict()
    try:
        record["status"] = int(record["status"])
    except ValueError, exc:
        print "bad status in line:", line
        return None
    record["size"] = 0 if record["size"] == "-" else int(record["size"])
    return record


def parse(lines):
    records = []
    for line in lines:
        record = parse_line(line.strip())
        if record is not None:
            records.append(record)
    return records
''')

w(F, "logparse/summary.py", '''def summarize(records):
    total = len(records)
    bytes_sent = sum(r["size"] for r in records)
    statuses = {}
    for record in records:
        code = record["status"]
        statuses[code] = statuses.get(code, 0) + 1
    return {"total": total, "bytes": bytes_sent, "statuses": statuses}


def report(summary):
    print "Requests: %d" % summary["total"]
    print "Bytes:    %d" % summary["bytes"]
    for code in sorted(summary["statuses"].keys()):
        print "  %d -> %d" % (code, summary["statuses"][code])
''')

w(F, "logparse/cli.py", '''import sys

from logparse.parser import parse
from logparse.summary import report, summarize


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    if not argv:
        print "usage: logparse ACCESS_LOG"
        return 1
    try:
        handle = open(argv[0])
    except IOError, exc:
        print "cannot open %s: %s" % (argv[0], exc)
        return 2
    records = parse(handle)
    handle.close()
    report(summarize(records))
    return 0


if __name__ == "__main__":
    sys.exit(main())
''')

w(F, "tests/test_parser.py", '''import unittest

from logparse.parser import parse_line
from logparse.summary import summarize

SAMPLE = '127.0.0.1 - - [10/Oct/2013:13:55:36 -0700] "GET /index.html HTTP/1.0" 200 2326'


class ParserTest(unittest.TestCase):
    def test_parse_line(self):
        record = parse_line(SAMPLE)
        self.assertIsNotNone(record)
        self.assertEqual(record["status"], 200)
        self.assertEqual(record["size"], 2326)
        self.assertEqual(record["path"], "/index.html")

    def test_summarize(self):
        summary = summarize([parse_line(SAMPLE)])
        self.assertEqual(summary["total"], 1)
        self.assertEqual(summary["bytes"], 2326)


if __name__ == "__main__":
    unittest.main()
''')

w(F, "README.md", '''# logparse

Parse and summarise Apache access logs.

    $ python -m logparse.cli /var/log/apache2/access.log

Requires Python 2.6 or 2.7.
''')


# ===========================================================================
# 3. java-target-mismatch — javac rejects an ancient release level (offline)
# ===========================================================================
F = "java-target-mismatch"
meta(F, {
    "id": F,
    "name": "textutils",
    "title": "Java compiler target no longer supported",
    "language": "java",
    "blurb": "A 2011 utility JAR targeting Java 6. Modern JDKs refuse to compile for release levels that old, and its Maven repository still points at plain HTTP.",
    "expectedFailure": "release version 6 not supported",
    "expectedRepair": "Raise the compiler target to the lowest level this JDK still accepts",
    "requiresNetwork": False,
    "lastCommit": "2011-08-19T16:40:00Z",
})

w(F, "pom.xml", '''<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>com.example</groupId>
  <artifactId>textutils</artifactId>
  <version>1.2.0</version>
  <packaging>jar</packaging>

  <properties>
    <maven.compiler.source>1.6</maven.compiler.source>
    <maven.compiler.target>1.6</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <repositories>
    <repository>
      <id>central</id>
      <url>http://repo1.maven.org/maven2</url>
    </repository>
  </repositories>
</project>
''')

w(F, "src/main/java/com/example/textutils/Strings.java", '''package com.example.textutils;

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
''')

w(F, "src/main/java/com/example/textutils/Main.java", '''package com.example.textutils;

import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        System.out.println(Strings.join(Arrays.asList("a", "b", "c"), "-"));
        System.out.println(Strings.reverse("textutils"));
        System.out.println(Strings.split("1,2,3", ',').size());
    }
}
''')

w(F, "README.md", '''# textutils

String helpers for Java 6 and up.

    mvn package

Built against JDK 1.6.
''')


# ===========================================================================
# 4. go-version-directive — go.mod demands a newer toolchain (offline)
# ===========================================================================
F = "go-version-directive"
meta(F, {
    "id": F,
    "name": "shortlink",
    "title": "Go module requires an unavailable toolchain",
    "language": "go",
    "blurb": "A URL shortener whose go.mod pins a Go release newer than the installed toolchain, so the build stops before compiling anything.",
    "expectedFailure": "go.mod requires go >= 1.99",
    "expectedRepair": "Lower the go directive to the installed toolchain",
    "requiresNetwork": False,
    "lastCommit": "2021-03-08T11:05:00Z",
})

w(F, "go.mod", '''module shortlink

go 1.99
''')

w(F, "main.go", '''package main

import (
\t"fmt"
\t"log"
\t"net/http"
)

func main() {
\tstore := NewStore()
\tstore.Put("go", "https://go.dev")

\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
\t\tkey := r.URL.Path[1:]
\t\ttarget, ok := store.Get(key)
\t\tif !ok {
\t\t\thttp.NotFound(w, r)
\t\t\treturn
\t\t}
\t\thttp.Redirect(w, r, target, http.StatusFound)
\t})

\tfmt.Println("listening on :8080")
\tlog.Fatal(http.ListenAndServe(":8080", nil))
}
''')

w(F, "store.go", '''package main

import "sync"

// Store is a tiny in-memory key to URL map.
type Store struct {
\tmu    sync.RWMutex
\tlinks map[string]string
}

func NewStore() *Store {
\treturn &Store{links: make(map[string]string)}
}

func (s *Store) Put(key, target string) {
\ts.mu.Lock()
\tdefer s.mu.Unlock()
\ts.links[key] = target
}

func (s *Store) Get(key string) (string, bool) {
\ts.mu.RLock()
\tdefer s.mu.RUnlock()
\ttarget, ok := s.links[key]
\treturn target, ok
}

func (s *Store) Len() int {
\ts.mu.RLock()
\tdefer s.mu.RUnlock()
\treturn len(s.links)
}
''')

w(F, "store_test.go", '''package main

import "testing"

func TestStorePutGet(t *testing.T) {
\ts := NewStore()
\ts.Put("a", "https://example.com")

\tgot, ok := s.Get("a")
\tif !ok {
\t\tt.Fatal("expected key to exist")
\t}
\tif got != "https://example.com" {
\t\tt.Fatalf("got %q", got)
\t}
\tif s.Len() != 1 {
\t\tt.Fatalf("expected 1 link, got %d", s.Len())
\t}
}

func TestStoreMissing(t *testing.T) {
\ts := NewStore()
\tif _, ok := s.Get("nope"); ok {
\t\tt.Fatal("expected miss")
\t}
}
''')

w(F, "README.md", '''# shortlink

A minimal URL shortener. Standard library only.

    go run .
''')


# ===========================================================================
# 5. rust-msrv — declared MSRV exceeds the installed compiler (offline)
# ===========================================================================
F = "rust-msrv"
meta(F, {
    "id": F,
    "name": "wordfreq",
    "title": "Crate declares an unreachable minimum Rust version",
    "language": "rust",
    "blurb": "A word-frequency CLI whose Cargo.toml claims it needs a Rust version that does not exist on this machine. Cargo refuses to build before compiling a line.",
    "expectedFailure": "cannot be built because it requires rustc 1.99.0",
    "expectedRepair": "Lower the declared minimum supported Rust version",
    "requiresNetwork": False,
    "lastCommit": "2020-09-27T14:30:00Z",
})

w(F, "Cargo.toml", '''[package]
name = "wordfreq"
version = "0.2.0"
edition = "2018"
rust-version = "1.99.0"
description = "Count word frequencies in a text file"
license = "MIT"

[dependencies]

[[bin]]
name = "wordfreq"
path = "src/main.rs"
''')

w(F, "src/main.rs", '''use std::collections::HashMap;
use std::env;
use std::fs;

mod counter;

use counter::count_words;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: wordfreq FILE");
        std::process::exit(1);
    }

    let contents = match fs::read_to_string(&args[1]) {
        Ok(text) => text,
        Err(err) => {
            eprintln!("cannot read {}: {}", args[1], err);
            std::process::exit(2);
        }
    };

    let counts: HashMap<String, usize> = count_words(&contents);
    let mut pairs: Vec<(&String, &usize)> = counts.iter().collect();
    pairs.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));

    for (word, count) in pairs.iter().take(20) {
        println!("{:>6}  {}", count, word);
    }
}
''')

w(F, "src/counter.rs", '''use std::collections::HashMap;

/// Count word occurrences, lowercasing and stripping punctuation.
pub fn count_words(text: &str) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for raw in text.split_whitespace() {
        let word: String = raw
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '\\'')
            .collect::<String>()
            .to_lowercase();
        if word.is_empty() {
            continue;
        }
        *counts.entry(word).or_insert(0) += 1;
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::count_words;

    #[test]
    fn counts_repeated_words() {
        let counts = count_words("the cat the hat");
        assert_eq!(counts.get("the"), Some(&2));
        assert_eq!(counts.get("cat"), Some(&1));
    }

    #[test]
    fn strips_punctuation_and_case() {
        let counts = count_words("Hello, hello! HELLO?");
        assert_eq!(counts.get("hello"), Some(&3));
    }

    #[test]
    fn ignores_empty_tokens() {
        let counts = count_words("--- ...");
        assert!(counts.is_empty());
    }
}
''')

w(F, "README.md", '''# wordfreq

Count the most frequent words in a text file.

    cargo run -- book.txt
''')


print("Generated fixtures:", ", ".join(sorted(
    d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, d)) and not d.startswith(".")
)))
