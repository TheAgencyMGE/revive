import re

LINE_PATTERN = re.compile(
    r'(?P<ip>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] '
    r'"(?P<method>\S+) (?P<path>\S+)[^"]*" (?P<status>\d{3}) (?P<size>\S+)'
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
