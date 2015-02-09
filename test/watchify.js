var vm = require('vm');
var os = require('os');
var fs = require('fs');
var path = require('path');
var build = require('..');
var test = require('tape');
var through = require('through2');
var browserify = require('browserify');
var watchify = require('watchify');
var mkdirp = require('mkdirp');

var tmpdir = path.join((os.tmpdir || os.tmpDir)(), 'bant-' + Math.random());
var xfile = path.join(tmpdir, 'x.js');
var yfile = path.join(tmpdir, 'y.js');
var zfile = path.join(tmpdir, 'z.js');
var wfile = path.join(tmpdir, 'w.js');

mkdirp.sync(tmpdir);
fs.writeFileSync(zfile, 'module.exports=function (n) { console.log(n); }');
fs.writeFileSync(yfile, "require('"+zfile+"')('foo' + require('"+wfile+"'))");
fs.writeFileSync(xfile, "require('"+zfile+"')('barbaz')");
fs.writeFileSync(wfile, "module.exports='quux'");

function run (src) {
  var output = '';
  function log (n) { output += n; }
  vm.runInNewContext(src, { console: { log: log } });
  return output;
}

test('watchify', function (t) {
  t.plan(3);
  var tr = through.obj();
  var w = watchify(browserify(watchify.args));
  var b = build(w);
  var bundles = [];

  var i = 1;
  b.on('bundle', function (bundle) {
    bundles.push(bundle.source.toString('utf8'));
    if (bundles.length === 3) {
      if (!i) {
        i++;
        setTimeout(function () {
          var src = bundles.reverse().join('\n');
          t.equal(run(src), 'barbazquxfooquuxqux');
          i = 2;
          bundles = [];
          fs.writeFileSync(wfile, "module.exports='eyo'"); 
        }, 1000);
      } else if (i === 1) {
        var src = bundles.reverse().join('\n');
        t.equal(run(src), 'barbazfooquux');
        i--;
        setTimeout(function () {
          bundles = [];
          fs.writeFileSync(zfile, "module.exports=function (n) { console.log(n + 'qux'); }"); 
        }, 10);
      } else if (i === 2) {
        setTimeout(function () {
          var src = bundles.reverse().join('\n');
          t.equal(run(src), 'barbazquxfooeyoqux');
          setTimeout(function () {
            w.close();
          }, 10);
        }, 1000);
      }
    }
  });

  tr.pipe(b);
  tr.write({ name: 'x', main: xfile });
  tr.write({ name: 'y', main: yfile });
  tr.end();
});

