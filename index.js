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
      outputs = [];

  rows.forEach(function (row) {
    var src = "module.exports=require('./" + path.basename(row.main.file) + "');";
    b.require(read(src), {
      entry: true,
      expose: row.main.expose,
      basedir: path.dirname(row.main.file)
    });
    outputs.push(self._concat(row.name));
    b.exclude(row.main.expose);
  });

  b.plugin(factor, {
    outputs: outputs
  });
  b.bundle(function (err, src) {
    if (err) throw err;
  }).pipe(self._concat());
};

build.prototype._createPipeline = function () {
  var pipeline = splicer.obj([
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

