var build = require('..');
var test = require('tape');
var through = require('through2');
var vm = require('vm');

test('globals-default', function (t) {
  t.plan(2);
  var tr = through.obj();
  var b = build({
    globals: {
      foo: 'bar',
      bar: 'baz'
    }
  });
  var rows = {};
  tr.pipe(b).pipe(through.obj(function (row, enc, cb) {
    rows[row.name] = row;
    cb();
  }, function () {
    var src = rows.common.source.toString('utf8');
    src += rows.y.source.toString('utf8');
    src += rows.x.source.toString('utf8');
    vm.runInNewContext(src, { t: t });
  }));
  tr.write({name: 'y', main: __dirname + '/globals-default/y.js'});
  tr.write({name: 'x', main: __dirname + '/globals-default/x.js'});
  tr.end();
});

