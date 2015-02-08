var debug = require('debug')('bant:build');
var concat = require('concat-stream');
var through = require('through2');
var inherits = require('util').inherits;
var normalize = require('bant-normalize');
var Duplex = require('readable-stream/duplex');
var Readable = require('readable-stream/readable');
var splicer = require('labeled-stream-splicer');
var browserify = require('browserify');
var factor = require('factor-bundle');
var path = require('path');
var extend = require('util')._extend;


module.exports = build;
inherits(build, Duplex);

function build (b, opts) {
  if (!b || (b && 'function' !== typeof b.bundle))
    opts = b; b = browserify();

  if (!(this instanceof build)) return new build(b, opts);
  Duplex.call(this, { objectMode: true });

  if (!opts) opts = {};

  var self = this;

  this.pipeline = this._createPipeline();
  this._normalize = normalize(opts);
  this._buf = [];
  this._rows = [];
  this._b = b;

  this.pipeline
      .on('data', function (row) {
        self._rows.push(row);
      })
      .once('end', function () {
        self.bundle();
      });

  this._normalize.pipe(this.pipeline);

  this.once('finish', function () { self._normalize.end(); });
}

build.prototype._read = function (n) { 
  var row, self = this, read = 0;
  while ((row = self._buf.shift()) != null) { self.push(row); read++; }
  if (read === 0) {
    self.once('_buffer', function (name, source) { 
      self._buf.push({ name: name || 'common', source: source });
      self._read(n); 
      if (!name) self.push(null);
    });
  }
};

build.prototype._write = function (row, enc, cb) {
  return this._normalize._write(row, enc, cb);
};

build.prototype.bundle = function () {
  var self = this,
      rows = self._rows,
      b = self._b,
      outputs = [], globals = {};

  b.exclude('globals');

  rows.forEach(function (row) {
    if (row.name) {
      var src = '';
      if ('object' === typeof row.globals) {
        src += "var globals = require('globals');\n";
        Object.keys(row.globals).forEach(function (key) {
          src += "globals['" + key + "'] = " + JSON.stringify(row.globals[key]) + ";\n";
        });
      }
      src += "module.exports=require('./" + path.basename(row.main.file) + "');";
      b.require(read(src), {
        entry: true,
        expose: row.main.expose,
        basedir: path.dirname(row.main.file)
      });
      outputs.push(self._concat(row.name));
      b.exclude(row.main.expose);
    } else if ('object' === typeof row.globals) {
      extend(globals, row.globals);
    }
  });

  globals = 'var g = ' + JSON.stringify(globals) + ';\nmodule.exports = g;';
  b.require(read(globals), { entry: true, expose: 'globals' });

  b.plugin(factor, {
    outputs: outputs,
    threshold: function (row, groups) {
      if ('globals' === row.id) return true;
      return this._defaultThreshold(row, groups);
    }
  });

  b.pipeline.get('emit-deps').push(through.obj(function (row, enc, cb) {
    this.push(row);
    cb();
  }));

  b.bundle(function (err, src) {
    if (err) throw err;
  }).pipe(self._concat());
};

build.prototype._globals = function () {
  return through.obj(function (row, enc, cb) {
    if (!row.name && 'object' === typeof row.globals)
      this.push({ globals: row.globals });
    else this.push(row);
    cb();
  });
};

build.prototype._createPipeline = function () {
  var pipeline = splicer.obj([
    'globals', [ this._globals() ],
    'wrap', []
  ]);
  return pipeline;
};

build.prototype._concat = function (name) {
  var self = this;
  return concat(function (buf) {
    self.emit('_buffer', name, buf);
  });
};

function isStream (s) { return s && typeof s.pipe === 'function'; }

function read (src) {
  var s = Readable();
  s._read = function () {
    s.push(src);
    s.push(null);
  };
  return s;
}

