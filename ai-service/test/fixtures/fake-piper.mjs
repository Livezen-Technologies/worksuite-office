// A stand-in for Piper: text on stdin, raw s16le PCM on stdout (100 samples per character).
let t = "";
process.stdin.on("data", (d) => (t += d));
process.stdin.on("end", () => { process.stdout.write(Buffer.alloc(t.trim().length * 200, 1)); });
