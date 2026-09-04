#!/bin/sh
# Run the suites. With no arguments, all of them; otherwise the ones named:
#
#   sh test/run.sh                 everything
#   sh test/run.sh trail swipe     just those two
#
# Each suite drives a real Chromium against a real copy of the page, stubs
# the city's API and the map libraries, and prints what it found rather than
# asserting silently — the output is meant to be read. A suite that throws
# has failed; a suite that prints "page errors: none" at the end has passed.
#
# Screenshots land in test/vendor/, which is gitignored, because the suites
# resolve the vendored libraries relative to the working directory.
set -e
here=$(cd "$(dirname "$0")" && pwd)
port=${PORT:-8150}
export PORT=$port

if [ ! -f "$here/vendor/ml.js" ]; then
  echo "no vendored libraries yet — running test/vendor.sh first"
  sh "$here/vendor.sh"
fi

node "$here/chk.js"

# a plain static server over public/, so the page is fetched the way it ships
node -e '
const http=require("http"),fs=require("fs"),path=require("path");
const root=process.argv[1];
const type=f=>f.endsWith(".html")?"text/html":f.endsWith(".css")?"text/css":
  f.endsWith(".js")?"application/javascript":"application/octet-stream";
http.createServer((q,s)=>{
  let f=q.url.split("?")[0]; if(f==="/")f="/index.html";
  fs.readFile(path.join(root,f),(e,d)=>{
    if(e){s.writeHead(404);return s.end("not found");}
    s.writeHead(200,{"content-type":type(f)});s.end(d);});
}).listen(process.argv[2]);
' "$here/../public" "$port" &
server=$!
trap 'kill $server 2>/dev/null' EXIT
sleep 1

suites="$*"
if [ -z "$suites" ]; then
  suites="chk trail swipe link spot third tidy trim card queue sheet dup keep across four photo pop vec wlog watch"
  suites=$(echo "$suites" | sed 's/chk //')
fi

cd "$here/vendor"
fail=0
for s in $suites; do
  f="$here/suites/$s.js"
  [ -f "$f" ] || f="$here/suites/$s.mjs"
  if [ ! -f "$f" ]; then echo "FAIL  $s  (no such suite)"; fail=1; continue; fi
  out=$(node "$f" 2>&1) || { printf 'FAIL  %-8s\n' "$s"; echo "$out" | tail -12; fail=1; continue; }
  if echo "$out" | grep -q "page errors *: *none" || [ "$s" = wlog ] || [ "$s" = watch ]; then
    printf 'ok    %-8s\n' "$s"
  else
    printf 'ERRS  %-8s\n' "$s"; echo "$out" | tail -12; fail=1
  fi
done
exit $fail
