import unittest

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
