use std::collections::HashMap;

/// Count word occurrences, lowercasing and stripping punctuation.
pub fn count_words(text: &str) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for raw in text.split_whitespace() {
        let word: String = raw
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '\'')
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
