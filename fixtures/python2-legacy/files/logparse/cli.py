import sys

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
