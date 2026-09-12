use std::collections::HashMap;
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
