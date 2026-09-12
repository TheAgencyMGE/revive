def summarize(records):
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
